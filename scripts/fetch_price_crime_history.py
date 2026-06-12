#!/usr/bin/env python3
"""CF-7: Build property-price and crime time-series from Statistics Finland.

Two metrics already shown as single snapshots get a real [year, value] history,
the same treatment income/population/unemployment already have:

  property_price_history  — sales-weighted €/m² per postal code per year, from the
                            PxWeb `ashi` table (statfin_ashi_pxt_13mu). Same
                            sales-weighted method as the snapshot `property_price_sqm`,
                            so the latest year matches what the map shows. Sales
                            counts in this table start in 2020, so the window is
                            2020 onward (real, postal-code-level).

  crime_index_history     — per postal code per year. The crime layer (`crime_index`)
                            is a municipality-level per-1,000 rate (PxWeb `rpk`
                            13h4) distributed within each municipality by a stable
                            density/unemployment/rental proxy. We hold that
                            intra-municipality factor constant and replay the REAL
                            municipal rate trend:
                              crime_index_history[pno][year]
                                = crime_index[pno] * rate[muni][year] / rate[muni][latest]
                            so the latest year equals the current crime_index exactly
                            and earlier years reflect the municipality's real change.

Outputs (committed as the pipeline's local fallback, like historical_trends.json):
  scripts/property_price_history.json  {"00100": [[2020, 7100], [2021, 7350], ...]}
  scripts/crime_index_history.json     {"00100": [[2020, 171.3], ...]}

With --apply, also writes the arrays straight into
public/data/metro_neighborhoods.geojson (property_price_history,
crime_index_history, and the derived crime_index_change_pct) so the map reads them
after `npm run build:data` rebuilds the TopoJSON. prepare_data.py loads the same
two files on a full rebuild (see load_/join_*_history there).

Usage:
    python scripts/fetch_price_crime_history.py            # fetch + write JSON files
    python scripts/fetch_price_crime_history.py --apply    # also patch the GeoJSON
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from regions_config import ALL_MUNICIPALITY_CODES  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
PROPERTY_HISTORY_FILE = SCRIPT_DIR / "property_price_history.json"
CRIME_HISTORY_FILE = SCRIPT_DIR / "crime_index_history.json"

ASHI_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ashi/statfin_ashi_pxt_13mu.px"
)
RPK_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/rpk/statfin_rpk_pxt_13h4.px"
)

# Sales counts in the ashi table begin in 2020, so sales-weighting (matching the
# property_price_sqm snapshot) is only possible from then. Keep both new series on
# the same recent window so the time slider behaves consistently across layers.
HISTORY_START_YEAR = 2020

# rpk offence category: "Offences and infractions total"
OFFENCE_TOTAL_CODE = "101T603"

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2
RATE_LIMIT_DELAY = 1.0
MIN_POINTS = 2  # a series needs at least two years to be a trend


def request_with_retry(method, url, *, label, retries=MAX_RETRIES, **kwargs):
    kwargs.setdefault("timeout", 90)
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
                logger.warning("  Retry %d/%d for %s in %ds (%s)", attempt, retries, label, wait, exc)
                time.sleep(wait)
    if last_exc is None:  # only reachable if retries < 1 (no attempt was made)
        raise RuntimeError(f"request_with_retry made no attempts for {label}")
    raise last_exc


def load_geojson():
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        return json.load(f)


def find_var(meta, *names):
    names_l = {n.lower() for n in names}
    for var in meta["variables"]:
        if var["code"].lower() in names_l:
            return var
    return None


def history_years(meta):
    """Return the sorted year codes >= HISTORY_START_YEAR present in the table."""
    year_var = find_var(meta, "Vuosi", "Year")
    if year_var is None:
        raise ValueError("No year variable in metadata")
    years = []
    for code, text in zip(year_var["values"], year_var.get("valueTexts", year_var["values"])):
        # strip any preliminary "*" marker for the int comparison
        digits = "".join(ch for ch in text if ch.isdigit())[:4] or code
        try:
            if int(digits) >= HISTORY_START_YEAR:
                years.append(code)
        except ValueError:
            continue
    years.sort()
    return years


# ---------------------------------------------------------------------------
# Property price history (sales-weighted €/m² per postal code per year)
# ---------------------------------------------------------------------------

def fetch_property_history(our_codes):
    logger.info("Fetching property-price history from ashi table...")
    meta = request_with_retry("GET", ASHI_URL, label="ashi meta", timeout=30).json()
    years = history_years(meta)
    logger.info("  Years: %s", years)

    postal_var = find_var(meta, "Postinumero", "Postal code")
    if postal_var is None:
        raise ValueError("No postal-code variable in ashi metadata")
    api_codes = set(postal_var["values"])
    matched = sorted(c for c in our_codes if c in api_codes)
    logger.info("  %d of %d postal codes present in ashi", len(matched), len(our_codes))
    if not matched:
        return {}

    info_var = find_var(meta, "Tiedot", "Information")
    info_vals = info_var["values"] if info_var else ["keskihinta_aritm_nw", "lkm_julk20"]
    # price item first, sales-count item second (table order)
    price_item = info_vals[0]
    count_item = info_vals[1] if len(info_vals) > 1 else info_vals[0]

    query = {
        "query": [
            {"code": "Vuosi", "selection": {"filter": "item", "values": years}},
            {"code": "Postinumero", "selection": {"filter": "item", "values": matched}},
            {"code": "Talotyyppi", "selection": {"filter": "all", "values": ["*"]}},
            {"code": "Tiedot", "selection": {"filter": "item", "values": [price_item, count_item]}},
        ],
        "response": {"format": "json"},
    }
    time.sleep(RATE_LIMIT_DELAY)
    data = request_with_retry("POST", ASHI_URL, label="ashi data", json=query, timeout=180).json()
    rows = data.get("data", [])
    logger.info("  Received %d ashi rows", len(rows))

    # { pno: { year: [ (price, count), ... ] } }
    by_pno = {}
    for row in rows:
        keys = row.get("key", [])
        vals = row.get("values", [])
        if len(keys) < 3 or len(vals) < 2:
            continue
        year, pno = keys[0], keys[1][:5]
        price_str, count_str = vals[0], vals[1]
        if price_str in (".", "..", "...", "") or count_str in (".", "..", "...", ""):
            continue
        try:
            price, count = float(price_str), float(count_str)
        except (ValueError, TypeError):
            continue
        if price <= 0 or count <= 0:
            continue
        by_pno.setdefault(pno, {}).setdefault(year, []).append((price, count))

    result = {}
    for pno, year_data in by_pno.items():
        series = []
        for year in years:
            entries = year_data.get(year)
            if not entries:
                continue
            tot_w = sum(p * c for p, c in entries)
            tot_c = sum(c for _, c in entries)
            if tot_c > 0:
                series.append([int(year), round(tot_w / tot_c)])
        if len(series) >= MIN_POINTS:
            result[pno] = series
    logger.info("  Built property-price history for %d postal codes", len(result))
    return result


# ---------------------------------------------------------------------------
# Crime history (real municipal rate trend applied to the postal proxy)
# ---------------------------------------------------------------------------

def fetch_muni_crime_rates():
    """Return { muni_code: { year(int): rate_per_1000 } } from rpk table 13h4."""
    logger.info("Fetching municipal crime-rate history from rpk table...")
    meta = request_with_retry("GET", RPK_URL, label="rpk meta", timeout=30).json()
    years = history_years(meta)
    logger.info("  Years: %s", years)

    muni_codes = [f"KU{code}" for code in sorted(ALL_MUNICIPALITY_CODES)]
    query = {
        "query": [
            {"code": "Vuosi", "selection": {"filter": "item", "values": years}},
            {"code": "Alue", "selection": {"filter": "item", "values": muni_codes}},
            {"code": "Rikosryhmä ja teonkuvauksen tarkenne",
             "selection": {"filter": "item", "values": [OFFENCE_TOTAL_CODE]}},
            {"code": "Tiedot", "selection": {"filter": "item", "values": ["rik_1000"]}},
        ],
        "response": {"format": "json"},
    }
    time.sleep(RATE_LIMIT_DELAY)
    data = request_with_retry("POST", RPK_URL, label="rpk data", json=query, timeout=180).json()
    rows = data.get("data", [])
    logger.info("  Received %d rpk rows", len(rows))

    rates = {}
    for row in rows:
        keys = row.get("key", [])
        vals = row.get("values", [])
        if len(keys) < 2 or not vals:
            continue
        year = keys[0]
        muni = keys[1].replace("KU", "").strip()
        val = vals[0]
        if val in (None, "..", "...", ""):
            continue
        try:
            rates.setdefault(muni, {})[int(year)] = float(val)
        except (ValueError, TypeError):
            continue
    return rates


def build_crime_history(features, muni_rates):
    """Scale each postal code's current crime_index by its municipality's real
    per-1,000 rate trend, anchoring the latest year to the current value."""
    result = {}
    for f in features:
        p = f.get("properties", {})
        pno = p.get("pno")
        muni = p.get("kunta")
        crime = p.get("crime_index")
        if not pno or not muni or crime is None:
            continue
        rates = muni_rates.get(muni)
        if not rates:
            continue
        years = sorted(rates.keys())
        if len(years) < MIN_POINTS:
            continue
        latest = years[-1]
        base = rates.get(latest)
        if not base or base <= 0:
            continue
        series = []
        for year in years:
            rate = rates.get(year)
            if rate is None:
                continue
            series.append([year, round(float(crime) * rate / base, 1)])
        if len(series) >= MIN_POINTS:
            result[pno] = series
    logger.info("  Built crime history for %d postal codes", len(result))
    return result


# ---------------------------------------------------------------------------
# Apply to GeoJSON
# ---------------------------------------------------------------------------

def change_pct(series):
    if not series or len(series) < 2:
        return None
    first, last = series[0][1], series[-1][1]
    if first == 0:
        return None
    return round((last - first) / abs(first) * 100, 1)


def apply_to_geojson(geojson, property_history, crime_history):
    """Write the history arrays into the GeoJSON.

    The project convention (see income_history / median_income) is that a metric's
    snapshot equals its trend's latest year. Crime satisfies this by construction.
    For property prices the committed property_price_sqm snapshot predates the 2025
    data release, so for codes that now have a fresh sales-weighted series we refresh
    the snapshot (property_price_sqm), the derived price_to_rent_ratio, and the
    property_price_change_pct to the new real values, keeping all four consistent.
    """
    pp = cc = refreshed = 0
    for f in geojson.get("features", []):
        p = f.get("properties", {})
        pno = p.get("pno")
        if pno in property_history:
            series = property_history[pno]
            p["property_price_history"] = series
            latest = series[-1][1]
            if p.get("property_price_sqm") != latest:
                refreshed += 1
            p["property_price_sqm"] = latest
            p["property_price_change_pct"] = change_pct(series)
            rent = p.get("rental_price_sqm")
            if isinstance(rent, (int, float)) and rent > 0:
                p["price_to_rent_ratio"] = round(latest / (rent * 12), 1)
            pp += 1
        if pno in crime_history:
            p["crime_index_history"] = crime_history[pno]
            p["crime_index_change_pct"] = change_pct(crime_history[pno])
            cc += 1
    logger.info("  property_price_history: %d features (%d snapshots refreshed to latest year)", pp, refreshed)
    logger.info("  crime_index_history: %d features", cc)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="also patch the GeoJSON in place")
    args = ap.parse_args()

    geojson = load_geojson()
    features = geojson.get("features", [])
    our_codes = sorted({f["properties"]["pno"] for f in features if f.get("properties", {}).get("pno")})
    logger.info("Loaded %d features (%d postal codes)", len(features), len(our_codes))

    property_history = fetch_property_history(our_codes)
    muni_rates = fetch_muni_crime_rates()
    crime_history = build_crime_history(features, muni_rates)

    PROPERTY_HISTORY_FILE.write_text(
        json.dumps(property_history, indent=0, sort_keys=True, ensure_ascii=False), encoding="utf-8")
    CRIME_HISTORY_FILE.write_text(
        json.dumps(crime_history, indent=0, sort_keys=True, ensure_ascii=False), encoding="utf-8")
    logger.info("Wrote %s and %s", PROPERTY_HISTORY_FILE.name, CRIME_HISTORY_FILE.name)

    if args.apply:
        apply_to_geojson(geojson, property_history, crime_history)
        with open(GEOJSON_PATH, "w", encoding="utf-8") as f:
            # Match the existing compact single-line serialization exactly.
            json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))
        logger.info("Patched %s", GEOJSON_PATH)

    if not property_history and not crime_history:
        logger.error("No history built — aborting.")
        sys.exit(1)


if __name__ == "__main__":
    main()
