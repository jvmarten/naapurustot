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
import pxweb  # noqa: E402
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

ASHI_TABLE = ("ashi", "13mu")
RPK_TABLE = ("rpk", "13h4")

# Written by fetch_crime_index.py; states which statistics year the postal
# crime_index snapshot came from. The history anchors to that year rather than
# assuming the newest year in this table is the snapshot's year.
CRIME_INDEX_META_FILE = SCRIPT_DIR / "crime_index_meta.json"

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


def var_containing(meta, value):
    """Return the variable whose value list contains ``value``.

    StatFin versions its variable codes (``Vuosi`` -> ``timeperiod_y``,
    ``Postinumero`` -> ``postinumeroalue_4_20220101``), so match on a stable
    value instead of on the code. See scripts/pxweb.py.
    """
    for var in meta["variables"]:
        if value in var.get("values", []):
            return var
    raise ValueError(f"No variable in metadata contains value {value!r}")


def history_years(meta):
    """Return the sorted year codes >= HISTORY_START_YEAR present in the table."""
    code = pxweb.year_var_code(meta)
    year_var = next(v for v in meta["variables"] if v["code"] == code)
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
    ashi_url, meta = pxweb.fetch_table_meta(*ASHI_TABLE)
    years = history_years(meta)
    logger.info("  Years: %s", years)

    postal_var = var_containing(meta, "00100")
    api_codes = set(postal_var["values"])
    matched = sorted(c for c in our_codes if c in api_codes)
    logger.info("  %d of %d postal codes present in ashi", len(matched), len(our_codes))
    if not matched:
        return {}

    info_var = var_containing(meta, "keskihinta_aritm_nw")
    info_vals = info_var["values"]
    # price item first, sales-count item second (table order)
    price_item = info_vals[0]
    count_item = info_vals[1] if len(info_vals) > 1 else info_vals[0]
    # The building-type variable is whichever one is left over — resolving it
    # positionally beats matching a code StatFin keeps versioning.
    named = {pxweb.year_var_code(meta), postal_var["code"], info_var["code"]}
    house_type_var = next(v for v in meta["variables"] if v["code"] not in named)

    query = {
        "query": [
            {"code": pxweb.year_var_code(meta),
             "selection": {"filter": "item", "values": years}},
            {"code": postal_var["code"],
             "selection": {"filter": "item", "values": matched}},
            {"code": house_type_var["code"],
             "selection": {"filter": "all", "values": ["*"]}},
            {"code": info_var["code"],
             "selection": {"filter": "item", "values": [price_item, count_item]}},
        ],
        "response": {"format": "json"},
    }
    time.sleep(RATE_LIMIT_DELAY)
    data = request_with_retry("POST", ashi_url, label="ashi data", json=query, timeout=180).json()
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
    rpk_url, meta = pxweb.fetch_table_meta(*RPK_TABLE)
    years = history_years(meta)
    logger.info("  Years: %s", years)

    muni_codes = [f"KU{code}" for code in sorted(ALL_MUNICIPALITY_CODES)]
    query = {
        "query": [
            {"code": pxweb.year_var_code(meta),
             "selection": {"filter": "item", "values": years}},
            {"code": pxweb.var_code_for_value(meta, muni_codes[0]),
             "selection": {"filter": "item", "values": muni_codes}},
            {"code": pxweb.var_code_for_value(meta, OFFENCE_TOTAL_CODE),
             "selection": {"filter": "item", "values": [OFFENCE_TOTAL_CODE]}},
            {"code": pxweb.var_code_for_value(meta, "rik_1000"),
             "selection": {"filter": "item", "values": ["rik_1000"]}},
        ],
        "response": {"format": "json"},
    }
    time.sleep(RATE_LIMIT_DELAY)
    data = request_with_retry("POST", rpk_url, label="rpk data", json=query, timeout=180).json()
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


def snapshot_year():
    """Return the statistics year the shipped crime_index snapshot came from.

    Read from crime_index_meta.json rather than inferred. build_crime_history
    used to anchor to the newest year in the *history* table, which asserts
    rather than measures the snapshot's year: when the snapshot lagged the
    table, every series was published with its last point labelled a year the
    underlying value did not come from.
    """
    if not CRIME_INDEX_META_FILE.exists():
        raise SystemExit(
            f"{CRIME_INDEX_META_FILE.name} is missing — run fetch_crime_index.py "
            "first so the history can be anchored to the snapshot's real year."
        )
    with open(CRIME_INDEX_META_FILE, encoding="utf-8") as f:
        year = json.load(f).get("year")
    if not year:
        raise SystemExit(f"{CRIME_INDEX_META_FILE.name} has no 'year'")
    return int(year)


def build_crime_history(features, muni_rates, anchor_year):
    """Scale each postal code's current crime_index by its municipality's real
    per-1,000 rate trend, anchoring the snapshot to the year it came from."""
    result = {}
    skipped_anchor = 0
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
        base = rates.get(anchor_year)
        if not base or base <= 0:
            # Without the anchor year we cannot place the snapshot on the
            # trend; emitting a series anchored to some other year would
            # mislabel it, so skip the area instead.
            skipped_anchor += 1
            continue
        series = []
        for year in years:
            rate = rates.get(year)
            if rate is None:
                continue
            series.append([year, round(float(crime) * rate / base, 1)])
        if len(series) >= MIN_POINTS:
            result[pno] = series
    logger.info("  Built crime history for %d postal codes (anchored to %d)",
                len(result), anchor_year)
    if skipped_anchor:
        logger.warning("  %d areas skipped: municipality has no %d rate to anchor to",
                       skipped_anchor, anchor_year)
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
    ap.add_argument("--skip-property", action="store_true",
                    help="rebuild only the crime history, leaving property prices untouched")
    args = ap.parse_args()

    geojson = load_geojson()
    features = geojson.get("features", [])
    our_codes = sorted({f["properties"]["pno"] for f in features if f.get("properties", {}).get("pno")})
    logger.info("Loaded %d features (%d postal codes)", len(features), len(our_codes))

    if args.skip_property:
        logger.info("Skipping property-price history (--skip-property)")
        property_history = json.loads(PROPERTY_HISTORY_FILE.read_text(encoding="utf-8")) \
            if PROPERTY_HISTORY_FILE.exists() else {}
    else:
        property_history = fetch_property_history(our_codes)
    muni_rates = fetch_muni_crime_rates()
    crime_history = build_crime_history(features, muni_rates, snapshot_year())

    PROPERTY_HISTORY_FILE.write_text(
        json.dumps(property_history, indent=0, sort_keys=True, ensure_ascii=False), encoding="utf-8")
    CRIME_HISTORY_FILE.write_text(
        json.dumps(crime_history, indent=0, sort_keys=True, ensure_ascii=False), encoding="utf-8")
    logger.info("Wrote %s and %s", PROPERTY_HISTORY_FILE.name, CRIME_HISTORY_FILE.name)

    if args.apply:
        apply_to_geojson(geojson, property_history, crime_history)
        with open(GEOJSON_PATH, "w", encoding="utf-8") as f:
            # The committed GeoJSON uses Python's DEFAULT serialization
            # (ensure_ascii=True, ", "/": " separators). Writing it compact
            # instead rewrites all 44 MB and buries the value change in a
            # whole-file diff — see scripts/in1_clean.py, which established
            # this convention.
            json.dump(geojson, f)
        logger.info("Patched %s", GEOJSON_PATH)

    if not property_history and not crime_history:
        logger.error("No history built — aborting.")
        sys.exit(1)


if __name__ == "__main__":
    main()
