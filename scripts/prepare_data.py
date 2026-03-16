#!/usr/bin/env python3
"""
Fetch Paavo statistics + postal code boundaries from Statistics Finland WFS,
filter to Helsinki metro area, reproject, calculate derived metrics,
join foreign-language speaker data, and output GeoJSON.
"""

import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from pyproj import Transformer

# Metro municipality codes
METRO_CODES = {"091", "049", "092", "235"}

WFS_URL = (
    "https://geo.stat.fi/geoserver/postialue/wfs"
    "?service=WFS&version=2.0.0&request=GetFeature"
    "&typeNames=postialue:pno_tilasto_2024"
    "&outputFormat=application/json"
)

LANG_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/vaerak/statfin_vaerak_pxt_11rm.px"
)


def safe_val(v):
    """Return None if value is suppressed (-1) or missing."""
    if v is None or v == -1 or v == -1.0:
        return None
    return v


def safe_div(a, b):
    """Safe division — returns None if either operand is None/zero."""
    if a is None or b is None or b == 0:
        return None
    return round(a / b * 100, 1)


def fetch_paavo():
    print("Fetching Paavo WFS data...")
    r = requests.get(WFS_URL, timeout=120)
    r.raise_for_status()
    gdf = gpd.GeoDataFrame.from_features(r.json()["features"], crs="EPSG:3067")
    print(f"  Received {len(gdf)} features")
    return gdf


def filter_metro(gdf):
    # kunta field holds the municipality code
    col = None
    for c in ["kunta", "kuntanro", "kuntatunnus"]:
        if c in gdf.columns:
            col = c
            break
    if col is None:
        # Try to derive from pno (first 3 digits map to municipality in some cases)
        # Actually, look at all columns to find it
        print("  Available columns:", list(gdf.columns))
        # Fall back: check if 'pno' starts with metro prefixes
        # Helsinki 00xxx, Espoo 02xxx, Vantaa 01xxx, Kauniainen 02700
        metro = gdf[
            gdf["pno"].str.startswith("00")
            | gdf["pno"].str.startswith("01")
            | gdf["pno"].str.startswith("02")
        ].copy()
        print(f"  Filtered to {len(metro)} metro postal codes by prefix")
        return metro

    metro = gdf[gdf[col].astype(str).isin(METRO_CODES)].copy()
    print(f"  Filtered to {len(metro)} metro postal codes by municipality code")
    return metro


def reproject(gdf):
    print("Reprojecting to WGS84...")
    return gdf.to_crs("EPSG:4326")


def calculate_metrics(gdf):
    print("Calculating derived metrics...")
    # Add pno field from postinumeroalue (frontend expects 'pno')
    gdf["pno"] = gdf["postinumeroalue"]
    for idx, row in gdf.iterrows():
        pop = safe_val(row.get("he_vakiy"))
        adult_pop = safe_val(row.get("ko_ika18y"))
        unemployed = safe_val(row.get("pt_tyott"))
        higher = safe_val(row.get("ko_yl_kork"))
        bachelor = safe_val(row.get("ko_al_kork"))
        pensioners = safe_val(row.get("pt_elakel"))

        gdf.at[idx, "unemployment_rate"] = safe_div(unemployed, pop)
        gdf.at[idx, "higher_education_rate"] = (
            safe_div((higher or 0) + (bachelor or 0), adult_pop)
            if higher is not None and bachelor is not None and adult_pop
            else None
        )
        gdf.at[idx, "pensioner_share"] = safe_div(pensioners, pop)
    return gdf


