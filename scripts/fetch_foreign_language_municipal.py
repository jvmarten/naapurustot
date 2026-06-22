#!/usr/bin/env python3
"""
Fetch the share of foreign-language speakers (vieraskielisten osuus) per
municipality from Statistics Finland and assign each postal code its
municipality's value. This is a *more recent* companion to the postal-code-level
foreign_language_pct layer, whose only openly-usable national source is a 2020
extract: Statistics Finland publishes language data no finer than municipality,
so a current (2025) figure can only be offered at municipal granularity.

Because the postal-code values are a municipality figure assigned to a finer
granularity than the source publishes, foreign_language_municipal_pct is flagged
is_proxy:true in src/data/data_sources.json and listed in
MUNICIPALITY_DISTRIBUTED_PROXIES in scripts/validate_data.py (enforced by
validate_data.py check_distributed_proxy_flags). It complements, and never
replaces, the real postal-code 2020 layer (which preserves within-city detail).

Data source: Tilastokeskus (Statistics Finland) StatFin PxWeb API
  Statistic: Väestörakenne (Population structure)
  Database:  vaerak
  Table:     159t -- "Population by origin and background country, sex and ...,
             municipality" — exposes a ready-computed "Share of foreign-language
             speakers, %" (content code vaesto_kieli_ulk_p) per municipality.
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
Format: {"00100": 21.2, "33100": 11.4, ...}  (% foreign-language speakers, latest
        municipal figure assigned to each postal code)

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
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_FILE = SCRIPT_DIR / "foreign_language_municipal.json"

# StatFin PxWeb — Population structure (database vaerak, table 159t).
PXWEB_TABLE_URL = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/vaerak/159t.px"

# Variable codes are date-suffixed in the metadata (e.g. alue_23_20260101); we
# resolve them by stable prefix so the script survives the annual code rotation.
AREA_PREFIX = "alue"               # Area: "SSS" (whole country) + "KU###" municipalities
VAR_YEAR = "timeperiod_y"          # Reference year (we take the latest with data)
VAR_INFO = "contentscode"          # Information dimension

# Ready-computed share of foreign-language speakers, %.
CONTENT_SHARE = "vaesto_kieli_ulk_p"

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


def fetch_municipal_share() -> tuple[dict[str, float], str]:
    """Fetch the share of foreign-language speakers per municipality for the
    latest reference year that actually carries data.

    Returns: ({kunta_code(3-digit): share%}, reference_year)
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
    # Walk years from newest to oldest, taking the first one with real data.
    for year in reversed(year_var["values"]):
        shares = _query_year(area_var, muni_codes, year)
        logger.info("  Year %s: %d municipalities with data", year, len(shares))
        if len(shares) >= MIN_MUNICIPALITIES:
            return shares, str(year)

    raise ValueError(
        f"No reference year returned data for >= {MIN_MUNICIPALITIES} municipalities"
    )


# ---------------------------------------------------------------------------
# Assign municipality values to postal codes
# ---------------------------------------------------------------------------

def assign_to_postal_codes(
    geojson: dict, muni_share: dict[str, float],
) -> dict[str, float]:
    """Assign each postal code its municipality's foreign-language share."""
    result: dict[str, float] = {}
    matched_munis: set[str] = set()
    for feat in geojson.get("features", []):
        props = feat.get("properties", {})
        pno = props.get("pno") or props.get("postinumeroalue")
        kunta = props.get("kunta")
        if not pno or kunta is None:
            continue
        val = muni_share.get(str(kunta).zfill(3))
        if val is not None:
            result[str(pno)] = val
            matched_munis.add(str(kunta).zfill(3))

    logger.info("  Assigned foreign-language share to %d postal codes across %d municipalities",
                len(result), len(matched_munis))
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Fetch StatFin municipal foreign-language share (vaerak 159t)"
    )
    parser.parse_args()

    logger.info("=" * 60)
    logger.info("Foreign-language share (Väestörakenne 159t) — municipal proxy")
    logger.info("=" * 60)

    try:
        muni_share, ref_year = fetch_municipal_share()
    except Exception as exc:
        logger.error("StatFin fetch failed: %s", exc)
        logger.error("Aborting WITHOUT writing — no fabricated data will be produced.")
        sys.exit(1)

    if len(muni_share) < MIN_MUNICIPALITIES:
        logger.error("Only %d municipalities fetched — too few, aborting.", len(muni_share))
        sys.exit(1)

    logger.info("Loading GeoJSON from %s", GEOJSON_PATH)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)

    postal_values = assign_to_postal_codes(geojson, muni_share)
    if not postal_values:
        logger.error("No postal code values produced — aborting without writing.")
        sys.exit(1)

    sorted_data = dict(sorted(postal_values.items()))
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted_data, f, indent=2, ensure_ascii=False)
    logger.info("Saved %d entries to %s (reference year %s)",
                len(sorted_data), OUTPUT_FILE, ref_year)

    vals = list(sorted_data.values())
    logger.info("  Range: min=%.1f max=%.1f mean=%.1f",
                min(vals), max(vals), sum(vals) / len(vals))

    # Sanity log: a few notable municipalities (real values).
    samples = {
        "091": "Helsinki", "049": "Espoo", "092": "Vantaa", "837": "Tampere",
        "564": "Oulu", "853": "Turku", "405": "Lappeenranta",
    }
    for code, name in samples.items():
        if code in muni_share:
            logger.info("  %s (%s): %.1f%% foreign-language speakers", name, code, muni_share[code])


if __name__ == "__main__":
    main()
