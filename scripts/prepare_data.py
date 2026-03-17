#!/usr/bin/env python3
"""
Fetch Paavo statistics + postal code boundaries from Statistics Finland WFS,
filter to Helsinki metro area, reproject, calculate derived metrics,
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

# Metro municipality codes
METRO_CODES = {"091", "049", "092", "235"}

# Pinned API versions — bump these explicitly when upgrading
WFS_URL = (
    "https://geo.stat.fi/geoserver/postialue/wfs"
    "?service=WFS&version=2.0.0&request=GetFeature"
    "&typeNames=postialue:pno_tilasto_2024"
    "&outputFormat=application/json"
)

# Historical Paavo data years for time-series trends
HISTORICAL_YEARS = [2019, 2020, 2021, 2022, 2023, 2024]
HISTORICAL_WFS_TEMPLATE = (
    "https://geo.stat.fi/geoserver/postialue/wfs"
    "?service=WFS&version=2.0.0&request=GetFeature"
    "&typeNames=postialue:pno_tilasto_{year}"
    "&outputFormat=application/json"
)

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

# Helsinki metro bounding box (for Overpass queries)
METRO_BBOX = "60.10,24.50,60.40,25.25"

# THL Sotkanet API for social/health indicators
SOTKANET_URL = "https://sotkanet.fi/sotkanet/fi/taulukko"

# Traficom open data — vehicles per postal code
TRAFICOM_VEHICLES_FILE = Path(__file__).parent / "car_ownership.json"

# HSL travel time matrix data
COMMUTE_TIME_FILE = Path(__file__).parent / "commute_times.json"

# HSY noise level data
NOISE_LEVEL_FILE = Path(__file__).parent / "noise_levels.json"

# Building age data (derived from building registry)
BUILDING_AGE_FILE = Path(__file__).parent / "building_ages.json"

# Energy efficiency data (ARA energy certificate registry)
ENERGY_CLASS_FILE = Path(__file__).parent / "energy_classes.json"

# Population growth data (year-over-year comparison)
POPULATION_GROWTH_FILE = Path(__file__).parent / "population_growth.json"

# Income inequality data (Gini coefficients by postal code)
INCOME_INEQUALITY_FILE = Path(__file__).parent / "income_inequality.json"

# Seniors living alone data (THL Sotkanet)
SENIORS_ALONE_FILE = Path(__file__).parent / "seniors_alone.json"

# Walkability index (composite score based on amenity/transit/street density)
WALKABILITY_FILE = Path(__file__).parent / "walkability.json"

# Kela social benefit recipients (% of population)
KELA_BENEFITS_FILE = Path(__file__).parent / "kela_benefits.json"

# Rental prices (€/m²/month) — Statistics Finland / ARA registry
RENTAL_PRICE_FILE = Path(__file__).parent / "rental_prices.json"

# Average taxable income (€) — Finnish Tax Administration
TAXABLE_INCOME_FILE = Path(__file__).parent / "taxable_income.json"

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

def fetch_paavo():
    logger.info("Fetching Paavo WFS data...")
    r = _request_with_retry("GET", WFS_URL, label="Paavo WFS", timeout=120)
    body = r.json()
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
        # Helsinki 00xxx, Espoo 02xxx, Vantaa 01xxx, Kauniainen 02700
        metro = gdf[
            gdf["pno"].str.startswith("00")
            | gdf["pno"].str.startswith("01")
            | gdf["pno"].str.startswith("02")
        ].copy()
        logger.info("  Filtered to %s metro postal codes by prefix", len(metro))
        return metro

    metro = gdf[gdf[col].astype(str).isin(METRO_CODES)].copy()
    logger.info("  Filtered to %s metro postal codes by municipality code", len(metro))
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
        # Fall back to local file
        if PROPERTY_PRICE_FILE.exists():
            logger.info("  Falling back to local file: %s", PROPERTY_PRICE_FILE.name)
            with open(PROPERTY_PRICE_FILE) as f:
                data = json.load(f)
            logger.info("  Loaded %s postal codes from %s", len(data), PROPERTY_PRICE_FILE.name)
            return {k: float(v) for k, v in data.items()}
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
        return stops
    except Exception as e:
        _record_error("fetch_hsl_transit_stops", e)
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
    Fetch air quality index data from HSY.
    Returns a dict of postal_code -> annual average air quality index.
    """
    logger.info("Fetching air quality data from HSY...")

    try:
        r = _request_with_retry(
            "GET", HSY_AIR_QUALITY_URL, label="HSY air quality", timeout=30,
        )
        data = r.json()
        if not isinstance(data, list):
            raise ValueError(f"expected JSON array, got {type(data).__name__}")
        logger.info("  Fetched air quality data: %s records", len(data))
        return data
    except Exception as e:
        _record_error("fetch_air_quality", e)
        return []


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
    """Execute an Overpass API query and return elements."""
    try:
        r = _request_with_retry(
            "POST", OVERPASS_URL, label=label,
            data={"data": query},
            timeout=120,
        )
        data = r.json()
        elements = data.get("elements", [])
        logger.info("  Fetched %s elements for %s", len(elements), label)
        return elements
    except Exception as e:
        _record_error(label, e)
        return []


