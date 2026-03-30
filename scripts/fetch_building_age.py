#!/usr/bin/env python3
"""
Fetch building stock age data from Statistics Finland and compute an estimated
average construction year per postal code.

Data source: Statistics Finland PxWeb API
  Table: statfin_raku_pxt_116g.px (Building stock by municipality,
         construction decade, building type)

Method:
  1. Fetch municipality-level building stock data (count of buildings by
     construction decade) from Statistics Finland PxWeb API.
  2. Compute per-municipality weighted average construction year using
     decade midpoints.
  3. Load existing GeoJSON to map postal codes -> municipalities (kunta field).
  4. Refine postal-code estimates using Paavo dwelling data:
     - ra_raky / ra_asunn (under-construction share => "newness" signal)
     - ra_pt_as / ra_asunn (detached house share => 1970s-90s suburban signal)

Output: scripts/building_age.json
Format: {"00100": 1972, "00120": 1965, ...}  (estimated avg construction year)
"""

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

OUT_DIR = Path(__file__).parent
GEOJSON_PATH = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_FILE = OUT_DIR / "building_age.json"
CACHE_DIR = OUT_DIR / "cache"

# PxWeb table URL — building stock by municipality, construction decade, type
PXWEB_TABLE_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/raku/statfin_raku_pxt_116g.px"
)

# Fallback table URL if primary does not work
PXWEB_TABLE_URL_ALT = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/raku/statfin_raku_pxt_15f6.px"
)

# Municipality codes by region
HELSINKI_METRO_CODES = {"091", "049", "092", "235"}
TURKU_CODES = {"853", "202", "680", "529", "423", "704", "481", "577", "019"}
TAMPERE_CODES = {"837", "536", "980", "211", "418", "604", "562"}
ALL_MUNICIPALITY_CODES = HELSINKI_METRO_CODES | TURKU_CODES | TAMPERE_CODES

# PxWeb municipality code format: "KU091", "KU049", etc.
PXWEB_MUNICIPALITY_CODES = [f"KU{code}" for code in sorted(ALL_MUNICIPALITY_CODES)]

# Decade midpoints for weighted average construction year
DECADE_MIDPOINTS = {
    # English labels (what we expect from the EN endpoint)
    "-1920": 1900,
    "Before 1920": 1900,
    "- 1920": 1900,
    "-  1920": 1900,
    "1921 - 1939": 1930,
    "1921-1939": 1930,
    "1921 -1939": 1930,
    "1940 - 1959": 1950,
    "1940-1959": 1950,
    "1940 -1959": 1950,
    "1960 - 1969": 1965,
    "1960-1969": 1965,
    "1960 -1969": 1965,
    "1970 - 1979": 1975,
    "1970-1979": 1975,
    "1970 -1979": 1975,
    "1980 - 1989": 1985,
    "1980-1989": 1985,
    "1980 -1989": 1985,
    "1990 - 1999": 1995,
    "1990-1999": 1995,
    "1990 -1999": 1995,
    "2000 - 2009": 2005,
    "2000-2009": 2005,
    "2000 -2009": 2005,
    "2010 - 2019": 2015,
    "2010-2019": 2015,
    "2010 -2019": 2015,
    "2020 -": 2022,
    "2020-": 2022,
    "2020 - ": 2022,
    # Finnish labels (fallback)
    "Ennen 1920": 1900,
    "ennen 1920": 1900,
}

# Retry settings
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2
RATE_LIMIT_DELAY = 1.0


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _cache_path(key: str) -> Path:
    safe = key.replace("/", "_").replace(":", "_").replace("?", "_").replace("&", "_")
    return CACHE_DIR / f"{safe}.json"


def _save_cache(key: str, data):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(key)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    logger.info("  Cached response -> %s", path.name)


def _load_cache(key: str):
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


def _rate_limit():
    """Sleep briefly between API calls."""
    time.sleep(RATE_LIMIT_DELAY)


# ---------------------------------------------------------------------------
# PxWeb metadata & data validation
# ---------------------------------------------------------------------------

def _validate_pxweb_meta(data: dict, label: str) -> list:
    """Validate PxWeb metadata response has a variables list."""
    if not isinstance(data, dict):
        raise ValueError(f"{label}: expected JSON object, got {type(data).__name__}")
    variables = data.get("variables")
    if not isinstance(variables, list) or len(variables) == 0:
        raise ValueError(f"{label}: missing or empty 'variables'")
    return variables


