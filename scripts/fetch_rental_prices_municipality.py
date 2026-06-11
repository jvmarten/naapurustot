#!/usr/bin/env python3
"""CF-15: Revive the rental-price layer from Statistics Finland asvu table 15fa.

The old postal-code rental tables (asvu 13eb / 11x4) were retired, freezing the
``rental_price_sqm`` layer at its 2022 snapshot. Statistics Finland now publishes
current quarterly mean rents only in table **15fa** ("Rent index (2025=100) and
average rents per square metre, quarterly"), which reports EUR/m² for ~27 large
cities (with sub-city *kalleusalue* cost zones) plus the 19 maakunnat — no longer
at postal-code level.

This script rebuilds a per-postal-code rental snapshot from 15fa:

  1. GET the 15fa metadata to discover the (date-suffixed) variable codes and the
     latest quarter.
  2. POST a query for the mean rent per m² (``asvu_keskineliovuokra``) of
     non-subsidised (vapaarahoitteiset) dwellings, all room counts, latest quarter,
     for every area code.
  3. Map each area's municipality code to its postal codes via the committed
     GeoJSON (``kunta`` -> 15fa "Alue" code). Cost-zone -> postal-code mapping is
     not reliably derivable, so each city's municipality-level mean is used.
  4. Preserve realistic intra-city variation by replaying the 2022 per-postal
     ratios from the existing scripts/rental_prices.json (the frozen snapshot):
        ratio          = old_pno_value / old_city_mean
        new_pno_value  = new_city_mean * ratio
     (the same "hold the intra-area factor constant, replay the real trend"
     approach used by crime_index_history). Where no clean ratio exists, the plain
     city mean is used.

Coverage is intentionally limited to postal codes in the cities 15fa reports
directly (the "large-city" set) that are substantial residential areas
(population > 1000) or already carried rental data in the 2022 snapshot. Maakunta
values are NOT distributed down to municipalities that 15fa does not report
directly, to respect the postal-level granularity floor.

All values are municipality/city-level proxies (flagged ``is_proxy`` downstream).

Output: scripts/rental_prices.json  ->  {"00100": 22.74, ...}  (EUR/m², 2 dp)

Usage:
    python scripts/fetch_rental_prices_municipality.py
"""

import json
import logging
import statistics
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
OUTPUT_FILE = SCRIPT_DIR / "rental_prices.json"

# asvu table 15fa: rent index + average rent per m², quarterly.
# (The old statfin_asvu_pxt_<id>.px naming is gone; the database lists it as 15fa.px.)
PXWEB_TABLE_URL = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/asvu/15fa.px"

# Mean rent per m² measure in the "Information"/contentscode variable.
RENT_MEASURE_CODE = "asvu_keskineliovuokra"  # "Average rent per square metre (EUR/m2)"

# Funding type: non-subsidised (vapaarahoitteiset) dwellings.
FUNDING_NONSUBSIDISED_CODE = "1"
# Room count: all dwellings total.
ROOMS_TOTAL_CODE = "SSS"

# Browser-like UA — the bare PxWeb host rejects some default agents.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# A few municipalities are merged in 15fa under a single neighbouring code.
# Kauniainen (235) is reported only as part of "Espoo-Kauniainen" (049).
MUNI_ALIAS = {"235": "049"}

# A postal code in a directly-reported city is included if it had rental data in
# the 2022 snapshot OR is a substantial residential area (keeps coverage close to
# the historical ~473 and well inside the postal-level granularity intent).
MIN_POPULATION = 1000

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2
RATE_LIMIT_DELAY = 1.0
MISSING = (".", "..", "...", "-", "", None)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def request_with_retry(method, url, *, label, retries=MAX_RETRIES, **kwargs):
    """Execute an HTTP request with exponential-backoff retries."""
    kwargs.setdefault("timeout", 60)
    kwargs.setdefault("headers", HEADERS)
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
                logger.warning("  Retry %d/%d for %s in %ds (%s)",
                               attempt, retries, label, wait, exc)
                time.sleep(wait)
    raise last_exc  # type: ignore[misc]


# ---------------------------------------------------------------------------
# GeoJSON helpers
# ---------------------------------------------------------------------------

