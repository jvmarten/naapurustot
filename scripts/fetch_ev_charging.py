#!/usr/bin/env python3
"""
Fetch EV charging station data from OpenStreetMap via the Overpass API.

Data source: OpenStreetMap (amenity=charging_station)
Method: Query all charging stations in the Helsinki metro bounding box,
        then count stations per postal code area (density = count / area_km2).

Output: ev_charging.json
Format: {"00100": 12.5, "00120": 3.2, ...}  (stations per km²)
"""

import json
import logging
import sys
import time
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import Point

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent

# Regional bounding boxes (south, west, north, east)
REGION_BBOXES = [
    (60.05, 24.50, 60.45, 25.30),   # Helsinki metro
    (60.25, 21.50, 60.75, 22.90),   # Turku metro
    (61.20, 23.10, 62.20, 25.00),   # Tampere metro
]

OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def load_postal_boundaries() -> gpd.GeoDataFrame:
    """Load postal code boundaries from existing GeoJSON."""
    path = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
    gdf = gpd.read_file(path)
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    return gdf


def fetch_ev_stations() -> list[dict]:
    """Fetch EV charging stations from Overpass API for all metro regions."""
    logger.info("Fetching EV charging stations from Overpass API...")

    stations = []
    seen = set()

    for i, bbox in enumerate(REGION_BBOXES):
        south, west, north, east = bbox
        logger.info("  Querying region %d bbox: %.2f,%.2f,%.2f,%.2f", i + 1, south, west, north, east)

        query = f"""
        [out:json][timeout:60];
        (
          node["amenity"="charging_station"]({south},{west},{north},{east});
          way["amenity"="charging_station"]({south},{west},{north},{east});
        );
        out center;
        """

        for attempt in range(1, 5):
            try:
                resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=120)
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                wait = 15 * attempt
                logger.warning("  Attempt %d failed: %s. Retrying in %ds...", attempt, e, wait)
                time.sleep(wait)
                data = {"elements": []}

        for element in data.get("elements", []):
            lat = element.get("lat") or element.get("center", {}).get("lat")
            lon = element.get("lon") or element.get("center", {}).get("lon")
            if lat and lon:
                key = (round(lat, 6), round(lon, 6))
                if key not in seen:
                    seen.add(key)
                    stations.append({"lat": lat, "lon": lon})

        logger.info("  Region %d: %d total stations so far", i + 1, len(stations))

        # Rate limit between Overpass queries
        if i < len(REGION_BBOXES) - 1:
            time.sleep(15)

    logger.info("  Found %d charging stations total", len(stations))
    return stations


def main():
    try:
        postal = load_postal_boundaries()
    except Exception as e:
        logger.error("Cannot load postal boundaries: %s", e)
        sys.exit(1)

    try:
        stations = fetch_ev_stations()
    except Exception as e:
        logger.warning("Could not fetch EV stations: %s", e)
        (OUT_DIR / "ev_charging.json").write_text("{}\n")
        return

    if not stations:
        logger.warning("No stations found, writing empty file")
        (OUT_DIR / "ev_charging.json").write_text("{}\n")
        return

    # Create GeoDataFrame of stations
    station_points = gpd.GeoDataFrame(
        stations,
        geometry=[Point(s["lon"], s["lat"]) for s in stations],
        crs="EPSG:4326",
    )

    # Spatial join: count stations per postal code area
    result = {}
    postal_proj = postal.to_crs(epsg=3067)

    for idx, row in postal.iterrows():
        pno = row.get("pno", "")
        if not pno:
            continue

        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        # Count stations within this postal code
        within = station_points[station_points.geometry.within(geom)]
        count = len(within)

        # Calculate area in km²
        proj_geom = postal_proj.loc[idx, "geometry"]
        area_km2 = proj_geom.area / 1_000_000

        if area_km2 > 0:
            density = round(count / area_km2, 1)
            result[pno] = density

    logger.info("Computed EV charging density for %d postal codes", len(result))

    with open(OUT_DIR / "ev_charging.json", "w") as f:
        json.dump(result, f, indent=2)

    logger.info("Done. Wrote ev_charging.json")


if __name__ == "__main__":
    main()