def _validate_pxweb_data(data: dict, label: str) -> tuple:
    """Validate PxWeb data response has columns and data rows."""
    if not isinstance(data, dict):
        raise ValueError(f"{label}: expected JSON object, got {type(data).__name__}")
    columns = data.get("columns")
    rows = data.get("data")
    if not isinstance(columns, list):
        raise ValueError(f"{label}: missing 'columns'")
    if not isinstance(rows, list):
        raise ValueError(f"{label}: missing 'data'")
    return columns, rows


# ---------------------------------------------------------------------------
# Decade label matching
# ---------------------------------------------------------------------------

def _match_decade_midpoint(label: str) -> int | None:
    """Match a decade label string to its midpoint year.

    Tries exact match first, then normalized match (strip whitespace),
    then pattern-based matching for common variations.
    """
    # Exact match
    if label in DECADE_MIDPOINTS:
        return DECADE_MIDPOINTS[label]

    # Strip and normalize whitespace
    stripped = " ".join(label.split())
    if stripped in DECADE_MIDPOINTS:
        return DECADE_MIDPOINTS[stripped]

    # Try extracting decade ranges from the string
    import re

    # Pattern: "YYYY - YYYY" or "YYYY-YYYY"
    m = re.match(r"(\d{4})\s*[-\u2013]\s*(\d{4})", stripped)
    if m:
        start, end = int(m.group(1)), int(m.group(2))
        return (start + end) // 2

    # Pattern: "- YYYY" or "Before YYYY" (early construction)
    m = re.match(r"(?:-|before|ennen)\s*(\d{4})", stripped, re.IGNORECASE)
    if m:
        year = int(m.group(1))
        # Midpoint assumption: 20 years before the cutoff
        return year - 20

    # Pattern: "YYYY -" or "YYYY-" (open-ended recent)
    m = re.match(r"(\d{4})\s*[-\u2013]\s*$", stripped)
    if m:
        return 2022  # Current-era midpoint

    # "Total" or "SSS" — skip these
    if stripped.lower() in ("total", "yhteensä", "sss", "all"):
        return None

    logger.warning("  Unrecognized decade label: '%s'", label)
    return None


# ---------------------------------------------------------------------------
# Core: Fetch building stock data from PxWeb
# ---------------------------------------------------------------------------

def fetch_building_stock_metadata(table_url: str) -> tuple:
    """Fetch and return PxWeb table metadata (variables).

    Returns (variables, effective_url) or raises on failure.
    """
    logger.info("Fetching PxWeb metadata from %s", table_url)
    meta_r = _request_with_retry("GET", table_url, label="building stock metadata")
    meta = meta_r.json()
    variables = _validate_pxweb_meta(meta, "building stock metadata")
    return variables, table_url


