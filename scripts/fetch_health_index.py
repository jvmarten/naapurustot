#!/usr/bin/env python3
"""
Fetch the THL/Kela standardized morbidity index ("Sairastavuusindeksi", part of
the Kansallinen terveysindeksi family) by municipality and write
scripts/health_index.json keyed by postal code.

Data source: Sotkanet REST API (THL), CC BY 4.0
  Indicator 5641 — "Sairastavuusindeksi, ikävakioitu" (age-standardized
  morbidity index; 100 = national average, higher = more morbidity).
  We deliberately use 5641 (current Kansallinen terveysindeksi, returns ~300
  municipality rows for 2023) and NOT the legacy indicator 244, which is frozen
  at 2019.

Method:
  1. GET /rest/1.1/regions to map Sotkanet region ids -> Finnish municipality
     codes (category == "KUNTA"; field `code` is the kunta code e.g. "091").
  2. GET /rest/1.1/json?indicator=5641&years=<year>&genders=total for the latest
     available year, mapping each row's `region` id -> municipality code -> value.
  3. Load postal code areas from the GeoJSON (pno -> kunta) and assign each postal
     code its municipality's morbidity index.

Because each postal code carries its municipality figure distributed to a finer
granularity than the source publishes, health_index is flagged is_proxy:true in
src/data/data_sources.json (enforced by validate_data.py) and added to
MUNICIPALITY_DISTRIBUTED_PROXIES.

Output: scripts/health_index.json   {"00100": 88.4, "33100": 101.2, ...}

Usage:
  python scripts/fetch_health_index.py
"""

import json
import logging
import time
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_FILE = SCRIPT_DIR / "health_index.json"

SOTKANET_BASE = "https://sotkanet.fi/rest/1.1"
INDICATOR = 5641  # Sairastavuusindeksi (Kansallinen terveysindeksi)
PREFERRED_YEARS = [2023, 2022, 2021, 2020]

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2

# Sotkanet rejects the default python-requests User-Agent with HTTP 403.
HEADERS = {"User-Agent": "naapurustot-data-pipeline/1.0 (+https://naapurustot.fi)"}


def _request_with_retry(method: str, url: str, *, label: str,
                        retries: int = MAX_RETRIES, **kwargs):
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


def fetch_region_to_municipality() -> dict[int, str]:
    """Map Sotkanet region id -> Finnish municipality code (KUNTA category)."""
    logger.info("Fetching Sotkanet region catalogue...")
    r = _request_with_retry("GET", f"{SOTKANET_BASE}/regions", label="sotkanet regions")
    regions = r.json()
    mapping: dict[int, str] = {}
    for reg in regions:
        if reg.get("category") == "KUNTA":
            code = str(reg.get("code", "")).zfill(3)
            rid = reg.get("id")
            if rid is not None and code:
                mapping[int(rid)] = code
    logger.info("  Mapped %d municipalities", len(mapping))
    return mapping


def fetch_municipality_values(region_to_muni: dict[int, str]) -> tuple[dict[str, float], int]:
    """Fetch morbidity index per municipality for the latest available year.

    Returns ({municipality_code: value}, year_used).
    """
    for year in PREFERRED_YEARS:
        url = f"{SOTKANET_BASE}/json?indicator={INDICATOR}&years={year}&genders=total"
        logger.info("Fetching indicator %d for year %d...", INDICATOR, year)
        try:
            r = _request_with_retry("GET", url, label=f"sotkanet {INDICATOR}/{year}")
            rows = r.json()
        except Exception as e:  # noqa: BLE001
            logger.warning("  Year %d failed: %s", year, e)
            continue
        if not rows:
            logger.info("  No data for year %d, trying earlier", year)
            continue
        result: dict[str, float] = {}
        for row in rows:
            rid = row.get("region")
            val = row.get("value")
            muni = region_to_muni.get(int(rid)) if rid is not None else None
            if muni and val is not None:
                try:
                    result[muni] = float(val)
                except (ValueError, TypeError):
                    pass
        if result:
            logger.info("  Got %d municipality values for year %d", len(result), year)
            return result, year
    raise RuntimeError(f"No Sotkanet data for indicator {INDICATOR} in any of {PREFERRED_YEARS}")


def assign_to_postal_codes(muni_values: dict[str, float]) -> dict[str, float]:
    """Assign each postal code its municipality's morbidity index."""
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
        val = muni_values.get(kunta)
        if val is not None:
            result[str(pno)] = round(val, 1)
            matched_munis.add(kunta)

    logger.info("  Assigned health index to %d postal codes across %d municipalities",
                len(result), len(matched_munis))
    return result


def main():
    logger.info("=" * 60)
    logger.info("Health index (THL/Kela morbidity) data pipeline")
    logger.info("=" * 60)

    region_to_muni = fetch_region_to_municipality()
    muni_values, year = fetch_municipality_values(region_to_muni)
    postal_values = assign_to_postal_codes(muni_values)

    if not postal_values:
        raise SystemExit("No postal code values produced — aborting without writing.")

    sorted_data = dict(sorted(postal_values.items()))
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted_data, f, indent=2, ensure_ascii=False)
    logger.info("Saved %d entries to %s (year %d)", len(sorted_data), OUTPUT_FILE, year)

    vals = list(sorted_data.values())
    logger.info("  Range: min=%.1f max=%.1f mean=%.1f",
                min(vals), max(vals), sum(vals) / len(vals))


if __name__ == "__main__":
    main()
