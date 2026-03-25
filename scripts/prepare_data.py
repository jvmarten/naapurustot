#!/usr/bin/env python3
"""
Fetch Paavo statistics + postal code boundaries from Statistics Finland WFS,
filter to supported regions (Helsinki metro, Turku, Tampere), reproject, calculate derived metrics,
join foreign-language speaker data and external quality-of-life data, and output GeoJSON.
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from pyproj import Transformer

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

# Municipality codes per city/region
HELSINKI_METRO_CODES = {"091", "049", "092", "235"}
TURKU_CODES = {"853", "202", "680", "529", "423", "704", "481", "577"}  # Turku, Kaarina, Raisio, Naantali, Lieto, Rusko, Masku, Paimio
TAMPERE_CODES = {"837", "536", "980", "211", "418", "604"}  # Tampere, Nokia, Ylöjärvi, Kangasala, Lempäälä, Pirkkala

# All supported municipality codes (union of all regions)
METRO_CODES = HELSINKI_METRO_CODES | TURKU_CODES | TAMPERE_CODES

# City label for each municipality code
MUNICIPALITY_CITY = {
    "091": "helsinki_metro",
    "049": "helsinki_metro",
    "092": "helsinki_metro",
    "235": "helsinki_metro",
    "853": "turku",
    "202": "turku",
    "680": "turku",
    "529": "turku",
    "423": "turku",
    "704": "turku",
    "481": "turku",
    "577": "turku",
    "837": "tampere",
    "536": "tampere",
    "980": "tampere",
    "211": "tampere",
    "418": "tampere",
    "604": "tampere",
}

# WFS base URL and capabilities endpoint for auto-detecting the latest year
WFS_BASE = "https://geo.stat.fi/geoserver/postialue/wfs"
WFS_CAPABILITIES_URL = f"{WFS_BASE}?service=WFS&version=2.0.0&request=GetCapabilities"
WFS_FEATURE_TEMPLATE = (
    f"{WFS_BASE}?service=WFS&version=2.0.0&request=GetFeature"
    "&typeNames=postialue:pno_tilasto_{year}"
    "&outputFormat=application/json"
)

# Fallback year if auto-detection fails
WFS_FALLBACK_YEAR = 2024

# Number of historical years to fetch for time-series trends
HISTORICAL_YEARS_COUNT = 6

# Local fallback for historical time-series data
HISTORICAL_TRENDS_FILE = Path(__file__).parent / "historical_trends.json"

LANG_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/vaerak/statfin_vaerak_pxt_11rm.px"
)

# Postal-code-level foreign language speaker percentages
# Source: Statistics Finland via OKM (Ministry of Education), 2020 data
FOREIGN_LANG_FILE = Path(__file__).parent / "foreign_language_pct.json"

# Postal-code-level crime index (reported crimes per 1,000 residents)
# Source: Finnish Police (Poliisi) open data
CRIME_INDEX_FILE = Path(__file__).parent / "crime_index.json"

# Statistics Finland apartment price data by postal code — PxWeb API v1
PROPERTY_PRICE_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/ashi/statfin_ashi_pxt_112p.px"
)
# Local fallback for property prices
PROPERTY_PRICE_FILE = Path(__file__).parent / "property_prices.json"

# HSL Digitransit API v1 for transit accessibility
DIGITRANSIT_URL = "https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql"
# Local fallback for transit stop density
TRANSIT_DENSITY_FILE = Path(__file__).parent / "transit_stop_density.json"

# HSY air quality open data
HSY_AIR_QUALITY_URL = (
    "https://www.hsy.fi/globalassets/ilmanlaatu/opendata/air-quality-index.json"
)
# Local fallback for air quality index
AIR_QUALITY_FILE = Path(__file__).parent / "air_quality.json"

# Overpass API for OpenStreetMap data
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Bounding boxes for Overpass queries (per region)
HELSINKI_METRO_BBOX = "60.10,24.50,60.40,25.25"
TURKU_BBOX = "60.20,21.80,60.60,22.70"
TAMPERE_BBOX = "61.20,23.30,61.70,24.10"

# All bounding boxes for Overpass queries
ALL_BBOXES = [HELSINKI_METRO_BBOX, TURKU_BBOX, TAMPERE_BBOX]

# THL Sotkanet API for social/health indicators
SOTKANET_URL = "https://sotkanet.fi/sotkanet/fi/taulukko"

# --- Phase 7: New data sources ---

# Voter turnout (%) — Statistics Finland / Ministry of Justice
VOTER_TURNOUT_FILE = Path(__file__).parent / "voter_turnout.json"

# Political diversity index (Shannon diversity of party votes)
PARTY_DIVERSITY_FILE = Path(__file__).parent / "party_diversity.json"


# Broadband coverage (% of addresses with 100 Mbit+) — Traficom
BROADBAND_COVERAGE_FILE = Path(__file__).parent / "broadband_coverage.json"

# EV charging station density (/km²) — Traficom / OpenStreetMap
EV_CHARGING_FILE = Path(__file__).parent / "ev_charging.json"

# Tree canopy coverage (% of area covered by trees) — HSY LiDAR
TREE_CANOPY_FILE = Path(__file__).parent / "tree_canopy.json"


# Transit reachability score (0-100, jobs/services within 30 min) — HSL
TRANSIT_REACHABILITY_FILE = Path(__file__).parent / "transit_reachability.json"

# --- Phase 9: Real open data layers ---

# Statistics Finland rental price data by postal code — PxWeb API v1
RENTAL_PRICE_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/asvu/statfin_asvu_pxt_13eb.px"
)
# Local fallback for rental prices
RENTAL_PRICE_FILE = Path(__file__).parent / "rental_prices.json"

# Traffic accidents — Väylävirasto open data
TRAFFIC_ACCIDENTS_FILE = Path(__file__).parent / "traffic_accidents.json"

# Statistics Finland property price history — PxWeb API v1
# Table statfin_ashi_pxt_13mu: price/m² by postal code, annual, 2009-2025
PROPERTY_PRICE_HISTORY_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/ashi/statfin_ashi_pxt_13mu.px"
)
PROPERTY_PRICE_CHANGE_FILE = Path(__file__).parent / "property_price_change.json"

# School quality — YTL matriculation exam results (pre-processed)
SCHOOL_QUALITY_FILE = Path(__file__).parent / "school_quality.json"

# Light pollution — NASA VIIRS nighttime radiance (pre-processed)
LIGHT_POLLUTION_FILE = Path(__file__).parent / "light_pollution.json"
NOISE_POLLUTION_FILE = Path(__file__).parent / "noise_pollution.json"

# ---------------------------------------------------------------------------
# Retry & rate-limit settings
# ---------------------------------------------------------------------------

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2  # seconds; exponential: 2, 4, 8
RATE_LIMIT_DELAY = 1.0  # seconds between successive API calls

# ---------------------------------------------------------------------------
# Error report collector
# ---------------------------------------------------------------------------

_errors: list[dict] = []


def _record_error(source: str, error: Exception, fatal: bool = False):
    """Record an error for the final report."""
    entry = {"source": source, "error": str(error), "fatal": fatal}
    _errors.append(entry)
    if fatal:
        logger.error("[%s]: %s", source, error)
    else:
        logger.warning("[%s]: %s", source, error)


def _print_error_report():
    """Log a summary of all errors encountered during the run."""
    if not _errors:
        logger.info("No errors encountered.")
        return
    fatal = [e for e in _errors if e["fatal"]]
    warnings = [e for e in _errors if not e["fatal"]]
    logger.info("Error report: %d fatal, %d warnings", len(fatal), len(warnings))
    for e in _errors:
        if e["fatal"]:
            logger.error("[FATAL] %s: %s", e["source"], e["error"])
        else:
            logger.warning("[WARN]  %s: %s", e["source"], e["error"])


# ---------------------------------------------------------------------------
# Cache directory
# ---------------------------------------------------------------------------

CACHE_DIR = Path(__file__).parent / "cache"


def _cache_path(key: str) -> Path:
    """Return the cache file path for a given key."""
    # Sanitise key for safe filenames
    safe = key.replace("/", "_").replace(":", "_").replace("?", "_").replace("&", "_")
    return CACHE_DIR / f"{safe}.json"


def _save_cache(key: str, data):
    """Save data to the cache directory."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(key)
    with open(path, "w") as f:
        json.dump(data, f)
    logger.info("  Cached response → %s", path.name)


def _load_cache(key: str):
    """Load data from cache. Returns None if not found."""
    path = _cache_path(key)
    if path.exists():
        with open(path) as f:
            data = json.load(f)
        logger.info("  Loaded from cache: %s", path.name)
        return data
    return None


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------

def _request_with_retry(method, url, *, label, retries=MAX_RETRIES, **kwargs):
    """Execute an HTTP request with exponential-backoff retries.

    Returns the Response object or raises on exhaustion.
    """
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
                logger.warning("Retry %d/%d for %s in %ds (%s)", attempt, retries, label, wait, exc)
                time.sleep(wait)
    raise last_exc  # type: ignore[misc]


def _fetch_cached(method, url, *, cache_key, label, **kwargs):
    """Fetch from URL with retry; on success cache the JSON, on failure load from cache.

    Returns the parsed JSON data, or None if both fetch and cache miss.
    """
    try:
        r = _request_with_retry(method, url, label=label, **kwargs)
        data = r.json()
        _save_cache(cache_key, data)
        return data
    except Exception as e:
        _record_error(label, e)
        logger.warning("  Fetch failed for %s, trying cache...", label)
        cached = _load_cache(cache_key)
        if cached is not None:
            return cached
        logger.warning("  No cache available for %s", label)
        return None


