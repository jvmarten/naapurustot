#!/usr/bin/env python3
"""
Fetch crime data for Helsinki metro, Tampere, and Turku regions and update
scripts/crime_index.json.

Data source: Statistics Finland PxWeb API
  Table: statfin_rpk_pxt_13h4.px
    "Offences recorded by year of reporting, figures relative to the population
    in the municipality"
  This table provides official per-capita crime rates (offences per 1,000
  population) by municipality.

Method:
  1. Fetch municipality-level crime rates per 1,000 residents from
     Statistics Finland (2024 data, or latest available year).
  2. Load postal code areas from the GeoJSON to get the postal-code-to-
     municipality mapping and population/density/income data.
  3. Give every postal code in a municipality that municipality's rate,
     unchanged. Finland publishes no crime statistic below municipality level,
     so any within-municipality variation would be invented — see
     assign_to_postal_codes().
  4. Save results to scripts/crime_index.json, and the statistics year they
     came from to scripts/crime_index_meta.json.

Every postal code is computed from the same national fetch. An earlier version
preserved existing 0xxxx (capital region) values unless --overwrite was passed;
since it never was, those 167 areas stayed frozen on an unrelated 2026-03
source at roughly half the scale of the rest of the country. Do not
reintroduce per-region preservation — mixing sources inside one layer puts a
false discontinuity on the map at every municipal border.

Because the postal-code values ARE the municipality figure — shown on postal
geography rather than measured there — crime_index is flagged is_proxy:true in
src/data/data_sources.json (enforced by validate_data.py check_distributed_proxy_flags).

Output: scripts/crime_index.json
Format: {"00100": 168.2, "33100": 115.4, "20100": 135.2, ...}
        (reported offences and infractions per 1,000 residents)

Usage:
  python scripts/fetch_crime_index.py             # Latest year StatFin publishes
  python scripts/fetch_crime_index.py --year 2024  # Pin a specific year
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import requests

import pxweb
from regions_config import ALL_MUNICIPALITY_CODES

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
OUTPUT_FILE = SCRIPT_DIR / "crime_index.json"
VIOLENT_OUTPUT_FILE = SCRIPT_DIR / "crime_violent.json"
PROPERTY_OUTPUT_FILE = SCRIPT_DIR / "crime_property.json"
# Records the statistics years the values above came from, so downstream
# consumers and the source registry can state them instead of guessing.
META_FILE = SCRIPT_DIR / "crime_index_meta.json"

# Statistics Finland PxWeb API — crime statistics per municipality
# Table 13h4: "Offences recorded by year of reporting, figures relative to
# the population in the municipality"
PXWEB_DATABASE = "rpk"
PXWEB_TABLE_ID = "13h4"

# Fallback: Table 13ex — raw counts by municipality (we compute rate ourselves)
PXWEB_FALLBACK_TABLE_ID = "13ex"

# Municipality codes — all 69 Finnish seutukunnat (from regions_config)
# ALL_MUNICIPALITY_CODES is imported at the top of the file.

# PxWeb municipality code format
PXWEB_MUNICIPALITY_CODES = [f"KU{code}" for code in sorted(ALL_MUNICIPALITY_CODES)]

# Offence category: "Offences and infractions total"
OFFENCE_TOTAL_CODE = "101T603"

# Offence sub-groups. These are SIBLINGS in the table's own hierarchy: the seven
# top-level groups sum exactly to OFFENCE_TOTAL_CODE, so they can be published
# and weighted independently. Never combine a parent with one of its children —
# "total" already contains both of these, so weighting total alongside violence
# would count assault twice.
#
# Measured nationally for 2025 (offences per 1,000 residents, whole country):
#   total 101.1 = property 47.3 + traffic 22.4 + other penal code 15.2
#                 + life & health 8.5 + other Acts 3.2 + public peace 2.8
#                 + sexual 1.8
# So the headline "crime rate" is 47 % property and 22 % speeding tickets, and
# only 8 % violence — which is why "Turvallisuus" now uses the violence group
# rather than the total.
OFFENCE_VIOLENT_CODE = "201T223"      # 12 B Crimes against life and health
OFFENCE_PROPERTY_CODE = "101T161"     # 11 Offences against property

# Violence is ~8.5 per 1,000 nationally, so a small municipality sees single
# digits per year and one incident swings the rate. Average over several years
# to damp that, and refuse to publish below a population floor entirely.
VIOLENT_YEARS = 5

# The floor applies to BOTH sub-groups. Property crime is three times more
# common and needs no multi-year averaging, but it is just as unstable at the
# bottom of the population range: measured for 2025, the 57 municipalities under
# this threshold span 0.0 to 52.1 per 1,000, and Sottunga (97 residents, zero
# recorded property offences) would otherwise render as the safest place in
# Finland. Withholding both keeps the two layers on identical coverage, which
# matters because users will read them side by side.
CATEGORY_MIN_POPULATION = 2000

# Traffic offences (331_332_501T504) are deliberately NOT published: they are
# overwhelmingly speeding tickets, and traffic_accident_rate already measures
# actual harm at postal resolution. Sexual crimes (231T241) are deliberately NOT
# published either: at 1.8 per 1,000 nationally a couple of cases would swing a
# small municipality's rate, and that is an irresponsible number to get wrong.

# The year is resolved from the table's own metadata (see pxweb.latest_year).
# Never hard-code a preferred-year list here: when StatFin publishes a newer
# year the pipeline must pick it up, and when it renames a variable the fetch
# must fail loudly rather than silently leaving the shipped data frozen.

# Retry settings
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2
RATE_LIMIT_DELAY = 1.0


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _request_with_retry(method: str, url: str, *, label: str,
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
    if last_exc is not None:
        raise last_exc
    raise RuntimeError(f"{label}: request failed without raising an exception")


def _rate_limit():
    """Sleep briefly between API calls to be polite."""
    time.sleep(RATE_LIMIT_DELAY)


# ---------------------------------------------------------------------------
# Fetch municipality-level crime rates from Statistics Finland
# ---------------------------------------------------------------------------

def fetch_crime_rates_per_1000(prefer_year: str | None = None) -> tuple[dict[str, float], str]:
    """Fetch official per-1,000 crime rates by municipality from PxWeb table 13h4.

    Returns: ({municipality_code: rate_per_1000, ...}, snapshot_year)
             e.g. ({"091": 123.07, "837": 102.43, ...}, "2025")

    The snapshot year is returned rather than assumed, because downstream
    (fetch_price_crime_history.build_crime_history) anchors the time series to
    it — inferring it from the history table instead produced a series whose
    last point was labelled with a year the snapshot did not come from.
    """
    url, meta = pxweb.fetch_table_meta(PXWEB_DATABASE, PXWEB_TABLE_ID)

    selected_year = pxweb.latest_year(meta, prefer=prefer_year)
    years = pxweb.available_years(meta)
    logger.info("  Using year: %s (available: %s...%s)",
                selected_year, years[0], years[-1])

    # Resolve variable codes from the table's own metadata — StatFin versions
    # and renames them (Vuosi -> timeperiod_y, Alue -> alue_28_20210101, ...).
    year_var = pxweb.year_var_code(meta)
    area_var = pxweb.var_code_for_value(meta, PXWEB_MUNICIPALITY_CODES[0])
    offence_var = pxweb.var_code_for_value(meta, OFFENCE_TOTAL_CODE)
    contents_var = pxweb.var_code_for_value(meta, "rik_1000")

    _rate_limit()

    # Query per-1,000 crime rates
    query = {
        "query": [
            {
                "code": year_var,
                "selection": {"filter": "item", "values": [selected_year]},
            },
            {
                "code": area_var,
                "selection": {"filter": "item", "values": PXWEB_MUNICIPALITY_CODES},
            },
            {
                "code": offence_var,
                "selection": {"filter": "item", "values": [OFFENCE_TOTAL_CODE]},
            },
            {
                "code": contents_var,
                "selection": {"filter": "item", "values": ["rik_1000"]},
            },
        ],
        "response": {"format": "json"},
    }

    logger.info("  Querying per-1,000 crime rates for %d municipalities...",
                len(PXWEB_MUNICIPALITY_CODES))
    r = _request_with_retry(
        "POST", url, label="crime data", json=query, timeout=120,
    )
    data = r.json()

    rows = data.get("data", [])
    if not rows:
        raise ValueError("No data rows in PxWeb response")

    result: dict[str, float] = {}
    for row in rows:
        keys = row.get("key", [])
        vals = row.get("values", [])
        if len(keys) < 2 or not vals:
            continue

        muni_raw = keys[1]  # "KU091"
        muni_code = muni_raw.replace("KU", "").strip()
        val_str = vals[0]

        if val_str in (None, "..", "...", ""):
            logger.warning("  No data for municipality %s", muni_code)
            continue

        try:
            rate = float(val_str)
        except (ValueError, TypeError):
            logger.warning("  Invalid value for %s: %s", muni_code, val_str)
            continue

        result[muni_code] = rate
        logger.info("  %s: %.2f per 1,000", muni_code, rate)

    logger.info("  Fetched crime rates for %d municipalities (year %s)",
                len(result), selected_year)

    return result, selected_year


def fetch_category_rates(
    offence_code: str,
    years: list[str],
    label: str,
) -> dict[str, float]:
    """Fetch one offence group's per-1,000 rate, averaged over ``years``.

    Averaging is what makes a rare category publishable at municipal level: the
    violence group runs about 8.5 per 1,000 nationally, so a 2,000-resident
    municipality sees roughly 17 incidents a year and a single bad year would
    otherwise move it several places in any ranking.

    Municipalities missing a year are averaged over the years they do have, so a
    boundary change does not silently drop them.
    """
    url, meta = pxweb.fetch_table_meta(PXWEB_DATABASE, PXWEB_TABLE_ID)
    available = set(pxweb.available_years(meta))
    use = [y for y in years if y in available]
    if not use:
        raise ValueError(f"{label}: none of {years} available (have {sorted(available)[-5:]})")

    query = {
        "query": [
            {"code": pxweb.year_var_code(meta),
             "selection": {"filter": "item", "values": use}},
            {"code": pxweb.var_code_for_value(meta, PXWEB_MUNICIPALITY_CODES[0]),
             "selection": {"filter": "item", "values": PXWEB_MUNICIPALITY_CODES}},
            {"code": pxweb.var_code_for_value(meta, offence_code),
             "selection": {"filter": "item", "values": [offence_code]}},
            {"code": pxweb.var_code_for_value(meta, "rik_1000"),
             "selection": {"filter": "item", "values": ["rik_1000"]}},
        ],
        "response": {"format": "json"},
    }
    logger.info("Fetching %s (%s) for %s...", label, offence_code, ", ".join(use))
    _rate_limit()
    r = _request_with_retry("POST", url, label=label, json=query, timeout=120)

    sums: dict[str, list[float]] = {}
    for row in r.json().get("data", []):
        keys, vals = row.get("key", []), row.get("values", [])
        if len(keys) < 2 or not vals:
            continue
        val = vals[0]
        if val in (None, "..", "...", ""):
            continue
        try:
            sums.setdefault(keys[1].replace("KU", "").strip(), []).append(float(val))
        except (TypeError, ValueError):
            continue

    result = {m: round(sum(v) / len(v), 2) for m, v in sums.items() if v}
    logger.info("  %s: %d municipalities, national mean %.2f per 1,000",
                label, len(result), sum(result.values()) / max(len(result), 1))
    return result


def fetch_crime_rates_fallback(prefer_year: str | None = None) -> tuple[dict[str, float], str]:
    """Fallback: Fetch raw crime counts from table 13ex and compute per-capita
    rates using GeoJSON population data.

    Returns: ({municipality_code: rate_per_1000, ...}, snapshot_year)
    """
    url, meta = pxweb.fetch_table_meta(PXWEB_DATABASE, PXWEB_FALLBACK_TABLE_ID)

    selected_year = pxweb.latest_year(meta, prefer=prefer_year)
    logger.info("  Using year: %s", selected_year)

    year_var = pxweb.year_var_code(meta)
    area_var = pxweb.var_code_for_value(meta, PXWEB_MUNICIPALITY_CODES[0])
    offence_var = pxweb.var_code_for_value(meta, OFFENCE_TOTAL_CODE)
    contents_var = pxweb.var_code_for_value(meta, "rikokset_lkm")

    _rate_limit()

    query = {
        "query": [
            {
                "code": year_var,
                "selection": {"filter": "item", "values": [selected_year]},
            },
            {
                "code": area_var,
                "selection": {"filter": "item", "values": PXWEB_MUNICIPALITY_CODES},
            },
            {
                "code": offence_var,
                "selection": {"filter": "item", "values": [OFFENCE_TOTAL_CODE]},
            },
            {
                "code": contents_var,
                "selection": {"filter": "item", "values": ["rikokset_lkm"]},
            },
        ],
        "response": {"format": "json"},
    }

    r = _request_with_retry(
        "POST", url, label="fallback crime data",
        json=query, timeout=120,
    )
    data = r.json()

    # Get raw counts
    raw_counts: dict[str, int] = {}
    for row in data.get("data", []):
        keys = row.get("key", [])
        vals = row.get("values", [])
        if len(keys) < 2 or not vals:
            continue
        muni_code = keys[1].replace("KU", "").strip()
        val_str = vals[0]
        if val_str in (None, "..", "...", ""):
            continue
        try:
            raw_counts[muni_code] = int(float(val_str))
        except (ValueError, TypeError):
            continue

    # Load population from GeoJSON
    muni_pop = _get_municipality_populations()

    # Compute rates
    result: dict[str, float] = {}
    for muni_code, count in raw_counts.items():
        pop = muni_pop.get(muni_code, 0)
        if pop > 0:
            rate = count / pop * 1000
            result[muni_code] = round(rate, 2)
            logger.info("  %s: %d crimes / %d pop = %.2f per 1,000",
                        muni_code, count, pop, result[muni_code])

    logger.info("  Computed rates for %d municipalities (year %s)",
                len(result), selected_year)
    return result, selected_year


def _get_municipality_populations() -> dict[str, int]:
    """Sum population by municipality from the GeoJSON."""
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)

    muni_pop: dict[str, int] = {}
    for feat in geojson.get("features", []):
        props = feat.get("properties", {})
        kunta = str(props.get("kunta", ""))
        pop = props.get("he_vakiy")
        if kunta and pop and pop > 0:
            muni_pop[kunta] = muni_pop.get(kunta, 0) + pop

    return muni_pop


# ---------------------------------------------------------------------------
# Load GeoJSON postal code data
# ---------------------------------------------------------------------------

def load_postal_codes() -> list[dict]:
    """Load postal code features from the GeoJSON.

    Returns list of dicts with fields needed for crime distribution:
      pno, kunta, he_vakiy, population_density, unemployment_rate, rental_rate
    """
    logger.info("Loading GeoJSON from %s", GEOJSON_PATH)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    logger.info("  Loaded %d features", len(features))

    records = []
    for feat in features:
        props = feat.get("properties", {})
        pno = props.get("pno")
        kunta = props.get("kunta")
        if not pno or not kunta:
            continue
        records.append({
            "pno": str(pno),
            "kunta": str(kunta),
            "he_vakiy": _safe_float(props.get("he_vakiy")),
            "population_density": _safe_float(props.get("population_density")),
            "unemployment_rate": _safe_float(props.get("unemployment_rate")),
            "rental_rate": _safe_float(props.get("rental_rate")),
        })

    logger.info("  Extracted %d postal code records", len(records))
    return records


def _safe_float(v) -> float | None:
    """Convert a value to float, returning None if invalid."""
    if v is None:
        return None
    try:
        val = float(v)
        return val if val == val else None  # NaN check
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Apply municipality-level rates to postal codes
# ---------------------------------------------------------------------------

def assign_to_postal_codes(
    muni_rates: dict[str, float],
    postal_records: list[dict],
) -> dict[str, float]:
    """Give every postal code its municipality's official crime rate, unchanged.

    This used to *spread* the municipal figure across a municipality's postal
    codes with a composite "crime proxy score" built from population density,
    unemployment rate and rental rate, scaled so the population-weighted mean
    came back to the official rate. The spread is gone, because no part of it
    was an observation of crime:

      - No crime statistic exists below municipality level in Finland. StatFin
        table 13h4's area variable offers 330 codes -- 1 whole country, 19
        maakunta, 308 municipalities -- and no postal codes. There is therefore
        nothing a within-municipality estimate could ever be validated against.
      - Measured on the shipped data, the variation it produced was largely a
        restatement of rent and density: within-municipality correlations were
        rental_rate +0.58, unemployment +0.43, population +0.33, density +0.27.
        Two postal codes in one city differed on "crime" mostly because they
        differed on rent.
      - It read as precision the source cannot support. 289 of the 308
        municipalities have more than one postal area, so nearly every
        multi-area municipality carried invented spread -- rendered to one
        decimal per area, and feeding the Quality Index (weight 26), the wizard
        fit score and the "safest areas" rankings as though it were observed.

    Flattening loses no real information: the old spread was already normalised
    so each municipality's population-weighted mean equalled the official rate,
    so the municipal signal is identical either way. Only the unvalidatable
    within-city variation goes.

    crime_index stays is_proxy:true -- it is still a municipal figure shown on
    postal geography, not a measurement of the postal area. That is exactly how
    voter_turnout_pct and broadband_coverage_pct already work.

    Do not reintroduce a spread without a real sub-municipal source.

    Args:
        muni_rates: {muni_code: crime_rate_per_1000}
        postal_records: postal code records; needs `pno` and `kunta`

    Returns:
        {postal_code: municipality_crime_rate_per_1000}
    """
    logger.info("Applying municipal crime rates to postal codes...")

    result: dict[str, float] = {}
    per_muni: dict[str, int] = {}
    for rec in postal_records:
        kunta = rec["kunta"]
        rate = muni_rates.get(kunta)
        if rate is None:
            continue
        result[rec["pno"]] = round(rate, 1)
        per_muni[kunta] = per_muni.get(kunta, 0) + 1

    if per_muni:
        biggest = max(per_muni, key=lambda k: per_muni[k])
        logger.info(
            "  %d postal codes across %d municipalities (largest: %s with %d areas)",
            len(result), len(per_muni), biggest, per_muni[biggest],
        )
    return result


# ---------------------------------------------------------------------------
# Merge results with existing data
# ---------------------------------------------------------------------------

def load_existing_data() -> dict[str, float]:
    """Load existing crime_index.json if it exists."""
    if OUTPUT_FILE.exists():
        with open(OUTPUT_FILE, encoding="utf-8") as f:
            data = json.load(f)
        logger.info("Loaded existing crime_index.json with %d entries", len(data))
        return {str(k): float(v) for k, v in data.items()}
    return {}


def merge_results(
    existing: dict[str, float],
    new_data: dict[str, float],
) -> dict[str, float]:
    """Replace the stored crime index with the freshly computed one.

    This function used to preserve any existing 0xxxx (capital region) entry
    unless --overwrite was passed — a leftover from when the app covered only
    the Helsinki metro and those values came from a different source. Because
    --overwrite was never passed, 167 capital-region postal codes stayed frozen
    on a 2026-03 snapshot from an unrelated source while the rest of the
    country tracked StatFin, roughly halving Helsinki/Espoo/Vantaa's crime
    index relative to their neighbours and putting a visible discontinuity on
    the municipal border of the app's most heavily weighted quality factor.

    One national fetch now produces every value, so every postal code is on the
    same source, scale and year. Entries that the current run did not compute
    are dropped rather than carried forward: a value whose provenance we can no
    longer state is exactly what this pipeline must not ship.
    """
    dropped = sorted(set(existing) - set(new_data))
    changed = sum(
        1 for pno, rate in new_data.items()
        if pno in existing and abs(existing[pno] - rate) > 1e-9
    )
    added = len(set(new_data) - set(existing))

    logger.info(
        "  Merge: %d computed (%d new, %d changed), %d stale entries dropped",
        len(new_data), added, changed, len(dropped),
    )
    if dropped:
        logger.info("    dropped: %s%s",
                    ", ".join(dropped[:10]),
                    " ..." if len(dropped) > 10 else "")
    return new_data


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Fetch crime statistics and update crime_index.json"
    )
    parser.add_argument(
        "--year",
        default=None,
        help="Pin a specific statistics year (default: the newest StatFin publishes)",
    )
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("Crime index data pipeline")
    logger.info("=" * 60)

    # Step 1: Fetch municipality-level crime rates
    muni_rates = None
    snapshot_year = None
    try:
        muni_rates, snapshot_year = fetch_crime_rates_per_1000(args.year)
    except Exception as e:
        logger.warning("Primary table failed: %s", e)
        logger.info("Trying fallback table...")

    if not muni_rates:
        try:
            _rate_limit()
            muni_rates, snapshot_year = fetch_crime_rates_fallback(args.year)
        except Exception as e:
            logger.error("Fallback table also failed: %s", e)
            logger.error("Cannot proceed without crime data. Exiting.")
            sys.exit(1)

    if not muni_rates:
        logger.error("No municipality crime rates obtained. Exiting without writing.")
        sys.exit(1)

    # Verify we got data for at least some municipalities
    missing = ALL_MUNICIPALITY_CODES - set(muni_rates.keys())
    if missing:
        logger.warning("Missing data for municipalities: %s", sorted(missing))
    if len(muni_rates) < len(ALL_MUNICIPALITY_CODES) // 2:
        logger.error(
            "Only got data for %d/%d municipalities — too few. Exiting.",
            len(muni_rates), len(ALL_MUNICIPALITY_CODES),
        )
        sys.exit(1)

    # Step 2: Load postal code data from GeoJSON
    postal_records = load_postal_codes()
    if not postal_records:
        logger.error("No postal code records found in GeoJSON. Exiting.")
        sys.exit(1)

    # Step 3: Distribute to postal codes
    new_data = assign_to_postal_codes(muni_rates, postal_records)
    if not new_data:
        logger.error("Distribution produced no results. Exiting without writing.")
        sys.exit(1)

    logger.info("Computed crime index for %d postal codes", len(new_data))

    # Step 4: Merge with existing data
    existing = load_existing_data()
    merged = merge_results(existing, new_data)

    # Step 5: Save
    logger.info("Saving %d entries to %s", len(merged), OUTPUT_FILE)
    sorted_data = dict(sorted(merged.items()))
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted_data, f, indent=2, ensure_ascii=False)

    # Step 6: the two offence sub-groups that get their own layers. Both are
    # siblings of each other under the total, so nothing is double-counted.
    year_i = int(snapshot_year)
    violent_years = [str(y) for y in range(year_i - VIOLENT_YEARS + 1, year_i + 1)]
    violent_muni = fetch_category_rates(OFFENCE_VIOLENT_CODE, violent_years, "violent crime")
    property_muni = fetch_category_rates(OFFENCE_PROPERTY_CODE, [snapshot_year], "property crime")

    # Population floor: below it the counts are small enough that the rate is
    # noise. Emit nothing rather than a number we cannot stand behind — the map
    # already renders a missing value as "low data" grey.
    muni_pop = _get_municipality_populations()
    for name, rates in (("violent", violent_muni), ("property", property_muni)):
        withheld = [m for m in rates if muni_pop.get(m, 0) < CATEGORY_MIN_POPULATION]
        for m in withheld:
            del rates[m]
        logger.info(
            "  %s crime: withheld %d municipalities under %d residents "
            "(too few incidents to be stable)",
            name, len(withheld), CATEGORY_MIN_POPULATION,
        )

    violent_postal = assign_to_postal_codes(violent_muni, postal_records)
    property_postal = assign_to_postal_codes(property_muni, postal_records)
    for path, data, name in [
        (VIOLENT_OUTPUT_FILE, violent_postal, "violent"),
        (PROPERTY_OUTPUT_FILE, property_postal, "property"),
    ]:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(dict(sorted(data.items())), f, indent=2, ensure_ascii=False)
        logger.info("Saved %d %s-crime entries to %s", len(data), name, path.name)

    # Record which years these values are. Downstream consumers must not infer
    # it: build_crime_history used to assume the newest year in the *history*
    # table was the snapshot year, which silently mislabelled the series.
    meta = {
        "year": snapshot_year,
        "source": f"Statistics Finland StatFin {PXWEB_DATABASE}/{PXWEB_TABLE_ID}",
        "offence_group": OFFENCE_TOTAL_CODE,
        "unit": "offences per 1,000 residents",
        "municipalities": len(muni_rates),
        "postal_codes": len(sorted_data),
        "violent": {
            "offence_group": OFFENCE_VIOLENT_CODE,
            "years": violent_years,
            "vintage": f"{violent_years[0]}–{violent_years[-1]}",
            "min_population": CATEGORY_MIN_POPULATION,
            "municipalities": len(violent_muni),
            "postal_codes": len(violent_postal),
        },
        "property": {
            "offence_group": OFFENCE_PROPERTY_CODE,
            "years": [snapshot_year],
            "vintage": snapshot_year,
            "municipalities": len(property_muni),
            "postal_codes": len(property_postal),
        },
    }
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
        f.write("\n")
    logger.info("Wrote snapshot metadata to %s (year %s)", META_FILE, snapshot_year)

    logger.info("Done!")

    # Summary statistics
    helsinki = {k: v for k, v in sorted_data.items() if k.startswith("0")}
    tampere = {k: v for k, v in sorted_data.items()
               if k[:2] in ("33", "34", "35", "36", "37", "39")}
    turku = {k: v for k, v in sorted_data.items()
             if k[:2] in ("20", "21", "23", "24")}

    for label, region_data in [("Helsinki metro", helsinki),
                                ("Tampere region", tampere),
                                ("Turku region", turku)]:
        if region_data:
            vals = list(region_data.values())
            logger.info(
                "  %s: %d areas, min=%.1f, max=%.1f, mean=%.1f",
                label, len(vals), min(vals), max(vals),
                sum(vals) / len(vals),
            )
        else:
            logger.info("  %s: no data", label)


if __name__ == "__main__":
    main()
