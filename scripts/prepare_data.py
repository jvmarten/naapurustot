#!/usr/bin/env python3
"""
Fetch Paavo statistics + postal code boundaries from Statistics Finland WFS,
filter to Helsinki metro area, reproject, calculate derived metrics,
join foreign-language speaker data and external quality-of-life data, and output GeoJSON.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from pyproj import Transformer

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

LANG_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/vaerak/statfin_vaerak_pxt_11rm.px"
)

# Postal-code-level foreign language speaker percentages
# Source: Statistics Finland via OKM (Ministry of Education), 2020 data
FOREIGN_LANG_FILE = Path(__file__).parent / "foreign_language_pct.json"

# Statistics Finland apartment price data by postal code — PxWeb API v1
PROPERTY_PRICE_URL = (
    "https://pxdata.stat.fi/PxWeb/api/v1/en/"
    "StatFin/ashi/statfin_ashi_pxt_112p.px"
)

# HSL Digitransit API v1 for transit accessibility
DIGITRANSIT_URL = "https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql"

# HSY air quality open data
HSY_AIR_QUALITY_URL = (
    "https://www.hsy.fi/globalassets/ilmanlaatu/opendata/air-quality-index.json"
)

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
    prefix = "ERROR" if fatal else "Warning"
    print(f"  {prefix} [{source}]: {error}")


def _print_error_report():
    """Print a summary of all errors encountered during the run."""
    if not _errors:
        print("\nNo errors encountered.")
        return
    fatal = [e for e in _errors if e["fatal"]]
    warnings = [e for e in _errors if not e["fatal"]]
    print(f"\n{'='*60}")
    print(f"Error report: {len(fatal)} fatal, {len(warnings)} warnings")
    print(f"{'='*60}")
    for e in _errors:
        tag = "FATAL" if e["fatal"] else "WARN "
        print(f"  [{tag}] {e['source']}: {e['error']}")


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
                print(f"  Retry {attempt}/{retries} for {label} in {wait}s ({exc})")
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
    print("Fetching Paavo WFS data...")
    r = _request_with_retry("GET", WFS_URL, label="Paavo WFS", timeout=120)
    body = r.json()
    features = _validate_geojson_features(body, "Paavo WFS")
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:3067")
    print(f"  Received {len(gdf)} features")
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
        print("  Available columns:", list(gdf.columns))
        # Fall back: check if 'pno' starts with metro prefixes
        # Helsinki 00xxx, Espoo 02xxx, Vantaa 01xxx, Kauniainen 02700
        metro = gdf[
            gdf["pno"].str.startswith("00")
            | gdf["pno"].str.startswith("01")
            | gdf["pno"].str.startswith("02")
        ].copy()
        print(f"  Filtered to {len(metro)} metro postal codes by prefix")
        return metro

    metro = gdf[gdf[col].astype(str).isin(METRO_CODES)].copy()
    print(f"  Filtered to {len(metro)} metro postal codes by municipality code")
    return metro


def reproject(gdf):
    print("Reprojecting to WGS84...")
    return gdf.to_crs("EPSG:4326")


def calculate_metrics(gdf):
    print("Calculating derived metrics...")
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
    print("Loading foreign-language speaker data...")

    if FOREIGN_LANG_FILE.exists():
        with open(FOREIGN_LANG_FILE) as f:
            data = json.load(f)
        print(f"  Loaded {len(data)} postal codes from {FOREIGN_LANG_FILE.name}")
        return data

    print(f"  Warning: {FOREIGN_LANG_FILE} not found")
    return {}


def join_foreign_language(gdf, lang_data):
    """Apply foreign-language percentages to postal codes."""
    if not lang_data:
        gdf["foreign_language_pct"] = None
        return gdf

    print("Joining foreign-language data...")
    for idx, row in gdf.iterrows():
        pno = row.get("postinumeroalue", "")
        pct = lang_data.get(pno)
        gdf.at[idx, "foreign_language_pct"] = float(pct) if pct is not None else None

    matched = gdf["foreign_language_pct"].notna().sum()
    print(f"  Matched {matched}/{len(gdf)} postal codes")
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
    print("Fetching property price data from Statistics Finland...")

    try:
        meta_r = _request_with_retry(
            "GET", PROPERTY_PRICE_URL, label="property price metadata", timeout=30,
        )
        meta = meta_r.json()
        variables = _validate_pxweb_meta(meta, "property price metadata")
    except Exception as e:
        _record_error("fetch_property_prices/meta", e)
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

        print(f"  Parsed property prices for {len(result)} postal codes")
    except Exception as e:
        _record_error("fetch_property_prices/parse", e)

    return result


def join_property_prices(gdf, price_data):
    """Join property price (€/m²) data to the GeoDataFrame."""
    if not price_data:
        gdf["property_price_sqm"] = None
        return gdf

    print("Joining property price data...")
    for idx, row in gdf.iterrows():
        pno = row.get("pno", "")
        gdf.at[idx, "property_price_sqm"] = price_data.get(pno)
    return gdf


def fetch_hsl_transit_stops():
    """
    Fetch public transit stop counts per postal code area from HSL Digitransit API.
    This gives a rough transit accessibility score based on stop density.
    """
    print("Fetching HSL transit stop data...")

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
        print(f"  Fetched {len(stops)} transit stops")
        return stops
    except Exception as e:
        _record_error("fetch_hsl_transit_stops", e)
        return []


def join_transit_data(gdf, stops):
    """Count transit stops per postal code area and calculate density."""
    if not stops:
        gdf["transit_stop_density"] = None
        return gdf

    print("Joining transit stop data...")
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

    print(f"  Computed transit density for {len(stop_counts)} postal codes")
    return gdf


def fetch_air_quality():
    """
    Fetch air quality index data from HSY.
    Returns a dict of postal_code -> annual average air quality index.
    """
    print("Fetching air quality data from HSY...")

    try:
        r = _request_with_retry(
            "GET", HSY_AIR_QUALITY_URL, label="HSY air quality", timeout=30,
        )
        data = r.json()
        if not isinstance(data, list):
            raise ValueError(f"expected JSON array, got {type(data).__name__}")
        print(f"  Fetched air quality data: {len(data)} records")
        return data
    except Exception as e:
        _record_error("fetch_air_quality", e)
        return []


def join_air_quality(gdf, aq_data):
    """Join air quality data to postal code areas."""
    if not aq_data:
        gdf["air_quality_index"] = None
        return gdf

    print("Joining air quality data...")
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
# Main
# ---------------------------------------------------------------------------

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

    # --- Error report ---
    _print_error_report()

    # --- Dry-run exits before writing ---
    if args.dry_run:
        print(f"\n[dry-run] Would write {len(gdf)} features to {out_path}")
        print("[dry-run] Exiting without writing output.")
        sys.exit(1 if any(e["fatal"] for e in _errors) else 0)

    # --- Write output ---
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(out_path, driver="GeoJSON")
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"\nWrote {len(gdf)} features to {out_path} ({size_mb:.1f} MB)")

    # Exit with error code if any fatal errors occurred
    if any(e["fatal"] for e in _errors):
        sys.exit(1)


if __name__ == "__main__":
    main()
