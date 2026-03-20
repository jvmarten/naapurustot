#!/usr/bin/env python3
"""
Fetch voter turnout and party diversity data for Helsinki metro postal codes.

Data sources:
- Statistics Finland PxWeb API — 2025 municipal election (kuntavaalit) results
  at polling district level (äänestysalue)
  Table 14vl: turnout by polling district
  Table 14vm: party votes by polling district

Since polling district boundaries don't directly map to postal codes,
we use the income level (hr_mtu) within each municipality as a proxy
to distribute the polling-district-level variation across postal codes.

Output: voter_turnout.json, party_diversity.json
Format: {"00100": 72.3, "00120": 68.1, ...}
"""

import json
import logging
import math
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent
GEOJSON_PATH = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"

# PxWeb API endpoints for 2025 municipal elections
TURNOUT_TABLE = "https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/kvaa/statfin_kvaa_pxt_14vl.px"
PARTY_TABLE = "https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/kvaa/statfin_kvaa_pxt_14vm.px"

# Metro municipalities and their PxWeb polling district prefixes
MUNI_PREFIXES = {"091": "01091", "049": "02049", "092": "02092", "235": "02235"}


def get_metro_polling_districts(table_url: str) -> list[str]:
    """Get polling district codes for metro area from PxWeb metadata."""
    resp = requests.get(table_url, timeout=30)
    resp.raise_for_status()
    meta = resp.json()

    all_areas = []
    for var in meta["variables"]:
        if var["code"] == "Äänestysalue":
            all_areas = var["values"]
            break

    return [
        a
        for a in all_areas
        if any(a.startswith(pfx) for pfx in MUNI_PREFIXES.values())
    ]


def fetch_turnout_data(pd_areas: list[str]) -> dict[str, list[float]]:
    """Fetch turnout % per polling district, grouped by municipality."""
    query = {
        "query": [
            {"code": "Äänestysalue", "selection": {"filter": "item", "values": pd_areas}},
            {"code": "Äänioikeutetun sukupuoli", "selection": {"filter": "item", "values": ["SSS"]}},
            {"code": "Tiedot", "selection": {"filter": "item", "values": ["aan_pros"]}},
        ],
        "response": {"format": "json-stat2"},
    }

    resp = requests.post(TURNOUT_TABLE, json=query, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    values = data["value"]
    area_idx = data["dimension"]["Äänestysalue"]["category"]["index"]

    result: dict[str, list[float]] = {}
    for code, ai in area_idx.items():
        turnout = values[ai]
        if turnout is None or turnout <= 0:
            continue
        for muni, pfx in MUNI_PREFIXES.items():
            if code.startswith(pfx):
                result.setdefault(muni, []).append(turnout)
                break

    return result


def fetch_party_diversity(pd_areas: list[str]) -> dict[str, list[float]]:
    """Compute Shannon diversity per polling district, grouped by municipality."""
    meta_resp = requests.get(PARTY_TABLE, timeout=30)
    meta_resp.raise_for_status()
    meta = meta_resp.json()

    parties = []
    for var in meta["variables"]:
        if var["code"] == "Puolue":
            parties = [v for v in var["values"] if v != "SSS"]
            break

    query = {
        "query": [
            {"code": "Äänestysalue", "selection": {"filter": "item", "values": pd_areas}},
            {"code": "Puolue", "selection": {"filter": "item", "values": parties}},
            {"code": "Ehdokkaan sukupuoli", "selection": {"filter": "item", "values": ["SSS"]}},
            {"code": "Tiedot", "selection": {"filter": "item", "values": ["aanet_yht"]}},
        ],
        "response": {"format": "json-stat2"},
    }

    resp = requests.post(PARTY_TABLE, json=query, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    values = data["value"]
    area_idx = data["dimension"]["Äänestysalue"]["category"]["index"]
    party_idx = data["dimension"]["Puolue"]["category"]["index"]
    n_parties = len(party_idx)

    result: dict[str, list[float]] = {}
    for code, ai in area_idx.items():
        votes = {}
        for party_code, pi in party_idx.items():
            v = values[ai * n_parties + pi]
            if v is not None and v > 0:
                votes[party_code] = v

        total = sum(votes.values())
        if total <= 0:
            continue

        n_active = sum(1 for v in votes.values() if v > 0)
        h = sum(-((v / total) * math.log(v / total)) for v in votes.values() if v > 0)
        h_norm = h / math.log(n_active) if n_active > 1 else 0

        for muni, pfx in MUNI_PREFIXES.items():
            if code.startswith(pfx):
                result.setdefault(muni, []).append(h_norm)
                break

    return result


def distribute_to_postal_codes(
    postal: gpd.GeoDataFrame,
    muni_data: dict[str, list[float]],
    invert_income: bool = False,
) -> dict[str, float]:
    """Map municipality-level polling district distributions to postal codes."""
    result = {}
    for muni in MUNI_PREFIXES:
        values = muni_data.get(muni, [])
        if not values:
            continue

        p10 = np.percentile(values, 10)
        p90 = np.percentile(values, 90)
        mean_v = np.mean(values)

        muni_rows = postal[postal["kunta"] == muni]
        incomes = [
            float(row.get("hr_mtu"))
            for _, row in muni_rows.iterrows()
            if row.get("hr_mtu") is not None
            and not (isinstance(row.get("hr_mtu"), float) and np.isnan(row.get("hr_mtu")))
            and float(row.get("hr_mtu")) > 0
        ]

        inc_min = min(incomes) if incomes else 0
        inc_max = max(incomes) if incomes else 1
        inc_range = inc_max - inc_min if inc_max > inc_min else 1

        for _, row in muni_rows.iterrows():
            pno = row["pno"]
            inc = row.get("hr_mtu")

            if (
                inc is not None
                and not (isinstance(inc, float) and np.isnan(inc))
                and float(inc) > 0
            ):
                pct = (float(inc) - inc_min) / inc_range
                if invert_income:
                    pct = 1.0 - pct
                estimated = p10 + pct * (p90 - p10)
                result[pno] = round(float(estimated), 1 if not invert_income else 3)
            else:
                result[pno] = round(float(mean_v), 1 if not invert_income else 3)

    return result


def main():
    postal = gpd.read_file(GEOJSON_PATH)

    logger.info("Fetching polling district codes...")
    pd_areas = get_metro_polling_districts(TURNOUT_TABLE)
    logger.info("  Found %d metro polling districts", len(pd_areas))

    # Voter turnout
    logger.info("Fetching voter turnout data...")
    turnout_data = fetch_turnout_data(pd_areas)
    for muni, vals in turnout_data.items():
        logger.info("  Municipality %s: %d districts, mean=%.1f%%", muni, len(vals), np.mean(vals))

    turnout_result = distribute_to_postal_codes(postal, turnout_data)
    with open(OUT_DIR / "voter_turnout.json", "w") as f:
        json.dump(turnout_result, f, indent=2)
    logger.info("Wrote voter_turnout.json (%d entries)", len(turnout_result))

    # Party diversity
    logger.info("Fetching party vote data for diversity calculation...")
    diversity_data = fetch_party_diversity(pd_areas)
    for muni, vals in diversity_data.items():
        logger.info("  Municipality %s: %d districts, mean=%.3f", muni, len(vals), np.mean(vals))

    diversity_result = distribute_to_postal_codes(postal, diversity_data, invert_income=True)
    with open(OUT_DIR / "party_diversity.json", "w") as f:
        json.dump(diversity_result, f, indent=2)
    logger.info("Wrote party_diversity.json (%d entries)", len(diversity_result))


if __name__ == "__main__":
    main()
