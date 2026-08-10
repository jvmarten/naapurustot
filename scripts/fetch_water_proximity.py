#!/usr/bin/env python3
"""Compute how far a postal code area's RESIDENTS live from the nearest water body.

Fetches water body data from OpenStreetMap via Overpass API, reprojects to
EPSG:3067 (Finnish metric CRS), and uses Shapely STRtree for efficient
nearest-geometry queries.

Measured from people, not from the polygon
------------------------------------------
This metric used to be ``postal_polygon.distance(nearest_water)`` — the gap
between the area's OUTLINE and the nearest water. In a country with ~188,000
lakes and a median postal area of 52 km², that asks "does this area contain a
pond?", and the answer is almost always yes: **2,789 of 3,018 areas (92.4 %)
read exactly 0 m**, so the layer painted one flat colour over the whole country
and contributed an identical constant to the quality index for 92 % of Finland.

It is now the population-weighted mean distance from where people actually
live to the nearest water, using Statistics Finland's 1 km population grid
(``fetch_population_grid.py``). Each populated cell centre inside the postal
area contributes its own point-to-water distance, weighted by inhabitants.

Because it measures from a POINT rather than from the polygon, the result no
longer collapses to zero the moment an area happens to contain a lake — a cell
centre is only at distance 0 if the water reaches the cell centre itself.

Small dense areas (37 of 3,018, median 0.54 km² — Sörnäinen, Keski-Töölö and
similar) contain no 1 km cell centre at all. They fall back to the polygon's
representative point, which for an area smaller than a single grid cell is an
equally good statement of "where the residents are". No area is left null,
which matters because the quality index weights this factor.

Inputs:
    scripts/cache/population_grid_1km.json  — written by fetch_population_grid.py
    public/data/metro_neighborhoods.geojson — postal polygons

Output: scripts/water_proximity.json  {"postal_code": distance_in_meters}

Usage:
    python scripts/fetch_population_grid.py     # once, to build the grid cache
    python scripts/fetch_water_proximity.py
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests
import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon

from regions_config import ALL_BBOXES

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_PATH = SCRIPT_DIR / "water_proximity.json"
CACHE_DIR = SCRIPT_DIR / "cache"
POPULATION_GRID_PATH = CACHE_DIR / "population_grid_1km.json"

# ---------------------------------------------------------------------------
# Bounding boxes — all 69 Finnish seutukunnat (from regions_config)
# ALL_BBOXES is imported at the top of the file: a list of Overpass bbox
# strings "south,west,north,east".
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Retry & rate-limit settings
# ---------------------------------------------------------------------------

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
MAX_RETRIES = 5
RETRY_BACKOFF_BASE = 3  # seconds; exponential: 3, 9, 27, 81
RATE_LIMIT_DELAY = 10.0  # seconds between successive API calls (generous for Overpass)

# ---------------------------------------------------------------------------
# Cache helpers (mirrors prepare_data.py)
# ---------------------------------------------------------------------------


def _cache_path(key: str) -> Path:
    """Return the cache file path for a given key."""
    safe = key.replace("/", "_").replace(":", "_").replace("?", "_").replace("&", "_")
    return CACHE_DIR / f"{safe}.json"


def _save_cache(key: str, data):
    """Save data to the cache directory."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(key)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    logger.info("  Cached response -> %s", path.name)


def _load_cache(key: str):
    """Load data from cache. Returns None if not found."""
    path = _cache_path(key)
    if path.exists():
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        logger.info("  Loaded from cache: %s", path.name)
        return data
    return None


# ---------------------------------------------------------------------------
# Retry helper (mirrors prepare_data.py)
# ---------------------------------------------------------------------------