def _detect_latest_paavo_year() -> int:
    """Query WFS GetCapabilities to find the latest pno_tilasto_YYYY layer.

    Returns the year as an integer, or WFS_FALLBACK_YEAR if detection fails.
    """
    import re

    try:
        r = _request_with_retry(
            "GET", WFS_CAPABILITIES_URL, label="WFS GetCapabilities", timeout=30,
        )
        text = r.text
        years = [int(m) for m in re.findall(r"pno_tilasto_(\d{4})", text)]
        if years:
            latest = max(years)
            logger.info("Auto-detected latest Paavo year: %d (available: %s)", latest, sorted(set(years)))
            return latest
    except Exception as e:
        _record_error("detect_paavo_year", e)

    logger.warning("  Could not detect latest Paavo year, using fallback: %d", WFS_FALLBACK_YEAR)
    return WFS_FALLBACK_YEAR


def _rate_limit():
    """Sleep briefly between API calls to be a good citizen."""
    time.sleep(RATE_LIMIT_DELAY)


# ---------------------------------------------------------------------------
# Schema validation helpers
# ---------------------------------------------------------------------------

def _validate_geojson_features(data: dict, label: str) -> list:
    """Validate that *data* looks like a GeoJSON FeatureCollection."""
    if not isinstance(data, dict):
        raise ValueError(f"{label}: expected JSON object, got {type(data).__name__}")
    features = data.get("features")
    if not isinstance(features, list):
        raise ValueError(f"{label}: missing or invalid 'features' array")
    if len(features) == 0:
        raise ValueError(f"{label}: 'features' array is empty")
    # Spot-check first feature
    first = features[0]
    if "geometry" not in first or "properties" not in first:
        raise ValueError(f"{label}: first feature missing 'geometry' or 'properties'")
    return features


def _validate_pxweb_meta(data: dict, label: str) -> list:
    """Validate PxWeb metadata response has a variables list."""
    if not isinstance(data, dict):
        raise ValueError(f"{label}: expected JSON object, got {type(data).__name__}")
    variables = data.get("variables")
    if not isinstance(variables, list) or len(variables) == 0:
        raise ValueError(f"{label}: missing or empty 'variables'")
    return variables


def _validate_pxweb_data(data: dict, label: str) -> tuple[list, list]:
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


def _validate_graphql_stops(data: dict, label: str) -> list:
    """Validate Digitransit GraphQL response contains stops."""
    if not isinstance(data, dict):
        raise ValueError(f"{label}: expected JSON object, got {type(data).__name__}")
    if "errors" in data:
        raise ValueError(f"{label}: GraphQL errors: {data['errors']}")
    stops = data.get("data", {}).get("stops")
    if not isinstance(stops, list):
        raise ValueError(f"{label}: missing 'data.stops'")
    return stops


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def safe_val(v):
    """Return None if value is suppressed (-1), missing, or NaN."""
    if v is None or v == -1 or v == -1.0:
        return None
    try:
        if v != v:  # NaN check (works for numpy and float NaN)
            return None
    except (TypeError, ValueError):
        pass
    return v


def safe_div(a, b):
    """Safe division — returns None if either operand is None/zero/NaN."""
    if a is None or b is None or b == 0:
        return None
    try:
        if a != a or b != b:  # NaN check
            return None
    except (TypeError, ValueError):
        pass
    return round(a / b * 100, 1)


# ---------------------------------------------------------------------------
# Data fetching (with retry, validation, rate limiting)
# ---------------------------------------------------------------------------

def fetch_paavo(year: int):
    """Fetch Paavo WFS data for the given year, with local cache fallback."""
    url = WFS_FEATURE_TEMPLATE.format(year=year)
    cache_key = f"paavo_wfs_{year}"
    logger.info("Fetching Paavo WFS data (year=%d)...", year)

    body = _fetch_cached("GET", url, cache_key=cache_key, label="Paavo WFS", timeout=120)
    if body is None:
        raise RuntimeError(f"Paavo WFS data unavailable (year={year}) and no cache exists")

    features = _validate_geojson_features(body, "Paavo WFS")
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:3067")
    logger.info("Received %d features", len(gdf))
    return gdf


def filter_metro(gdf):
    # kunta field holds the municipality code
    col = None
    for c in ["kunta", "kuntanro", "kuntatunnus"]:
        if c in gdf.columns:
            col = c
            break
    if col is None:
        # Try to derive from pno (first 3 digits map to municipality in some cases)
        # Actually, look at all columns to find it
        logger.info("  Available columns: %s", list(gdf.columns))
        # Fall back: check if 'pno' starts with metro prefixes
        # Helsinki 00xxx, Espoo 02xxx, Vantaa 01xxx, Kauniainen 02700, Turku 20xxx
        metro = gdf[
            gdf["pno"].str.startswith("00")
            | gdf["pno"].str.startswith("01")
            | gdf["pno"].str.startswith("02")
            | gdf["pno"].str.startswith("20")
        ].copy()
        logger.info("  Filtered to %s postal codes by prefix", len(metro))
        return metro

    metro = gdf[gdf[col].astype(str).isin(METRO_CODES)].copy()
    # Add city label based on municipality code
    metro["city"] = metro[col].astype(str).map(MUNICIPALITY_CITY).fillna("unknown")
    logger.info("  Filtered to %s postal codes by municipality code", len(metro))
    return metro


def reproject(gdf):
    logger.info("Reprojecting to WGS84...")
    return gdf.to_crs("EPSG:4326")


def calculate_metrics(gdf):
    logger.info("Calculating derived metrics...")
    # Add pno field from postinumeroalue (frontend expects 'pno')
    gdf["pno"] = gdf["postinumeroalue"]
    for idx, row in gdf.iterrows():
        pop = safe_val(row.get("he_vakiy"))
        adult_pop = safe_val(row.get("ko_ika18y"))
        unemployed = safe_val(row.get("pt_tyott"))
        higher = safe_val(row.get("ko_yl_kork"))
        bachelor = safe_val(row.get("ko_al_kork"))
        pensioners = safe_val(row.get("pt_elakel"))

        gdf.at[idx, "unemployment_rate"] = safe_div(unemployed, pop)
        gdf.at[idx, "higher_education_rate"] = (
            safe_div((higher or 0) + (bachelor or 0), adult_pop)
            if higher is not None and bachelor is not None and adult_pop
            else None
        )
        gdf.at[idx, "pensioner_share"] = safe_div(pensioners, pop)

        # --- Phase 1: New metrics from existing data ---

        # Home ownership rate (te_omis_as / te_taly)
        owner_occ = safe_val(row.get("te_omis_as"))
        total_hh = safe_val(row.get("te_taly"))
        gdf.at[idx, "ownership_rate"] = safe_div(owner_occ, total_hh)

        # Rental rate (te_vuok_as / te_taly)
        rental = safe_val(row.get("te_vuok_as"))
        gdf.at[idx, "rental_rate"] = safe_div(rental, total_hh)

        # Population density (persons per km²)
        area_m2 = safe_val(row.get("pinta_ala"))
        if pop is not None and area_m2 is not None and area_m2 > 0:
            gdf.at[idx, "population_density"] = round(pop / (area_m2 / 1_000_000))
        else:
            gdf.at[idx, "population_density"] = None

        # Child ratio (ages 0-6 / total population)
        children_0_2 = safe_val(row.get("he_0_2"))
        children_3_6 = safe_val(row.get("he_3_6"))
        if children_0_2 is not None and children_3_6 is not None and pop:
            gdf.at[idx, "child_ratio"] = round((children_0_2 + children_3_6) / pop * 100, 1)
        else:
            gdf.at[idx, "child_ratio"] = None

        # Student share (pt_opisk / pt_vakiy)
        students = safe_val(row.get("pt_opisk"))
        act_pop = safe_val(row.get("pt_vakiy"))
        gdf.at[idx, "student_share"] = safe_div(students, act_pop)

        # Detached house share (ra_pt_as / ra_asunn)
        detached = safe_val(row.get("ra_pt_as"))
        total_dwellings = safe_val(row.get("ra_asunn"))
        gdf.at[idx, "detached_house_share"] = safe_div(detached, total_dwellings)

        # --- Phase 7: Quick win metrics from existing Paavo fields ---

        # Youth ratio (18-29 year olds as % of population)
        he_18_19 = safe_val(row.get("he_18_19"))
        he_20_24 = safe_val(row.get("he_20_24"))
        he_25_29 = safe_val(row.get("he_25_29"))
        if he_18_19 is not None and he_20_24 is not None and he_25_29 is not None and pop:
            gdf.at[idx, "youth_ratio_pct"] = round((he_18_19 + he_20_24 + he_25_29) / pop * 100, 1)
        else:
            gdf.at[idx, "youth_ratio_pct"] = None

        # Gender ratio (women / men)
        naiset = safe_val(row.get("he_naiset"))
        miehet = safe_val(row.get("he_miehet"))
        if naiset is not None and miehet is not None and miehet > 0:
            gdf.at[idx, "gender_ratio"] = round(naiset / miehet, 2)
        else:
            gdf.at[idx, "gender_ratio"] = None

        # Single-parent households (% of total households)
        te_eil_np = safe_val(row.get("te_eil_np"))
        if te_eil_np is not None and total_hh is not None and total_hh > 0:
            gdf.at[idx, "single_parent_hh_pct"] = round(te_eil_np / total_hh * 100, 1)
        else:
            gdf.at[idx, "single_parent_hh_pct"] = None

        # Families with children (% of total households)
        te_laps = safe_val(row.get("te_laps"))
        if te_laps is not None and total_hh is not None and total_hh > 0:
            gdf.at[idx, "families_with_children_pct"] = round(te_laps / total_hh * 100, 1)
        else:
            gdf.at[idx, "families_with_children_pct"] = None

        # Tech sector jobs (information/communication sector / total jobs)
        tp_tyopy = safe_val(row.get("tp_tyopy"))
        tp_jk_info = safe_val(row.get("tp_j_info"))
        if tp_jk_info is not None and tp_tyopy is not None and tp_tyopy > 0:
            gdf.at[idx, "tech_sector_pct"] = round(tp_jk_info / tp_tyopy * 100, 1)
        else:
            gdf.at[idx, "tech_sector_pct"] = None

        # Healthcare workers (health/social services sector / total jobs)
        tp_qr_terv = safe_val(row.get("tp_q_terv"))
        if tp_qr_terv is not None and tp_tyopy is not None and tp_tyopy > 0:
            gdf.at[idx, "healthcare_workers_pct"] = round(tp_qr_terv / tp_tyopy * 100, 1)
        else:
            gdf.at[idx, "healthcare_workers_pct"] = None

        # --- Phase 8: More demographic detail ---

        # Employment rate (employed / working-age population)
        pt_tyoll = safe_val(row.get("pt_tyoll"))
        pt_vakiy = safe_val(row.get("pt_vakiy"))
        if pt_tyoll is not None and pt_vakiy is not None and pt_vakiy > 0:
            gdf.at[idx, "employment_rate"] = round(pt_tyoll / pt_vakiy * 100, 1)
        else:
            gdf.at[idx, "employment_rate"] = None

        # Elderly ratio (65+ as % of population)
        he_65_69 = safe_val(row.get("he_65_69"))
        he_70_74 = safe_val(row.get("he_70_74"))
        he_75_79 = safe_val(row.get("he_75_79"))
        he_80_84 = safe_val(row.get("he_80_84"))
        he_85_ = safe_val(row.get("he_85_"))
        if all(v is not None for v in [he_65_69, he_70_74, he_75_79, he_80_84, he_85_]) and pop:
            gdf.at[idx, "elderly_ratio_pct"] = round(
                (he_65_69 + he_70_74 + he_75_79 + he_80_84 + he_85_) / pop * 100, 1
            )
        else:
            gdf.at[idx, "elderly_ratio_pct"] = None

        # Average household size (population / households)
        if pop is not None and pop > 0 and total_hh is not None and total_hh > 0:
            gdf.at[idx, "avg_household_size"] = round(pop / total_hh, 2)
        else:
            gdf.at[idx, "avg_household_size"] = None

        # Manufacturing/industrial jobs (secondary sector / total jobs)
        tp_jalo_bf = safe_val(row.get("tp_jalo_bf"))
        if tp_jalo_bf is not None and tp_tyopy is not None and tp_tyopy > 0:
            gdf.at[idx, "manufacturing_jobs_pct"] = round(tp_jalo_bf / tp_tyopy * 100, 1)
        else:
            gdf.at[idx, "manufacturing_jobs_pct"] = None

        # Public sector jobs (public administration / total jobs)
        tp_o_julk = safe_val(row.get("tp_o_julk"))
        if tp_o_julk is not None and tp_tyopy is not None and tp_tyopy > 0:
            gdf.at[idx, "public_sector_jobs_pct"] = round(tp_o_julk / tp_tyopy * 100, 1)
        else:
            gdf.at[idx, "public_sector_jobs_pct"] = None

        # Service sector jobs (services / total jobs)
        tp_palv_gu = safe_val(row.get("tp_palv_gu"))
        if tp_palv_gu is not None and tp_tyopy is not None and tp_tyopy > 0:
            gdf.at[idx, "service_sector_jobs_pct"] = round(tp_palv_gu / tp_tyopy * 100, 1)
        else:
            gdf.at[idx, "service_sector_jobs_pct"] = None

        # New construction (buildings under construction / total dwellings %)
        ra_raky = safe_val(row.get("ra_raky"))
        total_dwellings = safe_val(row.get("ra_asunn"))
        if ra_raky is not None and total_dwellings is not None and total_dwellings > 0:
            gdf.at[idx, "new_construction_pct"] = round(ra_raky / total_dwellings * 100, 1)
        else:
            gdf.at[idx, "new_construction_pct"] = None

    return gdf


