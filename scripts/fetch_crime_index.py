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
  3. Distribute the municipality-level rate across postal codes using
     population density, unemployment rate, and rental rate as proxies for
     intra-municipality crime variation (denser, higher-unemployment,
     higher-rental areas tend to have higher crime rates).
  4. Save results to scripts/crime_index.json, and the statistics year they
     came from to scripts/crime_index_meta.json.

Every postal code is computed from the same national fetch. An earlier version
preserved existing 0xxxx (capital region) values unless --overwrite was passed;
since it never was, those 167 areas stayed frozen on an unrelated 2026-03
source at roughly half the scale of the rest of the country. Do not
reintroduce per-region preservation — mixing sources inside one layer puts a
false discontinuity on the map at every municipal border.

Because the postal-code values are a municipality figure distributed to a finer
granularity than the source publishes, crime_index is flagged is_proxy:true in
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
# Records the statistics year the values above came from, so downstream
# consumers and the source registry can state it instead of guessing.
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
# Distribute municipality-level rates to postal codes
# ---------------------------------------------------------------------------

def distribute_to_postal_codes(
    muni_rates: dict[str, float],
    postal_records: list[dict],
) -> dict[str, float]:
    """Distribute municipality-level crime rates to postal codes using
    population density, unemployment rate, and rental rate as proxies.

    Higher population density, higher unemployment, and higher rental rate
    (indicating more urban/commercial areas) correlate with higher crime.

    For each municipality, we:
    1. Compute a composite "crime proxy score" for each postal code area
       from normalized density, unemployment, and rental rate.
    2. Scale the scores so that the population-weighted mean across all
       postal codes in the municipality equals the official municipality rate.
    3. Clamp extreme values to prevent unreasonable outliers.

    Args:
        muni_rates: {muni_code: crime_rate_per_1000}
        postal_records: list of postal code records with proxy variables

    Returns:
        {postal_code: estimated_crime_rate_per_1000}
    """
    logger.info("Distributing crime rates to postal codes...")

    # Group postal codes by municipality
    muni_groups: dict[str, list[dict]] = {}
    for rec in postal_records:
        kunta = rec["kunta"]
        if kunta in muni_rates:
            muni_groups.setdefault(kunta, []).append(rec)

    result: dict[str, float] = {}

    for muni_code, records in muni_groups.items():
        muni_rate = muni_rates[muni_code]

        if len(records) == 1:
            # Only one postal code area in this municipality
            result[records[0]["pno"]] = round(muni_rate, 1)
            continue

        # Compute proxy scores for each postal code
        # Use population density, unemployment, and rental rate
        scores = []
        for rec in records:
            score = _compute_crime_proxy_score(rec)
            scores.append(score)

        # Normalize scores relative to population-weighted average
        # so that weighted mean of estimates equals the municipality rate
        total_pop = sum(rec["he_vakiy"] or 0 for rec in records)
        if total_pop <= 0:
            # Fall back to equal distribution if no population data
            for rec in records:
                result[rec["pno"]] = round(muni_rate, 1)
            continue

        # Compute population-weighted mean score
        weighted_score_sum = sum(
            score * (rec["he_vakiy"] or 0)
            for score, rec in zip(scores, records)
        )
        mean_score = weighted_score_sum / total_pop

        if mean_score <= 0:
            mean_score = 1.0

        # Scale each postal code's rate
        for score, rec in zip(scores, records):
            ratio = score / mean_score
            estimated_rate = muni_rate * ratio

            # Clamp to reasonable bounds:
            # - minimum 5 per 1,000 (even quiet residential areas have some crime)
            # - maximum 4x the municipality rate (city centers)
            estimated_rate = max(5.0, min(muni_rate * 4.0, estimated_rate))
            result[rec["pno"]] = round(estimated_rate, 1)

        # Log some stats for this municipality
        rates = [result[rec["pno"]] for rec in records]
        logger.info(
            "  %s: muni_rate=%.1f, distributed to %d areas "
            "(min=%.1f, max=%.1f, mean=%.1f)",
            muni_code, muni_rate, len(records),
            min(rates), max(rates),
            sum(r * (rec["he_vakiy"] or 0) for r, rec in zip(rates, records))
            / total_pop,
        )

    return result


def _compute_crime_proxy_score(rec: dict) -> float:
    """Compute a composite proxy score for crime likelihood from postal code
    characteristics.

    Higher scores indicate areas likely to have higher crime rates.
    Uses three signals weighted by their typical correlation with crime:
      - Population density (weight 0.5): denser areas have more opportunity
        for crime, more commercial activity, nightlife, etc.
      - Unemployment rate (weight 0.3): unemployment correlates with property
        crime and some violent crime.
      - Rental rate (weight 0.2): high rental share indicates transient
        population, commercial centers, less community cohesion.

    All inputs are log-transformed or scaled to reduce the effect of extreme
    outliers (e.g., a single very dense city center postal code).
    """
    import math

    score = 1.0  # base score

    # Population density: log-scale, centered around typical suburban density
    # Finnish postal codes range from ~10 to ~25,000 people/km2
    density = rec.get("population_density")
    if density and density > 0:
        # Log transform: ln(density/500) gives 0 at 500/km2 (typical suburb)
        # positive for denser, negative for sparser
        density_factor = math.log(density / 500.0)
        # Scale to a multiplier: each unit of log adds ~20% to crime score
        score += 0.5 * density_factor * 0.2
    else:
        # No density data — use neutral score
        pass

    # Unemployment rate: higher unemployment -> higher crime
    # Finnish rates typically range 2-15%
    unemployment = rec.get("unemployment_rate")
    if unemployment is not None and unemployment >= 0:
        # Center around 6% (typical average)
        unemp_factor = (unemployment - 6.0) / 6.0
        score += 0.3 * unemp_factor * 0.5

    # Rental rate: higher rental share -> more transient, urban, commercial
    # Finnish rates range ~15-80%
    rental_rate = rec.get("rental_rate")
    if rental_rate is not None and rental_rate > 0:
        # Center around 35% (typical average)
        rental_factor = (rental_rate - 35.0) / 35.0
        score += 0.2 * rental_factor * 0.5

    # Ensure score is positive
    return max(0.1, score)


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
    new_data = distribute_to_postal_codes(muni_rates, postal_records)
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

    # Record which year these values are. Downstream consumers must not infer
    # it: build_crime_history used to assume the newest year in the *history*
    # table was the snapshot year, which silently mislabelled the series.
    meta = {
        "year": snapshot_year,
        "source": f"Statistics Finland StatFin {PXWEB_DATABASE}/{PXWEB_TABLE_ID}",
        "offence_group": OFFENCE_TOTAL_CODE,
        "unit": "offences per 1,000 residents",
        "municipalities": len(muni_rates),
        "postal_codes": len(sorted_data),
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
