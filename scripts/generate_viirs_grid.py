#!/usr/bin/env python3
"""
Generate a GeoJSON grid of NASA VIIRS Black Marble nighttime radiance pixels.

Instead of aggregating radiance to postal codes (zonal statistics), this script
outputs the raw ~500 m grid cells as GeoJSON polygons so the map can render
light pollution at the native satellite resolution.

Data source: NASA VIIRS Black Marble (VNP46A4)
  - Annual gap-filled, cloud-free, BRDF-corrected nighttime lights
  - 15 arc-second (~500 m) spatial resolution
  - Variable: NearNadir_Composite_Snow_Free

Authentication:
  Requires a NASA Earthdata bearer token. Provide via:
    1. EARTHDATA_TOKEN environment variable, or
    2. --token command-line argument

Output: public/data/light_pollution_grid.geojson
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import box, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

OUTPUT_FILE = Path(__file__).parent.parent / "public" / "data" / "light_pollution_grid.geojson"
GEOJSON_FILE = (
    Path(__file__).parent.parent / "public" / "data" / "metro_neighborhoods.geojson"
)

DEFAULT_YEAR = 2024
PRODUCT_ID = "VNP46A4"

# VIIRS VNP46A4 pixel size: 15 arc-seconds
PIXEL_SIZE_DEG = 15.0 / 3600.0  # ~0.004167 degrees


def get_token(args):
    """Resolve NASA Earthdata bearer token from args or environment."""
    token = getattr(args, "token", None) or os.environ.get("EARTHDATA_TOKEN")
    if not token:
        logger.error(
            "No NASA Earthdata token provided.\n"
            "  Set EARTHDATA_TOKEN env var or pass --token.\n"
            "  Generate at: https://urs.earthdata.nasa.gov"
        )
        sys.exit(1)
    return token


def load_metro_boundary():
    """Load metro area boundary for clipping grid cells."""
    if not GEOJSON_FILE.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_FILE)
        sys.exit(1)

    logger.info("Loading metro boundary from %s...", GEOJSON_FILE.name)
    gdf = gpd.read_file(GEOJSON_FILE)

    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")

    # Create a single boundary polygon from all neighborhoods
    boundary = unary_union(gdf.geometry)
    logger.info("  Metro boundary created from %d neighborhoods", len(gdf))
    return gdf, boundary


def download_raster(gdf, token, year):
    """Download VIIRS raster using blackmarblepy."""
    from blackmarble.raster import bm_raster

    logger.info(
        "Downloading %s raster for year %d...",
        PRODUCT_ID,
        year,
    )

    raster = bm_raster(
        gdf,
        product_id=PRODUCT_ID,
        date_range=pd.date_range(f"{year}-01-01", periods=1, freq="YS").to_list(),
        token=token,
    )

    return raster


def raster_to_grid_geojson(raster, boundary):
    """Convert raster pixels to GeoJSON polygon grid cells.

    Each pixel becomes a rectangular polygon with its radiance value.
    Only cells that intersect the metro boundary are kept.
    """
    # Read the raster data and transform
    data = raster.values  # shape: (bands, height, width) or (height, width)
    if data.ndim == 3:
        data = data[0]  # Take first band

    transform = raster.rio.transform()
    height, width = data.shape
    logger.info("  Raster size: %d x %d pixels", width, height)

    # Build spatial index for fast intersection test
    boundary_prep = boundary.buffer(0)  # ensure valid

    features = []
    for row in range(height):
        for col in range(width):
            value = float(data[row, col])

            # Skip nodata / negative / zero values
            if np.isnan(value) or value <= 0:
                continue

            # Compute pixel bounds using affine transform
            x_min = transform.c + col * transform.a
            y_max = transform.f + row * transform.e
            x_max = x_min + transform.a
            y_min = y_max + transform.e  # e is negative

            cell = box(x_min, y_min, x_max, y_max)

            # Only keep cells that intersect metro area
            if not boundary_prep.intersects(cell):
                continue

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [round(x_min, 6), round(y_min, 6)],
                            [round(x_max, 6), round(y_min, 6)],
                            [round(x_max, 6), round(y_max, 6)],
                            [round(x_min, 6), round(y_max, 6)],
                            [round(x_min, 6), round(y_min, 6)],
                        ]
                    ],
                },
                "properties": {
                    "radiance": round(value, 2),
                },
            })

    logger.info("  Generated %d grid cells intersecting metro area", len(features))

    if not features:
        logger.error("No grid cells generated — check raster data")
        sys.exit(1)

    # Stats
    vals = [f["properties"]["radiance"] for f in features]
    logger.info(
        "  Radiance stats: min=%.2f, median=%.2f, max=%.2f nW/cm²/sr",
        min(vals),
        sorted(vals)[len(vals) // 2],
        max(vals),
    )

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate VIIRS radiance grid GeoJSON for fine-resolution light pollution map"
    )
    parser.add_argument(
        "--token",
        help="NASA Earthdata bearer token (or set EARTHDATA_TOKEN env var)",
    )
    parser.add_argument(
        "--year",
        type=int,
        default=DEFAULT_YEAR,
        help=f"Year for VNP46A4 annual composite (default: {DEFAULT_YEAR})",
    )
    args = parser.parse_args()

    token = get_token(args)
    gdf, boundary = load_metro_boundary()
    raster = download_raster(gdf, token, args.year)
    geojson = raster_to_grid_geojson(raster, boundary)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(geojson, ensure_ascii=False))
    logger.info(
        "Wrote %d grid cells to %s (%.1f KB)",
        len(geojson["features"]),
        OUTPUT_FILE.name,
        OUTPUT_FILE.stat().st_size / 1024,
    )


if __name__ == "__main__":
    main()