def fetch_osm_green_spaces():
    """Fetch parks, forests, and green spaces from OSM for Helsinki metro."""
    logger.info("Fetching green space data from OpenStreetMap...")
    query = f"""
    [out:json][timeout:120];
    (
      way["leisure"="park"]({METRO_BBOX});
      way["leisure"="nature_reserve"]({METRO_BBOX});
      way["leisure"="garden"]({METRO_BBOX});
      way["landuse"="forest"]({METRO_BBOX});
      way["landuse"="grass"]({METRO_BBOX});
      way["landuse"="meadow"]({METRO_BBOX});
      way["natural"="wood"]({METRO_BBOX});
      way["natural"="scrub"]({METRO_BBOX});
      way["natural"="heath"]({METRO_BBOX});
      way["boundary"="national_park"]({METRO_BBOX});
      relation["leisure"="park"]({METRO_BBOX});
      relation["leisure"="nature_reserve"]({METRO_BBOX});
      relation["landuse"="forest"]({METRO_BBOX});
      relation["landuse"="grass"]({METRO_BBOX});
      relation["natural"="wood"]({METRO_BBOX});
      relation["boundary"="national_park"]({METRO_BBOX});
      relation["boundary"="protected_area"]({METRO_BBOX});
    );
    out geom;
    """
    return _overpass_query(query, "OSM green spaces")


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
    query = f"""
    [out:json][timeout:60];
    (
      node["amenity"="kindergarten"]({METRO_BBOX});
      way["amenity"="kindergarten"]({METRO_BBOX});
      node["amenity"="childcare"]({METRO_BBOX});
      way["amenity"="childcare"]({METRO_BBOX});
    );
    out center;
    """
    return _overpass_query(query, "OSM daycares")


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
    query = f"""
    [out:json][timeout:60];
    (
      node["amenity"="school"]({METRO_BBOX});
      way["amenity"="school"]({METRO_BBOX});
    );
    out center;
    """
    return _overpass_query(query, "OSM schools")


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
    query = f"""
    [out:json][timeout:60];
    (
      node["amenity"="hospital"]({METRO_BBOX});
      way["amenity"="hospital"]({METRO_BBOX});
      node["amenity"="clinic"]({METRO_BBOX});
      way["amenity"="clinic"]({METRO_BBOX});
      node["amenity"="doctors"]({METRO_BBOX});
      way["amenity"="doctors"]({METRO_BBOX});
      node["healthcare"]({METRO_BBOX});
      way["healthcare"]({METRO_BBOX});
    );
    out center;
    """
    return _overpass_query(query, "OSM healthcare")


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
    query = f"""
    [out:json][timeout:60];
    (
      node["amenity"="restaurant"]({METRO_BBOX});
      node["amenity"="cafe"]({METRO_BBOX});
      node["amenity"="bar"]({METRO_BBOX});
      node["amenity"="fast_food"]({METRO_BBOX});
    );
    out;
    """
    return _overpass_query(query, "OSM restaurants")


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
    query = f"""
    [out:json][timeout:60];
    (
      node["shop"="supermarket"]({METRO_BBOX});
      way["shop"="supermarket"]({METRO_BBOX});
      node["shop"="convenience"]({METRO_BBOX});
      node["shop"="grocery"]({METRO_BBOX});
    );
    out center;
    """
    return _overpass_query(query, "OSM groceries")


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
    query = f"""
    [out:json][timeout:90];
    (
      way["highway"="cycleway"]({METRO_BBOX});
      way["cycleway"="lane"]({METRO_BBOX});
      way["cycleway"="track"]({METRO_BBOX});
      way["bicycle"="designated"]({METRO_BBOX});
    );
    out center;
    """
    return _overpass_query(query, "OSM cycling")


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


