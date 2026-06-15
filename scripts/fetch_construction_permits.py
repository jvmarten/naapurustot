#!/usr/bin/env python3
"""
CF-11: Fetch official municipal new-dwelling construction counts and compute a
forward-looking "construction activity" FLOW rate (new dwellings per 1,000
residents) per municipality, then assign each postal code its municipality's
value. This is the national counterpart to the participating-cities-only planning
data — it gives EVERY postal-code area a real building-activity signal.

Data source: Tilastokeskus (Statistics Finland) StatFin PxWeb API
  Statistic: Rakennus- ja asuntotuotanto / Rakennuskanta ja uudistuotanto
  Database:  raku ("Building stock and new production")
  Table:     15f6 -- "Dwellings by Region, Year of construction, Type of
             building, Dwelling occupancy, Year and Information" (CC BY 4.0,
             municipal granularity, latest reference year)
  URL:       https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/raku/15f6.px

Why this table (data-availability note): StatFin's dedicated construction-FLOW
tables — the "Building and dwelling production" monthly series (ras/12fy in the
StatFin_Passiivi archive, and raku/156f in the live database) — publish granted
permits / completed dwellings only at maakunta (20-region) granularity. The ONLY
municipal-granularity construction data StatFin exposes is the year-of-construction
breakdown of the current dwelling stock (this table, raku/15f6). Its most recent
year-of-construction bucket, "2020 -", is the count of dwellings in the latest
reference-year stock that were completed from 2020 onwards — i.e. the recent
new-dwelling FLOW per municipality. Choosing the municipal table over the coarser
maakunta flow honours the project's data-granularity rule (postal/municipal is
preferred over a 20-region figure).

Method:
  1. GET the table metadata to discover the municipality area codes
     (alue_23_YYYYMMDD values of the form "KU091" etc.).
  2. POST a json-stat2 query for the number of dwellings whose year of
     construction is the latest "2020 -" bucket, totalled over all building types
     and occupancy statuses, in the latest reference year, per municipality.
  3. rate = new_dwellings / municipal_population * 1000 per municipality. The
     municipal population denominator is he_vakiy (Tilastokeskus Paavo population)
     summed per municipality from the GeoJSON the app already ships — internally
     consistent with every other per-capita figure on the map.
  4. Assign each postal code its municipality's construction-activity rate.

Because the postal-code values are a municipality figure assigned to a finer
granularity than the source publishes, construction_activity is flagged
is_proxy:true in src/data/data_sources.json and listed in
MUNICIPALITY_DISTRIBUTED_PROXIES in scripts/validate_data.py (enforced by
validate_data.py check_distributed_proxy_flags).

DATA INTEGRITY: every value comes from the real StatFin API. If the fetch fails
or returns unexpected data, this script aborts with a non-zero exit code rather
than writing any fabricated, estimated, or placeholder values.

Output: scripts/construction_activity.json
Format: {"00100": 50.4, "33100": 69.0, ...}  (new dwellings 2020- per 1,000 res.)

Usage:
  python scripts/fetch_construction_permits.py
"""

import argparse
import json
import logging
import sys
import time
from collections import defaultdict
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
OUTPUT_FILE = SCRIPT_DIR / "construction_activity.json"

# StatFin PxWeb — Building stock and new production (database raku, table 15f6).
PXWEB_TABLE_URL = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/raku/15f6.px"

# Variable codes are date-suffixed in the metadata (e.g. alue_23_20260101); we
# resolve them by stable prefix so the script survives the annual code rotation.
AREA_PREFIX = "alue"               # Area: "SSS" (whole country) + "KU###" municipalities
YOC_PREFIX = "rak_valm_v"          # Year of construction (10-class)
BTYPE_PREFIX = "talotyyppi"        # Type of building (Total = SSS)
OCC_PREFIX = "asunnon_kaytolo"     # Dwelling occupancy (All = SSS)
VAR_YEAR = "timeperiod_y"          # Reference year (single, latest)
VAR_INFO = "contentscode"          # Information: asunto_lkm = number of dwellings

