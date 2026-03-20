#!/usr/bin/env python3
"""
Compute light pollution per postal code area using OpenStreetMap street light
density as a proxy for nighttime illumination.

Street light density (lamps/km²) correlates strongly with satellite-measured
radiance and directly reflects the lit environment residents experience.

Output: scripts/light_pollution.json — { postal_code: lamps_per_km2 }

Data source: OpenStreetMap via Overpass API (highway=street_lamp)
"""

import json
import logging
import math
import sys
import time
from pathlib import Path

import requests
from shapely.geometry import shape

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

OUTPUT_FILE = Path(__file__).parent / "light_pollution.json"
GEOJSON_FILE = Path(__file__).parent.parent / "public" / "data" / "metro_neighborhoods.geojson"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Approximate m² per degree² at Helsinki latitude (~60°N)
# 1° lat ≈ 111,320 m, 1° lon ≈ 111,320 * cos(60°) ≈ 55,660 m
LAT_M_PER_DEG = 111_320
LON_M_PER_DEG = 55_660


def load_neighborhoods():
    """Load postal code polygons from the project's GeoJSON."""
    if not GEOJSON_FILE.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_FILE)
        sys.exit(1)

    logger.info("Loading postal code polygons from %s...", GEOJSON_FILE.name)
    with open(GEOJSON_FILE) as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    logger.info("  Loaded %d features", len(features))

    neighborhoods = []
    for feat in features:
        props = feat.get("properties", {})
        pno = props.get("pno", "")
        geom = feat.get("geometry")
        if pno and geom:
            try:
                shp = shape(geom)
                neighborhoods.append({
                    "pno": pno,
                    "geometry": geom,
                    "shape": shp,
                    "bounds": shp.bounds,  # (minx, miny, maxx, maxy) = (lon_min, lat_min, lon_max, lat_max)
                })
            except Exception:
                pass

    return neighborhoods


def compute_area_km2(shp):
    """Approximate area of a Shapely polygon in km², using local projection."""
    bounds = shp.bounds
    mid_lat = (bounds[1] + bounds[3]) / 2
    cos_lat = math.cos(math.radians(mid_lat))
    # Use rough metric conversion for the area
    # shapely area is in deg², convert to m²
    area_deg2 = shp.area
    area_m2 = area_deg2 * LAT_M_PER_DEG * LON_M_PER_DEG
    return area_m2 / 1_000_000


def query_street_lamps_batch(neighborhoods):
    """Query Overpass API for street lamp counts in all postal code areas.

    Uses a single large query covering the entire Helsinki metro bbox,
    then does point-in-polygon assignment client-side.
    """
    # Compute overall bounding box
    all_lons = []
    all_lats = []
    for nb in neighborhoods:
        minx, miny, maxx, maxy = nb["bounds"]
        all_lons.extend([minx, maxx])
        all_lats.extend([miny, maxy])

    bbox = (min(all_lats), min(all_lons), max(all_lats), max(all_lons))
    logger.info("  Metro bbox: %.4f,%.4f,%.4f,%.4f", *bbox)

    # Query all street lamps in the metro area at once
    query = f"""
[out:json][timeout:300];
(
  node["highway"="street_lamp"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
);
out body;
"""
    logger.info("Querying Overpass for all street lamps in metro area...")
    for attempt in range(1, 5):
        try:
            r = requests.post(
                OVERPASS_URL,
                data={"data": query},
                timeout=300,
                verify=False,
            )
            r.raise_for_status()
            data = r.json()
            elements = data.get("elements", [])
            logger.info("  Found %d street lamps", len(elements))
            return elements
        except Exception as e:
            wait = 2 ** attempt
            logger.warning("  Attempt %d failed: %s. Retrying in %ds...", attempt, e, wait)
            time.sleep(wait)

    logger.error("Failed to query Overpass API after 4 attempts")
    return []


def assign_lamps_to_neighborhoods(lamps, neighborhoods):
    """Assign each street lamp to its postal code area using point-in-polygon."""
    from shapely.geometry import Point
    from shapely import STRtree

    logger.info("Building spatial index for %d neighborhoods...", len(neighborhoods))
    shapes = [nb["shape"] for nb in neighborhoods]
    tree = STRtree(shapes)

    # Count lamps per neighborhood
    counts = {nb["pno"]: 0 for nb in neighborhoods}
    assigned = 0

    logger.info("Assigning %d lamps to neighborhoods...", len(lamps))
    for i, lamp in enumerate(lamps):
        if i > 0 and i % 50000 == 0:
            logger.info("  Processed %d/%d lamps (%d assigned)...", i, len(lamps), assigned)

        pt = Point(lamp["lon"], lamp["lat"])

        # Query spatial index for candidate polygons
        idx_results = tree.query(pt)
        for idx in idx_results:
            if shapes[idx].contains(pt):
                counts[neighborhoods[idx]["pno"]] += 1
                assigned += 1
                break

    logger.info("  Assigned %d/%d lamps to postal codes", assigned, len(lamps))
    return counts


def main():
    neighborhoods = load_neighborhoods()
    if not neighborhoods:
        logger.error("No neighborhoods loaded")
        sys.exit(1)

    # Compute area for each neighborhood
    for nb in neighborhoods:
        nb["area_km2"] = compute_area_km2(nb["shape"])

    # Query all street lamps
    lamps = query_street_lamps_batch(neighborhoods)
    if not lamps:
        logger.error("No street lamp data retrieved")
        sys.exit(1)

    # Assign to postal codes
    counts = assign_lamps_to_neighborhoods(lamps, neighborhoods)

    # Compute density (lamps/km²)
    output = {}
    for nb in neighborhoods:
        pno = nb["pno"]
        count = counts.get(pno, 0)
        area = nb["area_km2"]
        if area > 0:
            density = count / area
            output[pno] = round(density, 1)

    # Stats
    vals = [v for v in output.values() if v > 0]
    if vals:
        logger.info("Density stats: min=%.1f, median=%.1f, max=%.1f lamps/km²",
                     min(vals), sorted(vals)[len(vals)//2], max(vals))

    logger.info("Computed light pollution for %d postal codes", len(output))

    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    logger.info("Wrote %d postal codes to %s", len(output), OUTPUT_FILE.name)


if __name__ == "__main__":
    main()