def load_foreign_language():
    """Load postal-code-level foreign-language speaker percentages.

    Primary source: scripts/foreign_language_pct.json containing per-postal-code
    percentages (source: Statistics Finland via OKM, 2020 data).
    """
    logger.info("Loading foreign-language speaker data...")

    if FOREIGN_LANG_FILE.exists():
        with open(FOREIGN_LANG_FILE) as f:
            data = json.load(f)
        logger.info("  Loaded %s postal codes from %s", len(data), FOREIGN_LANG_FILE.name)
        return data

    logger.warning(" %s not found", FOREIGN_LANG_FILE)
    return {}


def join_foreign_language(gdf, lang_data):
    """Apply foreign-language percentages to postal codes."""
    if not lang_data:
        gdf["foreign_language_pct"] = None
        return gdf

    logger.info("Joining foreign-language data...")
    for idx, row in gdf.iterrows():
        pno = row.get("postinumeroalue", "")
        pct = lang_data.get(pno)
        gdf.at[idx, "foreign_language_pct"] = float(pct) if pct is not None else None

    matched = gdf["foreign_language_pct"].notna().sum()
    logger.info("  Matched %s/%s postal codes", matched, len(gdf))
    return gdf


def load_crime_index():
    """Load postal-code-level crime index data (crimes per 1,000 residents).

    Source: Finnish Police (Poliisi) open data.
    """
    logger.info("Loading crime index data...")

    if CRIME_INDEX_FILE.exists():
        with open(CRIME_INDEX_FILE) as f:
            data = json.load(f)
        logger.info("  Loaded %s postal codes from %s", len(data), CRIME_INDEX_FILE.name)
        return data

    logger.warning(" %s not found", CRIME_INDEX_FILE)
    return {}


def join_crime_index(gdf, crime_data):
    """Apply crime index values to postal codes."""
    if not crime_data:
        gdf["crime_index"] = None
        return gdf

    logger.info("Joining crime index data...")
    for idx, row in gdf.iterrows():
        pno = row.get("postinumeroalue", "") or row.get("pno", "")
        val = crime_data.get(pno)
        gdf.at[idx, "crime_index"] = float(val) if val is not None else None

    matched = gdf["crime_index"].notna().sum()
    logger.info("  Matched %s/%s postal codes", matched, len(gdf))
    return gdf


def clean_properties(gdf):
    """Replace -1 suppressed values with None in key fields."""
    key_fields = [
        "he_vakiy", "he_kika", "ko_ika18y", "ko_yl_kork", "ko_al_kork",
        "ko_ammat", "ko_perus", "hr_mtu", "hr_ktu", "pt_tyoll", "pt_tyott",
        "pt_opisk", "pt_elakel", "ra_asunn", "te_takk",
        "te_omis_as", "te_vuok_as", "te_taly", "ra_as_kpa", "ra_pt_as",
        "pinta_ala", "he_0_2", "he_3_6",
    ]
    for col in key_fields:
        if col in gdf.columns:
            gdf[col] = gdf[col].apply(lambda v: None if v == -1 or v == -1.0 else v)
    return gdf


def fetch_property_prices():
    """Fetch apartment price data (€/m²) per postal code from Statistics Finland."""
    logger.info("Fetching property price data from Statistics Finland...")

    try:
        meta_r = _request_with_retry(
            "GET", PROPERTY_PRICE_URL, label="property price metadata", timeout=30,
        )
        meta = meta_r.json()
        variables = _validate_pxweb_meta(meta, "property price metadata")
    except Exception as e:
        _record_error("fetch_property_prices/meta", e)
        cached = _load_cache("property_prices")
        if cached is not None:
            return {k: float(v) for k, v in cached.items()}
        return {}

    query_items = []

    for var in variables:
        code = var["code"]
        values = var["values"]
        code_lower = code.lower()

        if code_lower in ("vuosineljännes", "quarter", "vuosi", "year"):
            # Take latest available
            query_items.append({"code": code, "selection": {"filter": "item", "values": [values[-1]]}})
        elif code_lower in ("postinumero", "postal code", "alue", "postinumeroalue"):
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
        elif code_lower in ("tiedot", "information", "talotyyppi", "building type"):
            # All info / all building types
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
        else:
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})

    query = {"query": query_items, "response": {"format": "json"}}

    _rate_limit()

    try:
        r = _request_with_retry(
            "POST", PROPERTY_PRICE_URL, label="property price data",
            json=query, timeout=60,
        )
        data = r.json()
        columns, rows = _validate_pxweb_data(data, "property price data")
    except Exception as e:
        _record_error("fetch_property_prices/data", e)
        cached = _load_cache("property_prices")
        if cached is not None:
            return {k: float(v) for k, v in cached.items()}
        return {}

    result = {}
    try:
        pno_idx = None
        for i, col in enumerate(columns):
            code_lower = col.get("code", "").lower()
            if code_lower in ("postinumero", "postal code", "alue", "postinumeroalue"):
                pno_idx = i

        if pno_idx is not None:
            for row in rows:
                keys = row.get("key", [])
                vals = row.get("values", [])
                if not keys or not vals:
                    continue
                pno = keys[pno_idx][:5]
                val = vals[0]
                if val not in (None, "..", "...", ""):
                    try:
                        price = float(val)
                        # Keep the highest/latest value per postal code
                        if pno not in result or price > result[pno]:
                            result[pno] = price
                    except (ValueError, TypeError):
                        pass

        logger.info("  Parsed property prices for %s postal codes", len(result))
        if result:
            _save_cache("property_prices", result)
    except Exception as e:
        _record_error("fetch_property_prices/parse", e)

    return result


def join_property_prices(gdf, price_data):
    """Join property price (€/m²) data to the GeoDataFrame."""
    if not price_data:
        gdf["property_price_sqm"] = None
        return gdf

    logger.info("Joining property price data...")
    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        gdf.at[idx, "property_price_sqm"] = price_data.get(pno)
    return gdf