def fetch_building_stock_data(table_url: str, variables: list) -> dict:
    """Build and execute the PxWeb query for building stock by municipality
    and construction decade.

    Returns: {municipality_code: {decade_label: building_count, ...}, ...}
    """
    logger.info("Building PxWeb query for building stock data...")

    # Log available variables for debugging
    for var in variables:
        logger.info(
            "  Variable: code=%s, text=%s, values_count=%d",
            var.get("code"), var.get("text"), len(var.get("values", [])),
        )

    query_items = []
    municipality_var_idx = None
    decade_var_idx = None

    for i, var in enumerate(variables):
        code = var["code"]
        values = var["values"]
        value_texts = var.get("valueTexts", values)
        code_lower = code.lower()
        text_lower = var.get("text", "").lower()

        # Municipality / area variable
        if code_lower in ("alue", "area", "kunta", "municipality") or \
           "kunta" in text_lower or "municipality" in text_lower or "area" in text_lower:
            # Select only our municipalities
            available = set(values)
            selected = [c for c in PXWEB_MUNICIPALITY_CODES if c in available]
            if not selected:
                # Try without KU prefix
                selected = [c for c in sorted(ALL_MUNICIPALITY_CODES) if c in available]
            if not selected:
                logger.warning(
                    "  No matching municipality codes found in variable '%s'. "
                    "Available sample: %s", code, values[:10],
                )
                # Fallback: select all
                selected = values
            logger.info("  Municipality variable '%s': selected %d codes", code, len(selected))
            query_items.append({
                "code": code,
                "selection": {"filter": "item", "values": selected},
            })
            municipality_var_idx = i

        # Construction decade / year of construction variable
        elif code_lower in ("rakennusvuosi", "construction year",
                            "rakennusvuosikymmen", "construction decade",
                            "valmistumisvuosi") or \
             "vuosikymmen" in text_lower or "decade" in text_lower or \
             "construction" in text_lower or "rakennusvuosi" in text_lower or \
             "year of construction" in text_lower or "valmistumis" in text_lower:
            # Select all decades (we want the full distribution)
            query_items.append({
                "code": code,
                "selection": {"filter": "all", "values": ["*"]},
            })
            decade_var_idx = i
            logger.info(
                "  Decade variable '%s': selecting all (%d values)",
                code, len(values),
            )
            # Log the decade value texts for debugging
            for v, t in zip(values[:15], value_texts[:15]):
                logger.info("    %s => %s", v, t)

        # Building type variable — select total/all
        elif code_lower in ("talotyyppi", "building type", "rakennustyyppi",
                            "type of building") or \
             "talotyyppi" in text_lower or "building type" in text_lower or \
             "rakennustyyppi" in text_lower:
            # Look for "Total" or "SSS" (all building types combined)
            total_vals = [v for v, t in zip(values, value_texts)
                         if t.lower() in ("total", "yhteensä", "all") or v == "SSS"]
            if total_vals:
                query_items.append({
                    "code": code,
                    "selection": {"filter": "item", "values": total_vals},
                })
                logger.info("  Building type variable '%s': selected total '%s'", code, total_vals)
            else:
                # If no total, select all and we'll sum later
                query_items.append({
                    "code": code,
                    "selection": {"filter": "all", "values": ["*"]},
                })
                logger.info("  Building type variable '%s': no total found, selecting all", code)

        # Year / time variable — select latest
        elif code_lower in ("vuosi", "year", "quarter", "vuosineljännes") or \
             "vuosi" in text_lower or "year" in text_lower:
            query_items.append({
                "code": code,
                "selection": {"filter": "item", "values": [values[-1]]},
            })
            logger.info("  Time variable '%s': selected latest '%s'", code, values[-1])

        # Information / measure variable — select all (usually just count)
        elif code_lower in ("tiedot", "information"):
            query_items.append({
                "code": code,
                "selection": {"filter": "all", "values": ["*"]},
            })
            logger.info("  Information variable '%s': selecting all", code)

        else:
            # Unknown variable — select all
            query_items.append({
                "code": code,
                "selection": {"filter": "all", "values": ["*"]},
            })
            logger.info("  Unknown variable '%s' (%s): selecting all", code, var.get("text"))

    query = {"query": query_items, "response": {"format": "json"}}

    _rate_limit()

    logger.info("Posting PxWeb query...")
    r = _request_with_retry(
        "POST", table_url, label="building stock data",
        json=query, timeout=120,
    )
    data = r.json()
    columns, rows = _validate_pxweb_data(data, "building stock data")

    logger.info("  Received %d data rows, %d columns", len(rows), len(columns))

    # Identify column indices
    muni_col_idx = None
    decade_col_idx = None
    for i, col in enumerate(columns):
        col_code = col.get("code", "").lower()
        col_text = col.get("text", "").lower()
        if col_code in ("alue", "area", "kunta", "municipality") or \
           "kunta" in col_text or "municipality" in col_text or "area" in col_text:
            muni_col_idx = i
        elif "vuosikymmen" in col_text or "decade" in col_text or \
             "construction" in col_text or "rakennusvuosi" in col_text or \
             col_code in ("rakennusvuosi", "construction year",
                          "rakennusvuosikymmen", "valmistumisvuosi") or \
             "year of construction" in col_text or "valmistumis" in col_text:
            decade_col_idx = i

    if muni_col_idx is None:
        logger.warning("  Could not identify municipality column, trying index 0")
        muni_col_idx = 0
    if decade_col_idx is None:
        logger.warning("  Could not identify decade column, trying index 1")
        decade_col_idx = 1

    # Parse into {municipality: {decade_label: count}}
    result = {}
    skipped = 0

    # Build a reverse map from value codes to value texts for the decade variable
    decade_texts = {}
    if municipality_var_idx is not None and decade_var_idx is not None:
        decade_var = variables[decade_var_idx]
        for v, t in zip(decade_var["values"], decade_var.get("valueTexts", decade_var["values"])):
            decade_texts[v] = t

    for row in rows:
        keys = row.get("key", [])
        vals = row.get("values", [])
        if not keys or not vals:
            skipped += 1
            continue

        muni_raw = keys[muni_col_idx] if muni_col_idx < len(keys) else None
        decade_raw = keys[decade_col_idx] if decade_col_idx < len(keys) else None
        if muni_raw is None or decade_raw is None:
            skipped += 1
            continue

        # Normalize municipality code: "KU091" -> "091"
        muni_code = muni_raw.replace("KU", "").strip()

        # Get human-readable decade label
        decade_label = decade_texts.get(decade_raw, decade_raw)

        # Parse count value
        val = vals[0]
        if val in (None, "..", "...", ""):
            continue
        try:
            count = float(val)
        except (ValueError, TypeError):
            continue

        if count <= 0:
            continue

        if muni_code not in result:
            result[muni_code] = {}

        # Sum counts if multiple building types
        result[muni_code][decade_label] = (
            result[muni_code].get(decade_label, 0) + count
        )

    if skipped:
        logger.info("  Skipped %d rows (missing keys/values)", skipped)

    logger.info("  Parsed building stock for %d municipalities", len(result))
    for muni, decades in sorted(result.items()):
        total = sum(decades.values())
        logger.info("    %s: %d buildings across %d decades", muni, int(total), len(decades))

    return result