def load_geojson_index():
    """Return {pno: {"kunta": code, "nimi": name, "pop": float|None}} from GeoJSON."""
    logger.info("Loading postal codes from %s", GEOJSON_PATH)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)
    index = {}
    for feat in geojson.get("features", []):
        p = feat.get("properties", {})
        pno = p.get("pno") or p.get("postinumeroalue")
        if not pno:
            continue
        pop = p.get("he_vakiy")
        index[pno] = {
            "kunta": p.get("kunta"),
            "nimi": p.get("nimi"),
            "pop": pop if isinstance(pop, (int, float)) else None,
        }
    logger.info("  Found %d postal codes in GeoJSON", len(index))
    return index


def load_old_snapshot():
    """Return the frozen 2022 {pno: eur_per_m2} snapshot (or {} if absent)."""
    if not OUTPUT_FILE.exists():
        logger.warning("  No existing %s — intra-city ratios cannot be replayed",
                       OUTPUT_FILE.name)
        return {}
    try:
        with open(OUTPUT_FILE, encoding="utf-8") as f:
            old = json.load(f)
        old = {k: float(v) for k, v in old.items()
               if isinstance(v, (int, float)) and v > 0}
        logger.info("  Loaded %d entries from existing %s (2022 snapshot)",
                    len(old), OUTPUT_FILE.name)
        return old
    except (OSError, ValueError, TypeError) as exc:
        logger.warning("  Could not read existing %s: %s", OUTPUT_FILE.name, exc)
        return {}


# ---------------------------------------------------------------------------
# PxWeb metadata / query
# ---------------------------------------------------------------------------

def find_var(meta, *prefixes):
    """Find a variable whose code starts with one of the given prefixes."""
    pref = tuple(p.lower() for p in prefixes)
    for var in meta["variables"]:
        if var["code"].lower().startswith(pref):
            return var
    return None


def fetch_metadata():
    logger.info("Fetching 15fa metadata from %s", PXWEB_TABLE_URL)
    meta = request_with_retry("GET", PXWEB_TABLE_URL, label="metadata", timeout=30).json()
    if not isinstance(meta, dict) or "variables" not in meta:
        raise ValueError("Unexpected metadata format: missing 'variables'")
    for var in meta["variables"]:
        logger.info("  Variable: code=%r text=%r (%d values)",
                    var.get("code"), var.get("text"), len(var.get("values", [])))
    return meta


def fetch_rent_by_area(meta):
    """POST a query and return {area_code: mean_eur_per_m2} for the latest quarter."""
    area = find_var(meta, "alue")
    funding = find_var(meta, "rahoitus")
    rooms = find_var(meta, "huoneluku")
    quarter = find_var(meta, "timeperiod", "vuosineljannes", "vuosinelj")
    contents = find_var(meta, "contentscode", "tiedot")
    for name, var in (("Alue", area), ("rahoitus", funding), ("huoneluku", rooms),
                      ("quarter", quarter), ("contents", contents)):
        if var is None:
            raise ValueError(f"Could not find {name} variable in 15fa metadata")

    latest_quarter = sorted(quarter["values"])[-1]
    logger.info("  Latest quarter: %s", latest_quarter)

    funding_code = (FUNDING_NONSUBSIDISED_CODE
                    if FUNDING_NONSUBSIDISED_CODE in funding["values"]
                    else funding["values"][-1])
    rooms_code = (ROOMS_TOTAL_CODE if ROOMS_TOTAL_CODE in rooms["values"]
                  else rooms["values"][0])
    if RENT_MEASURE_CODE not in contents["values"]:
        raise ValueError(f"Measure {RENT_MEASURE_CODE!r} not in contentscode")

    query = {
        "query": [
            {"code": area["code"],
             "selection": {"filter": "item", "values": area["values"]}},
            {"code": funding["code"],
             "selection": {"filter": "item", "values": [funding_code]}},
            {"code": rooms["code"],
             "selection": {"filter": "item", "values": [rooms_code]}},
            {"code": quarter["code"],
             "selection": {"filter": "item", "values": [latest_quarter]}},
            {"code": contents["code"],
             "selection": {"filter": "item", "values": [RENT_MEASURE_CODE]}},
        ],
        "response": {"format": "json"},
    }
    logger.info("  Querying mean rent EUR/m2 (non-subsidised, all rooms, %s)...",
                latest_quarter)
    time.sleep(RATE_LIMIT_DELAY)
    data = request_with_retry("POST", PXWEB_TABLE_URL, label="rent data",
                              json=query, timeout=120).json()
    rows = data.get("data", [])
    logger.info("  Received %d rows", len(rows))

    by_area = {}
    for row in rows:
        keys = row.get("key", [])
        vals = row.get("values", [])
        if not keys or not vals:
            continue
        area_code = keys[0]
        raw = vals[0]
        if raw in MISSING:
            continue
        try:
            val = float(str(raw).replace(",", "."))
        except (ValueError, TypeError):
            continue
        if val > 0:
            by_area[area_code] = val
    logger.info("  Parsed mean rent for %d areas", len(by_area))
    return by_area, latest_quarter


