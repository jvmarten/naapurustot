#!/usr/bin/env python3
"""Compute minimum distance from each postal code area to the nearest significant water body.

Fetches water body data from OpenStreetMap via Overpass API, reprojects to
EPSG:3067 (Finnish metric CRS), and uses Shapely STRtree for efficient
nearest-geometry queries.

Output: scripts/water_proximity.json  {"postal_code": distance_in_meters}

Usage:
    python scripts/fetch_water_proximity.py
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import geopandas as gpd
import requests
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import transform as shapely_transform
from shapely.validation import make_valid

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

# ---------------------------------------------------------------------------
# Bounding boxes (same as prepare_data.py)
# ---------------------------------------------------------------------------

HELSINKI_METRO_BBOX = "60.10,24.50,60.40,25.25"
TURKU_BBOX = "60.25,21.50,60.75,22.90"
TAMPERE_BBOX = "61.20,23.10,62.20,25.00"
ALL_BBOXES = [HELSINKI_METRO_BBOX, TURKU_BBOX, TAMPERE_BBOX]

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
    with open(path, "w") as f:
        json.dump(data, f)
    logger.info("  Cached response -> %s", path.name)


def _load_cache(key: str):
    """Load data from cache. Returns None if not found."""
    path = _cache_path(key)
    if path.exists():
        with open(path) as f:
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


def _overpass_query(query: str, label: str) -> list:
    """Execute an Overpass API query and return elements, with cache fallback."""
    cache_key = f"overpass_{label.replace(' ', '_').replace('(', '').replace(')', '').replace(',', '')}"
    try:
        r = _request_with_retry(
            "POST", OVERPASS_URL, label=label,
            data={"data": query},
            timeout=120,
        )
        data = r.json()
        elements = data.get("elements", [])
        logger.info("  Fetched %s elements for %s", len(elements), label)
        _save_cache(cache_key, elements)
        return elements
    except Exception as e:
        logger.warning("  Fetch failed for %s: %s, trying cache...", label, e)
        cached = _load_cache(cache_key)
        if cached is not None:
            logger.info("  Using cached data for %s (%s elements)", label, len(cached))
            return cached
        return []


def _overpass_query_all_regions(query_template: str, label: str) -> list:
    """Run an Overpass query for all region bounding boxes and combine results."""
    all_elements: list = []
    for bbox in ALL_BBOXES:
        query = query_template.replace("{BBOX}", bbox)
        _rate_limit()
        elements = _overpass_query(query, f"{label} ({bbox})")
        all_elements.extend(elements)
    # Deduplicate by element id
    seen: set = set()
    unique: list = []
    for el in all_elements:
        eid = (el.get("type", ""), el.get("id", ""))
        if eid not in seen:
            seen.add(eid)
            unique.append(el)
    logger.info("  Total unique elements for %s: %s", label, len(unique))
    return unique


# ---------------------------------------------------------------------------
# Fetch water bodies from OSM
# ---------------------------------------------------------------------------


def fetch_water_bodies() -> list:
    """Fetch significant water bodies (sea, lakes) from OSM.

    Excludes rivers and small streams which are too ubiquitous to create
    meaningful distance differentiation between postal codes.
    Only fetches: natural=water (lakes, ponds), natural=coastline (sea).
    Small ponds are filtered out by area in the geometry parsing step.
    """
    logger.info("Fetching significant water bodies from OpenStreetMap...")
    query = """
    [out:json][timeout:120];
    (
      way["natural"="water"]({BBOX});
      relation["natural"="water"]({BBOX});
      way["natural"="coastline"]({BBOX});
    );
    out geom;
    """
    return _overpass_query_all_regions(query, "OSM water bodies")


# ---------------------------------------------------------------------------
# Parse OSM elements into Shapely geometries
# ---------------------------------------------------------------------------


def _parse_water_geometries(elements: list) -> list:
    """Parse OSM elements with full geometry into Shapely Polygons or LineStrings.

    - Closed ways (lakes, ponds, riverbanks) -> Polygon
    - Open ways (rivers, coastlines) -> LineString
    - Relations (large lakes, multipolygon riverbanks) -> MultiPolygon / Polygon
    """
    geometries = []
    for el in elements:
        try:
            if el.get("type") == "way" and "geometry" in el:
                coords = [(pt["lon"], pt["lat"]) for pt in el["geometry"]]
                if len(coords) < 2:
                    continue
                # Closed way -> Polygon (needs >= 4 coords including closing point)
                if len(coords) >= 4 and coords[0] == coords[-1]:
                    poly = Polygon(coords)
                    if not poly.is_valid:
                        poly = make_valid(poly)
                    if not poly.is_empty:
                        geometries.append(poly)
                else:
                    # Open way -> LineString (rivers, coastlines)
                    line = LineString(coords)
                    if not line.is_empty:
                        geometries.append(line)

            elif el.get("type") == "relation" and "members" in el:
                outers = []
                inners = []
                for m in el["members"]:
                    if "geometry" not in m:
                        continue
                    coords = [(pt["lon"], pt["lat"]) for pt in m["geometry"]]
                    if len(coords) < 4:
                        continue
                    if m.get("role") == "inner":
                        inners.append(coords)
                    else:
                        outers.append(coords)
                for outer in outers:
                    try:
                        poly = Polygon(outer, inners)
                        if not poly.is_valid:
                            poly = make_valid(poly)
                        if not poly.is_empty:
                            geometries.append(poly)
                    except Exception:
                        continue
        except Exception:
            continue
    return geometries


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


def compute_water_proximity(geojson_path: Path) -> dict[str, float]:
    """Compute minimum distance (m) from each postal code area to nearest water body.

    Returns dict of postal_code -> distance in meters (rounded to 10m).
    Distance is 0 if the postal code area intersects a water body.
    """
    # 1. Load postal code areas
    logger.info("Loading postal code areas from %s", geojson_path)
    gdf = gpd.read_file(geojson_path)
    logger.info("  Loaded %d postal code areas", len(gdf))

    # 2. Fetch water bodies
    elements = fetch_water_bodies()
    if not elements:
        logger.error("No water body elements fetched, cannot compute distances")
        return {}

    # 3. Parse geometries
    logger.info("Parsing water body geometries...")
    water_geoms_wgs84 = _parse_water_geometries(elements)
    if not water_geoms_wgs84:
        logger.error("No valid water geometries parsed")
        return {}
    logger.info("  Parsed %d water geometries", len(water_geoms_wgs84))

    # 4. Reproject everything to EPSG:3067 (Finnish metric CRS)
    logger.info("Reprojecting to EPSG:3067...")
    reproject = _build_reprojector()

    # Minimum area threshold: 1 hectare (10,000 m²) for polygons.
    # Filters out tiny ponds/puddles that don't represent meaningful
    # "water access". Coastlines (LineStrings) are always kept.
    MIN_WATER_AREA_M2 = 10_000

    water_geoms_3067 = []
    skipped_small = 0
    for geom in water_geoms_wgs84:
        try:
            reprojected = shapely_transform(reproject, geom)
            if reprojected.is_empty:
                continue
            # Filter small polygons (keep all linestrings — coastlines)
            if hasattr(reprojected, 'area') and reprojected.area > 0:
                if reprojected.area < MIN_WATER_AREA_M2:
                    skipped_small += 1
                    continue
            water_geoms_3067.append(reprojected)
        except Exception:
            continue
    logger.info("  Reprojected %d water geometries (skipped %d small polygons < 1ha)",
                len(water_geoms_3067), skipped_small)

    gdf_proj = gdf.to_crs("EPSG:3067")

    # 5. Build spatial index
    logger.info("Building spatial index (STRtree)...")
    tree = STRtree(water_geoms_3067)

    # 6. Compute distances
    logger.info("Computing distances for %d postal codes...", len(gdf_proj))
    results: dict[str, float] = {}

    for i, (idx, row) in enumerate(gdf_proj.iterrows()):
        pno = gdf.loc[idx, "pno"] if "pno" in gdf.columns else gdf.loc[idx].get("postinumeroalue", "")
        if not pno:
            continue

        postal_geom = row.geometry
        if postal_geom is None or postal_geom.is_empty:
            continue

        # Find nearest water geometry
        nearest_idx = tree.nearest(postal_geom)
        nearest_water = water_geoms_3067[nearest_idx]

        # Compute distance (0 if intersecting)
        distance = postal_geom.distance(nearest_water)

        # Round to nearest 10 meters
        rounded = round(distance / 10) * 10
        results[pno] = rounded

        if (i + 1) % 50 == 0:
            logger.info("  Processed %d/%d postal codes...", i + 1, len(gdf_proj))

    logger.info("Computed water proximity for %d postal codes", len(results))

    # Log summary statistics
    if results:
        values = list(results.values())
        zero_count = sum(1 for v in values if v == 0)
        logger.info(
            "  Min: %dm, Max: %dm, Avg: %dm, Median: %dm, Touching water: %d",
            min(values),
            max(values),
            int(sum(values) / len(values)),
            sorted(values)[len(values) // 2],
            zero_count,
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
    with open(OUTPUT_PATH, "w") as f:
        json.dump(results, f, indent=2, sort_keys=True)
    logger.info("Saved results to %s (%d entries)", OUTPUT_PATH, len(results))


if __name__ == "__main__":
    main()
