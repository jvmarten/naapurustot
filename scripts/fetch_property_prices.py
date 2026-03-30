#!/usr/bin/env python3
"""Fetch property price data (EUR/m2) per postal code from Statistics Finland.

Data source: Statistics Finland PxWeb API
  Table: statfin_ashi_pxt_13mu.px
    "Prices per square meter of old dwellings in housing companies
     and numbers of transactions by postal code area, yearly"

Covers all three metro regions: Helsinki, Tampere, Turku.

Method:
  1. Read postal codes from the project GeoJSON (330 postal codes).
  2. Fetch PxWeb table metadata to discover variable codes and latest period.
  3. Query the API for the latest 3 years of data (for fallback coverage).
  4. For each postal code, compute a sales-weighted average across building
     types (1-room, 2-room, 3-room+ flats, terraced houses).
  5. Use the latest year with valid data; fall back to prior years if needed.
  6. Merge with any existing data in property_prices.json (new data takes
     priority) so that previously-fetched codes are not lost.
  7. Save to scripts/property_prices.json.

Output format: {"00100": 7350, "33100": 4150, ...}  (EUR/m2, integer)

Usage:
    python scripts/fetch_property_prices.py
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

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_FILE = SCRIPT_DIR / "property_prices.json"

# PxWeb table: old dwelling prices by postal code, yearly
PXWEB_TABLE_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/ashi/statfin_ashi_pxt_13mu.px"
)

# How many recent years to query for fallback coverage
FALLBACK_YEARS = 3

# Retry / rate limit
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2
RATE_LIMIT_DELAY = 1.0


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def request_with_retry(method: str, url: str, *, label: str,
                       retries: int = MAX_RETRIES, **kwargs):
    """Execute an HTTP request with exponential-backoff retries."""
    kwargs.setdefault("timeout", 60)
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.request(method, url, **kwargs)
            r.raise_for_status()
            return r
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                wait = RETRY_BACKOFF_BASE ** attempt
                logger.warning(
                    "  Retry %d/%d for %s in %ds (%s)",
                    attempt, retries, label, wait, exc,
                )
                time.sleep(wait)
    raise last_exc  # type: ignore[misc]


def rate_limit():
    """Sleep briefly between API calls to be polite."""
    time.sleep(RATE_LIMIT_DELAY)


# ---------------------------------------------------------------------------
# Load our postal codes from GeoJSON
# ---------------------------------------------------------------------------

def load_our_postal_codes() -> list[str]:
    """Read the postal codes we need from the project GeoJSON."""
    logger.info("Loading postal codes from %s", GEOJSON_PATH)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)

    codes = sorted(set(
        feat["properties"]["pno"]
        for feat in geojson.get("features", [])
        if feat.get("properties", {}).get("pno")
    ))
    logger.info("  Found %d postal codes in GeoJSON", len(codes))
    return codes


# ---------------------------------------------------------------------------
# Fetch PxWeb metadata
# ---------------------------------------------------------------------------

def fetch_metadata() -> dict:
    """GET the PxWeb table to discover variable codes and available values.

    Returns the parsed JSON metadata.
    """
    logger.info("Fetching PxWeb metadata from %s", PXWEB_TABLE_URL)
    r = request_with_retry("GET", PXWEB_TABLE_URL, label="metadata")
    meta = r.json()

    if not isinstance(meta, dict) or "variables" not in meta:
        raise ValueError("Unexpected metadata format: missing 'variables'")

    for var in meta["variables"]:
        code = var.get("code")
        text = var.get("text")
        count = len(var.get("values", []))
        logger.info("  Variable: code=%r, text=%r, %d values", code, text, count)

    return meta


# ---------------------------------------------------------------------------
# Build and execute the PxWeb query
# ---------------------------------------------------------------------------

def find_variable(meta: dict, code_hint: str) -> dict | None:
    """Find a variable in the metadata by code (case-insensitive)."""
    for var in meta["variables"]:
        if var["code"].lower() == code_hint.lower():
            return var
    return None


def determine_query_years(meta: dict) -> list[str]:
    """Pick the latest N non-preliminary years, plus any preliminary year.

    Returns up to FALLBACK_YEARS year codes, newest first.
    """
    year_var = find_variable(meta, "Vuosi")
    if year_var is None:
        raise ValueError("Could not find 'Vuosi' (Year) variable in metadata")

    all_years = year_var["values"]
    year_texts = year_var.get("valueTexts", all_years)

    # Identify preliminary years (marked with *)
    final_years = []
    preliminary_years = []
    for code, text in zip(all_years, year_texts):
        if "*" in text:
            preliminary_years.append(code)
        else:
            final_years.append(code)

    # Take the latest FALLBACK_YEARS from final, then add preliminary if useful
    selected = final_years[-FALLBACK_YEARS:]

    # Include the latest preliminary year if it's newer than our selection
    if preliminary_years:
        latest_prelim = preliminary_years[-1]
        if not selected or latest_prelim > selected[-1]:
            selected.append(latest_prelim)

    # Sort newest first for fallback priority
    selected.sort(reverse=True)
    logger.info("  Query years (newest first): %s", selected)
    return selected


def fetch_price_data(meta: dict, our_codes: list[str],
                     query_years: list[str]) -> list[dict]:
    """POST a query to the PxWeb API and return the raw data rows.

    Filters to only the postal codes that exist in both our GeoJSON and
    the API's postal code list.
    """
    postal_var = find_variable(meta, "Postinumero")
    if postal_var is None:
        raise ValueError("Could not find 'Postinumero' variable in metadata")

    api_codes = set(postal_var["values"])
    matched_codes = sorted(c for c in our_codes if c in api_codes)
    missing_codes = sorted(c for c in our_codes if c not in api_codes)

    logger.info("  %d of %d postal codes found in API (%d missing)",
                len(matched_codes), len(our_codes), len(missing_codes))
    if missing_codes:
        logger.info("  Missing from API: %s", missing_codes[:20])
        if len(missing_codes) > 20:
            logger.info("  ... and %d more", len(missing_codes) - 20)

    if not matched_codes:
        raise ValueError("No matching postal codes found in API")

    query = {
        "query": [
            {
                "code": "Vuosi",
                "selection": {"filter": "item", "values": query_years},
            },
            {
                "code": "Postinumero",
                "selection": {"filter": "item", "values": matched_codes},
            },
            {
                "code": "Talotyyppi",
                "selection": {"filter": "all", "values": ["*"]},
            },
            {
                "code": "Tiedot",
                "selection": {"filter": "all", "values": ["*"]},
            },
        ],
        "response": {"format": "json"},
    }

    logger.info("Querying PxWeb for %d postal codes x %d years...",
                len(matched_codes), len(query_years))
    r = request_with_retry(
        "POST", PXWEB_TABLE_URL, label="price data",
        json=query, timeout=120,
    )
    data = r.json()

    if not isinstance(data, dict) or "data" not in data:
        raise ValueError("Unexpected response format: missing 'data'")

    rows = data["data"]
    logger.info("  Received %d data rows", len(rows))
    return rows


# ---------------------------------------------------------------------------
# Parse rows into per-postal-code prices
# ---------------------------------------------------------------------------

def parse_price_data(rows: list[dict], query_years: list[str]) -> dict[str, int]:
    """Parse PxWeb data rows into {postal_code: price_per_sqm}.

    For each postal code:
    - Collects price and sales count per building type per year.
    - Computes a sales-weighted average price across building types.
    - Uses the latest year that has valid data (fallback to older years).

    Args:
        rows: Raw data rows from PxWeb API.
        query_years: Years in priority order (newest first).

    Returns:
        {postal_code: price_eur_per_sqm}
    """
    # Organize: {postal: {year: {building_type: (price, sales_count)}}}
    by_postal: dict[str, dict[str, dict[str, tuple[float, float]]]] = {}

    for row in rows:
        keys = row.get("key", [])
        vals = row.get("values", [])
        if len(keys) < 3 or len(vals) < 2:
            continue

        year = keys[0]
        postal = keys[1][:5]  # ensure 5-digit code
        btype = keys[2]
        price_str = vals[0]
        count_str = vals[1]

        # Skip suppressed / missing values
        if price_str in (".", "..", "...", ""):
            continue
        if count_str in (".", "..", "...", ""):
            continue

        try:
            price = float(price_str)
            count = float(count_str)
        except (ValueError, TypeError):
            continue

        if price <= 0 or count <= 0:
            continue

        if postal not in by_postal:
            by_postal[postal] = {}
        if year not in by_postal[postal]:
            by_postal[postal][year] = {}

        by_postal[postal][year][btype] = (price, count)

    # Compute weighted average per postal code, using latest available year
    result: dict[str, int] = {}
    year_usage: dict[str, int] = {}

    for postal, year_data in by_postal.items():
        for year in query_years:
            btypes = year_data.get(year, {})
            if not btypes:
                continue

            total_weighted = sum(p * c for p, c in btypes.values())
            total_count = sum(c for _, c in btypes.values())

            if total_count > 0:
                result[postal] = round(total_weighted / total_count)
                year_usage[year] = year_usage.get(year, 0) + 1
                break  # got data from this year, no need to fall back

    logger.info("  Computed prices for %d postal codes", len(result))
    for year in query_years:
        count = year_usage.get(year, 0)
        if count > 0:
            logger.info("    %s: %d postal codes", year, count)

    return result


# ---------------------------------------------------------------------------
# Merge with existing data
# ---------------------------------------------------------------------------

def merge_with_existing(new_data: dict[str, int]) -> dict[str, int]:
    """Merge new data with any existing property_prices.json.

    New data takes priority; existing data is preserved for postal codes
    not covered by the new fetch.
    """
    if not OUTPUT_FILE.exists():
        return new_data

    try:
        with open(OUTPUT_FILE, encoding="utf-8") as f:
            existing = json.load(f)
        if not isinstance(existing, dict):
            return new_data

        logger.info("  Existing file has %d entries", len(existing))

        merged = {k: int(v) for k, v in existing.items()}
        merged.update(new_data)  # new data takes priority

        added = len(set(new_data) - set(existing))
        updated = len(set(new_data) & set(existing))
        preserved = len(set(existing) - set(new_data))
        logger.info("  Merged: %d added, %d updated, %d preserved from existing",
                     added, updated, preserved)

        return merged
    except Exception as e:
        logger.warning("  Could not read existing file: %s", e)
        return new_data


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    logger.info("=" * 60)
    logger.info("Property price data fetch")
    logger.info("  Source: Statistics Finland PxWeb API")
    logger.info("  Table: statfin_ashi_pxt_13mu.px")
    logger.info("=" * 60)

    # Step 1: Load our postal codes
    our_codes = load_our_postal_codes()
    if not our_codes:
        logger.error("No postal codes found in GeoJSON. Exiting.")
        sys.exit(1)

    # Step 2: Fetch API metadata
    try:
        meta = fetch_metadata()
    except Exception as e:
        logger.error("Failed to fetch metadata: %s", e)
        sys.exit(1)

    rate_limit()

    # Step 3: Determine which years to query
    try:
        query_years = determine_query_years(meta)
    except Exception as e:
        logger.error("Failed to determine query years: %s", e)
        sys.exit(1)

    # Step 4: Fetch price data from API
    try:
        rows = fetch_price_data(meta, our_codes, query_years)
    except Exception as e:
        logger.error("Failed to fetch price data: %s", e)
        sys.exit(1)

    # Step 5: Parse into per-postal-code prices
    new_data = parse_price_data(rows, query_years)
    if not new_data:
        logger.error("No price data parsed from API response. Exiting.")
        sys.exit(1)

    # Step 6: Merge with existing data (preserve codes not in new fetch)
    merged = merge_with_existing(new_data)

    # Filter to only codes in our GeoJSON
    our_codes_set = set(our_codes)
    final = {k: v for k, v in merged.items() if k in our_codes_set}

    # Step 7: Save
    logger.info("Saving %d entries to %s", len(final), OUTPUT_FILE)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2, sort_keys=True, ensure_ascii=False)

    # Summary
    logger.info("=" * 60)
    logger.info("Done! %d postal codes with property price data.", len(final))

    helsinki = [c for c in final if c.startswith(("00", "01", "02"))]
    tampere = [c for c in final if c.startswith(("33", "34", "35", "36", "37", "39"))]
    turku = [c for c in final if c.startswith(("20", "21"))]
    logger.info("  Helsinki metro: %d", len(helsinki))
    logger.info("  Tampere region: %d", len(tampere))
    logger.info("  Turku region:   %d", len(turku))

    prices = list(final.values())
    if prices:
        logger.info("  Price range: %d - %d EUR/m2", min(prices), max(prices))
        logger.info("  Median: %d EUR/m2", sorted(prices)[len(prices) // 2])

    logger.info("=" * 60)


if __name__ == "__main__":
    main()