# Most recent year-of-construction bucket = dwellings completed from 2020 onward.
RECENT_YOC_VALUE = "2020 -"
CONTENT_DWELLINGS = "asunto_lkm"
TOTAL = "SSS"

POPULATION_FIELD = "he_vakiy"      # Paavo population per postal code

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
# Fetch municipal new-dwelling counts from StatFin
# ---------------------------------------------------------------------------

def fetch_new_dwellings() -> tuple[dict[str, int], str]:
    """Fetch the count of dwellings completed in the latest year-of-construction
    bucket ("2020 -") per municipality.

    Returns: ({kunta_code(3-digit): new_dwelling_count}, reference_year)
    """
    logger.info("Fetching construction metadata from %s", PXWEB_TABLE_URL)
    meta = _request_with_retry("GET", PXWEB_TABLE_URL, label="raku metadata").json()
    logger.info("  Table: %s", meta.get("title"))

    area_var = _resolve_var(meta, AREA_PREFIX)
    yoc_var = _resolve_var(meta, YOC_PREFIX)
    btype_var = _resolve_var(meta, BTYPE_PREFIX)
    occ_var = _resolve_var(meta, OCC_PREFIX)

    muni_codes = [c for c in area_var["values"] if c.startswith("KU")]
    if not muni_codes:
        raise ValueError("No municipality (KU###) area codes found in metadata")
    logger.info("  Found %d municipality codes", len(muni_codes))

    if RECENT_YOC_VALUE not in yoc_var["values"]:
        raise ValueError(
            f"Year-of-construction bucket {RECENT_YOC_VALUE!r} not in metadata "
            f"(got {yoc_var['values']})"
        )

    # Latest reference year available in the table.
    year_var = next(v for v in meta["variables"] if v["code"] == VAR_YEAR)
    ref_year = year_var["values"][-1]
    logger.info("  Reference year: %s | YOC bucket: %r", ref_year, RECENT_YOC_VALUE)

    query = {
        "query": [
            {"code": area_var["code"], "selection": {"filter": "item", "values": muni_codes}},
            {"code": yoc_var["code"], "selection": {"filter": "item", "values": [RECENT_YOC_VALUE]}},
            {"code": btype_var["code"], "selection": {"filter": "item", "values": [TOTAL]}},
            {"code": occ_var["code"], "selection": {"filter": "item", "values": [TOTAL]}},
            {"code": VAR_YEAR, "selection": {"filter": "item", "values": [ref_year]}},
            {"code": VAR_INFO, "selection": {"filter": "item", "values": [CONTENT_DWELLINGS]}},
        ],
        "response": {"format": "json-stat2"},
    }

    logger.info("  Querying new dwellings for %d municipalities...", len(muni_codes))
    r = _request_with_retry("POST", PXWEB_TABLE_URL, label="raku data",
                            json=query, timeout=120)
    data = r.json()

    # Verify the response describes the content + bucket we asked for.
    info_cat = data.get("dimension", {}).get(VAR_INFO, {}).get("category", {})
    if CONTENT_DWELLINGS not in info_cat.get("label", {}):
        raise ValueError(
            f"Response does not contain content code {CONTENT_DWELLINGS!r} "
            f"(got {list(info_cat.get('label', {}))})"
        )

    area_index = data["dimension"][area_var["code"]]["category"]["index"]
    values = data["value"]
    if len(values) != len(area_index):
        raise ValueError(
            f"Expected one value per municipality ({len(area_index)}), "
            f"got {len(values)} values"
        )

    result: dict[str, int] = {}
    for area_code, pos in area_index.items():
        if not area_code.startswith("KU"):
            continue
        kunta = area_code.replace("KU", "").strip().zfill(3)
        v = values[pos]
        if isinstance(v, (int, float)):
            result[kunta] = int(v)
        else:
            logger.warning("  Missing dwelling count for %s", area_code)

    logger.info("  Parsed new-dwelling counts for %d municipalities", len(result))
    return result, str(ref_year)


# ---------------------------------------------------------------------------
# Municipal population denominator (from the GeoJSON the app ships)
# ---------------------------------------------------------------------------