# ---------------------------------------------------------------------------
# Compute municipality-level weighted average construction year
# ---------------------------------------------------------------------------

def compute_municipality_avg_year(building_stock: dict) -> dict:
    """Compute weighted average construction year per municipality.

    Args:
        building_stock: {muni_code: {decade_label: count, ...}, ...}

    Returns:
        {muni_code: avg_year, ...}
    """
    logger.info("Computing municipality-level average construction year...")
    result = {}

    for muni_code, decades in building_stock.items():
        weighted_sum = 0.0
        total_count = 0.0

        for decade_label, count in decades.items():
            midpoint = _match_decade_midpoint(decade_label)
            if midpoint is None:
                # Skip "Total" rows etc.
                continue
            weighted_sum += midpoint * count
            total_count += count

        if total_count > 0:
            avg_year = round(weighted_sum / total_count)
            result[muni_code] = avg_year
            logger.info("  %s: avg year = %d (from %d buildings)", muni_code, avg_year, int(total_count))
        else:
            logger.warning("  %s: no valid decade data", muni_code)

    return result


# ---------------------------------------------------------------------------
# Load GeoJSON and build postal-code -> municipality mapping
# ---------------------------------------------------------------------------

def load_geojson_data() -> list:
    """Load GeoJSON features with fields needed for postal-code refinement.

    Returns list of dicts: [{pno, kunta, ra_asunn, ra_raky, ra_pt_as}, ...]
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
            "ra_asunn": _safe_float(props.get("ra_asunn")),
            "ra_raky": _safe_float(props.get("ra_raky")),
            "ra_pt_as": _safe_float(props.get("ra_pt_as")),
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
# Refine to postal-code level
# ---------------------------------------------------------------------------

def refine_to_postal_codes(
    municipality_avg_years: dict,
    postal_records: list,
) -> dict:
    """Refine municipality-level avg year to postal-code estimates.

    Uses two Paavo-derived signals:
      1. New construction share (ra_raky / ra_asunn): higher ratio => newer area,
         shift estimate upward.
      2. Detached house share (ra_pt_as / ra_asunn): high detached share in
         suburban areas tends to correlate with 1970s-1990s construction.

    Args:
        municipality_avg_years: {muni_code: avg_year}
        postal_records: list of {pno, kunta, ra_asunn, ra_raky, ra_pt_as}

    Returns:
        {postal_code: estimated_avg_year}
    """
    logger.info("Refining estimates to postal-code level...")

    # Compute municipality-level median new-construction share for normalization
    muni_new_shares = {}
    for rec in postal_records:
        muni = rec["kunta"]
        ra_asunn = rec["ra_asunn"]
        ra_raky = rec["ra_raky"]
        if ra_asunn and ra_asunn > 0 and ra_raky is not None:
            share = ra_raky / ra_asunn
            if muni not in muni_new_shares:
                muni_new_shares[muni] = []
            muni_new_shares[muni].append(share)

    muni_median_new = {}
    for muni, shares in muni_new_shares.items():
        sorted_shares = sorted(shares)
        n = len(sorted_shares)
        muni_median_new[muni] = sorted_shares[n // 2] if n > 0 else 0.0

    # Compute municipality-level median detached share
    muni_det_shares = {}
    for rec in postal_records:
        muni = rec["kunta"]
        ra_asunn = rec["ra_asunn"]
        ra_pt_as = rec["ra_pt_as"]
        if ra_asunn and ra_asunn > 0 and ra_pt_as is not None:
            share = ra_pt_as / ra_asunn
            if muni not in muni_det_shares:
                muni_det_shares[muni] = []
            muni_det_shares[muni].append(share)

    muni_median_det = {}
    for muni, shares in muni_det_shares.items():
        sorted_shares = sorted(shares)
        n = len(sorted_shares)
        muni_median_det[muni] = sorted_shares[n // 2] if n > 0 else 0.0

    result = {}
    matched = 0
    unmatched = 0

    for rec in postal_records:
        pno = rec["pno"]
        muni = rec["kunta"]
        base_year = municipality_avg_years.get(muni)

        if base_year is None:
            unmatched += 1
            continue

        adjustment = 0.0
        ra_asunn = rec["ra_asunn"]

        # Signal 1: New construction share
        # Above-median new construction => shift estimate newer (up to +10 years)
        # Below-median => shift estimate older (down to -5 years)
        if ra_asunn and ra_asunn > 0 and rec["ra_raky"] is not None:
            new_share = rec["ra_raky"] / ra_asunn
            median_new = muni_median_new.get(muni, 0.0)

            if median_new > 0:
                relative = (new_share - median_new) / median_new
                # Clamp relative to [-1, 3] to prevent extreme outliers
                relative = max(-1.0, min(3.0, relative))
                # Scale: +10 years at 3x median, -5 years at 0
                adjustment += relative * 5.0

        # Signal 2: Detached house share
        # High detached share with moderate construction => nudge toward 1975-1995
        # This is a weaker signal, max +/- 5 years
        if ra_asunn and ra_asunn > 0 and rec["ra_pt_as"] is not None:
            det_share = rec["ra_pt_as"] / ra_asunn
            median_det = muni_median_det.get(muni, 0.0)

            if det_share > 0.15:
                # High detached house share — suburban areas, tend to be
                # 1970s-1990s vintage
                suburban_target = 1982  # typical suburban peak
                if base_year < suburban_target:
                    # Nudge toward suburban peak, proportional to share
                    adjustment += min(det_share * 10, 5.0)
                elif base_year > suburban_target + 10:
                    # Very new municipality avg but high detached -> moderate down
                    adjustment -= min(det_share * 5, 3.0)

        estimated_year = round(base_year + adjustment)
        # Clamp to reasonable range
        estimated_year = max(1900, min(2025, estimated_year))
        result[pno] = estimated_year
        matched += 1

    logger.info(
        "  Refined %d postal codes (%d unmatched municipalities)",
        matched, unmatched,
    )

    return result


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def main():
    logger.info("=" * 60)
    logger.info("Building age estimation pipeline")
    logger.info("=" * 60)

    # Step 1: Fetch building stock data from PxWeb
    building_stock = None
    cache_key = "building_stock_by_decade"

    for table_url in [PXWEB_TABLE_URL, PXWEB_TABLE_URL_ALT]:
        try:
            variables, effective_url = fetch_building_stock_metadata(table_url)
            _rate_limit()
            building_stock = fetch_building_stock_data(effective_url, variables)
            if building_stock:
                _save_cache(cache_key, building_stock)
                break
        except Exception as e:
            logger.warning("  Failed with table %s: %s", table_url, e)
            continue

    # Try cache if both URLs failed
    if not building_stock:
        logger.warning("  Both PxWeb table URLs failed, trying cache...")
        cached = _load_cache(cache_key)
        if cached is not None:
            building_stock = cached
        else:
            logger.error("  No building stock data available. Exiting.")
            sys.exit(1)

    # Step 2: Compute municipality-level average construction year
    municipality_avg_years = compute_municipality_avg_year(building_stock)
    if not municipality_avg_years:
        logger.error("  Could not compute any municipality averages. Exiting.")
        sys.exit(1)

    # Step 3: Load GeoJSON for postal code -> municipality mapping
    postal_records = load_geojson_data()
    if not postal_records:
        logger.error("  No postal code records found in GeoJSON. Exiting.")
        sys.exit(1)

    # Step 4: Refine to postal-code level
    postal_code_years = refine_to_postal_codes(municipality_avg_years, postal_records)
    if not postal_code_years:
        logger.error("  No postal code estimates produced. Exiting.")
        sys.exit(1)

    # Step 5: Save results
    logger.info("Saving results to %s", OUTPUT_FILE)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(postal_code_years, f, indent=2, sort_keys=True)

    logger.info("Done! %d postal codes with building age estimates.", len(postal_code_years))

    # Print summary statistics
    years = list(postal_code_years.values())
    if years:
        logger.info("  Min year: %d", min(years))
        logger.info("  Max year: %d", max(years))
        logger.info("  Mean year: %d", round(sum(years) / len(years)))
        sorted_years = sorted(years)
        logger.info("  Median year: %d", sorted_years[len(sorted_years) // 2])


if __name__ == "__main__":
    main()