def fetch_foreign_language():
    """Fetch foreign-language speaker percentages per municipality from StatFin.

    Language data is not available at the postal code level in Paavo, so we
    use municipality-level data from Statistics Finland's population structure
    table (11rm) and apply it to postal codes by municipality.
    """
    print("Fetching foreign-language speaker data from StatFin...")

    # Municipality codes used in the StatFin API (prefixed with KU)
    muni_codes = [f"KU{c}" for c in METRO_CODES]

    try:
        # Get metadata to find the latest year
        meta_r = requests.get(LANG_URL, timeout=30)
        meta_r.raise_for_status()
        meta = meta_r.json()
    except Exception as e:
        print(f"  Warning: Could not fetch StatFin metadata: {e}")
        return {}

    latest_year = None
    for var in meta.get("variables", []):
        if var["code"].lower() in ("vuosi", "year"):
            latest_year = var["values"][-1]
            break

    if not latest_year:
        print("  Warning: Could not determine latest year")
        return {}

    # Query total (SSS) and foreign languages (02) for metro municipalities
    query = {
        "query": [
            {"code": "Alue", "selection": {"filter": "item", "values": muni_codes}},
            {"code": "Kieli", "selection": {"filter": "item", "values": ["SSS", "02"]}},
            {"code": "Sukupuoli", "selection": {"filter": "item", "values": ["SSS"]}},
            {"code": "Vuosi", "selection": {"filter": "item", "values": [latest_year]}},
        ],
        "response": {"format": "json"},
    }

    try:
        r = requests.post(LANG_URL, json=query, timeout=60)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  Warning: Could not fetch StatFin data: {e}")
        return {}

    # Parse response: build {municipality_code: foreign_pct}
    # Each municipality has two rows: SSS (total) and 02 (foreign)
    muni_totals = {}
    muni_foreign = {}
    for row in data.get("data", []):
        keys = row.get("key", [])
        vals = row.get("values", [])
        if not keys or not vals:
            continue
        muni = keys[0].replace("KU", "")  # e.g. "KU091" -> "091"
        lang_code = keys[1]
        val = float(vals[0]) if vals[0] not in (None, "..", "...", "") else 0
        if lang_code == "SSS":
            muni_totals[muni] = val
        elif lang_code == "02":
            muni_foreign[muni] = val

    result = {}
    for muni in muni_totals:
        total = muni_totals.get(muni, 0)
        foreign = muni_foreign.get(muni, 0)
        if total > 0:
            result[muni] = round(foreign / total * 100, 1)
        else:
            result[muni] = None

    print(f"  Foreign-language percentages by municipality:")
    for muni, pct in sorted(result.items()):
        print(f"    {muni}: {pct}%")

    return result


def join_foreign_language(gdf, lang_data):
    """Apply municipality-level foreign-language percentages to postal codes."""
    if not lang_data:
        gdf["foreign_language_pct"] = None
        return gdf

    print("Joining foreign-language data by municipality...")
    for idx, row in gdf.iterrows():
        muni = str(row.get("kunta", ""))
        gdf.at[idx, "foreign_language_pct"] = lang_data.get(muni)

    matched = gdf["foreign_language_pct"].notna().sum()
    print(f"  Matched {matched}/{len(gdf)} postal codes")
    return gdf


def clean_properties(gdf):
    """Replace -1 suppressed values with None in key fields."""
    key_fields = [
        "he_vakiy", "he_kika", "ko_ika18y", "ko_yl_kork", "ko_al_kork",
        "ko_ammat", "ko_perus", "hr_mtu", "hr_ktu", "pt_tyoll", "pt_tyott",
        "pt_opisk", "pt_elakel", "ra_asunn", "te_takk",
    ]
    for col in key_fields:
        if col in gdf.columns:
            gdf[col] = gdf[col].apply(lambda v: None if v == -1 or v == -1.0 else v)
    return gdf


def main():
    out_path = Path(__file__).parent.parent / "public" / "data" / "metro_neighborhoods.geojson"

    gdf = fetch_paavo()
    gdf = filter_metro(gdf)
    gdf = reproject(gdf)
    gdf = clean_properties(gdf)
    gdf = calculate_metrics(gdf)

    lang_data = fetch_foreign_language()
    gdf = join_foreign_language(gdf, lang_data)

    # Write output
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(out_path, driver="GeoJSON")
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"\nWrote {len(gdf)} features to {out_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