def fetch_hsl_transit_stops():
    """
    Fetch public transit stop counts per postal code area from HSL Digitransit API.
    This gives a rough transit accessibility score based on stop density.
    """
    logger.info("Fetching HSL transit stop data...")

    # Use a simple bbox query for the Helsinki metro area
    query = """
    {
      stops(feeds: ["HSL"]) {
        gtfsId
        name
        lat
        lon
        vehicleMode
      }
    }
    """

    try:
        r = _request_with_retry(
            "POST", DIGITRANSIT_URL, label="HSL Digitransit",
            json={"query": query},
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
        data = r.json()
        stops = _validate_graphql_stops(data, "HSL Digitransit")
        logger.info("  Fetched %s transit stops", len(stops))
        _save_cache("hsl_transit_stops", stops)
        return stops
    except Exception as e:
        _record_error("fetch_hsl_transit_stops", e)
        cached = _load_cache("hsl_transit_stops")
        if cached is not None:
            logger.info("  Using cached transit stops (%s stops)", len(cached))
            return cached
        return []


def _load_transit_density_fallback():
    """Load pre-computed transit stop density from local JSON file."""
    if TRANSIT_DENSITY_FILE.exists():
        logger.info("  Falling back to local file: %s", TRANSIT_DENSITY_FILE.name)
        with open(TRANSIT_DENSITY_FILE) as f:
            data = json.load(f)
        logger.info("  Loaded %s postal codes from %s", len(data), TRANSIT_DENSITY_FILE.name)
        return {k: float(v) for k, v in data.items()}
    return None


def join_transit_data(gdf, stops):
    """Count transit stops per postal code area and calculate density."""
    if not stops:
        # Try local fallback
        fallback = _load_transit_density_fallback()
        if fallback:
            logger.info("Joining transit density data from fallback...")
            for idx, row in gdf.iterrows():
                pno = row.get("pno", "")
                gdf.at[idx, "transit_stop_density"] = fallback.get(pno)
            matched = gdf["transit_stop_density"].notna().sum()
            logger.info("  Matched %s/%s postal codes", matched, len(gdf))
            return gdf
        gdf["transit_stop_density"] = None
        return gdf

    logger.info("Joining transit stop data...")
    from shapely.geometry import Point

    # Count stops per postal code polygon
    stop_counts = {}
    for stop in stops:
        lat = stop.get("lat")
        lon = stop.get("lon")
        if lat is None or lon is None:
            continue
        point = Point(lon, lat)
        for idx, row in gdf.iterrows():
            if row.geometry and row.geometry.contains(point):
                pno = row.get("pno", "")
                stop_counts[pno] = stop_counts.get(pno, 0) + 1
                break

    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        count = stop_counts.get(pno, 0)
        area_km2 = safe_val(row.get("pinta_ala"))
        if area_km2 is not None and area_km2 > 0:
            gdf.at[idx, "transit_stop_density"] = round(count / (area_km2 / 1_000_000), 1)
        else:
            gdf.at[idx, "transit_stop_density"] = None

    logger.info("  Computed transit density for %s postal codes", len(stop_counts))
    return gdf


def fetch_air_quality():
    """
    Fetch air quality index data from HSY, with cache fallback.
    Returns a list of station records or empty list.
    """
    logger.info("Fetching air quality data from HSY...")

    data = _fetch_cached("GET", HSY_AIR_QUALITY_URL, cache_key="hsy_air_quality",
                         label="HSY air quality", timeout=30)
    if data is None:
        return []
    if not isinstance(data, list):
        logger.warning("  HSY air quality: expected JSON array, got %s", type(data).__name__)
        return []
    logger.info("  Air quality data: %s records", len(data))
    return data


def join_air_quality(gdf, aq_data):
    """Join air quality data to postal code areas."""
    if not aq_data:
        # Try local fallback
        if AIR_QUALITY_FILE.exists():
            logger.info("  Falling back to local file: %s", AIR_QUALITY_FILE.name)
            with open(AIR_QUALITY_FILE) as f:
                fallback = json.load(f)
            logger.info("  Loaded %s postal codes from %s", len(fallback), AIR_QUALITY_FILE.name)
            logger.info("Joining air quality data from fallback...")
            for idx, row in gdf.iterrows():
                pno = row.get("pno", "")
                val = fallback.get(pno)
                gdf.at[idx, "air_quality_index"] = float(val) if val is not None else None
            matched = gdf["air_quality_index"].notna().sum()
            logger.info("  Matched %s/%s postal codes", matched, len(gdf))
            return gdf
        gdf["air_quality_index"] = None
        return gdf

    logger.info("Joining air quality data...")
    # HSY data is station-based; assign nearest station value to postal code areas
    from shapely.geometry import Point

    stations = []
    for record in aq_data:
        lat = record.get("lat") or record.get("latitude")
        lon = record.get("lon") or record.get("longitude")
        aqi = record.get("index") or record.get("aqi") or record.get("air_quality_index")
        if lat and lon and aqi:
            try:
                stations.append({"point": Point(float(lon), float(lat)), "aqi": float(aqi)})
            except (ValueError, TypeError):
                pass

    if not stations:
        gdf["air_quality_index"] = None
        return gdf

    for idx, row in gdf.iterrows():
        centroid = row.geometry.centroid if row.geometry else None
        if centroid is None:
            gdf.at[idx, "air_quality_index"] = None
            continue

        # Find nearest station
        min_dist = float("inf")
        nearest_aqi = None
        for s in stations:
            dist = centroid.distance(s["point"])
            if dist < min_dist:
                min_dist = dist
                nearest_aqi = s["aqi"]

        gdf.at[idx, "air_quality_index"] = nearest_aqi

    return gdf


# ---------------------------------------------------------------------------
# Phase 3: OSM-based data (Overpass API)
# ---------------------------------------------------------------------------

def _overpass_query(query: str, label: str) -> list:
    """Execute an Overpass API query and return elements, with cache fallback."""
    # Build a stable cache key from the label
    cache_key = f"overpass_{label.replace(' ', '_').replace('(', '').replace(')', '').replace(',', '')}"
    try:
        r = _request_with_retry(
            "POST", OVERPASS_URL, label=label,
            data={"data": query},
            timeout=120,
        )
        data = r.json()
        elements = data.get("elements", [])
        logger.info("  Fetched %s elements for %s", len(elements), label)
        _save_cache(cache_key, elements)
        return elements
    except Exception as e:
        _record_error(label, e)
        cached = _load_cache(cache_key)
        if cached is not None:
            logger.info("  Using cached data for %s (%s elements)", label, len(cached))
            return cached
        return []


def _overpass_query_all_regions(query_template: str, label: str) -> list:
    """Run an Overpass query for all region bounding boxes and combine results.

    The *query_template* should use ``{BBOX}`` as a placeholder for the bbox string.
    """
    all_elements: list = []
    for bbox in ALL_BBOXES:
        query = query_template.replace("{BBOX}", bbox)
        _rate_limit()
        elements = _overpass_query(query, f"{label} ({bbox})")
        all_elements.extend(elements)
    # Deduplicate by element id
    seen: set = set()
    unique: list = []
    for el in all_elements:
        eid = (el.get("type", ""), el.get("id", ""))
        if eid not in seen:
            seen.add(eid)
            unique.append(el)
    logger.info("  Total unique elements for %s: %s", label, len(unique))
    return unique


def fetch_osm_green_spaces():
    """Fetch parks, forests, and green spaces from OSM for all supported regions."""
    logger.info("Fetching green space data from OpenStreetMap...")
    query = """
    [out:json][timeout:120];
    (
      way["leisure"="park"]({BBOX});
      way["leisure"="nature_reserve"]({BBOX});
      way["leisure"="garden"]({BBOX});
      way["landuse"="forest"]({BBOX});
      way["landuse"="grass"]({BBOX});
      way["landuse"="meadow"]({BBOX});
      way["natural"="wood"]({BBOX});
      way["natural"="scrub"]({BBOX});
      way["natural"="heath"]({BBOX});
      way["boundary"="national_park"]({BBOX});
      relation["leisure"="park"]({BBOX});
      relation["leisure"="nature_reserve"]({BBOX});
      relation["landuse"="forest"]({BBOX});
      relation["landuse"="grass"]({BBOX});
      relation["natural"="wood"]({BBOX});
      relation["boundary"="national_park"]({BBOX});
      relation["boundary"="protected_area"]({BBOX});
    );
    out geom;
    """
    return _overpass_query_all_regions(query, "OSM green spaces")


def _parse_osm_green_geometries(elements):
    """Parse OSM elements with full geometry into Shapely polygons."""
    from shapely.geometry import Polygon, MultiPolygon
    from shapely.validation import make_valid

    polygons = []
    for el in elements:
        try:
            if el.get("type") == "way" and "geometry" in el:
                coords = [(pt["lon"], pt["lat"]) for pt in el["geometry"]]
                if len(coords) >= 4:
                    poly = Polygon(coords)
                    if not poly.is_valid:
                        poly = make_valid(poly)
                    if not poly.is_empty:
                        polygons.append(poly)
            elif el.get("type") == "relation" and "members" in el:
                outers = []
                inners = []
                for m in el["members"]:
                    if "geometry" not in m:
                        continue
                    coords = [(pt["lon"], pt["lat"]) for pt in m["geometry"]]
                    if len(coords) < 4:
                        continue
                    if m.get("role") == "inner":
                        inners.append(coords)
                    else:
                        outers.append(coords)
                for outer in outers:
                    try:
                        poly = Polygon(outer, inners)
                        if not poly.is_valid:
                            poly = make_valid(poly)
                        if not poly.is_empty:
                            polygons.append(poly)
                    except Exception:
                        continue
        except Exception:
            continue
    return polygons


def join_green_spaces(gdf, elements):
    """Calculate green space area coverage (%) per postal code."""
    if not elements:
        gdf["green_space_pct"] = None
        return gdf

    logger.info("Joining green space data (area coverage)...")

    green_polys = _parse_osm_green_geometries(elements)
    if not green_polys:
        logger.warning(" no valid green space polygons parsed")
        gdf["green_space_pct"] = None
        return gdf
    logger.info("  Parsed %s green space polygons", len(green_polys))

    from shapely.geometry import MultiPolygon
    from shapely.ops import unary_union

    # Build a GeoDataFrame of green spaces and union overlapping areas
    green_gdf = gpd.GeoDataFrame(geometry=green_polys, crs="EPSG:4326")

    # Reproject both to EPSG:3067 (Finnish metre-based CRS) for area calculation
    gdf_proj = gdf[["geometry"]].to_crs("EPSG:3067")
    green_gdf_proj = green_gdf.to_crs("EPSG:3067")

    # Spatial join: intersect green polygons with postal code boundaries
    green_union = unary_union(green_gdf_proj.geometry)

    green_pct = {}
    for idx, row in gdf_proj.iterrows():
        postal_geom = row.geometry
        if postal_geom is None or postal_geom.is_empty:
            continue
        postal_area = postal_geom.area
        if postal_area <= 0:
            continue
        intersection = postal_geom.intersection(green_union)
        if intersection.is_empty:
            green_pct[idx] = 0.0
        else:
            green_pct[idx] = round(intersection.area / postal_area * 100, 1)

    gdf["green_space_pct"] = gdf.index.map(lambda i: green_pct.get(i))

    valid = [v for v in green_pct.values() if v is not None and v > 0]
    if valid:
        logger.info("Computed green space coverage for %d postal codes (avg %.1f%%)",
                     len(valid), sum(valid) / len(valid))
    else:
        logger.info("No green space coverage computed")
    return gdf


def fetch_osm_daycares():
    """Fetch daycare/kindergarten locations from OSM."""
    logger.info("Fetching daycare data from OpenStreetMap...")
    query = """
    [out:json][timeout:60];
    (
      node["amenity"="kindergarten"]({BBOX});
      way["amenity"="kindergarten"]({BBOX});
      node["amenity"="childcare"]({BBOX});
      way["amenity"="childcare"]({BBOX});
    );
    out center;
    """
    return _overpass_query_all_regions(query, "OSM daycares")


def join_daycares(gdf, elements):
    """Calculate daycare density per postal code area."""
    if not elements:
        gdf["daycare_density"] = None
        return gdf

    logger.info("Joining daycare data...")
    from shapely.geometry import Point

    counts = {}
    for el in elements:
        lat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        lon = el.get("lon") or (el.get("center", {}) or {}).get("lon")
        if lat is None or lon is None:
            continue
        point = Point(float(lon), float(lat))
        for idx, row in gdf.iterrows():
            if row.geometry and row.geometry.contains(point):
                pno = row.get("pno", "")
                counts[pno] = counts.get(pno, 0) + 1
                break

    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        count = counts.get(pno, 0)
        area_m2 = safe_val(row.get("pinta_ala"))
        if area_m2 is not None and area_m2 > 0:
            gdf.at[idx, "daycare_density"] = round(count / (area_m2 / 1_000_000), 1)
        else:
            gdf.at[idx, "daycare_density"] = None

    logger.info("  Computed daycare density for %s postal codes", len(counts))
    return gdf


def fetch_osm_schools():
    """Fetch school locations from OSM."""
    logger.info("Fetching school data from OpenStreetMap...")
    query = """
    [out:json][timeout:60];
    (
      node["amenity"="school"]({BBOX});
      way["amenity"="school"]({BBOX});
    );
    out center;
    """
    return _overpass_query_all_regions(query, "OSM schools")


def join_schools(gdf, elements):
    """Calculate school density per postal code area."""
    if not elements:
        gdf["school_density"] = None
        return gdf

    logger.info("Joining school data...")
    from shapely.geometry import Point

    counts = {}
    for el in elements:
        lat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        lon = el.get("lon") or (el.get("center", {}) or {}).get("lon")
        if lat is None or lon is None:
            continue
        point = Point(float(lon), float(lat))
        for idx, row in gdf.iterrows():
            if row.geometry and row.geometry.contains(point):
                pno = row.get("pno", "")
                counts[pno] = counts.get(pno, 0) + 1
                break

    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        count = counts.get(pno, 0)
        area_m2 = safe_val(row.get("pinta_ala"))
        if area_m2 is not None and area_m2 > 0:
            gdf.at[idx, "school_density"] = round(count / (area_m2 / 1_000_000), 1)
        else:
            gdf.at[idx, "school_density"] = None

    logger.info("  Computed school density for %s postal codes", len(counts))
    return gdf


def fetch_osm_healthcare():
    """Fetch healthcare facility locations from OSM."""
    logger.info("Fetching healthcare data from OpenStreetMap...")
    query = """
    [out:json][timeout:60];
    (
      node["amenity"="hospital"]({BBOX});
      way["amenity"="hospital"]({BBOX});
      node["amenity"="clinic"]({BBOX});
      way["amenity"="clinic"]({BBOX});
      node["amenity"="doctors"]({BBOX});
      way["amenity"="doctors"]({BBOX});
      node["healthcare"]({BBOX});
      way["healthcare"]({BBOX});
    );
    out center;
    """
    return _overpass_query_all_regions(query, "OSM healthcare")


def join_healthcare(gdf, elements):
    """Calculate healthcare facility density per postal code area."""
    if not elements:
        gdf["healthcare_density"] = None
        return gdf

    logger.info("Joining healthcare data...")
    from shapely.geometry import Point

    counts = {}
    for el in elements:
        lat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        lon = el.get("lon") or (el.get("center", {}) or {}).get("lon")
        if lat is None or lon is None:
            continue
        point = Point(float(lon), float(lat))
        for idx, row in gdf.iterrows():
            if row.geometry and row.geometry.contains(point):
                pno = row.get("pno", "")
                counts[pno] = counts.get(pno, 0) + 1
                break

    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        count = counts.get(pno, 0)
        area_m2 = safe_val(row.get("pinta_ala"))
        if area_m2 is not None and area_m2 > 0:
            gdf.at[idx, "healthcare_density"] = round(count / (area_m2 / 1_000_000), 1)
        else:
            gdf.at[idx, "healthcare_density"] = None

    logger.info("  Computed healthcare density for %s postal codes", len(counts))
    return gdf


def fetch_osm_restaurants():
    """Fetch restaurant and cafe locations from OSM."""
    logger.info("Fetching restaurant/cafe data from OpenStreetMap...")
    query = """
    [out:json][timeout:60];
    (
      node["amenity"="restaurant"]({BBOX});
      node["amenity"="cafe"]({BBOX});
      node["amenity"="bar"]({BBOX});
      node["amenity"="fast_food"]({BBOX});
    );
    out;
    """
    return _overpass_query_all_regions(query, "OSM restaurants")


def join_restaurants(gdf, elements):
    """Calculate restaurant/cafe density per postal code area."""
    if not elements:
        gdf["restaurant_density"] = None
        return gdf

    logger.info("Joining restaurant data...")
    from shapely.geometry import Point

    counts = {}
    for el in elements:
        lat = el.get("lat")
        lon = el.get("lon")
        if lat is None or lon is None:
            continue
        point = Point(float(lon), float(lat))
        for idx, row in gdf.iterrows():
            if row.geometry and row.geometry.contains(point):
                pno = row.get("pno", "")
                counts[pno] = counts.get(pno, 0) + 1
                break

    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        count = counts.get(pno, 0)
        area_m2 = safe_val(row.get("pinta_ala"))
        if area_m2 is not None and area_m2 > 0:
            gdf.at[idx, "restaurant_density"] = round(count / (area_m2 / 1_000_000), 1)
        else:
            gdf.at[idx, "restaurant_density"] = None

    logger.info("  Computed restaurant density for %s postal codes", len(counts))
    return gdf


def fetch_osm_groceries():
    """Fetch grocery/supermarket locations from OSM."""
    logger.info("Fetching grocery store data from OpenStreetMap...")
    query = """
    [out:json][timeout:60];
    (
      node["shop"="supermarket"]({BBOX});
      way["shop"="supermarket"]({BBOX});
      node["shop"="convenience"]({BBOX});
      node["shop"="grocery"]({BBOX});
    );
    out center;
    """
    return _overpass_query_all_regions(query, "OSM groceries")


def join_groceries(gdf, elements):
    """Calculate grocery store density per postal code area."""
    if not elements:
        gdf["grocery_density"] = None
        return gdf

    logger.info("Joining grocery store data...")
    from shapely.geometry import Point

    counts = {}
    for el in elements:
        lat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        lon = el.get("lon") or (el.get("center", {}) or {}).get("lon")
        if lat is None or lon is None:
            continue
        point = Point(float(lon), float(lat))
        for idx, row in gdf.iterrows():
            if row.geometry and row.geometry.contains(point):
                pno = row.get("pno", "")
                counts[pno] = counts.get(pno, 0) + 1
                break

    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        count = counts.get(pno, 0)
        area_m2 = safe_val(row.get("pinta_ala"))
        if area_m2 is not None and area_m2 > 0:
            gdf.at[idx, "grocery_density"] = round(count / (area_m2 / 1_000_000), 1)
        else:
            gdf.at[idx, "grocery_density"] = None

    logger.info("  Computed grocery density for %s postal codes", len(counts))
    return gdf


def fetch_osm_cycling():
    """Fetch cycling infrastructure from OSM."""
    logger.info("Fetching cycling infrastructure data from OpenStreetMap...")
    query = """
    [out:json][timeout:90];
    (
      way["highway"="cycleway"]({BBOX});
      way["cycleway"="lane"]({BBOX});
      way["cycleway"="track"]({BBOX});
      way["bicycle"="designated"]({BBOX});
    );
    out center;
    """
    return _overpass_query_all_regions(query, "OSM cycling")


def join_cycling(gdf, elements):
    """Calculate cycling infrastructure density per postal code area."""
    if not elements:
        gdf["cycling_density"] = None
        return gdf

    logger.info("Joining cycling infrastructure data...")
    from shapely.geometry import Point

    counts = {}
    for el in elements:
        lat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        lon = el.get("lon") or (el.get("center", {}) or {}).get("lon")
        if lat is None or lon is None:
            continue
        point = Point(float(lon), float(lat))
        for idx, row in gdf.iterrows():
            if row.geometry and row.geometry.contains(point):
                pno = row.get("pno", "")
                counts[pno] = counts.get(pno, 0) + 1
                break

    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        count = counts.get(pno, 0)
        area_m2 = safe_val(row.get("pinta_ala"))
        if area_m2 is not None and area_m2 > 0:
            gdf.at[idx, "cycling_density"] = round(count / (area_m2 / 1_000_000), 1)
        else:
            gdf.at[idx, "cycling_density"] = None

    logger.info("  Computed cycling density for %s postal codes", len(counts))
    return gdf


# ---------------------------------------------------------------------------
# Phase 3: JSON file-based data sources
# ---------------------------------------------------------------------------

def _load_json_data(filepath: Path, label: str) -> dict:
    """Load a JSON file containing postal code -> value mapping."""
    logger.info("Loading %s...", label)
    if filepath.exists():
        with open(filepath) as f:
            data = json.load(f)
        logger.info("  Loaded %s postal codes from %s", len(data), filepath.name)
        return data
    logger.warning(" %s not found — column will be null", filepath)
    return {}


def _join_simple_data(gdf, data: dict, column: str, label: str):
    """Join a simple postal_code -> value dict to the GeoDataFrame."""
    if not data:
        gdf[column] = None
        return gdf

    logger.info("Joining %s...", label)
    for idx, row in gdf.iterrows():
        pno = row.get("pno", "") or row.get("postinumeroalue", "")
        val = data.get(pno)
        gdf.at[idx, column] = float(val) if val is not None else None

    matched = gdf[column].notna().sum()
    logger.info("  Matched %s/%s postal codes", matched, len(gdf))
    return gdf


def fetch_historical_paavo(latest_year: int):
    """Fetch multi-year Paavo data for time-series trends.

    Fetches income (hr_mtu), population (he_vakiy), and unemployment (pt_tyott)
    for each historical year to build trend arrays per postal code.

    Returns a dict: { postal_code: { metric: { year: value } } }
    """
    logger.info("Fetching historical Paavo data for time-series trends...")

    historical_years = list(range(latest_year - HISTORICAL_YEARS_COUNT + 1, latest_year + 1))
    logger.info("  Historical years: %s", historical_years)

    # Structure: { pno: { "hr_mtu": {2019: val, ...}, "he_vakiy": {...}, "unemployment_rate": {...} } }
    history = {}
    trend_fields = ["hr_mtu", "he_vakiy", "pt_tyott", "ko_ika18y"]

    for year in historical_years:
        url = WFS_FEATURE_TEMPLATE.format(year=year)
        cache_key = f"paavo_wfs_{year}"
        try:
            _rate_limit()
            body = _fetch_cached("GET", url, cache_key=cache_key, label=f"Paavo WFS {year}", timeout=120)
            if body is None:
                logger.warning("  No data available for year %s (API down, no cache)", year)
                continue
            features = _validate_geojson_features(body, f"Paavo WFS {year}")
            logger.info("  Year %s: %s features", year, len(features))

            for feat in features:
                props = feat.get("properties", {})
                pno = props.get("postinumeroalue", "")
                if not pno:
                    continue

                if pno not in history:
                    history[pno] = {f: {} for f in trend_fields}

                for field in trend_fields:
                    val = safe_val(props.get(field))
                    if val is not None:
                        history[pno][field][str(year)] = val
        except Exception as e:
            _record_error(f"fetch_historical_paavo/{year}", e)
            logger.warning(" Could not fetch historical data for %s", year)

    logger.info("  Collected historical data for %s postal codes", len(history))
    return history


def _build_trend_arrays(history: dict) -> dict:
    """Convert raw historical data into sorted trend arrays.

    Returns: { pno: { "income_history": [[year, value], ...], ... } }
    """
    result = {}
    for pno, metrics in history.items():
        entry = {}

        # Income trend (hr_mtu)
        if metrics.get("hr_mtu"):
            series = sorted([[int(y), v] for y, v in metrics["hr_mtu"].items()])
            if len(series) >= 2:
                entry["income_history"] = series

        # Population trend (he_vakiy)
        if metrics.get("he_vakiy"):
            series = sorted([[int(y), v] for y, v in metrics["he_vakiy"].items()])
            if len(series) >= 2:
                entry["population_history"] = series

        # Unemployment rate trend (pt_tyott / he_vakiy)
        pt_tyott = metrics.get("pt_tyott", {})
        he_vakiy_hist = metrics.get("he_vakiy", {})
        if pt_tyott and he_vakiy_hist:
            unemp_series = []
            for y in sorted(pt_tyott.keys()):
                pop = he_vakiy_hist.get(y)
                if pop and pop > 0:
                    rate = round(pt_tyott[y] / pop * 100, 1)
                    unemp_series.append([int(y), rate])
            if len(unemp_series) >= 2:
                entry["unemployment_history"] = unemp_series

        if entry:
            result[pno] = entry

    return result


def join_historical_trends(gdf, history: dict):
    """Join historical trend arrays to the GeoDataFrame as JSON-encoded strings."""
    if not history:
        # Try local fallback
        if HISTORICAL_TRENDS_FILE.exists():
            logger.info("  Falling back to local file: %s", HISTORICAL_TRENDS_FILE.name)
            with open(HISTORICAL_TRENDS_FILE) as f:
                history = json.load(f)
            logger.info("  Loaded historical trends for %s postal codes", len(history))
        else:
            gdf["income_history"] = None
            gdf["population_history"] = None
            gdf["unemployment_history"] = None
            return gdf

    trend_data = _build_trend_arrays(history) if history and not isinstance(next(iter(history.values()), {}).get("income_history", None), list) else history

    logger.info("Joining historical trend data...")
    trend_keys = ["income_history", "population_history", "unemployment_history"]
    for idx, row in gdf.iterrows():
        pno = row.get("pno", "") or row.get("postinumeroalue", "")
        pno_trends = trend_data.get(pno, {})
        for key in trend_keys:
            series = pno_trends.get(key)
            if series and len(series) >= 2:
                gdf.at[idx, key] = json.dumps(series)
            else:
                gdf.at[idx, key] = None

    for key in trend_keys:
        matched = gdf[key].notna().sum()
        logger.info("  %s: %s/%s postal codes have data", key, matched, len(gdf))

    return gdf


def fetch_rental_prices():
    """Fetch rental price data (€/m²/month) per postal code from Statistics Finland.

    Uses PxWeb API table statfin_asvu_pxt_13eb (rent levels of rental dwellings).
    """
    logger.info("Fetching rental price data from Statistics Finland...")

    try:
        meta_r = _request_with_retry(
            "GET", RENTAL_PRICE_URL, label="rental price metadata", timeout=30,
        )
        meta = meta_r.json()
        variables = _validate_pxweb_meta(meta, "rental price metadata")
    except Exception as e:
        _record_error("fetch_rental_prices/meta", e)
        cached = _load_cache("rental_prices")
        if cached is not None:
            return {k: float(v) for k, v in cached.items()}
        return {}

    query_items = []
    for var in variables:
        code = var["code"]
        values = var["values"]
        code_lower = code.lower()

        if code_lower in ("vuosineljännes", "quarter", "vuosi", "year"):
            # Take latest available
            query_items.append({"code": code, "selection": {"filter": "item", "values": [values[-1]]}})
        elif code_lower in ("postinumero", "postal code", "alue", "postinumeroalue"):
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
        elif code_lower in ("huoneluku", "number of rooms"):
            # All room counts
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
        elif code_lower in ("tiedot", "information"):
            # Only "keskivuokra" = rent per sqm, not "lkm_ptno" = count
            keskivuokra = [v for v in values if "keskivuokra" in v.lower() or "vuokra" in v.lower()]
            if keskivuokra:
                query_items.append({"code": code, "selection": {"filter": "item", "values": keskivuokra}})
            else:
                query_items.append({"code": code, "selection": {"filter": "item", "values": [values[-1]]}})
        else:
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})

    query = {"query": query_items, "response": {"format": "json"}}

    _rate_limit()

    try:
        r = _request_with_retry(
            "POST", RENTAL_PRICE_URL, label="rental price data",
            json=query, timeout=60,
        )
        data = r.json()
        columns, rows = _validate_pxweb_data(data, "rental price data")
    except Exception as e:
        _record_error("fetch_rental_prices/data", e)
        cached = _load_cache("rental_prices")
        if cached is not None:
            return {k: float(v) for k, v in cached.items()}
        return {}

    result = {}
    try:
        from collections import defaultdict
        pno_rents = defaultdict(list)

        pno_idx = None
        for i, col in enumerate(columns):
            code_lower = col.get("code", "").lower()
            if code_lower in ("postinumero", "postal code", "alue", "postinumeroalue"):
                pno_idx = i

        if pno_idx is not None:
            for row in rows:
                keys = row.get("key", [])
                vals = row.get("values", [])
                if not keys or not vals:
                    continue
                pno = keys[pno_idx][:5]
                val = vals[0]
                if val not in (None, "..", "...", ""):
                    try:
                        rent = float(val)
                        if rent > 0:
                            pno_rents[pno].append(rent)
                    except (ValueError, TypeError):
                        pass

        # Average across room types per postal code
        for pno, rents in pno_rents.items():
            result[pno] = round(sum(rents) / len(rents), 2)

        logger.info("  Parsed rental prices for %s postal codes", len(result))
        if result:
            _save_cache("rental_prices", result)
    except Exception as e:
        _record_error("fetch_rental_prices/parse", e)

    return result


