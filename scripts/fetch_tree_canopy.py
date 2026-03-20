#!/usr/bin/env python3
"""
Fetch tree canopy coverage data from HSY's Helsinki Region Land Cover Dataset.

Data source: HSY — Pääkaupunkiseudun maanpeiteaineisto (LiDAR-derived)
             Available via WFS at kartta.hsy.fi
             License: CC BY 4.0
             Coverage: Helsinki, Espoo, Vantaa, Kauniainen + surrounding municipalities

Method: Query the land cover dataset via HSY WFS, filter for tree canopy classes
        (puusto 2-10m, 10-15m, 15-20m, 20m+), intersect with postal code boundaries,
        and compute tree canopy % per postal code.

Output: tree_canopy.json
Format: {"00100": 15.3, "00120": 42.1, ...}  (% of area covered by trees)
"""

import json
import logging
import sys
from pathlib import Path

import geopandas as gpd
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent

# HSY WFS endpoint
HSY_WFS_URL = "https://kartta.hsy.fi/geoserver/wfs"

# HSY land cover layer name
# The 2022 dataset layer: asuminen_ja_maankaytto:maanpeite_2022
# Tree canopy classes in the dataset:
#   - Puusto 2-10 m (trees 2-10m)
#   - Puusto 10-15 m (trees 10-15m)
#   - Puusto 15-20 m (trees 15-20m)
#   - Puusto yli 20 m (trees over 20m)
LAND_COVER_LAYER = "asuminen_ja_maankaytto:maanpeite_2022"

# Tree canopy class codes in the HSY land cover dataset
TREE_CLASSES = {5, 6, 7, 8}  # Typically classes for different tree height categories


def load_postal_boundaries() -> gpd.GeoDataFrame:
    """Load postal code boundaries from existing GeoJSON."""
    path = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
    gdf = gpd.read_file(path)
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    return gdf


def fetch_land_cover_for_bbox(bbox: tuple) -> gpd.GeoDataFrame:
    """Fetch land cover data from HSY WFS for a bounding box."""
    west, south, east, north = bbox
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": LAND_COVER_LAYER,
        "outputFormat": "application/json",
        "srsName": "EPSG:3067",
        "bbox": f"{south},{west},{north},{east},EPSG:4326",
        "count": "50000",
    }

    resp = requests.get(HSY_WFS_URL, params=params, timeout=300)
    resp.raise_for_status()

    features = resp.json().get("features", [])
    if not features:
        return gpd.GeoDataFrame()

    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:3067")
    logger.info("  Fetched %d land cover features", len(gdf))
    return gdf


def main():
    try:
        postal = load_postal_boundaries()
    except Exception as e:
        logger.error("Cannot load postal boundaries: %s", e)
        sys.exit(1)

    logger.info("Computing tree canopy coverage per postal code...")

    # The HSY WFS land cover dataset is very large (millions of polygons).
    # For practical use, we process each postal code area individually.
    # Alternative: download the full dataset as GeoPackage from HSY open data portal.

    result = {}
    postal_proj = postal.to_crs(epsg=3067)

    # Try to fetch the full dataset first (more efficient)
    total_bbox = postal.total_bounds  # (minx, miny, maxx, maxy)
    logger.info("Fetching land cover data for metro area bbox...")

    try:
        land_cover = fetch_land_cover_for_bbox(total_bbox)

        if land_cover.empty:
            logger.warning("No land cover data received from WFS")
            logger.info("The HSY land cover WFS may require fetching the full dataset")
            logger.info("Download manually from: https://www.hsy.fi/en/environmental-information/open-data/avoin-data---sivut/helsinki-region-land-cover-dataset/")
            (OUT_DIR / "tree_canopy.json").write_text("{}\n")
            return

        # Identify tree canopy features
        # The 'koodi' or 'luokka' column typically contains the land cover class
        class_col = None
        for col in ("koodi", "luokka", "class", "KOODI", "LUOKKA"):
            if col in land_cover.columns:
                class_col = col
                break

        if class_col:
            logger.info("  Land cover classes found: %s", land_cover[class_col].unique())
            tree_cover = land_cover[land_cover[class_col].isin(TREE_CLASSES)]
        else:
            # Try filtering by name/description column
            name_col = None
            for col in ("nimi", "kuvaus", "name", "description"):
                if col in land_cover.columns:
                    name_col = col
                    break

            if name_col:
                tree_cover = land_cover[
                    land_cover[name_col].str.contains("puusto|puu|tree", case=False, na=False)
                ]
            else:
                logger.warning("Cannot identify tree canopy classes in land cover data")
                logger.info("Columns available: %s", land_cover.columns.tolist())
                (OUT_DIR / "tree_canopy.json").write_text("{}\n")
                return

        logger.info("  Found %d tree canopy features", len(tree_cover))

        if tree_cover.empty:
            logger.warning("No tree canopy features found")
            (OUT_DIR / "tree_canopy.json").write_text("{}\n")
            return

        # Compute tree canopy % per postal code
        for idx, row in postal_proj.iterrows():
            pno = row.get("pno", "")
            if not pno:
                continue

            postal_geom = row.geometry
            if postal_geom is None or postal_geom.is_empty:
                continue

            postal_area = postal_geom.area  # m²

            # Find tree polygons that intersect this postal code
            candidates = tree_cover[tree_cover.geometry.intersects(postal_geom)]
            if candidates.empty:
                result[pno] = 0.0
                continue

            # Sum intersection areas
            tree_area = 0.0
            for _, tree_row in candidates.iterrows():
                intersection = postal_geom.intersection(tree_row.geometry)
                tree_area += intersection.area

            if postal_area > 0:
                pct = round((tree_area / postal_area) * 100, 1)
                result[pno] = min(pct, 100.0)  # Cap at 100%

        logger.info("Computed tree canopy for %d postal codes", len(result))

    except Exception as e:
        logger.warning("Could not fetch land cover data: %s", e)
        logger.info("Try downloading the dataset manually from HSY open data portal")
        (OUT_DIR / "tree_canopy.json").write_text("{}\n")
        return

    with open(OUT_DIR / "tree_canopy.json", "w") as f:
        json.dump(result, f, indent=2)

    logger.info("Done. Wrote tree_canopy.json")


if __name__ == "__main__":
    main()
