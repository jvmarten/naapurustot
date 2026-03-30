#!/usr/bin/env python3
"""
Fetch broadband coverage data from Traficom and produce a postal code ->
broadband_coverage_pct mapping.

Data source: Traficom (Finnish Transport and Communications Agency)
  Fixed broadband availability by municipality (ODS spreadsheet)
  https://tieto.traficom.fi/en/statistics/fixed-broadband-availability

The ODS file contains the percentage of households with access to fixed
broadband at various speed tiers (>=30, >=100, >=300, >=1000 Mbit/s)
per municipality, reported twice yearly.

Method:
  1. Download the ODS file from Traficom's open data portal.
  2. Parse municipality-level coverage for >=100 Mbit/s.
  3. Map postal codes to municipalities using the GeoJSON (kunta field).
  4. Assign each postal code the coverage percentage of its municipality.

Output: scripts/broadband_coverage.json
Format: {"00100": 98.0, "00120": 98.0, ...}  (percentage 0-100)

Usage:
    python scripts/fetch_broadband_coverage.py
"""
from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import pandas as pd
import requests

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

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
OUTPUT_FILE = SCRIPT_DIR / "broadband_coverage.json"
CACHE_DIR = SCRIPT_DIR / "cache"

# Traficom ODS download URL — fixed broadband availability by municipality
# Source page: https://tieto.traficom.fi/en/statistics/fixed-broadband-availability
TRAFICOM_ODS_URL = (
    "https://tieto.traficom.fi/sites/default/files/media/file/"
    "Kiintean-verkon-laajakaistasaatavuus-Tillgang-till-fasta-natet.ods"
)

# Municipality codes per region (same as prepare_data.py)
HELSINKI_METRO_CODES = {"091", "049", "092", "235"}
TURKU_CODES = {"853", "202", "680", "529", "423", "704", "481", "577", "019"}
TAMPERE_CODES = {"837", "536", "980", "211", "418", "604", "562"}
ALL_MUNICIPALITY_CODES = HELSINKI_METRO_CODES | TURKU_CODES | TAMPERE_CODES

# Mapping from municipality name (Finnish) to municipality code.
# Only includes municipalities relevant to this project.
MUNICIPALITY_NAME_TO_CODE = {
    # Helsinki metro
    "Helsinki": "091",
    "Espoo": "049",
    "Vantaa": "092",
    "Kauniainen": "235",
    # Turku region
    "Turku": "853",
    "Kaarina": "202",
    "Raisio": "680",
    "Naantali": "529",
    "Lieto": "423",
    "Rusko": "704",
    "Masku": "481",
    "Paimio": "577",
    "Aura": "019",
    # Tampere region
    "Tampere": "837",
    "Nokia": "536",
    "Ylöjärvi": "980",
    "Kangasala": "211",
    "Lempäälä": "418",
    "Pirkkala": "604",
    "Orivesi": "562",
}

# The speed tier column index we want: >=100 Mbit/s (column index 4 in the ODS)
# Column layout (0-indexed): FIN name, SVE name, ENG name, >=30, >=100, >=300, >=1000
SPEED_100_COL_INDEX = 4

# Retry settings
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2
RATE_LIMIT_DELAY = 1.0


# ---------------------------------------------------------------------------
# Cache helpers (same pattern as other scripts)
# ---------------------------------------------------------------------------

def _cache_path(key: str) -> Path:
    """Return the cache file path for a given key."""
    safe = key.replace("/", "_").replace(":", "_").replace("?", "_").replace("&", "_")
    return CACHE_DIR / f"{safe}.json"