def join_rental_prices(gdf, rental_data):
    """Join rental price (€/m²/month) data to the GeoDataFrame."""
    if not rental_data:
        gdf["rental_price_sqm"] = None
        return gdf

    logger.info("Joining rental price data...")
    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        gdf.at[idx, "rental_price_sqm"] = rental_data.get(pno)
    matched = gdf["rental_price_sqm"].notna().sum()
    logger.info("  Matched %s/%s postal codes", matched, len(gdf))
    return gdf


def calculate_price_to_rent(gdf):
    """Calculate price-to-rent ratio from property price and rental price.

    Formula: property_price_sqm / (rental_price_sqm * 12)
    This gives the number of years of rent needed to equal the purchase price.
    """
    logger.info("Calculating price-to-rent ratio...")
    count = 0
    for idx, row in gdf.iterrows():
        price = safe_val(row.get("property_price_sqm"))
        rent = safe_val(row.get("rental_price_sqm"))
        if price is not None and rent is not None and rent > 0:
            gdf.at[idx, "price_to_rent_ratio"] = round(price / (rent * 12), 1)
            count += 1
        else:
            gdf.at[idx, "price_to_rent_ratio"] = None
    logger.info("  Computed price-to-rent ratio for %s postal codes", count)
    return gdf


def calculate_walkability(gdf):
    """Calculate walkability index as a composite score (0-100) from existing OSM densities.

    Components (equal weighting):
    - Restaurant/cafe density (walkable dining/nightlife)
    - Grocery store density (daily shopping)
    - Transit stop density (public transport access)
    - Healthcare facility density (essential services)
    - Cycling infrastructure density (active transport)
    - School density (family amenities)

    Each component is normalized to 0-100 using percentile-based scaling,
    then averaged.
    """
    logger.info("Calculating walkability index...")

    components = [
        "restaurant_density", "grocery_density", "transit_stop_density",
        "healthcare_density", "cycling_density", "school_density",
    ]

    # Collect non-null values for each component to compute percentiles
    comp_values = {}
    for comp in components:
        vals = []
        for idx, row in gdf.iterrows():
            v = safe_val(row.get(comp))
            if v is not None and v >= 0:
                vals.append(v)
        comp_values[comp] = sorted(vals) if vals else []

    def _percentile_score(value, sorted_vals):
        """Return 0-100 percentile score for a value within sorted_vals."""
        if not sorted_vals or value is None:
            return None
        n = len(sorted_vals)
        # Count values less than or equal
        count_le = sum(1 for v in sorted_vals if v <= value)
        return round(count_le / n * 100, 1)

    count = 0
    for idx, row in gdf.iterrows():
        scores = []
        for comp in components:
            v = safe_val(row.get(comp))
            if v is not None and comp_values[comp]:
                s = _percentile_score(v, comp_values[comp])
                if s is not None:
                    scores.append(s)

        if len(scores) >= 3:  # Require at least 3 components
            gdf.at[idx, "walkability_index"] = round(sum(scores) / len(scores), 0)
            count += 1
        else:
            gdf.at[idx, "walkability_index"] = None

    logger.info("  Computed walkability index for %s postal codes", count)
    return gdf