def load_municipal_population(geojson: dict) -> dict[str, float]:
    """Sum he_vakiy (Paavo population) per municipality from the GeoJSON."""
    pop: dict[str, float] = defaultdict(float)
    for feat in geojson.get("features", []):
        props = feat.get("properties", {})
        kunta = props.get("kunta")
        vakiy = props.get(POPULATION_FIELD)
        if kunta is not None and isinstance(vakiy, (int, float)):
            pop[str(kunta).zfill(3)] += vakiy
    logger.info("  Municipal population summed for %d municipalities", len(pop))
    return dict(pop)


def compute_activity_rate(
    new_dwellings: dict[str, int], population: dict[str, float],
) -> dict[str, float]:
    """new dwellings per 1,000 residents per municipality."""
    rates: dict[str, float] = {}
    for kunta, count in new_dwellings.items():
        pop = population.get(kunta, 0.0)
        if pop <= 0:
            logger.warning("  Skipping %s: non-positive population %s", kunta, pop)
            continue
        rates[kunta] = round(count / pop * 1000.0, 1)
    return rates


# ---------------------------------------------------------------------------
# Assign municipality values to postal codes
# ---------------------------------------------------------------------------

def assign_to_postal_codes(
    geojson: dict, muni_rate: dict[str, float],
) -> dict[str, float]:
    """Assign each postal code its municipality's construction-activity rate."""
    result: dict[str, float] = {}
    matched_munis: set[str] = set()
    for feat in geojson.get("features", []):
        props = feat.get("properties", {})
        pno = props.get("pno") or props.get("postinumeroalue")
        kunta = props.get("kunta")
        if not pno or kunta is None:
            continue
        kunta = str(kunta).zfill(3)
        val = muni_rate.get(kunta)
        if val is not None:
            result[str(pno)] = val
            matched_munis.add(kunta)

    logger.info("  Assigned construction activity to %d postal codes across %d municipalities",
                len(result), len(matched_munis))
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Fetch StatFin municipal construction activity (CF-11)"
    )
    parser.parse_args()

    logger.info("=" * 60)
    logger.info("Construction activity (Rakennus- ja asuntotuotanto) pipeline")
    logger.info("=" * 60)

    try:
        new_dwellings, ref_year = fetch_new_dwellings()
    except Exception as exc:
        logger.error("StatFin fetch failed: %s", exc)
        logger.error("Aborting WITHOUT writing — no fabricated data will be produced.")
        sys.exit(1)

    if len(new_dwellings) < 100:
        logger.error("Only %d municipalities fetched — too few, aborting.", len(new_dwellings))
        sys.exit(1)

    logger.info("Loading GeoJSON from %s", GEOJSON_PATH)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)

    population = load_municipal_population(geojson)
    if not population:
        logger.error("No municipal population computed — aborting without writing.")
        sys.exit(1)

    muni_rate = compute_activity_rate(new_dwellings, population)
    if not muni_rate:
        logger.error("No activity rates computed — aborting without writing.")
        sys.exit(1)

    postal_values = assign_to_postal_codes(geojson, muni_rate)
    if not postal_values:
        logger.error("No postal code values produced — aborting without writing.")
        sys.exit(1)

    sorted_data = dict(sorted(postal_values.items()))
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted_data, f, indent=2, ensure_ascii=False)
    logger.info("Saved %d entries to %s (reference year %s, YOC %s)",
                len(sorted_data), OUTPUT_FILE, ref_year, RECENT_YOC_VALUE)

    vals = list(sorted_data.values())
    logger.info("  Range: min=%.1f max=%.1f mean=%.1f",
                min(vals), max(vals), sum(vals) / len(vals))

    # Sanity log: a few notable municipalities (real values).
    samples = {
        "091": "Helsinki", "049": "Espoo", "837": "Tampere", "564": "Oulu",
        "853": "Turku", "405": "Lappeenranta", "047": "Enontekio",
    }
    for code, name in samples.items():
        if code in muni_rate:
            logger.info("  %s (%s): %.1f new dwellings / 1000 res. (%d dwellings 2020-)",
                        name, code, muni_rate[code], new_dwellings.get(code, 0))


if __name__ == "__main__":
    main()
