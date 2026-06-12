#!/usr/bin/env python3
"""
Compute light pollution per postal code area using OpenStreetMap street light
density as a proxy for nighttime illumination.

Street light density (lamps/km²) correlates with the lit environment that
residents actually experience.  Coverage of ``highway=street_lamp`` in
OpenStreetMap varies by region — major cities tend to be reasonably complete,
while rural municipalities can be undermapped.  Truly dark areas (forests,
wilderness) genuinely have few or no street lights, so low densities outside
urban cores still carry useful information.

Iterates every seutukunta bbox in ``regions_config.ALL_BBOXES`` so all 3018
postal code areas across the country are covered.

Output: scripts/light_pollution.json — { postal_code: lamps_per_km2 }
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import geopandas as gpd
import requests
from shapely import STRtree
from shapely.geometry import Point
from pyproj import Transformer

from regions_config import ALL_BBOXES

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent
OUTPUT_FILE = SCRIPT_DIR / "light_pollution.json"
GEOJSON_FILE = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
CACHE_DIR = SCRIPT_DIR / "cache"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
MAX_RETRIES = 5
RETRY_BACKOFF_BASE = 3  # exponential: 3, 9, 27, 81 s
RATE_LIMIT_DELAY = 10.0  # seconds between successive API calls


# ---------------------------------------------------------------------------
# Cache helpers (mirrors fetch_water_proximity.py)
# ---------------------------------------------------------------------------


def _cache_path(key: str) -> Path:
    safe = (
        key.replace("/", "_")
        .replace(":", "_")
        .replace("?", "_")
        .replace("&", "_")
    )
    return CACHE_DIR / f"{safe}.json"


def _save_cache(key: str, data) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(key)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    logger.info("  Cached response -> %s", path.name)


def _load_cache(key: str):
    path = _cache_path(key)
    if path.exists():
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        logger.info("  Loaded from cache: %s", path.name)
        return data
    return None


def _request_with_retry(method, url, *, label, retries=MAX_RETRIES, **kwargs):
    kwargs.setdefault("timeout", 300)
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
                    "  Retry %d/%d for %s in %ds (%s)",
                    attempt, retries, label, wait, exc,
                )
                time.sleep(wait)
    raise last_exc  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Overpass: street lamps per region bbox
# ---------------------------------------------------------------------------


def _query_street_lamps(bbox: str) -> list:
    """Query Overpass for street_lamp nodes inside ``bbox`` (south,west,north,east).

    Cache-first: if a previous response is on disk, use it.  Otherwise call
    Overpass and cache the result.
    """
    cache_key = f"overpass_OSM_street_lamps_{bbox.replace(',', '')}"
    cached = _load_cache(cache_key)
    if cached is not None:
        return cached

    query = f"""