def fetch_traffic_accidents():
    """Load traffic accident data per postal code.

    Primary source: scripts/traffic_accidents.json pre-processed from
    Väylävirasto (Finnish Transport Infrastructure Agency) open data.
    Returns dict of postal_code -> accidents per 1000 residents.
    """
    logger.info("Loading traffic accident data...")
    if TRAFFIC_ACCIDENTS_FILE.exists():
        with open(TRAFFIC_ACCIDENTS_FILE) as f:
            data = json.load(f)
        logger.info("  Loaded %s postal codes from %s", len(data), TRAFFIC_ACCIDENTS_FILE.name)
        return data
    logger.warning(" %s not found — column will be null", TRAFFIC_ACCIDENTS_FILE)
    return {}


def join_traffic_accidents(gdf, accident_data):
    """Join traffic accident rate data to postal codes."""
    if not accident_data:
        gdf["traffic_accident_rate"] = None
        return gdf

    logger.info("Joining traffic accident data...")
    for idx, row in gdf.iterrows():
        pno = row.get("pno", "") or row.get("postinumeroalue", "")
        val = accident_data.get(pno)
        gdf.at[idx, "traffic_accident_rate"] = float(val) if val is not None else None

    matched = gdf["traffic_accident_rate"].notna().sum()
    logger.info("  Matched %s/%s postal codes", matched, len(gdf))
    return gdf


