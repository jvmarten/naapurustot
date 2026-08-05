#!/usr/bin/env python3
"""
Fetch sports facility data from LIPAS V2 API and compute density per postal code.

Data source: LIPAS (University of Jyvaskyla)
- API: https://api.lipas.fi/v2/sports-sites
- License: CC-BY-SA 4.0
- Coverage: All Finnish sports/recreation facilities (~48,000 nationwide)

Output: sports_facility_density.json — { postal_code: facilities_per_km2 }
"""

import json
import logging
import sys
import time
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import Point

from regions_config import ALL_MUNICIPALITY_CODES

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent
GEOJSON_PATH = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_FILE = OUT_DIR / "sports_facility_density.json"

LIPAS_URL = "https://api.lipas.fi/v2/sports-sites"
PAGE_SIZE = 100
# LIPAS 500s intermittently partway through the ~489-page walk; retry before
# giving up, and give up loudly rather than writing a truncated dataset.
PAGE_RETRIES = 4
PAGE_RETRY_DELAY = 3

# Municipality codes for all 69 Finnish seutukunnat (from regions_config).
# LIPAS city-codes are integers, so strip the zero-padding from the 3-digit
# codes (e.g. "019" -> 19, "091" -> 91).
CITY_CODES = sorted(int(code) for code in ALL_MUNICIPALITY_CODES)

# Exclude maintenance/service buildings (category 7000) — not user-facing facilities
EXCLUDE_MAIN_CATEGORIES = {7}


def load_postal_boundaries() -> gpd.GeoDataFrame:
    """Load postal code boundaries from GeoJSON."""
    gdf = gpd.read_file(GEOJSON_PATH)
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    return gdf


def fetch_lipas_facilities() -> list[dict]:
    """Fetch all active sports facilities from LIPAS V2 API for metro regions."""
    logger.info("Fetching sports facilities from LIPAS API...")
    facilities = []
    city_codes_str = ",".join(str(c) for c in CITY_CODES)

    page = 1
    total_pages = None
    while True:
        params = {
            "city-codes": city_codes_str,
            "page-size": PAGE_SIZE,
            "page": page,
            "statuses": "active,out-of-service-temporarily",
        }
        # Retry, then abort — never break out with a partial page set. LIPAS
        # returns an intermittent 500 partway through the ~489-page walk, and
        # `break` used to accept whatever had arrived so far and write it as a
        # complete national dataset: every postal code past the failure point
        # silently became a measured-looking density of 0. This is the same
        # failure mode _overpass_query_all_regions already refuses to tolerate.
        response = None
        for attempt in range(1, PAGE_RETRIES + 1):
            try:
                r = requests.get(LIPAS_URL, params=params, timeout=30,
                                 headers={"User-Agent": "naapurustot.fi/data-pipeline"})
                r.raise_for_status()
                response = r.json()
                break
            except Exception as e:
                if attempt == PAGE_RETRIES:
                    raise RuntimeError(
                        f"LIPAS page {page} of {total_pages} failed after "
                        f"{PAGE_RETRIES} attempts: {e}. Refusing to write a "
                        f"truncated national dataset — every postal code past "
                        f"this page would ship as a measured 0."
                    ) from e
                logger.warning("  LIPAS API error on page %d (attempt %d/%d): %s",
                               page, attempt, PAGE_RETRIES, e)
                time.sleep(PAGE_RETRY_DELAY * attempt)

        # V2 API wraps results: {"items": [...], "pagination": {...}}
        items = response.get("items", [])
        pagination = response.get("pagination", {})
        if total_pages is None:
            total_pages = pagination.get("total-pages", 0)
            total_items = pagination.get("total-items", 0)
            logger.info("  API reports %d total items across %d pages", total_items, total_pages)

        if not items:
            break

        for item in items:
            type_code = (item.get("type") or {}).get("type-code", 0)
            main_category = type_code // 1000
            if main_category in EXCLUDE_MAIN_CATEGORIES:
                continue

            geometries = (item.get("location") or {}).get("geometries") or {}
            features = geometries.get("features") or []
            if not features:
                continue

            geom = features[0].get("geometry") or {}
            coords = geom.get("coordinates")
            geom_type = geom.get("type", "")

            lat, lon = None, None
            if geom_type == "Point" and coords and len(coords) >= 2:
                lon, lat = coords[0], coords[1]
            elif geom_type == "LineString" and coords:
                # Use midpoint of line
                mid = coords[len(coords) // 2]
                if len(mid) >= 2:
                    lon, lat = mid[0], mid[1]
            elif geom_type == "Polygon" and coords and coords[0]:
                # Use centroid approximation (average of first ring)
                ring = coords[0]
                lon = sum(c[0] for c in ring) / len(ring)
                lat = sum(c[1] for c in ring) / len(ring)

            if lat is not None and lon is not None:
                facilities.append({"lat": lat, "lon": lon, "type_code": type_code})

        logger.info("  Page %d/%s: %d items (total so far: %d)",
                     page, total_pages or "?", len(items), len(facilities))

        if page >= (total_pages or 0):
            break

        page += 1
        time.sleep(0.1)  # Be polite to the API

    logger.info("  Total facilities fetched: %d", len(facilities))
    return facilities


def compute_density(postal: gpd.GeoDataFrame, facilities: list[dict]) -> dict[str, float]:
    """Compute sports facility density (facilities/km²) per postal code."""
    from shapely import STRtree

    if not facilities:
        return {}

    # Build spatial index for postal codes
    postal_proj = postal.to_crs(epsg=3067)
    postal_geoms = list(postal.geometry)
    tree = STRtree(postal_geoms)

    # Count facilities per postal code
    counts: dict[str, int] = {}
    for fac in facilities:
        pt = Point(fac["lon"], fac["lat"])
        candidates = tree.query(pt)
        for idx in candidates:
            if postal_geoms[idx].contains(pt):
                pno = postal.iloc[idx].get("pno", "")
                if pno:
                    counts[pno] = counts.get(pno, 0) + 1
                break

    # Compute density using projected area (EPSG:3067 = meters)
    result = {}
    for idx, row in postal_proj.iterrows():
        pno = postal.iloc[idx].get("pno", "")
        if not pno:
            continue
        count = counts.get(pno, 0)
        area_m2 = row.geometry.area if row.geometry else 0
        area_km2 = area_m2 / 1_000_000
        if area_km2 > 0:
            # 4 decimals, not 1: at one decimal anything below 0.05/km2 becomes
            # exactly 0.0, and the median Finnish postal area is 52 km2 — so a
            # single real sports facility rounded away across most of the
            # country. See prepare_data.POI_DENSITY_DECIMALS.
            result[pno] = round(count / area_km2, 4)

    return result


def main():
    try:
        postal = load_postal_boundaries()
    except Exception as e:
        logger.error("Cannot load postal boundaries: %s", e)
        sys.exit(1)

    facilities = fetch_lipas_facilities()

    if not facilities:
        logger.error("No facilities fetched — aborting")
        sys.exit(1)

    density = compute_density(postal, facilities)
    logger.info("Computed density for %d postal codes", len(density))

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(density, f, indent=2)

    logger.info("Wrote %s (%d entries)", OUTPUT_FILE.name, len(density))


if __name__ == "__main__":
    main()