def _request_with_retry(method, url, *, label, retries=MAX_RETRIES, **kwargs):
    """Execute an HTTP request with exponential-backoff retries."""
    kwargs.setdefault("timeout", 120)
    # Overpass rejects requests with no User-Agent (HTTP 406). Merge, don't clobber.
    headers = {"User-Agent": "naapurustot.fi data pipeline (+https://naapurustot.fi)"}
    headers.update(kwargs.get("headers") or {})
    kwargs["headers"] = headers
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.request(method, url, **kwargs)
            r.raise_for_status()
            return r
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                wait = RETRY_BACKOFF_BASE ** attempt
                logger.warning(
                    "Retry %d/%d for %s in %ds (%s)",
                    attempt, retries, label, wait, exc,
                )
                time.sleep(wait)
    raise last_exc  # type: ignore[misc]


def _rate_limit():
    """Sleep briefly between API calls to be a good citizen."""
    time.sleep(RATE_LIMIT_DELAY)


# ---------------------------------------------------------------------------
# Overpass query helpers (mirrors prepare_data.py)
# ---------------------------------------------------------------------------


def _overpass_query(query: str, label: str) -> tuple[list, bool]:
    """Execute an Overpass API query and return (elements, used_network).

    Cache-first: if we already have a cached response for this label on disk,
    use it without hitting the network.  ``used_network`` lets the caller skip
    rate-limit sleeps for cache hits.

    Raises rather than returning empty on failure. A region that silently
    yields no water bodies does not produce a gap — it produces *wrong values*,
    because every postal code in it is then measured against whatever lakes
    happen to sit in a neighbouring bbox, and reads as far from water. The
    same guard exists in ``prepare_data._overpass_query_all_regions``; this
    fetcher predated it.
    """
    cache_key = f"overpass_{label.replace(' ', '_').replace('(', '').replace(')', '').replace(',', '')}"
    cached = _load_cache(cache_key)
    if cached is not None:
        if not cached:
            raise RuntimeError(
                f"Cached Overpass response for {label} is empty. An older run "
                "may have stored a failed fetch; delete the cache entry and refetch."
            )
        logger.info("  Using cached data for %s (%s elements)", label, len(cached))
        return cached, False
    r = _request_with_retry(
        "POST", OVERPASS_URL, label=label,
        data={"data": query},
        timeout=120,
    )
    data = r.json()
    # Overpass reports server-side timeouts as HTTP 200 with a "remark" field,
    # so a truncated result looks exactly like a successful small one.
    remark = data.get("remark")
    if remark:
        raise RuntimeError(f"Overpass returned a remark for {label}: {remark}")
    elements = data.get("elements", [])
    if not elements:
        raise RuntimeError(
            f"Overpass returned zero elements for {label}. Every Finnish "
            "seutukunta contains water; treating this as a fetch failure."
        )
    logger.info("  Fetched %s elements for %s", len(elements), label)
    _save_cache(cache_key, elements)
    return elements, True


def _iter_overpass_elements_by_region(query_template: str, label: str):
    """Yield (region_bbox, [elements]) one region at a time.

    Streaming the regions instead of accumulating them lets the caller process
    each region's data and free it before loading the next. With ~350k OSM
    elements nationally, accumulating then deduplicating doubles peak memory.
    Deduplication is done by the caller via a seen-set on (type, id).
    """
    for bbox in ALL_BBOXES:
        query = query_template.replace("{BBOX}", bbox)
        elements, used_network = _overpass_query(query, f"{label} ({bbox})")
        yield bbox, elements
        if used_network:
            _rate_limit()


# ---------------------------------------------------------------------------
# Fetch water bodies from OSM
# ---------------------------------------------------------------------------


WATER_QUERY_TEMPLATE = """
[out:json][timeout:120];
(
  way["natural"="water"]({BBOX});
  relation["natural"="water"]({BBOX});
  way["natural"="coastline"]({BBOX});
);
out geom;
"""


def iter_water_bodies_by_region():
    """Yield (bbox, elements) for each seutukunta — see _iter_overpass_elements_by_region.

    Excludes rivers and small streams which are too ubiquitous to create
    meaningful distance differentiation between postal codes.
    Only fetches: natural=water (lakes, ponds), natural=coastline (sea).
    Small ponds are filtered out by area in the geometry parsing step.
    """
    logger.info("Fetching significant water bodies from OpenStreetMap (streaming by region)...")
    yield from _iter_overpass_elements_by_region(WATER_QUERY_TEMPLATE, "OSM water bodies")


