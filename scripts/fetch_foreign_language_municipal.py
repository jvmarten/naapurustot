#!/usr/bin/env python3
"""
Fetch the share of foreign-language speakers (vieraskielisten osuus) per
municipality from Statistics Finland, for every reference year from 2020 to the
latest available. This is the municipal change signal used to roll the real
postal-code 2020 foreign_language_pct layer forward to later years as a
within-city estimate (see derive_foreign_language_history in
apply_foreign_language_municipal_to_geojson.py).

Statistics Finland publishes language data no finer than municipality, so the
only openly-usable postal-code figure is a 2020 special extract
(foreign_language_pct). Later years can therefore be offered only as an
estimate: the 2020 postal distribution scaled per municipality by how that
municipality's foreign-language share changed (this file). That estimate is
flagged is_proxy:true in src/data/data_sources.json and listed in
MUNICIPALITY_DISTRIBUTED_PROXIES in scripts/validate_data.py (enforced by
validate_data.py check_distributed_proxy_flags). It complements, and never
replaces, the real 2020 postal layer (which preserves within-city detail).

Data source: Tilastokeskus (Statistics Finland) StatFin PxWeb API
  Statistic: Väestörakenne (Population structure)
  Database:  vaerak
  Table:     159t -- "Population according to citizenship, country of birth,
             language and origin, municipality" — exposes a ready-computed
             "Share of foreign-language speakers, %" (content code
             vaesto_kieli_ulk_p) per municipality, 1990-.
  URL:       https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/vaerak/159t.px

Why 159t (data-availability note): foreign-language share is NOT part of the open
postal-code Paavo product (pno_tilasto / paavo_pxt_12f7 carry no language field at
all), and the StatFin language tables (vaerak 11rm "Language by municipality",
159t) bottom out at municipality. 159t is preferred because it publishes the share
% directly (definition identical to the postal layer: native language other than
Finnish, Swedish or Sámi), avoiding any client-side recomputation.

DATA INTEGRITY: every value comes from the real StatFin API. If the fetch fails or
returns unexpected data, this script aborts with a non-zero exit code rather than
writing any fabricated, estimated, or placeholder values.

Output: scripts/foreign_language_municipal.json
Format: {"091": {"2020": 16.1, "2021": 17.0, ..., "2025": 21.2}, ...}
        — % foreign-language speakers per municipality (3-digit kunta code), one
        entry per reference year from 2020 to the latest available.

Usage:
  python scripts/fetch_foreign_language_municipal.py
"""

import argparse
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
OUTPUT_FILE = SCRIPT_DIR / "foreign_language_municipal.json"

# StatFin PxWeb — Population structure (database vaerak, table 159t).
PXWEB_TABLE_URL = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/vaerak/159t.px"

# Variable codes are date-suffixed in the metadata (e.g. alue_23_20260101); we
# resolve them by stable prefix so the script survives the annual code rotation.
AREA_PREFIX = "alue"               # Area: "SSS" (whole country) + "KU###" municipalities
VAR_YEAR = "timeperiod_y"          # Reference year
VAR_INFO = "contentscode"          # Information dimension

# Ready-computed share of foreign-language speakers, %.
CONTENT_SHARE = "vaesto_kieli_ulk_p"

# Earliest reference year to fetch. 2020 is the baseline year of the real
# postal-code layer (foreign_language_pct), so the estimate scales from there.
START_YEAR = 2020

# Treat the table as having data for a year only if at least this many
# municipalities return a numeric value (sanity floor; ~309 municipalities exist).
MIN_MUNICIPALITIES = 100

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2


# ---------------------------------------------------------------------------
# HTTP helper
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
                logger.warning("  Retry %d/%d for %s in %ds (%s)",
                               attempt, retries, label, wait, exc)
                time.sleep(wait)
    if last_exc is not None:
        raise last_exc
    raise RuntimeError(f"{label}: request failed without raising an exception")


def _resolve_var(meta: dict, prefix: str) -> dict:
    """Find a variable in the metadata by stable code prefix."""
    for v in meta.get("variables", []):
        if v["code"].lower().startswith(prefix):
            return v
    raise ValueError(f"Variable with code prefix '{prefix}' not found in metadata")


# ---------------------------------------------------------------------------
# Fetch municipal foreign-language share from StatFin
# ---------------------------------------------------------------------------

