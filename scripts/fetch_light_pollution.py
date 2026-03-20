#!/usr/bin/env python3
"""
Compute light pollution (nighttime radiance) per postal code area using
NASA VIIRS DNB annual composites via Google Earth Engine.

Output: scripts/light_pollution.json — { postal_code: mean_radiance_nW }

Prerequisites:
- Google Earth Engine Python API: pip install earthengine-api
- Authenticated: earthengine authenticate
- GEE project: set EE_PROJECT env var or use default

Data source: NOAA/VIIRS/DNB/ANNUAL_V22 (2012-2024, ~500m resolution)
"""

import json
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

OUTPUT_FILE = Path(__file__).parent / "light_pollution.json"
GEOJSON_FILE = Path(__file__).parent.parent / "public" / "data" / "metro_neighborhoods.geojson"


def main():
    try:
        import ee
    except ImportError:
        logger.error(
            "Google Earth Engine Python API not installed.\n"
            "Install with: pip install earthengine-api\n"
            "Then authenticate: earthengine authenticate"
        )
        sys.exit(1)

    # Initialize Earth Engine
    try:
        ee.Initialize()
        logger.info("Earth Engine initialized")
    except Exception:
        try:
            ee.Authenticate()
            ee.Initialize()
            logger.info("Earth Engine authenticated and initialized")
        except Exception as e:
            logger.error("Could not initialize Earth Engine: %s", e)
            sys.exit(1)

    # Load postal code polygons from the project's GeoJSON
    if not GEOJSON_FILE.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_FILE)
        logger.error("Run prepare_data.py first to generate the GeoJSON")
        sys.exit(1)

    logger.info("Loading postal code polygons from %s...", GEOJSON_FILE.name)
    with open(GEOJSON_FILE) as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    logger.info("  Loaded %d features", len(features))

    # Upload polygons to Earth Engine as a FeatureCollection
    ee_features = []
    for feat in features:
        pno = feat.get("properties", {}).get("pno", "")
        if not pno:
            continue
        geom = feat.get("geometry")
        if not geom:
            continue
        try:
            ee_geom = ee.Geometry(geom)
            ee_feat = ee.Feature(ee_geom, {"pno": pno})
            ee_features.append(ee_feat)
        except Exception:
            continue

    if not ee_features:
        logger.error("No valid features to process")
        sys.exit(1)

    ee_fc = ee.FeatureCollection(ee_features)
    logger.info("  Uploaded %d features to Earth Engine", len(ee_features))

    # Load VIIRS annual composite (latest available year)
    logger.info("Loading VIIRS DNB annual composite...")
    viirs = ee.ImageCollection("NOAA/VIIRS/DNB/ANNUAL_V22")

    # Get the latest year's average radiance band
    latest = viirs.sort("system:time_start", False).first()
    avg_radiance = latest.select("average")

    logger.info("Computing zonal statistics (mean radiance per postal code)...")

    # Reduce regions: compute mean radiance per polygon
    results = avg_radiance.reduceRegions(
        collection=ee_fc,
        reducer=ee.Reducer.mean(),
        scale=500,  # VIIRS native resolution
    )

    # Fetch results
    result_list = results.getInfo()
    if not result_list or "features" not in result_list:
        logger.error("No results from Earth Engine")
        sys.exit(1)

    # Parse into postal code -> radiance dict
    output = {}
    for feat in result_list["features"]:
        props = feat.get("properties", {})
        pno = props.get("pno", "")
        mean_val = props.get("mean")
        if pno and mean_val is not None:
            output[pno] = round(mean_val, 2)

    logger.info("Computed light pollution for %d postal codes", len(output))

    # Write output
    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    logger.info("Wrote %d postal codes to %s", len(output), OUTPUT_FILE.name)


if __name__ == "__main__":
    main()