[out:json][timeout:300];
(
  node["highway"="street_lamp"]({bbox});
);
out body;
"""
    label = f"street lamps ({bbox})"
    try:
        r = _request_with_retry(
            "POST", OVERPASS_URL, label=label, data={"data": query}, timeout=300,
        )
        elements = r.json().get("elements", [])
        logger.info("  Fetched %d street lamps for bbox %s", len(elements), bbox)
        _save_cache(cache_key, elements)
        return elements
    except Exception as exc:
        logger.warning("  Fetch failed for %s: %s", label, exc)
        return []


def fetch_all_street_lamps() -> list[dict]:
    """Iterate every seutukunta bbox, accumulate street lamp nodes, dedupe by id."""
    seen: set = set()
    all_lamps: list[dict] = []
    for i, bbox in enumerate(ALL_BBOXES, 1):
        logger.info("Region %d/%d: bbox %s", i, len(ALL_BBOXES), bbox)
        lamps = _query_street_lamps(bbox)
        # Only sleep between *network* calls — cache hits should be fast.
        cache_key = f"overpass_OSM_street_lamps_{bbox.replace(',', '')}"
        if not _cache_path(cache_key).exists() and i < len(ALL_BBOXES):
            time.sleep(RATE_LIMIT_DELAY)
        for el in lamps:
            eid = el.get("id")
            if eid is None or eid in seen:
                continue
            seen.add(eid)
            all_lamps.append(el)
    logger.info("Total unique street lamps across Finland: %d", len(all_lamps))
    return all_lamps


# ---------------------------------------------------------------------------
# Compute lamps per km² per postal code
# ---------------------------------------------------------------------------


def _wgs84_to_3067_transformer():
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:3067", always_xy=True)

    def fn(x, y, z=None):
        return transformer.transform(x, y)

    return fn


def compute_densities(lamps: list[dict]) -> dict[str, float]:
    """Return {postal_code: lamps_per_km2} for every postal code in the GeoJSON.

    Areas are computed in EPSG:3067 (Finnish metric CRS), so densities are
    accurate at every latitude in Finland.
    """
    logger.info("Loading postal code polygons from %s", GEOJSON_FILE.name)
    gdf = gpd.read_file(GEOJSON_FILE)
    if "pno" not in gdf.columns:
        logger.error("GeoJSON is missing the 'pno' property")
        return {}

    gdf_proj = gdf.to_crs("EPSG:3067")
    logger.info("  Loaded %d postal code polygons", len(gdf_proj))

    # Reproject lamp points to EPSG:3067 in bulk
    reproject = _wgs84_to_3067_transformer()
    lamp_points: list[Point] = []
    for el in lamps:
        lon = el.get("lon")
        lat = el.get("lat")
        if lon is None or lat is None:
            continue
        x, y = reproject(lon, lat)
        lamp_points.append(Point(x, y))
    logger.info("Reprojected %d lamps to EPSG:3067", len(lamp_points))

    if not lamp_points:
        logger.error("No lamp points to assign — aborting density computation")
        return {}

    # Build STRtree over postal code polygons; for each lamp find its container.
    poly_geoms = list(gdf_proj.geometry)
    pnos = list(gdf_proj["pno"])
    tree = STRtree(poly_geoms)
    counts: dict[str, int] = {pno: 0 for pno in pnos}

    logger.info("Assigning lamps to postal code areas...")
    for i, pt in enumerate(lamp_points):
        if i and i % 100_000 == 0:
            logger.info("  ...processed %d/%d lamps", i, len(lamp_points))
        candidates = tree.query(pt)
        for idx in candidates:
            if poly_geoms[idx].contains(pt):
                counts[pnos[idx]] += 1
                break
    assigned = sum(counts.values())
    logger.info("  Assigned %d/%d lamps to postal codes", assigned, len(lamp_points))

    # Convert to lamps/km² using each polygon's true area
    output: dict[str, float] = {}
    for pno, geom in zip(pnos, poly_geoms):
        if geom is None or geom.is_empty:
            continue
        area_km2 = geom.area / 1_000_000.0  # EPSG:3067 is metric
        if area_km2 <= 0:
            continue
        density = counts.get(pno, 0) / area_km2
        output[pno] = round(density, 1)

    vals = [v for v in output.values() if v > 0]
    if vals:
        srt = sorted(vals)
        logger.info(
            "  Density stats (non-zero only): min=%.1f, median=%.1f, max=%.1f lamps/km², n=%d",
            srt[0], srt[len(srt) // 2], srt[-1], len(srt),
        )
    return output


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    logger.info("=== Light Pollution Calculator (OSM street lamps, national) ===")
    if not GEOJSON_FILE.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_FILE)
        raise SystemExit(1)

    lamps = fetch_all_street_lamps()
    if not lamps:
        logger.error("No street lamps fetched, cannot continue")
        raise SystemExit(1)

    output = compute_densities(lamps)
    if not output:
        logger.error("No densities computed")
        raise SystemExit(1)

    logger.info("Computed light pollution for %d postal codes", len(output))
    OUTPUT_FILE.write_text(
        json.dumps(output, indent=2, sort_keys=True, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info("Wrote %d postal codes to %s", len(output), OUTPUT_FILE.name)


if __name__ == "__main__":
    main()