# ---------------------------------------------------------------------------
# Parse OSM elements into Shapely geometries
# ---------------------------------------------------------------------------


def _iter_water_geometries(elements: list):
    """Yield Shapely geometries in WGS-84 parsed from OSM Overpass elements.

    Streamed (generator) rather than accumulated into a list so the caller can
    reproject and filter incrementally — fetching nationally produces ~350k
    geometries, and keeping a full WGS-84 *and* EPSG:3067 copy in memory at
    once will OOM on a 16 GB machine.

    Geometry rules:
    - Closed ways (lakes, ponds, riverbanks)  -> Polygon
    - Open ways (rivers, coastlines)          -> LineString
    - Relations (multipolygon lakes/rivers)   -> one Polygon per outer member

    For relations we yield each outer ring as its own simple polygon and drop
    inner rings entirely. Postal-code-level distance to water doesn't need to
    distinguish "lake interior" from "island within lake" — and pairing each
    outer with its containing inners would either require a quadratic point-
    in-polygon scan or risk attaching every inner to every outer (which on
    huge relations like Päijänne — 1546 members — turned a 7-second region
    into a 5-minute hang during the national rollout).

    ``make_valid`` is also skipped: outer ring polygons coming straight from
    OSM are almost always valid, and the validity check itself is the slow
    step on multi-thousand-vertex rings. Invalid geometries fall through to
    a try/except below.
    """
    for el in elements:
        try:
            if el.get("type") == "way" and "geometry" in el:
                coords = [(pt["lon"], pt["lat"]) for pt in el["geometry"]]
                if len(coords) < 2:
                    continue
                if len(coords) >= 4 and coords[0] == coords[-1]:
                    poly = Polygon(coords)
                    if not poly.is_empty:
                        yield poly
                else:
                    line = LineString(coords)
                    if not line.is_empty:
                        yield line

            elif el.get("type") == "relation" and "members" in el:
                for m in el["members"]:
                    if "geometry" not in m:
                        continue
                    if m.get("role") == "inner":
                        continue
                    coords = [(pt["lon"], pt["lat"]) for pt in m["geometry"]]
                    if len(coords) < 4:
                        continue
                    # Close the ring if needed.
                    if coords[0] != coords[-1]:
                        coords.append(coords[0])
                    try:
                        poly = Polygon(coords)
                        if not poly.is_empty:
                            yield poly
                    except Exception:
                        continue
        except Exception:
            continue


# ---------------------------------------------------------------------------
# Reproject helper
# ---------------------------------------------------------------------------


def _build_reprojector():
    """Build a WGS84 -> EPSG:3067 transformer and return a Shapely-compatible function."""
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:3067", always_xy=True)

    def reproject(x, y, z=None):
        return transformer.transform(x, y)

    return reproject


# ---------------------------------------------------------------------------
# Compute distances
# ---------------------------------------------------------------------------


def load_population_points() -> gpd.GeoDataFrame:
    """Load the Statistics Finland 1 km population grid as EPSG:3067 points.

    The grid is published as centre points in EPSG:3067 already, so this is a
    straight read — no reprojection, no geocoding.
    """
    if not POPULATION_GRID_PATH.exists():
        raise SystemExit(
            f"Population grid not found at {POPULATION_GRID_PATH}.\n"
            "  Run: python scripts/fetch_population_grid.py"
        )
    payload = json.loads(POPULATION_GRID_PATH.read_text(encoding="utf-8"))
    if payload.get("crs") != "EPSG:3067":
        raise SystemExit(f"Population grid is in {payload.get('crs')}, expected EPSG:3067")
    cells = payload["cells"]
    logger.info(
        "Loaded %d populated 1 km cells (%d inhabitants, %s)",
        len(cells), sum(c[2] for c in cells), payload.get("layer", "?"),
    )
    return gpd.GeoDataFrame(
        {"vaesto": [c[2] for c in cells]},
        geometry=[Point(c[0], c[1]) for c in cells],
        crs="EPSG:3067",
    )