def fetch_property_price_change():
    """Fetch property price change (%) over 5 years from Statistics Finland.

    Uses PxWeb table statfin_ashi_pxt_13mu (€/m² by postal code, annual).
    Computes percentage change between 5 years ago and latest available year.
    """
    logger.info("Fetching property price history from Statistics Finland...")

    try:
        meta_r = _request_with_retry(
            "GET", PROPERTY_PRICE_HISTORY_URL, label="property price history metadata", timeout=30,
        )
        meta = meta_r.json()
        variables = _validate_pxweb_meta(meta, "property price history metadata")
    except Exception as e:
        _record_error("fetch_property_price_change/meta", e)
        cached = _load_cache("property_price_change")
        if cached is not None:
            return {k: float(v) for k, v in cached.items()}
        return {}

    # Find year variable and select two years 5 apart
    query_items = []
    for var in variables:
        code = var["code"]
        values = var["values"]
        code_lower = code.lower()

        if code_lower in ("vuosi", "year"):
            # Pick latest and 5 years earlier
            latest = values[-1]
            try:
                target_old = str(int(latest) - 5)
            except ValueError:
                target_old = values[0]
            old_year = target_old if target_old in values else values[0]
            query_items.append({"code": code, "selection": {"filter": "item", "values": [old_year, latest]}})
        elif code_lower in ("postinumero", "postal code", "alue", "postinumeroalue"):
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
        elif code_lower in ("talotyyppi", "building type"):
            # All building types
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
        elif code_lower in ("tiedot", "information"):
            # Select price per sqm (first item usually)
            query_items.append({"code": code, "selection": {"filter": "item", "values": [values[0]]}})
        else:
            query_items.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})

    query = {"query": query_items, "response": {"format": "json"}}

    _rate_limit()

    try:
        r = _request_with_retry(
            "POST", PROPERTY_PRICE_HISTORY_URL, label="property price history data",
            json=query, timeout=60,
        )
        data = r.json()
        columns, rows = _validate_pxweb_data(data, "property price history data")
    except Exception as e:
        _record_error("fetch_property_price_change/data", e)
        cached = _load_cache("property_price_change")
        if cached is not None:
            return {k: float(v) for k, v in cached.items()}
        return {}

    # Parse: collect price per postal code per year, then compute change
    prices_by_pno = {}  # { pno: { year: price } }
    try:
        pno_idx = None
        year_idx = None
        for i, col in enumerate(columns):
            code_lower = col.get("code", "").lower()
            if code_lower in ("postinumero", "postal code", "alue", "postinumeroalue"):
                pno_idx = i
            if code_lower in ("vuosi", "year"):
                year_idx = i

        if pno_idx is not None and year_idx is not None:
            for row in rows:
                keys = row.get("key", [])
                vals = row.get("values", [])
                if not keys or not vals:
                    continue
                pno = keys[pno_idx][:5]
                year = keys[year_idx]
                val = vals[0]
                if val not in (None, "..", "...", ""):
                    try:
                        price = float(val)
                        if price > 0:
                            if pno not in prices_by_pno:
                                prices_by_pno[pno] = {}
                            # Keep highest price per year per postal code (across building types)
                            if year not in prices_by_pno[pno] or price > prices_by_pno[pno][year]:
                                prices_by_pno[pno][year] = price
                    except (ValueError, TypeError):
                        pass

        # Compute percentage change
        result = {}
        for pno, year_prices in prices_by_pno.items():
            years_sorted = sorted(year_prices.keys())
            if len(years_sorted) >= 2:
                old_price = year_prices[years_sorted[0]]
                new_price = year_prices[years_sorted[-1]]
                if old_price > 0:
                    change_pct = round((new_price - old_price) / old_price * 100, 1)
                    result[pno] = change_pct

        logger.info("  Computed property price change for %s postal codes", len(result))
        if result:
            _save_cache("property_price_change", result)
        return result

    except Exception as e:
        _record_error("fetch_property_price_change/parse", e)
        return {}


def join_property_price_change(gdf, change_data):
    """Join property price change (%) data to the GeoDataFrame."""
    if not change_data:
        gdf["property_price_change_pct"] = None
        return gdf

    logger.info("Joining property price change data...")
    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        gdf.at[idx, "property_price_change_pct"] = change_data.get(pno)
    matched = gdf["property_price_change_pct"].notna().sum()
    logger.info("  Matched %s/%s postal codes", matched, len(gdf))
    return gdf


def fetch_school_quality():
    """Load school quality data per postal code.

    Pre-processed from YTL (Ylioppilastutkintolautakunta) matriculation exam
    results. Average scores geocoded to postal code areas.
    Returns dict of postal_code -> average matriculation score (0-100 scale).
    """
    logger.info("Loading school quality data...")
    if SCHOOL_QUALITY_FILE.exists():
        with open(SCHOOL_QUALITY_FILE) as f:
            data = json.load(f)
        logger.info("  Loaded %s postal codes from %s", len(data), SCHOOL_QUALITY_FILE.name)
        return data
    logger.warning(" %s not found — column will be null", SCHOOL_QUALITY_FILE)
    return {}


