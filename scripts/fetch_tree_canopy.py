#!/usr/bin/env python3
"""
Fetch tree canopy coverage data for all metro regions.

Data sources:
  - Helsinki metro: HSY — Pääkaupunkiseudun maanpeiteaineisto (LiDAR-derived,
    sub-metre per-tree detection — substantially higher quality than 10 m
    satellite, worth keeping as a special case for the dense urban core).
    WFS: kartta.hsy.fi/geoserver/wfs
    Layer: asuminen_ja_maankaytto:puusto
  - Everywhere else: Copernicus HRL Tree Cover Density (10 m, pan-European, newest year),
    read from the CDSE S3 archive (scripts/tcd_cdse.py, shared with Sweden's
    scripts/se/fetch_se_canopy.py): the exact mean over every pixel in the postal
    area — no random sampling, no estimation. Needs CDSE_S3_ACCESS_KEY and
    CDSE_S3_SECRET_KEY. The EEA ImageServer this used to call (computeHistograms)
    was retired.

Tampere and Turku previously combined OSM forest landuse with Copernicus via
max(); OSM was dropped because (a) it inflated values where parks/private
yards were tagged as forest, (b) under-mapping caused arbitrary regional
variation, and (c) using one methodology nationwide makes regions comparable.

Output: tree_canopy.json
Format: {"00100": 15.3, "00120": 42.1, ...}  (% of area covered by trees)
Output: tree_canopy_history.json — Copernicus for EVERY postal code and year 2018-,
        capital region included, for the year slider (HSY has a single year)
Format: {"00100": [[2018, 14.9], ..., [2024, 15.6]], ...}
"""

import json
import logging
from pathlib import Path

import geopandas as gpd
import requests
from shapely import STRtree
from shapely.ops import unary_union
from shapely.validation import make_valid

from tcd_cdse import history, mean_tcd

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent
GEOJSON_PATH = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"

# HSY (Helsinki metro)
HSY_WFS_URL = "https://kartta.hsy.fi/geoserver/wfs"
PUUSTO_LAYER = "asuminen_ja_maankaytto:puusto"

# Postal-code prefixes HSY's land cover covers; Copernicus TCD everywhere else.
HSY_PREFIXES = {"00", "01", "02"}


# ---------------------------------------------------------------------------
# OSM forest helpers
# ---------------------------------------------------------------------------

def compute_tree_pct(postal_proj, tree_gdf, label=""):
    """Compute tree canopy % for each postal code using spatial index."""
    if tree_gdf.empty:
        return {}

    tree_geoms = list(tree_gdf.geometry)
    tree = STRtree(tree_geoms)

    result = {}
    total = len(postal_proj)
    for i, (idx, row) in enumerate(postal_proj.iterrows()):
        pno = row["pno"]
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        postal_area = geom.area
        if postal_area <= 0:
            continue

        candidates = tree.query(geom)
        if len(candidates) == 0:
            result[pno] = 0.0
            continue

        candidate_geoms = [tree_geoms[c] for c in candidates]
        local_union = unary_union(candidate_geoms)
        intersection = geom.intersection(local_union)
        if intersection.is_empty:
            result[pno] = 0.0
        else:
            pct = min(round(intersection.area / postal_area * 100, 1), 100.0)
            result[pno] = pct

        if (i + 1) % 20 == 0:
            logger.info("  %s: %d/%d postal codes", label, i + 1, total)

    return result


# ---------------------------------------------------------------------------
# Per-metro fetch functions
# ---------------------------------------------------------------------------

def fetch_hsy_trees(postal_proj):
    """Fetch tree canopy from HSY for Helsinki metro."""
    logger.info("Downloading HSY tree coverage layer...")
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
    puusto["geometry"] = puusto.geometry.apply(make_valid)
    logger.info("  Downloaded %d HSY tree polygons", len(puusto))

    hki_postal = postal_proj[postal_proj["pno"].str[:2].isin(HSY_PREFIXES)].copy()

    return compute_tree_pct(hki_postal, puusto, "Helsinki")


def main():
    postal = gpd.read_file(GEOJSON_PATH)
    postal_proj = postal.to_crs(epsg=3067)
    postal_proj["geometry"] = postal_proj.geometry.apply(make_valid)
    postal_4326 = postal.to_crs(epsg=4326)
    postal_4326["geometry"] = postal_4326.geometry.apply(make_valid)

    # Load existing data (Helsinki already has data from HSY)
    existing_file = OUT_DIR / "tree_canopy.json"
    result = {}
    if existing_file.exists():
        with open(existing_file, encoding="utf-8") as f:
            result = json.load(f)
        logger.info("Loaded %d existing entries from %s", len(result), existing_file.name)

    # Only fetch HSY if we don't already have Helsinki data
    hki_count = sum(1 for k in result if k[:2] in HSY_PREFIXES)
    if hki_count < 50:
        try:
            hsy_result = fetch_hsy_trees(postal_proj)
            result.update(hsy_result)
            logger.info("Helsinki: %d postal codes", len(hsy_result))
        except Exception as e:
            logger.error("HSY tree canopy failed: %s", e)
    else:
        logger.info("Skipping HSY fetch (already have %d Helsinki entries)", hki_count)

    # Copernicus TCD for every postal code and year, the exact mean over every 10 m pixel
    # in the area (scripts/tcd_cdse.py, also Sweden's source). The series feeds the year
    # slider; its newest year is the current value outside the capital region.
    by_year = mean_tcd(postal_4326, "pno", label="Nationwide TCD")
    latest = by_year[max(by_year)]
    if len(latest) != len(postal_4326):
        raise SystemExit(f"TCD: {len(postal_4326) - len(latest)} postal codes got no mapped pixel")
    result = {k: v for k, v in result.items() if k[:2] in HSY_PREFIXES}
    result.update({k: v for k, v in latest.items() if k not in result})
    result = dict(sorted(result.items()))
    with open(OUT_DIR / "tree_canopy_history.json", "w", encoding="utf-8") as f:
        json.dump(history(by_year), f, separators=(",", ":"))
        f.write("\n")

    logger.info("Total tree canopy data: %d postal codes", len(result))

    with open(OUT_DIR / "tree_canopy.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    logger.info("Done. Wrote tree_canopy.json")


if __name__ == "__main__":
    main()