# ---------------------------------------------------------------------------
# Region -> postal-code mapping + 2022 ratio replay
# ---------------------------------------------------------------------------

def muni_to_area(kunta):
    """Map a municipality code to the 15fa Alue code that reports it."""
    if kunta is None:
        return None
    return MUNI_ALIAS.get(kunta, kunta)


def build_rental_prices(geo_index, old_snapshot, rent_by_area):
    """Combine the new city means with the 2022 intra-city ratios."""
    # 15fa Alue codes that are municipality-level cities (3-digit numeric).
    city_area_codes = {c for c in rent_by_area if len(c) == 3 and c.isdigit()}
    logger.info("  Directly-reported cities in 15fa: %d", len(city_area_codes))

    # Old (2022) per-area mean = simple mean of the snapshot's postal values whose
    # municipality maps to that Alue code. Used only to normalise the ratios.
    old_area_values = {}
    for pno, val in old_snapshot.items():
        meta = geo_index.get(pno)
        if not meta:
            continue
        area = muni_to_area(meta["kunta"])
        if area in city_area_codes:
            old_area_values.setdefault(area, []).append(val)
    old_area_mean = {a: statistics.fmean(vs) for a, vs in old_area_values.items() if vs}

    result = {}
    ratio_count = plain_count = 0
    for pno, meta in geo_index.items():
        area = muni_to_area(meta["kunta"])
        if area not in city_area_codes:
            continue  # not a directly-reported large city -> respect granularity floor
        # Coverage gate: historical rental pno OR substantial residential area.
        had_old = pno in old_snapshot
        pop = meta["pop"]
        if not had_old and not (isinstance(pop, (int, float)) and pop > MIN_POPULATION):
            continue

        city_mean = rent_by_area[area]
        base = old_area_mean.get(area)
        if had_old and base and base > 0:
            ratio = old_snapshot[pno] / base
            value = city_mean * ratio
            ratio_count += 1
        else:
            value = city_mean
            plain_count += 1
        result[pno] = round(value, 2)

    logger.info("  Built %d postal codes (%d via 2022 ratio replay, %d plain city mean)",
                len(result), ratio_count, plain_count)
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    logger.info("=" * 64)
    logger.info("Rental price revival (CF-15)")
    logger.info("  Source: Statistics Finland PxWeb table asvu 15fa")
    logger.info("=" * 64)

    geo_index = load_geojson_index()
    if not geo_index:
        logger.error("No postal codes found in GeoJSON. Exiting.")
        sys.exit(1)
    old_snapshot = load_old_snapshot()

    try:
        meta = fetch_metadata()
        rent_by_area, quarter = fetch_rent_by_area(meta)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to fetch 15fa data: %s", exc)
        sys.exit(1)
    if not rent_by_area:
        logger.error("No rent values parsed from 15fa. Exiting.")
        sys.exit(1)

    result = build_rental_prices(geo_index, old_snapshot, rent_by_area)
    if not result:
        logger.error("No postal-code rental values built. Exiting.")
        sys.exit(1)

    ordered = {k: result[k] for k in sorted(result)}
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(ordered, f, indent=2, ensure_ascii=False)

    vals = list(ordered.values())
    logger.info("=" * 64)
    logger.info("Wrote %d entries to %s (quarter %s)",
                len(ordered), OUTPUT_FILE.name, quarter)
    logger.info("  EUR/m2  min=%.2f  max=%.2f  mean=%.2f",
                min(vals), max(vals), statistics.fmean(vals))
    samples = list(ordered.items())[:5]
    logger.info("  Samples: %s",
                ", ".join(f"{k}={v}" for k, v in samples))
    logger.info("=" * 64)


if __name__ == "__main__":
    main()
