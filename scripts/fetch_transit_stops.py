#!/usr/bin/env python3
"""
Fetch transit stop data for all metro regions and compute stop density per postal code.

Data sources:
- Helsinki metro: HSL Digitransit GraphQL API (cached fallback from transit_stop_density.json)
- Turku: Föli GTFS stops API (https://data.foli.fi/gtfs/stops)
- Tampere: ITS Factory stop-points API (https://data.itsfactory.fi/journeys/api/1/stop-points)

Output: transit_stop_density.json — { postal_code: stops_per_km2 }
"""

import json
import logging
import sys
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import Point

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent
GEOJSON_PATH = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
EXISTING_FILE = OUT_DIR / "transit_stop_density.json"

# Föli (Turku region) GTFS stops
FOLI_STOPS_URL = "https://data.foli.fi/gtfs/stops"

# ITS Factory (Tampere region) stop-points
NYSSE_STOPS_URL = "https://data.itsfactory.fi/journeys/api/1/stop-points"


def load_postal_boundaries() -> gpd.GeoDataFrame:
    """Load postal code boundaries from GeoJSON."""
    gdf = gpd.read_file(GEOJSON_PATH)
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    return gdf


def fetch_foli_stops() -> list[dict]:
    """Fetch transit stops from Föli (Turku) GTFS API."""
    logger.info("Fetching Föli (Turku) transit stops...")
    try:
        r = requests.get(FOLI_STOPS_URL, timeout=60)
        r.raise_for_status()
        data = r.json()

        stops = []
        for stop_id, stop in data.items():
            lat = stop.get("stop_lat")
            lon = stop.get("stop_lon")
            if lat and lon:
                stops.append({"lat": float(lat), "lon": float(lon)})

        logger.info("  Found %d Föli stops", len(stops))
        return stops
    except Exception as e:
        logger.warning("  Could not fetch Föli stops: %s", e)
        return []


def fetch_nysse_stops() -> list[dict]:
    """Fetch transit stops from ITS Factory (Tampere/Nysse) API."""
    logger.info("Fetching Nysse (Tampere) transit stops...")
    headers = {"User-Agent": "naapurustot.fi/data-pipeline"}
    try:
        r = requests.get(NYSSE_STOPS_URL, timeout=60, headers=headers)
        r.raise_for_status()
        data = r.json()

        stops = []
        body = data.get("body", []) if isinstance(data, dict) else data
        if isinstance(body, list):
            for stop in body:
                loc = stop.get("location")
                if isinstance(loc, str) and "," in loc:
                    parts = loc.split(",")
                    try:
                        lat = float(parts[0].strip())
                        lon = float(parts[1].strip())
                        stops.append({"lat": lat, "lon": lon})
                    except ValueError:
                        pass

        logger.info("  Found %d Nysse stops", len(stops))
        return stops
    except Exception as e:
        logger.warning("  Could not fetch Nysse stops: %s", e)
        return []


def compute_density(postal: gpd.GeoDataFrame, stops: list[dict]) -> dict[str, float]:
    """Compute transit stop density (stops/km²) per postal code."""
    from shapely import STRtree

    if not stops:
        return {}

    # Build spatial index for postal codes
    postal_proj = postal.to_crs(epsg=3067)
    postal_geoms = list(postal.geometry)
    tree = STRtree(postal_geoms)

    # Count stops per postal code
    counts: dict[str, int] = {}
    for stop in stops:
        pt = Point(stop["lon"], stop["lat"])
        candidates = tree.query(pt)
        for idx in candidates:
            if postal_geoms[idx].contains(pt):
                pno = postal.iloc[idx].get("pno", "")
                if pno:
                    counts[pno] = counts.get(pno, 0) + 1
                break

    # Compute density
    result = {}
    for idx, row in postal_proj.iterrows():
        pno = postal.iloc[idx].get("pno", "")
        if not pno:
            continue
        count = counts.get(pno, 0)
        area_m2 = row.geometry.area if row.geometry else 0
        area_km2 = area_m2 / 1_000_000
        if area_km2 > 0:
            result[pno] = round(count / area_km2, 1)

    return result


def main():
    try:
        postal = load_postal_boundaries()
    except Exception as e:
        logger.error("Cannot load postal boundaries: %s", e)
        sys.exit(1)

    # Load existing Helsinki data
    existing = {}
    if EXISTING_FILE.exists():
        with open(EXISTING_FILE) as f:
            existing = json.load(f)
        logger.info("Loaded %d existing entries from %s", len(existing), EXISTING_FILE.name)

    # Fetch stops from Turku and Tampere
    foli_stops = fetch_foli_stops()
    nysse_stops = fetch_nysse_stops()

    all_new_stops = foli_stops + nysse_stops
    logger.info("Total new stops: %d", len(all_new_stops))

    if all_new_stops:
        new_density = compute_density(postal, all_new_stops)
        logger.info("Computed density for %d postal codes from Föli/Nysse", len(new_density))

        # Merge: keep existing Helsinki data, add/update Turku/Tampere
        for pno, density in new_density.items():
            if density > 0 or pno not in existing:
                existing[pno] = density

    logger.info("Total entries: %d", len(existing))

    with open(EXISTING_FILE, "w") as f:
        json.dump(existing, f, indent=2)

    logger.info("Wrote %s", EXISTING_FILE.name)


if __name__ == "__main__":
    main()