def fetch_historical_paavo():
    """Fetch multi-year Paavo data for time-series trends.

    Fetches income (hr_mtu), population (he_vakiy), and unemployment (pt_tyott)
    for each historical year to build trend arrays per postal code.

    Returns a dict: { postal_code: { metric: { year: value } } }
    """
    logger.info("Fetching historical Paavo data for time-series trends...")

    # Structure: { pno: { "hr_mtu": {2019: val, ...}, "he_vakiy": {...}, "unemployment_rate": {...} } }
    history = {}
    trend_fields = ["hr_mtu", "he_vakiy", "pt_tyott", "ko_ika18y"]

    for year in HISTORICAL_YEARS:
        url = HISTORICAL_WFS_TEMPLATE.format(year=year)
        try:
            _rate_limit()
            r = _request_with_retry("GET", url, label=f"Paavo WFS {year}", timeout=120)
            body = r.json()
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


def calculate_single_person_hh(gdf):
    """Calculate single-person household percentage from Paavo te_ fields."""
    logger.info("Calculating single-person household share...")
    for idx, row in gdf.iterrows():
        te_takk = safe_val(row.get("te_takk"))
        te_taly = safe_val(row.get("te_taly"))
        # te_takk represents 1-person households in some Paavo versions
        # If available, use it; otherwise set to None
        if te_takk is not None and te_taly is not None and te_taly > 0:
            gdf.at[idx, "single_person_hh_pct"] = round(te_takk / te_taly * 100, 1)
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

    # --- Core data (fatal on failure) ---
    try:
        gdf = fetch_paavo()
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

    # --- Phase 3: JSON file-based data sources ---
    noise_data = _load_json_data(NOISE_LEVEL_FILE, "noise levels")
    gdf = _join_simple_data(gdf, noise_data, "noise_level", "noise levels")

    building_data = _load_json_data(BUILDING_AGE_FILE, "building ages")
    gdf = _join_simple_data(gdf, building_data, "avg_building_year", "building ages")

    energy_data = _load_json_data(ENERGY_CLASS_FILE, "energy classes")
    gdf = _join_simple_data(gdf, energy_data, "energy_efficiency", "energy classes")

    growth_data = _load_json_data(POPULATION_GROWTH_FILE, "population growth")
    gdf = _join_simple_data(gdf, growth_data, "population_growth_pct", "population growth")

    inequality_data = _load_json_data(INCOME_INEQUALITY_FILE, "income inequality")
    gdf = _join_simple_data(gdf, inequality_data, "gini_coefficient", "income inequality")

    seniors_data = _load_json_data(SENIORS_ALONE_FILE, "seniors living alone")
    gdf = _join_simple_data(gdf, seniors_data, "seniors_alone_pct", "seniors living alone")

    car_data = _load_json_data(TRAFICOM_VEHICLES_FILE, "car ownership")
    gdf = _join_simple_data(gdf, car_data, "cars_per_household", "car ownership")

    commute_data = _load_json_data(COMMUTE_TIME_FILE, "commute times")
    gdf = _join_simple_data(gdf, commute_data, "avg_commute_min", "commute times")

    walkability_data = _load_json_data(WALKABILITY_FILE, "walkability")
    gdf = _join_simple_data(gdf, walkability_data, "walkability_index", "walkability")

    kela_data = _load_json_data(KELA_BENEFITS_FILE, "Kela benefits")
    gdf = _join_simple_data(gdf, kela_data, "kela_benefit_pct", "Kela benefits")

    rental_data = _load_json_data(RENTAL_PRICE_FILE, "rental prices")
    gdf = _join_simple_data(gdf, rental_data, "rental_price_sqm", "rental prices")

    tax_data = _load_json_data(TAXABLE_INCOME_FILE, "taxable income")
    gdf = _join_simple_data(gdf, tax_data, "avg_taxable_income", "taxable income")

    # Single-person households (from existing Paavo data)
    gdf = calculate_single_person_hh(gdf)

    # --- Phase 4: Historical time-series data ---
    _rate_limit()
    historical = fetch_historical_paavo()
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
        "foreign_language_pct", "crime_index", "noise_level",
        "avg_building_year", "energy_efficiency", "population_growth_pct",
        "gini_coefficient", "seniors_alone_pct", "cars_per_household",
        "avg_commute_min", "walkability_index", "kela_benefit_pct",
        "rental_price_sqm", "avg_taxable_income",
        # Phase 4: historical time-series
        "income_history", "population_history", "unemployment_history",
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
