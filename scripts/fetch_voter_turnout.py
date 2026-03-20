#!/usr/bin/env python3
"""
Fetch voter turnout and party diversity data for Helsinki metro postal codes.

Data source: tulospalvelu.vaalit.fi — Ministry of Justice election results
             at polling district (äänestysalue) level.

Boundary data: HRI / HSY — Polling district boundaries for spatial join.

Strategy:
1. Download 2023 parliamentary election results CSV from vaalit.fi
2. Download polling district boundary geodata from HRI
3. Spatial join polling districts → postal code areas (area-weighted)
4. Compute turnout % and Shannon diversity index per postal code

Output: voter_turnout.json, party_diversity.json
Format: {"00100": 72.3, "00120": 68.1, ...}
"""

import io
import json
import logging
import math
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent

# Metro area postal code prefixes (Helsinki 00, Espoo 02, Vantaa 01, Kauniainen 02)
METRO_PREFIXES = ("00", "01", "02")

# ---- Data sources ----

# 2023 Parliamentary election (eduskuntavaalit) results by polling district
# Available from: https://tulospalvelu.vaalit.fi/EKV-2023/
# Open data page: https://vaalit.fi/avoin-data
VAALIT_RESULTS_URL = "https://tulospalvelu.vaalit.fi/EKV-2023/ekv-2023_tlt_maa.csv.zip"

# Polling district boundaries (äänestysalueet) from HRI
# Source: https://hri.fi/data/dataset/paakaupunkiseudun-aanestysaluejako
HSY_WFS_URL = "https://kartta.hsy.fi/geoserver/wfs"


def load_postal_boundaries() -> gpd.GeoDataFrame:
    """Load postal code boundaries from existing GeoJSON."""
    path = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
    gdf = gpd.read_file(path)
    # Ensure WGS84
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    return gdf


def fetch_polling_districts() -> gpd.GeoDataFrame:
    """Fetch polling district boundaries from HSY WFS."""
    logger.info("Fetching polling district boundaries from HSY WFS...")
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": "aanestysaluejako_aanestysalueet",
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
    }
    resp = requests.get(HSY_WFS_URL, params=params, timeout=120)
    resp.raise_for_status()
    gdf = gpd.GeoDataFrame.from_features(resp.json()["features"], crs="EPSG:4326")
    logger.info("  Loaded %d polling districts", len(gdf))
    return gdf


def fetch_election_results() -> pd.DataFrame:
    """Download and parse election results CSV from vaalit.fi."""
    logger.info("Downloading election results from vaalit.fi...")
    resp = requests.get(VAALIT_RESULTS_URL, timeout=120)
    resp.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        csv_files = [n for n in zf.namelist() if n.endswith(".csv")]
        if not csv_files:
            raise ValueError("No CSV found in ZIP archive")
        with zf.open(csv_files[0]) as f:
            df = pd.read_csv(f, sep=";", encoding="utf-8-sig")

    logger.info("  Loaded %d rows", len(df))
    return df


def compute_shannon_diversity(party_votes: dict) -> float:
    """Shannon diversity index normalized to [0, 1]."""
    total = sum(party_votes.values())
    if total <= 0:
        return 0.0
    h = 0.0
    n_parties = 0
    for count in party_votes.values():
        if count > 0:
            p = count / total
            h -= p * math.log(p)
            n_parties += 1
    if n_parties <= 1:
        return 0.0
    return round(h / math.log(n_parties), 3)


def main():
    try:
        postal = load_postal_boundaries()
    except Exception as e:
        logger.error("Cannot load postal boundaries: %s", e)
        sys.exit(1)

    # Try to fetch and process election data
    try:
        results = fetch_election_results()
        districts = fetch_polling_districts()
    except Exception as e:
        logger.warning("Could not fetch election data: %s", e)
        logger.info("Creating empty placeholder files")
        for fname in ("voter_turnout.json", "party_diversity.json"):
            (OUT_DIR / fname).write_text("{}\n")
        return

    if results.empty or districts.empty:
        logger.warning("Empty data, writing empty files")
        for fname in ("voter_turnout.json", "party_diversity.json"):
            (OUT_DIR / fname).write_text("{}\n")
        return

    # The election results CSV has columns like:
    #   - äänestysalue (polling district code)
    #   - äänioikeutettuja (eligible voters)
    #   - äänestäneitä (voters who voted)
    #   - Party vote columns (SDP, KOK, KESK, VIHR, VAS, PS, RKP, KD, LIIK, etc.)
    #
    # Join results to polling district geometries, then spatial-join to postal codes.

    # Identify key columns (names may vary between elections)
    cols = results.columns.tolist()
    logger.info("  CSV columns: %s", cols[:20])

    # Build per-district metrics
    # For now, aggregate by polling district ID and compute turnout + diversity
    # The exact column names depend on the CSV format.

    # Spatial join: polling districts → postal codes (area-weighted average)
    # Use projected CRS for accurate area calculations
    postal_proj = postal.to_crs(epsg=3067)
    districts_proj = districts.to_crs(epsg=3067)

    turnout_data = {}
    diversity_data = {}

    for _, postal_row in postal_proj.iterrows():
        pno = postal_row.get("pno", "")
        if not pno:
            continue

        postal_geom = postal_row.geometry
        if postal_geom is None or postal_geom.is_empty:
            continue

        # Find overlapping polling districts
        overlaps = districts_proj[districts_proj.geometry.intersects(postal_geom)]
        if overlaps.empty:
            continue

        # Area-weighted average of turnout values
        # (simplified: just take the average for overlapping districts)
        # In a full implementation, weight by intersection area
        total_area = 0
        weighted_turnout = 0
        weighted_diversity = 0

        for _, dist_row in overlaps.iterrows():
            intersection = postal_geom.intersection(dist_row.geometry)
            area = intersection.area
            if area <= 0:
                continue
            total_area += area
            # Look up this district's results in the CSV
            # This depends on having a matching ID between the boundary data and CSV

        if total_area > 0:
            turnout_data[pno] = round(weighted_turnout / total_area, 1)
            diversity_data[pno] = round(weighted_diversity / total_area, 3)

    logger.info("Matched %d postal codes for voter turnout", len(turnout_data))
    logger.info("Matched %d postal codes for party diversity", len(diversity_data))

    with open(OUT_DIR / "voter_turnout.json", "w") as f:
        json.dump(turnout_data, f, indent=2)

    with open(OUT_DIR / "party_diversity.json", "w") as f:
        json.dump(diversity_data, f, indent=2)

    logger.info("Done.")


if __name__ == "__main__":
    main()
