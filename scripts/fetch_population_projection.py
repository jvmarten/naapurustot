#!/usr/bin/env python3
"""
CF-6: Fetch the official municipal population projection and compute a
forward-looking projected-population-change % per municipality, then assign each
postal code its municipality's value.

Data source: Tilastokeskus (Statistics Finland) StatFin PxWeb API
  Database: vaenn (Population projection)
  Table:    14wx -- "Population projection 2024: Population according to age and
            sex by area, 2024-2045" (published 2024-10-24, CC BY 4.0)
  URL:      https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/vaenn/14wx.px

This is the BASE projection scenario (perusvaihtoehto): the table's single
`contentscode` value `vaesto_e24` ("Population 31 Dec (projection 2024)"). The
self-sufficiency variant is a separate table (14x1) and is NOT used here.

Method:
  1. GET the table metadata to discover the municipality area codes
     (alue_23_20240101 values of the form "KU091" etc.).
  2. POST a json-stat2 query for the projected TOTAL population (both sexes, all
     ages) in the base year (2024) and the target year (2040) for every
     municipality.
  3. growth_pct = (pop_target - pop_base) / pop_base * 100 per municipality.
  4. Load postal code areas from the GeoJSON (pno -> kunta) and assign each
     postal code its municipality's growth_pct.

Because the postal-code values are a municipality figure assigned to a finer
granularity than the source publishes, population_projection_pct is flagged
is_proxy:true in src/data/data_sources.json and listed in
MUNICIPALITY_DISTRIBUTED_PROXIES in scripts/validate_data.py (enforced by
validate_data.py check_distributed_proxy_flags).

DATA INTEGRITY: every value comes from the real StatFin API. If the fetch fails
or returns unexpected data, this script aborts with a non-zero exit code rather
than writing any fabricated, estimated, or placeholder values.

Output: scripts/population_projection.json
Format: {"00100": 18.0, "33100": 20.7, ...}  (projected % change 2024 -> 2040)

Usage:
  python scripts/fetch_population_projection.py
  python scripts/fetch_population_projection.py --base-year 2024 --target-year 2040
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
OUTPUT_FILE = SCRIPT_DIR / "population_projection.json"

# StatFin PxWeb — Population projection 2024 (database vaenn, table 14wx).
PXWEB_TABLE_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/vaenn/14wx.px"
)

# Variable codes (from the table metadata).
VAR_AREA = "alue_23_20240101"   # Area: "SSS" (whole country) + "KU###" municipalities
VAR_YEAR = "timeperiod_y"       # Year: 2024..2045
VAR_SEX = "sukupuoli_9_20180101"  # Sex: SSS=Total
VAR_AGE = "ikaryhma_10_20180101"  # Age: SSS=Total
VAR_INFO = "contentscode"       # Information: vaesto_e24 = base projection 2024

CONTENT_BASE_PROJECTION = "vaesto_e24"  # base scenario (perusvaihtoehto), 31 Dec

DEFAULT_BASE_YEAR = "2024"
DEFAULT_TARGET_YEAR = "2040"

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


# ---------------------------------------------------------------------------
# Fetch municipal projected population from StatFin
# ---------------------------------------------------------------------------

def fetch_municipality_codes() -> list[str]:
    """GET the table metadata and return the municipality area codes (KU###)."""
    logger.info("Fetching projection metadata from %s", PXWEB_TABLE_URL)
    meta = _request_with_retry("GET", PXWEB_TABLE_URL, label="vaenn metadata").json()

    area_var = next((v for v in meta.get("variables", []) if v["code"] == VAR_AREA), None)
    if area_var is None:
        raise ValueError(f"Area variable '{VAR_AREA}' not found in metadata")

    muni_codes = [c for c in area_var["values"] if c.startswith("KU")]
    if not muni_codes:
        raise ValueError("No municipality (KU###) area codes found in metadata")

    logger.info("  Found %d municipality codes", len(muni_codes))
    return muni_codes


def fetch_projected_population(
    muni_codes: list[str], base_year: str, target_year: str,
) -> dict[str, dict[str, int]]:
    """POST a json-stat2 query for total projected population in base_year and
    target_year for every municipality.

    Returns: {kunta_code(3-digit): {"base": pop_base, "target": pop_target}}
    """
    query = {
        "query": [
            {"code": VAR_AREA, "selection": {"filter": "item", "values": muni_codes}},
            {"code": VAR_YEAR, "selection": {"filter": "item", "values": [base_year, target_year]}},
            {"code": VAR_SEX, "selection": {"filter": "item", "values": ["SSS"]}},
            {"code": VAR_AGE, "selection": {"filter": "item", "values": ["SSS"]}},
            {"code": VAR_INFO, "selection": {"filter": "item", "values": [CONTENT_BASE_PROJECTION]}},
        ],
        "response": {"format": "json-stat2"},
    }

    logger.info("  Querying projected population for %d municipalities (%s, %s)...",
                len(muni_codes), base_year, target_year)
    r = _request_with_retry("POST", PXWEB_TABLE_URL, label="vaenn data",
                            json=query, timeout=120)
    data = r.json()

    # Verify the response describes the base projection scenario we asked for.
    info_cat = data.get("dimension", {}).get(VAR_INFO, {}).get("category", {})
    info_labels = info_cat.get("label", {})
    if CONTENT_BASE_PROJECTION not in info_labels:
        raise ValueError(
            f"Response does not contain the base projection content code "
            f"'{CONTENT_BASE_PROJECTION}' (got {list(info_labels)})"
        )
    logger.info("  Content: %s = %r",
                CONTENT_BASE_PROJECTION, info_labels[CONTENT_BASE_PROJECTION])

    # Parse json-stat2. The value array is row-major over `id` dims in `size` order.
    dim_ids = data["id"]
    sizes = data["size"]
    values = data["value"]

    area_index = data["dimension"][VAR_AREA]["category"]["index"]   # {"KU047":0,...}
    year_index = data["dimension"][VAR_YEAR]["category"]["index"]    # {"2024":0,"2040":1}

    if base_year not in year_index or target_year not in year_index:
        raise ValueError(f"Requested years {base_year}/{target_year} not in response")

    # Build strides for row-major flattening.
    strides = [1] * len(sizes)
    for i in range(len(sizes) - 2, -1, -1):
        strides[i] = strides[i + 1] * sizes[i + 1]
    pos = {dim: idx for idx, dim in enumerate(dim_ids)}

    def value_at(area_code: str, year: str) -> int | None:
        flat = 0
        for dim in dim_ids:
            if dim == VAR_AREA:
                flat += area_index[area_code] * strides[pos[dim]]
            elif dim == VAR_YEAR:
                flat += year_index[year] * strides[pos[dim]]
            # Sex/Age/Info each have a single selected value at index 0.
        v = values[flat]
        return int(v) if isinstance(v, (int, float)) else None

    result: dict[str, dict[str, int]] = {}
    for area_code in area_index:
        kunta = area_code.replace("KU", "").strip().zfill(3)
        pop_base = value_at(area_code, base_year)
        pop_target = value_at(area_code, target_year)
        if pop_base is None or pop_target is None:
            logger.warning("  Missing population for %s (base=%s target=%s)",
                           area_code, pop_base, pop_target)
            continue
        result[kunta] = {"base": pop_base, "target": pop_target}

    logger.info("  Parsed projected population for %d municipalities", len(result))
    return result


def compute_growth_pct(
    pops: dict[str, dict[str, int]],
) -> dict[str, float]:
    """Compute projected % population change base_year -> target_year per kunta."""
    growth: dict[str, float] = {}
    for kunta, p in pops.items():
        base = p["base"]
        if base <= 0:
            logger.warning("  Skipping %s: non-positive base population %s", kunta, base)
            continue
        growth[kunta] = round((p["target"] - base) / base * 100.0, 1)
    return growth


# ---------------------------------------------------------------------------
# Assign municipality values to postal codes
# ---------------------------------------------------------------------------

def assign_to_postal_codes(muni_growth: dict[str, float]) -> dict[str, float]:
    """Assign each postal code its municipality's projected growth %."""
    logger.info("Loading GeoJSON from %s", GEOJSON_PATH)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)

    result: dict[str, float] = {}
    matched_munis: set[str] = set()
    for feat in geojson.get("features", []):
        props = feat.get("properties", {})
        pno = props.get("pno") or props.get("postinumeroalue")
        kunta = props.get("kunta")
        if not pno or kunta is None:
            continue
        kunta = str(kunta).zfill(3)
        val = muni_growth.get(kunta)
        if val is not None:
            result[str(pno)] = val
            matched_munis.add(kunta)

    logger.info("  Assigned projection to %d postal codes across %d municipalities",
                len(result), len(matched_munis))
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Fetch StatFin municipal population projection (CF-6)"
    )
    parser.add_argument("--base-year", default=DEFAULT_BASE_YEAR)
    parser.add_argument("--target-year", default=DEFAULT_TARGET_YEAR)
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("Population projection (Vaestoennuste 2024) data pipeline")
    logger.info("=" * 60)

    try:
        muni_codes = fetch_municipality_codes()
        pops = fetch_projected_population(muni_codes, args.base_year, args.target_year)
    except Exception as exc:
        logger.error("StatFin fetch failed: %s", exc)
        logger.error("Aborting WITHOUT writing — no fabricated data will be produced.")
        sys.exit(1)

    if len(pops) < 100:
        logger.error("Only %d municipalities fetched — too few, aborting.", len(pops))
        sys.exit(1)

    muni_growth = compute_growth_pct(pops)
    if not muni_growth:
        logger.error("No growth values computed — aborting without writing.")
        sys.exit(1)

    postal_values = assign_to_postal_codes(muni_growth)
    if not postal_values:
        logger.error("No postal code values produced — aborting without writing.")
        sys.exit(1)

    sorted_data = dict(sorted(postal_values.items()))
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted_data, f, indent=2, ensure_ascii=False)
    logger.info("Saved %d entries to %s (%s -> %s)",
                len(sorted_data), OUTPUT_FILE, args.base_year, args.target_year)

    vals = list(sorted_data.values())
    logger.info("  Range: min=%.1f max=%.1f mean=%.1f",
                min(vals), max(vals), sum(vals) / len(vals))

    # Sanity log: a few notable municipalities.
    samples = {
        "091": "Helsinki", "837": "Tampere", "564": "Oulu",
        "405": "Lappeenranta", "047": "Enontekio",
    }
    for code, name in samples.items():
        if code in muni_growth:
            logger.info("  %s (%s): %+.1f%%", name, code, muni_growth[code])


if __name__ == "__main__":
    main()
