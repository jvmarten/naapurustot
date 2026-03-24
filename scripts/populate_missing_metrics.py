#!/usr/bin/env python3
"""
Targeted script to populate missing metrics in the GeoJSON:
- rental_price_sqm (from Statistics Finland PxWeb API)
- price_to_rent_ratio (derived from property_price_sqm + rental_price_sqm)
- walkability_index (derived from existing OSM density columns)

This avoids running the full prepare_data.py pipeline which takes very long
due to OSM spatial joins.
"""

import json
import logging
import sys
import time
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

GEOJSON_PATH = Path(__file__).parent.parent / "public" / "data" / "metro_neighborhoods.geojson"

RENTAL_PRICE_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/asvu/statfin_asvu_pxt_13eb.px"
)
RENTAL_PRICE_FILE = Path(__file__).parent / "rental_prices.json"

MAX_RETRIES = 3


def fetch_rental_prices():
    """Fetch rental price data (€/m²/month) per postal code from Statistics Finland."""
    logger.info("Fetching rental price metadata...")

    try:
        r = requests.get(RENTAL_PRICE_URL, timeout=30)
        r.raise_for_status()
        meta = r.json()
    except Exception as e:
        logger.warning("Failed to fetch metadata: %s", e)
        if RENTAL_PRICE_FILE.exists():
            logger.info("Falling back to local file: %s", RENTAL_PRICE_FILE.name)
            with open(RENTAL_PRICE_FILE) as f:
                data = json.load(f)
            return {k: float(v) for k, v in data.items()}
        return {}

    variables = meta.get("variables", [])
    if not variables:
        logger.error("No variables in metadata")
        return {}

    query_items = []
    for var in variables:
        code = var["code"]
        values = var["values"]
        code_lower = code.lower()

        if code_lower in ("vuosineljännes", "quarter", "vuosi", "year"):
            # Take latest quarter
            query_items.append({"code": code, "selection": {"filter": "item", "values": [values[-1]]}})
        elif code_lower in ("postinumero", "postal code", "alue", "postinumeroalue"):
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
        elif code_lower in ("huoneluku", "number of rooms"):
            # All room types — we'll average them
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
        elif code_lower in ("tiedot", "information"):
            # Only "keskivuokra" = rent per sqm, not "lkm_ptno" = count
            keskivuokra = [v for v in values if "keskivuokra" in v.lower() or "vuokra" in v.lower()]
            if keskivuokra:
                query_items.append({"code": code, "selection": {"filter": "item", "values": keskivuokra}})
            else:
                # Fallback: take last value (usually the rent metric)
                query_items.append({"code": code, "selection": {"filter": "item", "values": [values[-1]]}})
        else:
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})

    query = {"query": query_items, "response": {"format": "json"}}

    logger.info("Fetching rental price data...")
    time.sleep(1)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.post(RENTAL_PRICE_URL, json=query, timeout=60)
            r.raise_for_status()
            data = r.json()
            break
        except Exception as e:
            if attempt == MAX_RETRIES:
                logger.error("Failed to fetch rental data after %d retries: %s", MAX_RETRIES, e)
                if RENTAL_PRICE_FILE.exists():
                    logger.info("Falling back to local file")
                    with open(RENTAL_PRICE_FILE) as f:
                        return json.load(f)
                return {}
            wait = 2 ** attempt
            logger.warning("Retry %d/%d in %ds: %s", attempt, MAX_RETRIES, wait, e)
            time.sleep(wait)

    columns = data.get("columns", [])
    rows = data.get("data", [])

    # Collect all rent values per postal code (multiple room types)
    # and compute a weighted average
    from collections import defaultdict
    pno_rents = defaultdict(list)

    pno_idx = None
    for i, col in enumerate(columns):
        code_lower = col.get("code", "").lower()
        if code_lower in ("postinumero", "postal code", "alue", "postinumeroalue"):
            pno_idx = i

    if pno_idx is not None:
        for row in rows:
            keys = row.get("key", [])
            vals = row.get("values", [])
            if not keys or not vals:
                continue
            pno = keys[pno_idx][:5]
            val = vals[0]
            if val not in (None, "..", "...", ""):
                try:
                    rent = float(val)
                    if rent > 0:
                        pno_rents[pno].append(rent)
                except (ValueError, TypeError):
                    pass

    # Average across room types
    result = {}
    for pno, rents in pno_rents.items():
        result[pno] = round(sum(rents) / len(rents), 2)

    logger.info("Parsed rental prices for %s postal codes", len(result))

    # Save to local file for future fallback
    with open(RENTAL_PRICE_FILE, "w") as f:
        json.dump(result, f, indent=2)
    logger.info("Saved rental prices to %s", RENTAL_PRICE_FILE.name)

    return result


def calculate_walkability(features):
    """Calculate walkability index from existing OSM density properties."""
    components = [
        "restaurant_density", "grocery_density", "transit_stop_density",
        "healthcare_density", "cycling_density", "school_density",
    ]

    # Collect non-null values for percentile calculation
    comp_values = {}
    for comp in components:
        vals = []
        for feat in features:
            v = feat["properties"].get(comp)
            if v is not None and isinstance(v, (int, float)) and v >= 0:
                vals.append(v)
        comp_values[comp] = sorted(vals)

    def percentile_score(value, sorted_vals):
        if not sorted_vals or value is None:
            return None
        n = len(sorted_vals)
        count_le = sum(1 for v in sorted_vals if v <= value)
        return round(count_le / n * 100, 1)

    count = 0
    for feat in features:
        props = feat["properties"]
        scores = []
        for comp in components:
            v = props.get(comp)
            if v is not None and isinstance(v, (int, float)) and comp_values[comp]:
                s = percentile_score(v, comp_values[comp])
                if s is not None:
                    scores.append(s)

        if len(scores) >= 3:
            props["walkability_index"] = round(sum(scores) / len(scores), 0)
            count += 1
        else:
            props["walkability_index"] = None

    logger.info("Computed walkability index for %s/%s postal codes", count, len(features))


def main():
    logger.info("Loading GeoJSON from %s", GEOJSON_PATH)
    with open(GEOJSON_PATH) as f:
        geojson = json.load(f)

    features = geojson["features"]
    logger.info("Loaded %d features", len(features))

    # 1. Fetch rental prices
    rental_data = fetch_rental_prices()

    # 2. Join rental prices to features
    matched = 0
    for feat in features:
        pno = feat["properties"].get("pno", "")
        rent = rental_data.get(pno)
        feat["properties"]["rental_price_sqm"] = rent
        if rent is not None:
            matched += 1
    logger.info("Matched rental prices: %s/%s", matched, len(features))

    # 3. Calculate price-to-rent ratio
    ptr_count = 0
    for feat in features:
        props = feat["properties"]
        price = props.get("property_price_sqm")
        rent = props.get("rental_price_sqm")
        if (price is not None and isinstance(price, (int, float))
                and rent is not None and isinstance(rent, (int, float)) and rent > 0):
            props["price_to_rent_ratio"] = round(price / (rent * 12), 1)
            ptr_count += 1
        else:
            props["price_to_rent_ratio"] = None
    logger.info("Computed price-to-rent ratio for %s/%s postal codes", ptr_count, len(features))

    # 4. Calculate walkability index
    calculate_walkability(features)

    # 5. Write updated GeoJSON
    with open(GEOJSON_PATH, "w") as f:
        json.dump(geojson, f)
    size_mb = GEOJSON_PATH.stat().st_size / 1024 / 1024
    logger.info("Wrote %d features to %s (%.1f MB)", len(features), GEOJSON_PATH, size_mb)


if __name__ == "__main__":
    main()
