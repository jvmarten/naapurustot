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

PXWEB_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "Postinumeroalueittainen_avoin_tieto/uusin/paavo_pxt_12f7.px"
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
    for idx, row in gdf.iterrows():
        pop = safe_val(row.get("he_vakiy"))
        adult_pop = safe_val(row.get("ko_ika18y"))
        unemployed = safe_val(row.get("pt_tyott"))
        higher = safe_val(row.get("ko_yl_kork"))
        bachelor = safe_val(row.get("ko_al_kork"))
        pensioners = safe_val(row.get("pt_elak"))

        gdf.at[idx, "unemployment_rate"] = safe_div(unemployed, pop)
        gdf.at[idx, "higher_education_rate"] = (
            safe_div((higher or 0) + (bachelor or 0), adult_pop)
            if higher is not None and bachelor is not None and adult_pop
            else None
        )
        gdf.at[idx, "pensioner_share"] = safe_div(pensioners, pop)
    return gdf


def fetch_foreign_language():
    """Fetch foreign-language speaker data from PxWeb API."""
    print("Fetching foreign-language speaker data from PxWeb...")

    # First, get table metadata to understand the structure
    try:
        meta_r = requests.get(PXWEB_URL, timeout=30)
        meta_r.raise_for_status()
        meta = meta_r.json()
    except Exception as e:
        print(f"  Warning: Could not fetch PxWeb metadata: {e}")
        return {}

    # Build a query for the latest year, all postal codes, relevant language groups
    variables = meta.get("variables", [])
    query_items = []

    for var in variables:
        code = var["code"]
        values = var["values"]
        if code.lower() in ("vuosi", "year"):
            # Take latest year
            query_items.append({"code": code, "selection": {"filter": "item", "values": [values[-1]]}})
        elif code.lower() in ("postinumeroalue", "postal code area", "alue"):
            # All postal codes
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
        elif code.lower() in ("kieli", "language", "kieli1"):
            # All languages to calculate foreign share
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
        else:
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})

    query = {"query": query_items, "response": {"format": "json"}}

    try:
        r = requests.post(PXWEB_URL, json=query, timeout=60)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  Warning: Could not fetch PxWeb data: {e}")
        return {}

    # Parse JSON-stat-like response
    # Group by postal code, sum Finnish+Swedish vs other
    result = {}
    try:
        columns = data.get("columns", [])
        comments = data.get("data", []) if "data" in data else []
        # Find the postal code column and language column indices
        pno_idx = None
        lang_idx = None
        val_idx = None
        for i, col in enumerate(columns):
            code = col.get("code", "").lower()
            if code in ("postinumeroalue", "postal code area", "alue"):
                pno_idx = i
            elif code in ("kieli", "language", "kieli1"):
                lang_idx = i

        if pno_idx is not None:
            for row in comments:
                keys = row.get("key", [])
                vals = row.get("values", [])
                if not keys or not vals:
                    continue
                pno = keys[pno_idx][:5]  # Extract 5-digit postal code
                lang = keys[lang_idx] if lang_idx is not None else ""
                val = float(vals[0]) if vals[0] not in (None, "..", "...", "") else 0

                if pno not in result:
                    result[pno] = {"total": 0, "finnish": 0, "swedish": 0, "other": 0}

                result[pno]["total"] += val
                # Finnish = fi, Swedish = sv
                lang_lower = lang.lower()
                if "suomi" in lang_lower or "finska" in lang_lower or "finnish" in lang_lower or lang_lower == "fi":
                    result[pno]["finnish"] += val
                elif "ruotsi" in lang_lower or "svenska" in lang_lower or "swedish" in lang_lower or lang_lower == "sv":
                    result[pno]["swedish"] += val
                else:
                    result[pno]["other"] += val

        print(f"  Parsed foreign-language data for {len(result)} postal codes")
    except Exception as e:
        print(f"  Warning: Could not parse PxWeb response: {e}")

    return result


def join_foreign_language(gdf, lang_data):
    if not lang_data:
        gdf["foreign_language_pct"] = None
        return gdf

    print("Joining foreign-language data...")
    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        if pno in lang_data:
            d = lang_data[pno]
            total = d["total"]
            other = d["other"]
            if total and total > 0:
                gdf.at[idx, "foreign_language_pct"] = round(other / total * 100, 1)
            else:
                gdf.at[idx, "foreign_language_pct"] = None
        else:
            gdf.at[idx, "foreign_language_pct"] = None
    return gdf


def clean_properties(gdf):
    """Replace -1 suppressed values with None in key fields."""
    key_fields = [
        "he_vakiy", "he_kika", "ko_ika18y", "ko_yl_kork", "ko_al_kork",
        "ko_ammat", "ko_perus", "hr_mtu", "hr_ktu", "pt_tyoll", "pt_tyott",
        "pt_opisk", "pt_elak", "ra_asunn", "te_takk",
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
