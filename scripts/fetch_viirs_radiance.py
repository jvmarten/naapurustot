#!/usr/bin/env python3
"""
Fetch NASA VIIRS Black Marble nighttime radiance data.

Produces two outputs:
  1. scripts/light_pollution.json — postal code → mean radiance (for choropleth)
  2. scripts/light_pollution_pixels.json — per-pixel radiance at native ~500m
     VIIRS resolution (for the fine-grained grid overlay)

Uses the VNP46A4 annual composite product.

Data source: NASA VIIRS Black Marble (VNP46A4)
  - Annual gap-filled, cloud-free, BRDF-corrected nighttime lights
  - 15 arc-second (~500 m) spatial resolution
  - Variable: NearNadir_Composite_Snow_Free

Authentication:
  Requires a NASA Earthdata bearer token. Provide via:
    1. EARTHDATA_TOKEN environment variable, or
    2. --token command-line argument

  To generate a token:
    - Log in at https://urs.earthdata.nasa.gov
    - Go to "Generate Token" under your profile

Output:
  scripts/light_pollution.json — { postal_code: mean_radiance_nw }
  scripts/light_pollution_pixels.json — [ { lng, lat, radiance }, ... ]
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
from shapely.geometry import Point

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

OUTPUT_FILE = Path(__file__).parent / "light_pollution.json"
PIXEL_OUTPUT_FILE = Path(__file__).parent / "light_pollution_pixels.json"
GEOJSON_FILE = (
    Path(__file__).parent.parent / "public" / "data" / "metro_neighborhoods.geojson"
)

# VNP46A4 annual composite — most recent complete year
DEFAULT_YEAR = 2024
PRODUCT_ID = "VNP46A4"


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


def load_postal_codes():
    """Load postal code polygons as a GeoDataFrame."""
    if not GEOJSON_FILE.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_FILE)
        sys.exit(1)

    logger.info("Loading postal code polygons from %s...", GEOJSON_FILE.name)
    gdf = gpd.read_file(GEOJSON_FILE)

    # Ensure CRS is WGS84 (EPSG:4326) — required by blackmarblepy
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")

    # Keep only rows with a postal code
    gdf = gdf[gdf["pno"].notna() & (gdf["pno"] != "")].copy()
    logger.info("  Loaded %d postal code areas", len(gdf))
    return gdf


def extract_radiance(gdf, token, year):
    """Extract mean VIIRS radiance per postal code using blackmarblepy."""
    from blackmarble.extract import bm_extract

    logger.info(
        "Extracting %s radiance for year %d (%d zones)...",
        PRODUCT_ID,
        year,
        len(gdf),
    )

    # bm_extract returns a GeoDataFrame with zonal statistics appended
    result = bm_extract(
        gdf,
        product_id=PRODUCT_ID,
        date_range=pd.date_range(f"{year}-01-01", periods=1, freq="YS").to_list(),
        token=token,
        aggfunc="mean",
    )

    return result


def extract_pixel_radiance(gdf, token, year):
    """Extract per-pixel VIIRS radiance at native ~500m resolution.

    Uses bm_raster to download the actual raster, then converts each
    valid pixel within the metro area into a {lng, lat, radiance} record.
    """
    from blackmarble.raster import bm_raster

    logger.info(
        "Fetching %s raster for year %d (pixel-level export)...",
        PRODUCT_ID,
        year,
    )

    # bm_raster returns an xarray.Dataset at native VIIRS resolution
    ds = bm_raster(
        gdf,
        product_id=PRODUCT_ID,
        date_range=pd.date_range(f"{year}-01-01", periods=1, freq="YS").to_list(),
        token=token,
    )

    # The dataset typically contains a variable like 'NearNadir_Composite_Snow_Free'
    # Find the first data variable
    var_names = list(ds.data_vars)
    logger.info("  Raster variables: %s", var_names)

    if not var_names:
        logger.error("No data variables in raster — check product/year")
        return []

    var_name = var_names[0]
    data = ds[var_name]

    # If there's a time/band dimension, select first
    if "time" in data.dims:
        data = data.isel(time=0)
    if "band" in data.dims:
        data = data.isel(band=0)

    # Get coordinate arrays
    lats = data.coords["y"].values if "y" in data.coords else data.coords["latitude"].values
    lngs = data.coords["x"].values if "x" in data.coords else data.coords["longitude"].values

    # Build spatial index for metro area boundary check
    metro_union = gdf.geometry.union_all()

    logger.info(
        "  Raster shape: %s, extracting pixels within metro area...",
        data.shape,
    )

    pixels = []
    values = data.values

    for i, lat in enumerate(lats):
        for j, lng in enumerate(lngs):
            val = float(values[i, j])
            # Skip fill/nodata values
            if np.isnan(val) or val < 0:
                continue
            # Check if pixel center is within metro area
            if metro_union.contains(Point(lng, lat)):
                pixels.append({
                    "lng": round(float(lng), 6),
                    "lat": round(float(lat), 6),
                    "radiance": round(val, 2),
                })

    logger.info("  Extracted %d valid pixels within metro area", len(pixels))

    if pixels:
        rads = [p["radiance"] for p in pixels]
        logger.info(
            "  Pixel radiance stats: min=%.2f, median=%.2f, max=%.2f nW/cm²/sr",
            min(rads),
            sorted(rads)[len(rads) // 2],
            max(rads),
        )

    return pixels


def main():
    parser = argparse.ArgumentParser(
        description="Fetch NASA VIIRS Black Marble radiance per postal code"
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
    parser.add_argument(
        "--skip-pixels",
        action="store_true",
        help="Skip pixel-level export (only compute postal code averages)",
    )
    args = parser.parse_args()

    token = get_token(args)
    gdf = load_postal_codes()

    # --- Postal code averages ---
    result = extract_radiance(gdf, token, args.year)

    radiance_cols = [
        c for c in result.columns if c not in gdf.columns and c != "geometry"
    ]
    logger.info("  Radiance columns added: %s", radiance_cols)

    if not radiance_cols:
        logger.error("No radiance data extracted — check token and year")
        sys.exit(1)

    rad_col = radiance_cols[0]
    logger.info("  Using column: %s", rad_col)

    output = {}
    for _, row in result.iterrows():
        pno = row["pno"]
        val = row[rad_col]
        if pd.notna(val) and val >= 0:
            output[pno] = round(float(val), 2)

    vals = [v for v in output.values() if v > 0]
    if vals:
        logger.info(
            "Radiance stats: min=%.2f, median=%.2f, max=%.2f nW/cm²/sr",
            min(vals),
            sorted(vals)[len(vals) // 2],
            max(vals),
        )

    logger.info("Computed radiance for %d postal codes", len(output))
    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    logger.info("Wrote %d postal codes to %s", len(output), OUTPUT_FILE.name)

    # --- Pixel-level export ---
    if not args.skip_pixels:
        pixels = extract_pixel_radiance(gdf, token, args.year)
        if pixels:
            PIXEL_OUTPUT_FILE.write_text(
                json.dumps(pixels, ensure_ascii=False)
            )
            logger.info(
                "Wrote %d pixels to %s", len(pixels), PIXEL_OUTPUT_FILE.name
            )
    else:
        logger.info("Skipping pixel-level export (--skip-pixels)")


if __name__ == "__main__":
    main()