def _save_cache(key: str, data):
    """Save data to the cache directory."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(key)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info("  Cached response -> %s", path.name)


def _load_cache(key: str):
    """Load data from cache. Returns None if not found."""
    path = _cache_path(key)
    if path.exists():
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        logger.info("  Loaded from cache: %s", path.name)
        return data
    return None


# ---------------------------------------------------------------------------
# HTTP helpers with retry logic
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
    raise last_exc  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Download and parse Traficom ODS file
# ---------------------------------------------------------------------------

def download_traficom_ods() -> bytes:
    """Download the Traficom ODS broadband availability file.

    Returns the raw bytes of the ODS file.
    """
    logger.info("Downloading Traficom broadband ODS from %s", TRAFICOM_ODS_URL)
    r = _request_with_retry("GET", TRAFICOM_ODS_URL, label="Traficom ODS download")
    logger.info("  Downloaded %d bytes", len(r.content))
    return r.content


def parse_municipality_coverage(ods_bytes: bytes) -> dict[str, float]:
    """Parse the Traficom ODS file and extract >=100 Mbit/s coverage by municipality.

    The ODS file structure:
      Row 0: Title (Kiinteän verkon laajakaistasaatavuus ...)
      Row 1: Subtitle (Prosenttia kotitalouksista ...)
      Row 2: Country-level header (FIN, SVE, ENG, speed tiers)
      Row 3: Country-level data (Suomi, Finland, Finland, values)
      Row 4: Province-level header
      Rows 5-23: Province data
      Row 24: Municipality-level header (Kunnat, Kommuner, Municipalities, ...)
      Rows 25+: Municipality data

    Returns:
        {municipality_code: coverage_pct (0-100), ...}
    """
    import io

    logger.info("Parsing ODS file for municipality-level broadband coverage...")

    df = pd.read_excel(io.BytesIO(ods_bytes), engine="odf", header=None)
    logger.info("  ODS has %d rows, %d columns", df.shape[0], df.shape[1])

    # Find the municipality data section.
    # Look for the row with "Kunnat" / "Municipalities" as the section header.
    muni_start_row = None
    for i in range(len(df)):
        cell = str(df.iloc[i, 0]).strip()
        if cell.lower() in ("kunnat", "municipalities"):
            muni_start_row = i + 1
            break

    if muni_start_row is None:
        logger.error("Could not find municipality section header ('Kunnat') in ODS")
        return {}

    logger.info("  Municipality data starts at row %d", muni_start_row)

    # Verify the speed column header
    header_row = muni_start_row - 1
    speed_header = str(df.iloc[header_row, SPEED_100_COL_INDEX]).strip()
    logger.info("  Speed tier column header: '%s'", speed_header)
    if "100" not in speed_header:
        logger.warning(
            "  Expected '>=100 Mbit/s' column at index %d, got '%s'. "
            "Attempting to find correct column...",
            SPEED_100_COL_INDEX, speed_header,
        )
        # Try to find the correct column
        found = False
        for col in range(3, df.shape[1]):
            h = str(df.iloc[header_row, col]).strip()
            if "100" in h:
                logger.info("  Found >=100 Mbit/s column at index %d: '%s'", col, h)
                actual_speed_col = col
                found = True
                break
        if not found:
            logger.error("  Could not find >=100 Mbit/s column in ODS")
            return {}
    else:
        actual_speed_col = SPEED_100_COL_INDEX

    # Parse municipality rows
    coverage_by_code: dict[str, float] = {}
    unmatched_names: list[str] = []

    for i in range(muni_start_row, len(df)):
        fin_name = str(df.iloc[i, 0]).strip()
        if not fin_name or fin_name == "nan":
            continue

        # Read the coverage value
        raw_val = df.iloc[i, actual_speed_col]
        if pd.isna(raw_val):
            continue

        try:
            coverage_fraction = float(raw_val)
        except (ValueError, TypeError):
            continue

        # Convert from fraction (0.0-1.0) to percentage (0-100)
        coverage_pct = round(coverage_fraction * 100, 1)

        # Look up municipality code
        muni_code = MUNICIPALITY_NAME_TO_CODE.get(fin_name)
        if muni_code is not None:
            coverage_by_code[muni_code] = coverage_pct
            logger.info(
                "  %s (code %s): %.1f%% coverage (>=100 Mbit/s)",
                fin_name, muni_code, coverage_pct,
            )
        else:
            unmatched_names.append(fin_name)

    logger.info(
        "  Parsed %d target municipalities, %d other municipalities skipped",
        len(coverage_by_code), len(unmatched_names),
    )

    # Check which target municipalities we missed
    found_codes = set(coverage_by_code.keys())
    missing_codes = ALL_MUNICIPALITY_CODES - found_codes
    if missing_codes:
        logger.warning(
            "  Missing coverage data for municipality codes: %s",
            sorted(missing_codes),
        )

    return coverage_by_code


# ---------------------------------------------------------------------------
# Map municipality coverage to postal codes
# ---------------------------------------------------------------------------

def load_postal_code_municipalities() -> list[dict]:
    """Load postal code -> municipality mapping from the GeoJSON.

    Returns list of {pno, kunta} dicts.
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
        if pno and kunta:
            records.append({"pno": str(pno), "kunta": str(kunta)})

    logger.info("  Extracted %d postal code -> municipality mappings", len(records))
    return records


