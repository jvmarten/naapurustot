#!/usr/bin/env python3
"""Fetch property price data (EUR/m2) per postal code from Statistics Finland.

Data source: Statistics Finland PxWeb API
  Table: ashi / 13mu.px
    "Prices per square meter of old dwellings in housing companies and numbers
     of transactions by postal code area, yearly" (2009-2025).

  NOTE on the table id: Statistics Finland migrated PxWeb and renamed the table
  files. The old form `statfin_ashi_pxt_13mu.px` now returns HTTP 400 — the live
  id is simply `13mu.px`. The variable *codes* were renamed too (e.g. `Vuosi`->
  `timeperiod_y`, `Postinumero`->`postinumeroalue_4_20220101`, `Talotyyppi`->
  `talotyyppi_6_20131021`, `Tiedot`->`contentscode`). This script therefore never
  hardcodes variable codes: it discovers them from the live metadata by their
  English/Finnish text and the PxWeb `time` flag, so it survives future renames.

Method (sales-weighted, multi-year fallback — maximises coverage):
  1. Read the postal codes we care about from the project GeoJSON (all of Finland).
  2. Fetch table metadata, discover variable codes + the price and sales-count
     measures, and list every available year.
  3. Query the API (chunked by postal code to stay under PxWeb's cell limit) for
     ALL years x ALL building types (1-/2-/3-room flats, terraced houses) and
     BOTH measures (EUR/m2 price + number of sales).
  4. For each postal code, walk years newest -> oldest and use the first year that
     has data, computing a SALES-COUNT-WEIGHTED mean EUR/m2 across the building
     types reported that year (falling back to an unweighted mean only if a year
     reports prices but no sales counts). The newest-year-first walk is the
     multi-year fallback that lifts coverage well above a single-year query.
  5. Round to integer EUR/m2 and write {pno: eur_per_m2}, sorted by pno.

Coverage reality: the table lists ~1,724 postal codes but Statistics Finland
suppresses cells with too few transactions, so ~1,097 codes actually carry a
non-suppressed price somewhere in 2009-2025. Those ~1,097 are what we can honestly
report (vs ~455 for the old single-year/single-building-type slice). We never
fabricate values for the suppressed remainder.

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

# PxWeb database (post-migration). The table id is `13mu.px`; if Statistics
# Finland renames it again we rediscover it from this database listing.
ASHI_DB_URL = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ashi/"
PXWEB_TABLE_URL = ASHI_DB_URL + "13mu.px"

# A browser-like UA — the API rejects some default client signatures.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# PxWeb caps a single query's data cells (~100k). With all years x all building
# types x both measures, 500 postal codes -> 500*17*4*2 = 68,000 cells, safely
# under the limit.
POSTAL_BATCH_SIZE = 500

# Plausibility guard for old-dwelling EUR/m2 (rural terraced houses really do
# sell for a few hundred EUR/m2; luxury Helsinki tops out well under 20,000).
MIN_PRICE = 100
MAX_PRICE = 20000

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2
RATE_LIMIT_DELAY = 0.5


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def request_with_retry(method: str, url: str, *, label: str,
                       retries: int = MAX_RETRIES, **kwargs):
    """Execute an HTTP request with exponential-backoff retries."""
    kwargs.setdefault("timeout", 90)
    kwargs.setdefault("headers", HEADERS)
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.request(method, url, **kwargs)
            r.raise_for_status()
            return r
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                wait = RETRY_BACKOFF_BASE ** attempt
                logger.warning("  Retry %d/%d for %s in %ds (%s)",
                               attempt, retries, label, wait, exc)
                time.sleep(wait)
    raise last_exc  # type: ignore[misc]


def rate_limit():
    time.sleep(RATE_LIMIT_DELAY)


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


# ---------------------------------------------------------------------------
# Postal codes from GeoJSON
# ---------------------------------------------------------------------------

def load_our_postal_codes() -> set[str]:
    """Read the postal codes used by the app from the project GeoJSON.

    Returns an empty set if the GeoJSON is unavailable; the caller then falls
    back to every postal code the API offers.
    """
    if not GEOJSON_PATH.exists():
        logger.warning("GeoJSON not found at %s — using all API postal codes",
                       GEOJSON_PATH)
        return set()
    logger.info("Loading postal codes from %s", GEOJSON_PATH)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)
    codes = {
        feat["properties"]["pno"]
        for feat in geojson.get("features", [])
        if feat.get("properties", {}).get("pno")
    }
    logger.info("  Found %d postal codes in GeoJSON", len(codes))
    return codes


# ---------------------------------------------------------------------------
# Metadata discovery (resilient to the PxWeb variable-code renames)
# ---------------------------------------------------------------------------

def resolve_table_url() -> str:
    """Return a working table URL, rediscovering the id if the direct one 400s."""
    try:
        request_with_retry("GET", PXWEB_TABLE_URL, label="table probe", timeout=30)
        return PXWEB_TABLE_URL
    except requests.RequestException as exc:
        logger.warning("Direct table URL failed (%s); searching ashi listing...", exc)
        listing = request_with_retry("GET", ASHI_DB_URL, label="ashi listing").json()
        for entry in listing:
            text = (entry.get("text") or "").lower()
            tid = entry.get("id", "")
            if "13mu" in tid or ("postal code area, yearly" in text):
                url = ASHI_DB_URL + tid
                logger.info("  Resolved table to %s", url)
                return url
        raise RuntimeError("Could not locate the ashi 13mu table in the listing")


def fetch_metadata(table_url: str) -> dict:
    logger.info("Fetching PxWeb metadata from %s", table_url)
    meta = request_with_retry("GET", table_url, label="metadata").json()
    if not isinstance(meta, dict) or "variables" not in meta:
        raise ValueError("Unexpected metadata format: missing 'variables'")
    for var in meta["variables"]:
        logger.info("  Variable: code=%r text=%r (%d values)",
                    var.get("code"), var.get("text"), len(var.get("values", [])))
    return meta


def _match_var(meta: dict, *, time_flag: bool = False, texts=(), code_prefixes=()):
    """Find a variable by the PxWeb `time` flag, English/Finnish text, or code prefix."""
    texts_l = {t.lower() for t in texts}
    for var in meta["variables"]:
        if time_flag and var.get("time"):
            return var
    for var in meta["variables"]:
        code = (var.get("code") or "").lower()
        text = (var.get("text") or "").lower()
        if text in texts_l:
            return var
        if any(code.startswith(p) for p in code_prefixes):
            return var
    return None


def discover_variables(meta: dict) -> dict:
    """Map the live (renamed) variable codes to our roles."""
    year = _match_var(meta, time_flag=True, texts=("year", "vuosi"),
                      code_prefixes=("vuosi", "timeperiod"))
    postal = _match_var(meta, texts=("postal code", "postinumero", "postinumeroalue"),
                        code_prefixes=("postinumero", "pno"))
    building = _match_var(meta, texts=("building type", "talotyyppi"),
                          code_prefixes=("talotyyppi",))
    content = _match_var(meta, texts=("information", "tiedot"),
                         code_prefixes=("contentscode", "tiedot"))
    missing = [n for n, v in
               (("year", year), ("postal", postal),
                ("building", building), ("information", content)) if v is None]
    if missing:
        raise ValueError(f"Could not discover variables: {missing}")

    # Identify the price measure and the sales-count measure within `content`.
    price_item = count_item = None
    for code, txt in zip(content["values"],
                         content.get("valueTexts", content["values"])):
        tl = txt.lower()
        if price_item is None and ("eur/m" in tl or "price per square" in tl
                                   or "hinta" in tl or "neliöhinta" in tl):
            price_item = code
        if count_item is None and ("sales" in tl or "number" in tl
                                   or "transaction" in tl or "lkm" in tl
                                   or "kauppojen" in tl):
            count_item = code
    if price_item is None:
        price_item = content["values"][0]
    if count_item is None and len(content["values"]) > 1:
        count_item = content["values"][1]

    info = {
        "year_code": year["code"],
        "postal_code": postal["code"],
        "building_code": building["code"],
        "content_code": content["code"],
        "price_item": price_item,
        "count_item": count_item,
        "api_codes": set(postal["values"]),
        "years": list(year["values"]),
    }
    logger.info("  Discovered: year=%r postal=%r building=%r content=%r",
                info["year_code"], info["postal_code"],
                info["building_code"], info["content_code"])
    logger.info("  Measures: price=%r count=%r", price_item, count_item)
    logger.info("  Years %s..%s (%d), postal codes in table: %d",
                info["years"][0], info["years"][-1],
                len(info["years"]), len(info["api_codes"]))
    return info


# ---------------------------------------------------------------------------
# Data fetch + sales-weighted multi-year parsing
# ---------------------------------------------------------------------------

def fetch_rows(table_url: str, info: dict, codes: list[str]) -> list[dict]:
    """POST chunked queries (all years x all building types x both measures)."""
    items = [info["price_item"]]
    if info["count_item"] and info["count_item"] != info["price_item"]:
        items.append(info["count_item"])

    rows: list[dict] = []
    batches = list(chunked(codes, POSTAL_BATCH_SIZE))
    for i, batch in enumerate(batches, 1):
        query = {
            "query": [
                {"code": info["year_code"],
                 "selection": {"filter": "item", "values": info["years"]}},
                {"code": info["postal_code"],
                 "selection": {"filter": "item", "values": batch}},
                {"code": info["building_code"],
                 "selection": {"filter": "all", "values": ["*"]}},
                {"code": info["content_code"],
                 "selection": {"filter": "item", "values": items}},
            ],
            "response": {"format": "json"},
        }
        logger.info("  Querying batch %d/%d (%d postal codes)...",
                    i, len(batches), len(batch))
        r = request_with_retry("POST", table_url, label=f"data batch {i}",
                               json=query, timeout=180)
        data = r.json()
        if not isinstance(data, dict) or "data" not in data:
            raise ValueError("Unexpected response format: missing 'data'")
        rows.extend(data["data"])
        rate_limit()
    logger.info("  Received %d data rows total", len(rows))
    return rows


def parse_prices(rows: list[dict], years: list[str]) -> tuple[dict[str, int], dict[str, int]]:
    """Sales-weighted mean EUR/m2 per postal code, newest year that has data.

    Returns (prices, year_usage).
    """
    has_count = any(len(r.get("values", [])) >= 2 for r in rows)

    # {pno: {year: [(price, count), ...]}}
    by_pno: dict[str, dict[str, list[tuple[float, float]]]] = {}
    for row in rows:
        keys = row.get("key", [])
        vals = row.get("values", [])
        if len(keys) < 3 or not vals:
            continue
        year, pno = keys[0], keys[1][:5]
        price_str = vals[0]
        if price_str in (".", "..", "...", "", None):
            continue
        try:
            price = float(price_str)
        except (ValueError, TypeError):
            continue
        if price <= 0:
            continue
        count = 0.0
        if len(vals) > 1 and vals[1] not in (".", "..", "...", "", None):
            try:
                count = float(vals[1])
            except (ValueError, TypeError):
                count = 0.0
        by_pno.setdefault(pno, {}).setdefault(year, []).append((price, count))

    year_order = sorted(years, reverse=True)  # newest first
    prices: dict[str, int] = {}
    year_usage: dict[str, int] = {}
    for pno, year_data in by_pno.items():
        for year in year_order:
            entries = year_data.get(year)
            if not entries:
                continue
            total_count = sum(c for _, c in entries)
            if total_count > 0:
                value = sum(p * c for p, c in entries) / total_count
            else:
                # Year reports prices but no sales counts (older pre-2020 cells):
                # fall back to an unweighted mean so coverage isn't lost.
                value = sum(p for p, _ in entries) / len(entries)
            value = round(value)
            if MIN_PRICE <= value <= MAX_PRICE:
                prices[pno] = value
                year_usage[year] = year_usage.get(year, 0) + 1
                break

    if has_count:
        logger.info("  (sales-count weighting active)")
    return prices, year_usage


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    logger.info("=" * 60)
    logger.info("Property price fetch — Statistics Finland ashi 13mu")
    logger.info("=" * 60)

    our_codes = load_our_postal_codes()

    table_url = resolve_table_url()
    meta = fetch_metadata(table_url)
    info = discover_variables(meta)

    # Query intersection of our codes and the table's codes (or all if no GeoJSON).
    if our_codes:
        codes = sorted(our_codes & info["api_codes"])
        logger.info("  %d of %d table postal codes are in our GeoJSON",
                    len(codes), len(info["api_codes"]))
    else:
        codes = sorted(info["api_codes"])
    if not codes:
        logger.error("No postal codes to query. Exiting.")
        sys.exit(1)

    rows = fetch_rows(table_url, info, codes)
    prices, year_usage = parse_prices(rows, info["years"])
    if not prices:
        logger.error("No prices parsed. Exiting.")
        sys.exit(1)

    final = dict(sorted(prices.items()))
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2, ensure_ascii=False)

    vals = list(final.values())
    vals_sorted = sorted(vals)
    logger.info("=" * 60)
    logger.info("Done! %d postal codes with property price data.", len(final))
    logger.info("  EUR/m2  min=%d  max=%d  mean=%d  median=%d",
                min(vals), max(vals), round(sum(vals) / len(vals)),
                vals_sorted[len(vals_sorted) // 2])
    logger.info("  Year vintage (value taken from):")
    for year in sorted(year_usage, reverse=True):
        logger.info("    %s: %d postal codes", year, year_usage[year])
    logger.info("  Samples: %s",
                {k: final[k] for k in list(final)[:5]})
    logger.info("  Wrote %s", OUTPUT_FILE)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