def fetch_light_pollution():
    """Load light pollution data per postal code.

    Pre-processed from NASA VIIRS nighttime radiance data.
    Mean radiance (nW/cm²/sr) per postal code area computed via zonal statistics.
    Returns dict of postal_code -> mean_radiance.
    """
    logger.info("Loading light pollution data...")
    if LIGHT_POLLUTION_FILE.exists():
        with open(LIGHT_POLLUTION_FILE) as f:
            data = json.load(f)
        logger.info("  Loaded %s postal codes from %s", len(data), LIGHT_POLLUTION_FILE.name)
        return data
    logger.warning(" %s not found — column will be null", LIGHT_POLLUTION_FILE)
    return {}


def fetch_noise_pollution():
    """Load noise pollution data per postal code.

    Pre-processed from Helsinki 2022 noise survey (WFS) and HRI metro-area
    noise shapefile (2012). Area-weighted average Lden (dB) per postal code.
    Returns dict of postal_code -> avg_Lden_dB.
    """
    logger.info("Loading noise pollution data...")
    if NOISE_POLLUTION_FILE.exists():
        with open(NOISE_POLLUTION_FILE) as f:
            data = json.load(f)
        logger.info("  Loaded %s postal codes from %s", len(data), NOISE_POLLUTION_FILE.name)
        return data
    logger.warning(" %s not found — column will be null", NOISE_POLLUTION_FILE)
    return {}


def calculate_single_person_hh(gdf):
    """Calculate single-person household percentage from Paavo te_ fields."""
    logger.info("Calculating single-person household share...")
    for idx, row in gdf.iterrows():
        te_yks = safe_val(row.get("te_yks"))
        te_taly = safe_val(row.get("te_taly"))
        if te_yks is not None and te_taly is not None and te_taly > 0:
            gdf.at[idx, "single_person_hh_pct"] = round(te_yks / te_taly * 100, 1)
        else:
            gdf.at[idx, "single_person_hh_pct"] = None
    return gdf


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _load_previous_output(path: Path) -> dict:
    """Load the previous GeoJSON output as a postal-code-keyed dict of properties.

    When an external API fails, we fall back to these values so that no metric
    regresses to null just because a single run had a network problem.
    """
    if not path.exists():
        return {}
    try:
        prev = json.loads(path.read_text())
        features = prev.get("features", [])
        lookup = {}
        for f in features:
            props = f.get("properties", {})
            pno = props.get("pno") or props.get("postinumeroalue", "")
            if pno:
                lookup[pno] = props
        logger.info("Loaded previous output with %s postal codes for fallback", len(lookup))
        return lookup
    except Exception as e:
        logger.warning(" could not load previous output: %s", e)
        return {}


def _backfill_nulls(gdf, previous: dict, columns: list[str]):
    """For each column, replace null values with values from the previous run."""
    if not previous:
        return gdf
    backfilled = {col: 0 for col in columns}
    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        prev_props = previous.get(pno, {})
        for col in columns:
            if row.get(col) is None and prev_props.get(col) is not None:
                gdf.at[idx, col] = prev_props[col]
                backfilled[col] += 1
    for col, count in backfilled.items():
        if count > 0:
            logger.info("  Backfilled %s null values in '%s' from previous output", count, col)
    return gdf


def main():
    parser = argparse.ArgumentParser(
        description="Prepare Helsinki metro neighborhood GeoJSON data."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate API connectivity and response schemas without writing output.",
    )
    args = parser.parse_args()

    out_path = Path(__file__).parent.parent / "public" / "data" / "metro_neighborhoods.geojson"

    # Load previous output so we can backfill any metrics that fail this run
    previous = _load_previous_output(out_path)

    # --- Detect latest available Paavo year ---
    latest_year = _detect_latest_paavo_year()

    # --- Core data (fatal on failure) ---
    try:
        gdf = fetch_paavo(latest_year)
    except Exception as e:
        _record_error("fetch_paavo", e, fatal=True)
        _print_error_report()
        sys.exit(1)

    gdf = filter_metro(gdf)
    gdf = reproject(gdf)
    gdf = clean_properties(gdf)
    gdf = calculate_metrics(gdf)

    lang_data = load_foreign_language()
    gdf = join_foreign_language(gdf, lang_data)

    crime_data = load_crime_index()
    gdf = join_crime_index(gdf, crime_data)

    # --- Phase 2: External data sources (graceful fallback if APIs unavailable) ---
    _rate_limit()
    price_data = fetch_property_prices()
    gdf = join_property_prices(gdf, price_data)

    _rate_limit()
    transit_stops = fetch_hsl_transit_stops()
    gdf = join_transit_data(gdf, transit_stops)

    _rate_limit()
    aq_data = fetch_air_quality()
    gdf = join_air_quality(gdf, aq_data)

    # --- Phase 3: OSM-based data sources ---
    _rate_limit()
    green_data = fetch_osm_green_spaces()
    gdf = join_green_spaces(gdf, green_data)

    _rate_limit()
    daycare_data = fetch_osm_daycares()
    gdf = join_daycares(gdf, daycare_data)

    _rate_limit()
    school_data = fetch_osm_schools()
    gdf = join_schools(gdf, school_data)

    _rate_limit()
    healthcare_data = fetch_osm_healthcare()
    gdf = join_healthcare(gdf, healthcare_data)

    _rate_limit()
    restaurant_data = fetch_osm_restaurants()
    gdf = join_restaurants(gdf, restaurant_data)

    _rate_limit()
    grocery_data = fetch_osm_groceries()
    gdf = join_groceries(gdf, grocery_data)

    _rate_limit()
    cycling_data = fetch_osm_cycling()
    gdf = join_cycling(gdf, cycling_data)

    # Single-person households (from existing Paavo data)
    gdf = calculate_single_person_hh(gdf)

    # --- Phase 9: Real open data layers ---
    _rate_limit()
    rental_data = fetch_rental_prices()
    gdf = join_rental_prices(gdf, rental_data)

    # Price-to-rent ratio (derived from property price + rental price)
    gdf = calculate_price_to_rent(gdf)

    # Walkability index (composite from existing OSM densities)
    gdf = calculate_walkability(gdf)

    # Traffic accidents
    accident_data = fetch_traffic_accidents()
    gdf = join_traffic_accidents(gdf, accident_data)

    # Property price change (5-year %)
    _rate_limit()
    price_change_data = fetch_property_price_change()
    gdf = join_property_price_change(gdf, price_change_data)

    # School quality (YTL matriculation exam results)
    school_data = fetch_school_quality()
    gdf = _join_simple_data(gdf, school_data, "school_quality_score", "school quality")

    # Light pollution (NASA VIIRS nighttime radiance)
    light_data = fetch_light_pollution()
    gdf = _join_simple_data(gdf, light_data, "light_pollution", "light pollution")

    # Noise pollution (Helsinki meluselvitys 2022 / HRI metro 2012)
    noise_data = fetch_noise_pollution()
    gdf = _join_simple_data(gdf, noise_data, "noise_pollution", "noise pollution")

    # --- Phase 7: New data sources ---
    voter_data = _load_json_data(VOTER_TURNOUT_FILE, "voter turnout")
    gdf = _join_simple_data(gdf, voter_data, "voter_turnout_pct", "voter turnout")

    party_data = _load_json_data(PARTY_DIVERSITY_FILE, "party diversity")
    gdf = _join_simple_data(gdf, party_data, "party_diversity_index", "party diversity")


    broadband_data = _load_json_data(BROADBAND_COVERAGE_FILE, "broadband coverage")
    gdf = _join_simple_data(gdf, broadband_data, "broadband_coverage_pct", "broadband coverage")

    ev_data = _load_json_data(EV_CHARGING_FILE, "EV charging density")
    gdf = _join_simple_data(gdf, ev_data, "ev_charging_density", "EV charging density")

    canopy_data = _load_json_data(TREE_CANOPY_FILE, "tree canopy coverage")
    gdf = _join_simple_data(gdf, canopy_data, "tree_canopy_pct", "tree canopy coverage")


    reach_data = _load_json_data(TRANSIT_REACHABILITY_FILE, "transit reachability")
    gdf = _join_simple_data(gdf, reach_data, "transit_reachability_score", "transit reachability")

    # --- Phase 4: Historical time-series data ---
    _rate_limit()
    historical = fetch_historical_paavo(latest_year)
    gdf = join_historical_trends(gdf, historical)

    # --- Backfill nulls from previous output ---
    # If any data source failed this run, preserve the values from the last
    # successful run instead of writing nulls.
    backfill_columns = [
        # Phase 2: external APIs
        "property_price_sqm", "transit_stop_density", "air_quality_index",
        # Phase 3: OSM-based
        "green_space_pct", "daycare_density", "school_density",
        "healthcare_density", "restaurant_density", "grocery_density",
        "cycling_density",
        # File-based
        "foreign_language_pct", "crime_index",
        # Phase 4: historical time-series
        "income_history", "population_history", "unemployment_history",
        # Phase 7: new data sources
        "voter_turnout_pct", "party_diversity_index",
        "broadband_coverage_pct", "ev_charging_density",
        "tree_canopy_pct", "transit_reachability_score",
        # Phase 9: real open data
        "rental_price_sqm", "price_to_rent_ratio",
        "walkability_index", "traffic_accident_rate",
        "property_price_change_pct", "school_quality_score",
        "light_pollution",
        "noise_pollution",
    ]
    gdf = _backfill_nulls(gdf, previous, backfill_columns)

    # --- Error report ---
    _print_error_report()

    # --- Dry-run exits before writing ---
    if args.dry_run:
        logger.info("[dry-run] Would write %d features to %s", len(gdf), out_path)
        logger.info("[dry-run] Exiting without writing output.")
        sys.exit(1 if any(e["fatal"] for e in _errors) else 0)

    # --- Write output ---
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(out_path, driver="GeoJSON")
    size_mb = out_path.stat().st_size / 1024 / 1024
    logger.info("Wrote %d features to %s (%.1f MB)", len(gdf), out_path, size_mb)

    # Exit with error code if any fatal errors occurred
    if any(e["fatal"] for e in _errors):
        sys.exit(1)


if __name__ == "__main__":
    main()