def compute_water_proximity(geojson_path: Path) -> dict[str, float]:
    """Population-weighted mean distance (m) from residents to the nearest water.

    Returns dict of postal_code -> distance in meters (rounded to 10m).
    See the module docstring for why this is measured from population rather
    than from the postal polygon.
    """
    # 1. Load postal code areas
    logger.info("Loading postal code areas from %s", geojson_path)
    gdf = gpd.read_file(geojson_path)
    logger.info("  Loaded %d postal code areas", len(gdf))

    # 2+3+4. Fetch, parse, reproject and filter per region in a single pass.
    #
    # Two reasons it's done per-region rather than nationally:
    #  - Holding both raw OSM dicts AND parsed Shapely geometries for all 350k
    #    national elements at once peaked at >10 GB RSS.
    #  - Vectorized GeoSeries.to_crs() (used here per region) is ~100× faster
    #    than calling shapely.ops.transform on each geometry individually,
    #    because pyproj transforms whole coordinate arrays in one C call.
    #
    # Minimum area threshold: 1 hectare (10,000 m²) for polygons. Filters out
    # tiny ponds/puddles that don't represent meaningful "water access".
    # Coastlines (LineStrings) are always kept.
    MIN_WATER_AREA_M2 = 10_000

    water_geoms_3067: list = []
    seen_ids: set = set()
    parsed_count = 0
    skipped_small = 0
    region_count = 0

    for bbox, elements in iter_water_bodies_by_region():
        region_count += 1
        # Dedupe across regions: many lakes straddle seutukunta bboxes.
        unique_elements = []
        for el in elements:
            eid = (el.get("type", ""), el.get("id", ""))
            if eid in seen_ids:
                continue
            seen_ids.add(eid)
            unique_elements.append(el)
        del elements

        # Parse this region's geometries (WGS-84) into a list...
        region_geoms_wgs = list(_iter_water_geometries(unique_elements))
        del unique_elements
        parsed_count += len(region_geoms_wgs)
        if not region_geoms_wgs:
            if region_count % 10 == 0:
                logger.info(
                    "  After region %d/%d: parsed %d, kept %d (%d small skipped)",
                    region_count, len(ALL_BBOXES), parsed_count,
                    len(water_geoms_3067), skipped_small,
                )
            continue

        # ...then bulk-reproject the whole region in one vectorized C call.
        region_gs = gpd.GeoSeries(region_geoms_wgs, crs="EPSG:4326").to_crs("EPSG:3067")
        del region_geoms_wgs

        # Filter: drop empties, drop polygons smaller than 1 ha (keep all lines).
        for g in region_gs:
            if g is None or g.is_empty:
                continue
            if hasattr(g, "area") and g.area > 0 and g.area < MIN_WATER_AREA_M2:
                skipped_small += 1
                continue
            water_geoms_3067.append(g)
        del region_gs

        if region_count % 10 == 0:
            logger.info(
                "  After region %d/%d: parsed %d, kept %d (%d small skipped)",
                region_count, len(ALL_BBOXES), parsed_count,
                len(water_geoms_3067), skipped_small,
            )

    if not water_geoms_3067:
        logger.error("No valid water geometries after reprojection")
        return {}
    logger.info(
        "  Kept %d water geometries (skipped %d small polygons < 1ha)",
        len(water_geoms_3067), skipped_small,
    )

    gdf_proj = gdf.to_crs("EPSG:3067")
    if "pno" not in gdf_proj.columns:
        raise SystemExit("Postal GeoJSON has no 'pno' column")
    gdf_proj = gdf_proj[gdf_proj["pno"].notna() & (gdf_proj["pno"] != "")]
    gdf_proj = gdf_proj[gdf_proj.geometry.notna() & ~gdf_proj.geometry.is_empty]

    # 5. Build spatial index
    logger.info("Building spatial index (STRtree) over %d water geometries...",
                len(water_geoms_3067))
    tree = STRtree(water_geoms_3067)

    # 6. Place the population on the map and measure from it.
    #
    # One vectorised nearest() over ~97k points beats a Python-level loop by
    # roughly two orders of magnitude: shapely walks the tree in C once for the
    # whole array instead of re-entering it per point.
    points = load_population_points()
    logger.info("Assigning population cells to postal areas...")
    joined = gpd.sjoin(
        points, gdf_proj[["pno", "geometry"]], how="inner", predicate="within"
    )
    logger.info(
        "  %d of %d cells fall inside a postal polygon (%d inhabitants)",
        len(joined), len(points), int(joined["vaesto"].sum()),
    )

    logger.info("Measuring cell centres to nearest water...")
    cell_geoms = np.asarray(joined.geometry.values)
    nearest_idx = tree.nearest(cell_geoms)
    nearest_water = np.asarray(water_geoms_3067, dtype=object)[nearest_idx]
    joined = joined.assign(dist=shapely.distance(cell_geoms, nearest_water))

    # Population-weighted mean: sum(pop * dist) / sum(pop). Cells with no
    # inhabitants cannot occur — the grid only publishes populated cells — but
    # guard the divisor anyway so a future vintage cannot produce NaN.
    joined = joined.assign(weighted=joined["vaesto"] * joined["dist"])
    grouped = joined.groupby("pno").agg(
        weighted=("weighted", "sum"), residents=("vaesto", "sum")
    )
    grouped = grouped[grouped["residents"] > 0]
    # NB: the population column must not be called "pop" — attribute access on a
    # pandas row resolves `row.pop` to Series.pop, the method, and the division
    # then fails with an unhelpful TypeError.
    results: dict[str, float] = {
        pno: round(row.weighted / row.residents / 10) * 10
        for pno, row in grouped.iterrows()
    }
    logger.info("  %d postal areas measured from their population", len(results))

    # 7. Fallback for areas holding no 1 km cell centre. These are small and
    # dense (median 0.54 km²) — smaller than one grid cell — so the polygon's
    # representative point is as good a statement of "where the residents are"
    # as a grid cell centre would be. Leaving them null is not an option: the
    # quality index weights this factor, and a null would drop them from it.
    missing = gdf_proj[~gdf_proj["pno"].isin(set(results))]
    if len(missing):
        logger.info("  %d areas hold no populated cell centre; using their "
                    "representative point", len(missing))
        rep_points = np.asarray(missing.geometry.representative_point().values)
        rep_nearest = np.asarray(water_geoms_3067, dtype=object)[tree.nearest(rep_points)]
        rep_dists = shapely.distance(rep_points, rep_nearest)
        for pno, dist in zip(missing["pno"], rep_dists):
            results[pno] = round(dist / 10) * 10

    logger.info("Computed water proximity for %d postal codes", len(results))

    # Log summary statistics
    if results:
        values = sorted(results.values())
        zero_count = sum(1 for v in values if v == 0)
        logger.info(
            "  Min: %dm, Median: %dm, Avg: %dm, p90: %dm, Max: %dm, Exactly zero: %d (%.1f%%)",
            values[0],
            values[len(values) // 2],
            int(sum(values) / len(values)),
            values[int(0.9 * (len(values) - 1))],
            values[-1],
            zero_count,
            100 * zero_count / len(values),
        )

    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    logger.info("=== Water Proximity Calculator ===")

    if not GEOJSON_PATH.exists():
        logger.error("GeoJSON not found at %s", GEOJSON_PATH)
        raise SystemExit(1)

    results = compute_water_proximity(GEOJSON_PATH)

    if not results:
        logger.error("No results computed")
        raise SystemExit(1)

    # Save results
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)
    logger.info("Saved results to %s (%d entries)", OUTPUT_PATH, len(results))


if __name__ == "__main__":
    main()
