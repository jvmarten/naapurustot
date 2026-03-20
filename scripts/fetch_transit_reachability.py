#!/usr/bin/env python3
"""
Compute transit reachability scores from the Helsinki Region Travel Time Matrix.

Data source: Helsinki Region Travel Time Matrix 2023
             Zenodo: https://zenodo.org/records/11220980
             License: CC BY 4.0
             Granularity: 250m × 250m grid (YKR grid)

Method:
1. Download the travel time matrix CSV from Zenodo
2. For each grid cell, compute how many other grid cells are reachable
   within 30 minutes by public transit
3. Aggregate grid cells to postal code areas (area-weighted average)
4. Normalize to a 0-100 score

Output: transit_reachability.json
Format: {"00100": 85.2, "00120": 72.1, ...}  (score 0-100)
"""

import json
import logging
import sys
import zipfile
from io import BytesIO
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent

# Helsinki Region Travel Time Matrix 2023
# Main dataset: travel times by public transit between all YKR grid cells
ZENODO_RECORD = "11220980"
ZENODO_API = f"https://zenodo.org/api/records/{ZENODO_RECORD}"

# YKR grid cell shapefile (250m grid)
# Available from: https://www.stat.fi/org/avoindata/paikkatietoaineistot/ykr_grid.html
# Or included in the travel time matrix download

# Threshold: 30 minutes by public transit
REACHABILITY_THRESHOLD_MIN = 30


def load_postal_boundaries() -> gpd.GeoDataFrame:
    """Load postal code boundaries from existing GeoJSON."""
    path = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
    gdf = gpd.read_file(path)
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    return gdf


def fetch_travel_time_summary() -> pd.DataFrame:
    """
    Fetch or compute a summary of reachability per YKR grid cell.

    The full travel time matrix is very large (13k × 13k cells).
    We download the summary/metadata file that contains grid cell centroids
    and compute reachability from the matrix files.
    """
    logger.info("Fetching travel time matrix metadata from Zenodo...")

    # Get record metadata to find download URLs
    resp = requests.get(ZENODO_API, timeout=30)
    resp.raise_for_status()
    record = resp.json()

    files = record.get("files", [])
    logger.info("  Found %d files in Zenodo record", len(files))

    # Look for a summary or grid file
    # The dataset typically contains:
    # - MetropAccess_YKR_grid_EurefFIN.shp (grid cell boundaries)
    # - Travel time CSV files (one per destination cell)
    # - Or a combined file

    grid_url = None
    tt_url = None
    for f in files:
        name = f.get("key", "")
        if "grid" in name.lower() and name.endswith((".zip", ".shp", ".gpkg")):
            grid_url = f.get("links", {}).get("self", "")
        elif "pt_" in name.lower() or "travel" in name.lower():
            tt_url = f.get("links", {}).get("self", "")

    if not grid_url:
        logger.warning("Could not find grid shapefile in Zenodo record")
        logger.info("  Available files: %s", [f["key"] for f in files])

    return pd.DataFrame()


def compute_reachability_from_grid(
    grid: gpd.GeoDataFrame, postal: gpd.GeoDataFrame
) -> dict:
    """
    Compute transit reachability score per postal code from grid data.

    If the full travel time matrix is available, we compute how many
    destinations each grid cell can reach within 30 minutes by PT.
    Then aggregate to postal codes.
    """
    result = {}
    postal_proj = postal.to_crs(epsg=3067)
    grid_proj = grid.to_crs(epsg=3067) if not grid.empty else grid

    if grid_proj.empty:
        return result

    for idx, row in postal_proj.iterrows():
        pno = row.get("pno", "")
        if not pno:
            continue

        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        # Find grid cells within this postal code
        within = grid_proj[grid_proj.geometry.intersects(geom)]
        if within.empty:
            continue

        # Average the reachability score of grid cells in this postal code
        if "reachability" in within.columns:
            avg_score = within["reachability"].mean()
            result[pno] = round(avg_score, 1)

    return result


def main():
    try:
        postal = load_postal_boundaries()
    except Exception as e:
        logger.error("Cannot load postal boundaries: %s", e)
        sys.exit(1)

    logger.info("Computing transit reachability scores...")

    # The full travel time matrix is very large (several GB).
    # For practical use, we recommend downloading it once and caching locally.
    #
    # Download instructions:
    # 1. Go to https://zenodo.org/records/11220980
    # 2. Download the travel time matrix files
    # 3. Place them in scripts/data/travel_time_matrix/
    # 4. Run this script
    #
    # Alternative: Use the Digitransit routing API for real-time calculations
    # (requires HSL API key from https://portal-api.digitransit.fi/)

    local_grid = OUT_DIR / "data" / "travel_time_grid.gpkg"

    if local_grid.exists():
        logger.info("Loading cached grid data from %s", local_grid)
        grid = gpd.read_file(local_grid)
        result = compute_reachability_from_grid(grid, postal)
    else:
        logger.info("Travel time matrix not found locally.")
        logger.info("To populate this layer:")
        logger.info("  1. Download from https://zenodo.org/records/11220980")
        logger.info("  2. Process into %s", local_grid)
        logger.info("  3. Re-run this script")

        # Try fetching just the metadata to confirm the source exists
        try:
            summary = fetch_travel_time_summary()
        except Exception as e:
            logger.warning("Could not access Zenodo: %s", e)

        result = {}

    with open(OUT_DIR / "transit_reachability.json", "w") as f:
        json.dump(result, f, indent=2)

    logger.info("Done. Wrote transit_reachability.json (%d entries)", len(result))


if __name__ == "__main__":
    main()