def map_to_postal_codes(
    coverage_by_muni: dict[str, float],
    postal_records: list[dict],
) -> dict[str, float]:
    """Map municipality-level broadband coverage to postal codes.

    Each postal code gets its municipality's coverage percentage.

    Args:
        coverage_by_muni: {municipality_code: coverage_pct}
        postal_records: [{pno, kunta}, ...]

    Returns:
        {postal_code: coverage_pct}
    """
    logger.info("Mapping municipality coverage to postal codes...")

    result: dict[str, float] = {}
    matched = 0
    unmatched = 0

    for rec in postal_records:
        pno = rec["pno"]
        kunta = rec["kunta"]
        coverage = coverage_by_muni.get(kunta)
        if coverage is not None:
            result[pno] = coverage
            matched += 1
        else:
            unmatched += 1

    logger.info(
        "  Mapped %d postal codes (%d without coverage data)",
        matched, unmatched,
    )

    return result


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def main():
    logger.info("=" * 60)
    logger.info("Broadband coverage data pipeline")
    logger.info("Source: Traficom fixed broadband availability")
    logger.info("=" * 60)

    # Validate GeoJSON exists
    if not GEOJSON_PATH.exists():
        logger.error("GeoJSON not found at %s", GEOJSON_PATH)
        sys.exit(1)

    # Step 1: Download ODS from Traficom (with cache fallback)
    cache_key = "traficom_broadband_coverage"
    coverage_by_muni: dict[str, float] | None = None

    try:
        ods_bytes = download_traficom_ods()
        coverage_by_muni = parse_municipality_coverage(ods_bytes)
        if coverage_by_muni:
            _save_cache(cache_key, coverage_by_muni)
    except Exception as e:
        logger.warning("Failed to download/parse Traficom ODS: %s", e)

    # Try cache if download failed
    if not coverage_by_muni:
        logger.warning("Attempting to load from cache...")
        cached = _load_cache(cache_key)
        if cached is not None:
            coverage_by_muni = cached
        else:
            logger.error(
                "No broadband coverage data available (download failed "
                "and no cache). Exiting."
            )
            sys.exit(1)

    if not coverage_by_muni:
        logger.error("No municipality coverage data parsed. Exiting.")
        sys.exit(1)

    # Step 2: Load postal code -> municipality mapping from GeoJSON
    postal_records = load_postal_code_municipalities()
    if not postal_records:
        logger.error("No postal code records found in GeoJSON. Exiting.")
        sys.exit(1)

    # Step 3: Map to postal codes
    postal_coverage = map_to_postal_codes(coverage_by_muni, postal_records)
    if not postal_coverage:
        logger.error("No postal code coverage data produced. Exiting.")
        sys.exit(1)

    # Step 4: Save results
    logger.info("Saving results to %s", OUTPUT_FILE)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(postal_coverage, f, indent=2, sort_keys=True)

    logger.info("Done! %d postal codes with broadband coverage data.", len(postal_coverage))

    # Print summary statistics
    values = list(postal_coverage.values())
    if values:
        logger.info("  Min: %.1f%%", min(values))
        logger.info("  Max: %.1f%%", max(values))
        logger.info("  Mean: %.1f%%", sum(values) / len(values))
        sorted_vals = sorted(values)
        logger.info("  Median: %.1f%%", sorted_vals[len(sorted_vals) // 2])

        # Per-municipality summary
        logger.info("  Per-municipality breakdown:")
        for code in sorted(coverage_by_muni.keys()):
            # Reverse-lookup the name
            name = next(
                (n for n, c in MUNICIPALITY_NAME_TO_CODE.items() if c == code),
                code,
            )
            pct = coverage_by_muni[code]
            count = sum(1 for r in postal_records if r["kunta"] == code)
            logger.info("    %s (%s): %.1f%% (%d postal codes)", name, code, pct, count)


if __name__ == "__main__":
    main()
