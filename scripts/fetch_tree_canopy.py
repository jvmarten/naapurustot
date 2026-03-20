#!/usr/bin/env python3
"""
Fetch tree canopy coverage data from HSY's Helsinki Region Land Cover Dataset.

Data source: HSY — Pääkaupunkiseudun maanpeiteaineisto (LiDAR-derived)
             WFS: kartta.hsy.fi/geoserver/wfs
             Layer: asuminen_ja_maankaytto:puusto (aggregate tree coverage)
             Individual height layers also available:
               - maanpeite_puusto_2_10m_2024
               - maanpeite_puusto_10_15m_2024
               - maanpeite_puusto_15_20m_2024
               - maanpeite_puusto_yli20m_2024
             License: CC BY 4.0

Method: Download aggregate tree coverage polygons via WFS, intersect with
        postal code boundaries, compute tree canopy % per postal code.

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
GEOJSON_PATH = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"

HSY_WFS_URL = "https://kartta.hsy.fi/geoserver/wfs"
PUUSTO_LAYER = "asuminen_ja_maankaytto:puusto"


def main():
    postal = gpd.read_file(GEOJSON_PATH)
    postal_proj = postal.to_crs(epsg=3067)
    postal_proj["geometry"] = postal_proj.geometry.buffer(0)

    logger.info("Downloading aggregate tree coverage layer from HSY WFS...")
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": PUUSTO_LAYER,
        "outputFormat": "application/json",
        "srsName": "EPSG:3067",
    }
    resp = requests.get(HSY_WFS_URL, params=params, timeout=300)
    resp.raise_for_status()
    puusto = gpd.GeoDataFrame.from_features(resp.json()["features"], crs="EPSG:3067")
    puusto["geometry"] = puusto.geometry.buffer(0)
    logger.info("  Downloaded %d tree coverage polygons", len(puusto))

    result = {}
    for idx, row in postal_proj.iterrows():
        pno = row["pno"]
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        postal_area = geom.area
        if postal_area <= 0:
            continue

        candidates = puusto[puusto.geometry.intersects(geom)]
        if candidates.empty:
            result[pno] = 0.0
            continue

        tree_area = 0.0
        for _, tree_row in candidates.iterrows():
            try:
                intersection = geom.intersection(tree_row.geometry)
                tree_area += intersection.area
            except Exception:
                continue

        pct = min(round((tree_area / postal_area) * 100, 1), 100.0)
        result[pno] = pct

        if (idx + 1) % 20 == 0:
            logger.info("  Processed %d/%d postal codes", idx + 1, len(postal_proj))

    logger.info("Computed tree canopy for %d postal codes", len(result))

    with open(OUT_DIR / "tree_canopy.json", "w") as f:
        json.dump(result, f, indent=2)
    logger.info("Done. Wrote tree_canopy.json")


if __name__ == "__main__":
    main()