def _query_year(area_var: dict, muni_codes: list[str], year: str) -> dict[str, float]:
    """Query the foreign-language share for one reference year. Returns
    {kunta_code(3-digit): share%} for municipalities with a numeric value."""
    query = {
        "query": [
            {"code": area_var["code"], "selection": {"filter": "item", "values": muni_codes}},
            {"code": VAR_YEAR, "selection": {"filter": "item", "values": [year]}},
            {"code": VAR_INFO, "selection": {"filter": "item", "values": [CONTENT_SHARE]}},
        ],
        "response": {"format": "json-stat2"},
    }
    r = _request_with_retry("POST", PXWEB_TABLE_URL, label="vaerak 159t data",
                            json=query, timeout=120)
    data = r.json()

    info_cat = data.get("dimension", {}).get(VAR_INFO, {}).get("category", {})
    if CONTENT_SHARE not in info_cat.get("label", {}):
        raise ValueError(
            f"Response does not contain content code {CONTENT_SHARE!r} "
            f"(got {list(info_cat.get('label', {}))})"
        )

    area_index = data["dimension"][area_var["code"]]["category"]["index"]
    values = data["value"]
    if len(values) != len(area_index):
        raise ValueError(
            f"Expected one value per municipality ({len(area_index)}), "
            f"got {len(values)} values"
        )

    out: dict[str, float] = {}
    for area_code, pos in area_index.items():
        if not area_code.startswith("KU"):
            continue
        v = values[pos]
        if isinstance(v, (int, float)):
            out[area_code.replace("KU", "").strip().zfill(3)] = round(float(v), 1)
    return out


def fetch_municipal_share_series() -> tuple[dict[str, dict[str, float]], int]:
    """Fetch the share of foreign-language speakers per municipality for every
    reference year from START_YEAR to the latest available.

    Returns: ({kunta_code(3-digit): {year(str): share%}}, latest_year)
    """
    logger.info("Fetching language metadata from %s", PXWEB_TABLE_URL)
    meta = _request_with_retry("GET", PXWEB_TABLE_URL, label="vaerak 159t metadata").json()
    logger.info("  Table: %s", meta.get("title"))

    area_var = _resolve_var(meta, AREA_PREFIX)
    muni_codes = [c for c in area_var["values"] if c.startswith("KU")]
    if not muni_codes:
        raise ValueError("No municipality (KU###) area codes found in metadata")
    logger.info("  Found %d municipality codes", len(muni_codes))

    info_var = next(v for v in meta["variables"] if v["code"] == VAR_INFO)
    if CONTENT_SHARE not in info_var["values"]:
        raise ValueError(
            f"Content code {CONTENT_SHARE!r} not in metadata (got {info_var['values']})"
        )

    year_var = next(v for v in meta["variables"] if v["code"] == VAR_YEAR)
    wanted_years = [y for y in year_var["values"] if str(y).isdigit() and int(y) >= START_YEAR]
    if not wanted_years:
        raise ValueError(f"No reference years >= {START_YEAR} found in metadata")

    series: dict[str, dict[str, float]] = {}
    latest_year = 0
    for year in sorted(wanted_years, key=int):
        shares = _query_year(area_var, muni_codes, year)
        logger.info("  Year %s: %d municipalities with data", year, len(shares))
        if len(shares) < MIN_MUNICIPALITIES:
            # A future year that exists in metadata but has not been populated yet
            # (or a one-off sparse year) is skipped rather than treated as fatal.
            logger.warning("  Year %s skipped (only %d municipalities < %d floor)",
                           year, len(shares), MIN_MUNICIPALITIES)
            continue
        for kunta, share in shares.items():
            series.setdefault(kunta, {})[str(year)] = share
        latest_year = max(latest_year, int(year))

    if str(START_YEAR) not in {y for vals in series.values() for y in vals}:
        raise ValueError(
            f"Baseline year {START_YEAR} returned no data — cannot anchor the estimate"
        )
    if latest_year <= START_YEAR:
        raise ValueError(
            f"Only the baseline year {START_YEAR} has data — no later year to estimate"
        )

    return series, latest_year


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Fetch StatFin municipal foreign-language share series (vaerak 159t)"
    )
    parser.parse_args()

    logger.info("=" * 60)
    logger.info("Foreign-language share series (Väestörakenne 159t) — municipal")
    logger.info("=" * 60)

    try:
        series, latest_year = fetch_municipal_share_series()
    except Exception as exc:
        logger.error("StatFin fetch failed: %s", exc)
        logger.error("Aborting WITHOUT writing — no fabricated data will be produced.")
        sys.exit(1)

    if len(series) < MIN_MUNICIPALITIES:
        logger.error("Only %d municipalities fetched — too few, aborting.", len(series))
        sys.exit(1)

    # Stable ordering: municipalities, then years ascending within each.
    sorted_data = {
        kunta: {y: series[kunta][y] for y in sorted(series[kunta], key=int)}
        for kunta in sorted(series)
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted_data, f, indent=2, ensure_ascii=False)
    logger.info("Saved %d municipalities (2020..%d) to %s",
                len(sorted_data), latest_year, OUTPUT_FILE)

    # Sanity log: a few notable municipalities (real values).
    samples = {
        "091": "Helsinki", "049": "Espoo", "092": "Vantaa", "837": "Tampere",
        "564": "Oulu", "853": "Turku", "405": "Lappeenranta",
    }
    for code, name in samples.items():
        if code in sorted_data:
            yrs = sorted_data[code]
            base = yrs.get(str(START_YEAR))
            last = yrs.get(str(latest_year))
            logger.info("  %s (%s): %s%% (2020) -> %s%% (%d)",
                        name, code, base, last, latest_year)


if __name__ == "__main__":
    main()
