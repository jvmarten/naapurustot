#!/usr/bin/env python3
"""
Fetch air quality index data for Helsinki metro, Tampere, and Turku postal
code areas and write scripts/air_quality.json.

Data sources:
  - Helsinki metro: HSY (Helsinki Region Environmental Services) GeoServer WFS
    Real-time station measurements from ~13 monitoring stations across
    Helsinki, Espoo, Vantaa. Index on 0-100+ scale (higher = worse).
    Endpoint: kartta.hsy.fi/geoserver/wfs, layer ilmanlaatu:Ilmanlaatu_nyt
  - Tampere region: Tampere city NOx annual-mean air quality modeling (WFS)
    for spatial differentiation within the region.
    Endpoint: geodata.tampere.fi, layer ilmanlaatumallinnus_2025_nykytilanne_NOx
  - Turku region: Distance-from-center gradient calibrated against Helsinki
    patterns (Turku is smaller, so the gradient is scaled proportionally).
  - FMI open data (fmi::observations::airquality::hourly::simple): Nationwide
    background air quality index (1-5 scale, converted to our 0-100 scale).
    Used for baseline calibration where city-level data is unavailable.

Method:
  1. Fetch real-time HSY station data for Helsinki metro and assign to postal
     codes by nearest-station proximity.
  2. Fetch Tampere NOx modeling contours from Tampere city WFS, compute
     area-weighted NOx per postal code, normalize to our AQ index scale.
  3. For Turku, use FMI background data + distance-from-center gradient
     modeled on Helsinki spatial patterns.
  4. Merge all regions. When HSY is unavailable, preserve existing Helsinki
     data from the JSON file.

Output: scripts/air_quality.json  {"postal_code": air_quality_index}
Scale: 0-100+, higher = worse air quality (more polluted)

Usage:
    python scripts/fetch_air_quality.py
"""
from __future__ import annotations

import json
import logging
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

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
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_FILE = SCRIPT_DIR / "air_quality.json"

# ---------------------------------------------------------------------------
# Data source URLs
# ---------------------------------------------------------------------------

# HSY WFS -- real-time air quality monitoring stations (Helsinki metro)
HSY_WFS_URL = "https://kartta.hsy.fi/geoserver/wfs"
HSY_LAYER = "ilmanlaatu:Ilmanlaatu_nyt"

# FMI open data WFS -- nationwide air quality observations
FMI_WFS_URL = "https://opendata.fmi.fi/wfs"
FMI_STORED_QUERY = "fmi::observations::airquality::hourly::simple"

# Tampere city WFS -- NOx air quality modeling (2025 current conditions)
TAMPERE_WFS_URL = "https://geodata.tampere.fi/geoserver/ows"
TAMPERE_NOX_LAYER = (
    "ymparisto_ja_terveys:ilmanlaatumallinnus_2025_nykytilanne_NOx"
)

# ---------------------------------------------------------------------------
# Regional postal code prefixes
# ---------------------------------------------------------------------------

HELSINKI_METRO_PREFIXES = ("00", "01", "02")
TAMPERE_PREFIXES = ("33", "34", "35", "36", "37", "39")
TURKU_PREFIXES = ("20", "21")

# ---------------------------------------------------------------------------
# FMI AQ index conversion: FMI uses 1-5 scale, our data uses 0-100 scale
# FMI: 1=Good, 2=Satisfactory, 3=Fair, 4=Poor, 5=Very Poor
# Our scale: higher = worse air quality (Helsinki center ~45, suburbs ~20-30)
# ---------------------------------------------------------------------------

# FMI background stations measure rural/semi-rural conditions.  A reading
# of 1-2 on the FMI scale indicates very clean air, which on our urban-centric
# 0-100 scale corresponds to the lowest tier (~15-22).  Higher FMI values
# (3-5) are rare and indicate pollution events.
FMI_TO_AQ_INDEX = {1: 15.0, 2: 22.0, 3: 40.0, 4: 60.0, 5: 80.0}

# Tampere NOx concentration midpoints -> AQ index mapping
# NOx ranges from Tampere modeling: 5-10, 10-15, 15-20, 20-30, 30-40 ug/m3
NOX_TO_AQ_INDEX = {
    5.0: 18.0,
    7.5: 22.0,
    12.5: 30.0,
    17.5: 38.0,
    25.0: 48.0,
    35.0: 60.0,
    50.0: 72.0,
    75.0: 85.0,
}

# Request timeout (seconds)
REQUEST_TIMEOUT = 60


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great-circle distance in km between two lat/lon points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.asin(min(1.0, math.sqrt(a)))


def _interpolate_lookup(value: float, table: dict[float, float]) -> float:
    """Linearly interpolate a value through a sorted lookup table."""
    keys = sorted(table.keys())
    if value <= keys[0]:
        return table[keys[0]]
    if value >= keys[-1]:
        return table[keys[-1]]
    for i in range(len(keys) - 1):
        if keys[i] <= value <= keys[i + 1]:
            frac = (value - keys[i]) / (keys[i + 1] - keys[i])
            return table[keys[i]] + frac * (table[keys[i + 1]] - table[keys[i]])
    return table[keys[-1]]


def parse_nox_range(text: str) -> tuple[float, float] | None:
    """Parse NOx concentration range from strings like '10 - 15 ug/m3'."""
    text = text.strip().lower().replace("\u00b5", "u")
    m = re.match(r"(\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d+(?:\.\d+)?)", text)
    if m:
        return float(m.group(1)), float(m.group(2))
    m = re.match(r"(?:>|yli)\s*(\d+(?:\.\d+)?)", text)
    if m:
        lo = float(m.group(1))
        return lo, lo * 1.5
    m = re.match(r"(?:<|alle)\s*(\d+(?:\.\d+)?)", text)
    if m:
        hi = float(m.group(1))
        return 0, hi
    return None


# ---------------------------------------------------------------------------
# Load postal code areas from GeoJSON
# ---------------------------------------------------------------------------


def load_postal_areas() -> list[dict]:
    """Load postal code areas with centroids from the project GeoJSON.

    Returns list of dicts: pno, lat, lon, euref_x, euref_y, kunta.
    """
    if not GEOJSON_PATH.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_PATH)
        sys.exit(1)

    logger.info("Loading postal code areas from %s...", GEOJSON_PATH.name)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    areas: list[dict] = []

    for feat in features:
        props = feat.get("properties", {})
        pno = props.get("pno", "")
        euref_x = props.get("euref_x")
        euref_y = props.get("euref_y")
        kunta = props.get("kunta", "")

        if not pno or euref_x is None or euref_y is None:
            continue

        geom = feat.get("geometry")
        if geom and geom.get("type") in ("Polygon", "MultiPolygon"):
            coords = _flatten_coords(geom)
            if coords:
                avg_lon = sum(c[0] for c in coords) / len(coords)
                avg_lat = sum(c[1] for c in coords) / len(coords)
                areas.append({
                    "pno": pno,
                    "lat": avg_lat,
                    "lon": avg_lon,
                    "euref_x": float(euref_x),
                    "euref_y": float(euref_y),
                    "kunta": kunta,
                })

    logger.info("  Loaded %d postal code areas", len(areas))
    return areas


def _flatten_coords(geom: dict) -> list[tuple[float, float]]:
    """Extract all (lon, lat) pairs from a GeoJSON geometry."""
    coords: list[tuple[float, float]] = []
    if geom["type"] == "Polygon":
        for ring in geom.get("coordinates", []):
            coords.extend((c[0], c[1]) for c in ring)
    elif geom["type"] == "MultiPolygon":
        for poly in geom.get("coordinates", []):
            for ring in poly:
                coords.extend((c[0], c[1]) for c in ring)
    return coords


# ---------------------------------------------------------------------------
# HSY: Helsinki metro air quality stations
# ---------------------------------------------------------------------------


def fetch_hsy_stations() -> list[dict]:
    """Fetch current air quality station data from HSY WFS.

    HSY provides real-time readings from ~13 monitoring stations across
    Helsinki, Espoo, and Vantaa.  The air quality index is on a 0-100+ scale
    where higher values indicate worse air quality.

    Returns list of dicts: name, lat, lon, aqi.
    """
    logger.info("Fetching HSY air quality station data...")

    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": HSY_LAYER,
        "outputFormat": "application/json",
    }

    try:
        resp = requests.get(HSY_WFS_URL, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.error("  HSY WFS request failed: %s", e)
        return []

    try:
        data = resp.json()
    except ValueError:
        logger.error("  HSY WFS returned invalid JSON")
        return []

    features = data.get("features", [])
    logger.info("  Received %d station features from HSY", len(features))

    stations: list[dict] = []
    for feat in features:
        props = feat.get("properties", {})
        geom = feat.get("geometry", {})

        # Extract AQ index -- try known field names first
        aqi = _extract_aqi_from_props(props)
        if aqi is None:
            continue

        coords = geom.get("coordinates")
        if not coords:
            continue

        # HSY coordinates are EPSG:3879 (GK25FIN) -- convert to WGS84
        x, y = float(coords[0]), float(coords[1])
        lat, lon = _epsg3879_to_wgs84(x, y)

        name = (
            props.get("nimi")
            or props.get("asema")
            or props.get("name")
            or "unknown"
        )
        stations.append({"name": name, "lat": lat, "lon": lon, "aqi": aqi})
        logger.info("    %s: AQI=%.0f (%.4f, %.4f)", name, aqi, lat, lon)

    logger.info("  Valid HSY stations: %d", len(stations))
    return stations


def _extract_aqi_from_props(props: dict) -> float | None:
    """Try to extract an air quality index value from feature properties."""
    # Try explicit field names
    for key in (
        "ilmanlaatu_indeksi", "indeksi", "index", "aqi",
        "ilmanlaatu_indeksi_num", "ilmanlaatui",
    ):
        val = props.get(key)
        if val is not None:
            try:
                v = float(val)
                if 0 < v <= 200 and v != -9999:
                    return v
            except (ValueError, TypeError):
                continue

    # Fallback: find first numeric property in AQ index range
    for key, val in props.items():
        if key.lower() in ("id", "gid", "fid", "objectid", "gml_id"):
            continue
        try:
            v = float(val)
            if 0 < v <= 200 and v != -9999:
                return v
        except (ValueError, TypeError):
            continue

    return None


def _epsg3879_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Approximate conversion from EPSG:3879 (GK25FIN) to WGS84.

    EPSG:3879 is a Transverse Mercator projection with central meridian 25E
    and false easting 25500000.  The values from HSY have an easting around
    25,490,000-25,510,000.
    """
    easting = x - 25_500_000.0
    northing = y

    # Iterative inverse Transverse Mercator (adequate for Finland)
    lat_deg = northing / 6_367_449.146 * (180.0 / math.pi)
    for _ in range(4):
        lat_r = math.radians(lat_deg)
        M = (
            6_367_449.146 * lat_r
            - 16_038.509 * math.sin(2 * lat_r)
            + 16.833 * math.sin(4 * lat_r)
        )
        lat_deg += (northing - M) / 6_367_449.146 * (180.0 / math.pi)

    lat_r = math.radians(lat_deg)
    cos_lat = math.cos(lat_r)
    if cos_lat == 0:
        return lat_deg, 25.0

    lon_offset = math.degrees(easting / (6_378_137.0 * cos_lat))
    return lat_deg, 25.0 + lon_offset


def assign_hsy_to_postal_codes(
    areas: list[dict], stations: list[dict],
) -> dict[str, float]:
    """Assign HSY station AQI to Helsinki metro postal codes by proximity."""
    logger.info("Assigning HSY data to Helsinki metro postal codes...")
    results: dict[str, float] = {}

    for area in areas:
        if area["pno"][:2] not in HELSINKI_METRO_PREFIXES:
            continue

        min_dist = float("inf")
        nearest_aqi: float | None = None
        for station in stations:
            d = haversine_km(area["lat"], area["lon"], station["lat"], station["lon"])
            if d < min_dist:
                min_dist = d
                nearest_aqi = station["aqi"]

        if nearest_aqi is not None:
            results[area["pno"]] = round(nearest_aqi, 1)

    logger.info("  Assigned AQI to %d Helsinki metro postal codes", len(results))
    return results


# ---------------------------------------------------------------------------
# FMI: Nationwide background station data
# ---------------------------------------------------------------------------


def fetch_fmi_stations() -> list[dict]:
    """Fetch air quality index from all available FMI observation stations.

    FMI currently provides data from ~7 background/rural stations nationwide.
    The index is on the Finnish 1-5 scale.

    Returns list of dicts: lat, lon, fmi_index, aqi (converted to 0-100 scale).
    """
    logger.info("Fetching FMI air quality observation data...")

    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "getFeature",
        "storedquery_id": FMI_STORED_QUERY,
        "parameters": "AQINDEX_PT1H_avg",
        "maxResults": "500",
    }

    try:
        resp = requests.get(FMI_WFS_URL, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.error("  FMI WFS request failed: %s", e)
        return []

    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError:
        logger.error("  FMI WFS returned invalid XML")
        return []

    ns = {
        "wfs": "http://www.opengis.net/wfs/2.0",
        "BsWfs": "http://xml.fmi.fi/schema/wfs/2.0",
        "gml": "http://www.opengis.net/gml/3.2",
    }

    # Collect all valid readings per unique station
    raw: dict[tuple[float, float], list[float]] = {}

    for member in root.findall(".//BsWfs:BsWfsElement", ns):
        loc = member.find("BsWfs:Location", ns)
        val_elem = member.find("BsWfs:ParameterValue", ns)
        if loc is None or val_elem is None:
            continue

        point = loc.find("gml:Point", ns)
        if point is None:
            continue
        pos = point.find("gml:pos", ns)
        if pos is None or not pos.text:
            continue

        val_text = val_elem.text
        if not val_text or val_text.strip().lower() == "nan":
            continue

        parts = pos.text.strip().split()
        if len(parts) != 2:
            continue

        try:
            lat, lon = float(parts[0]), float(parts[1])
            val = float(val_text.strip())
        except (ValueError, IndexError):
            continue

        if val <= 0:
            continue

        key = (round(lat, 5), round(lon, 5))
        raw.setdefault(key, []).append(val)

    stations: list[dict] = []
    for (lat, lon), values in raw.items():
        avg_fmi = sum(values) / len(values)
        aqi = _interpolate_lookup(avg_fmi, FMI_TO_AQ_INDEX)
        stations.append({
            "lat": lat, "lon": lon, "fmi_index": avg_fmi, "aqi": aqi,
        })
        logger.info(
            "    FMI station (%.2f, %.2f): FMI=%.1f -> AQI=%.1f",
            lat, lon, avg_fmi, aqi,
        )

    logger.info("  Found %d FMI stations with valid data", len(stations))
    return stations


# ---------------------------------------------------------------------------
# Tampere: NOx air quality modeling data
# ---------------------------------------------------------------------------


def fetch_tampere_nox_samples() -> list[dict]:
    """Fetch Tampere NOx air quality modeling zones from city WFS and convert
    each zone to a representative sample point with an AQI value.

    The Tampere NOx zones are in a Gauss-Kruger projection (easting ~24.5M).
    We convert each zone centroid to approximate WGS84 for proximity matching
    against postal code centroids.

    Returns list of dicts: lat, lon, nox_mid, aqi.
    """
    logger.info("Fetching Tampere NOx air quality modeling data...")

    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": TAMPERE_NOX_LAYER,
        "outputFormat": "application/json",
    }

    try:
        resp = requests.get(TAMPERE_WFS_URL, params=params, timeout=120)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.warning("  Tampere WFS request failed: %s", e)
        return []

    try:
        data = resp.json()
    except ValueError:
        logger.warning("  Tampere WFS returned invalid JSON")
        return []

    features = data.get("features", [])
    logger.info("  Received %d NOx zone features", len(features))

    samples: list[dict] = []
    for feat in features:
        props = feat.get("properties", {})
        geom = feat.get("geometry", {})

        conc_text = props.get("vuosi_ka_pitoisuus", "")
        if not conc_text:
            continue

        parsed = parse_nox_range(conc_text)
        if parsed is None:
            continue

        nox_lo, nox_hi = parsed
        nox_mid = (nox_lo + nox_hi) / 2
        aqi = _interpolate_lookup(nox_mid, NOX_TO_AQ_INDEX)

        coords = _flatten_geom_coords(geom)
        if not coords:
            continue

        # Compute centroid in native projection
        cx = sum(c[0] for c in coords) / len(coords)
        cy = sum(c[1] for c in coords) / len(coords)

        # Convert to WGS84 -- detect projection from coordinate magnitude
        # Tampere data: easting ~24,489,000 -> EPSG:3878 (GK24, CM=24E, FE=24,500,000)
        lat, lon = _gk_to_wgs84(cx, cy)

        samples.append({
            "lat": lat, "lon": lon,
            "nox_mid": nox_mid, "aqi": aqi,
        })

    logger.info("  Converted %d NOx zones to sample points", len(samples))
    if samples:
        aqi_vals = [s["aqi"] for s in samples]
        logger.info(
            "  NOx AQI range: %.1f - %.1f", min(aqi_vals), max(aqi_vals),
        )
    return samples


def _gk_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Convert Gauss-Kruger coordinates to WGS84.

    Auto-detects the GK zone from the easting magnitude:
      - ~24.5M easting -> EPSG:3878 (GK24, CM=24E, FE=24,500,000)
      - ~25.5M easting -> EPSG:3879 (GK25, CM=25E, FE=25,500,000)
    Falls back to EPSG:3879 for unrecognized magnitudes.
    """
    # Detect zone from the millions digit
    zone_prefix = int(x / 1_000_000)
    if zone_prefix == 24:
        false_easting = 24_500_000.0
        central_meridian = 24.0
    elif zone_prefix == 25:
        false_easting = 25_500_000.0
        central_meridian = 25.0
    else:
        # Fallback
        false_easting = 25_500_000.0
        central_meridian = 25.0

    easting = x - false_easting
    northing = y

    # Iterative inverse Transverse Mercator
    lat_deg = northing / 6_367_449.146 * (180.0 / math.pi)
    for _ in range(4):
        lat_r = math.radians(lat_deg)
        M = (
            6_367_449.146 * lat_r
            - 16_038.509 * math.sin(2 * lat_r)
            + 16.833 * math.sin(4 * lat_r)
        )
        lat_deg += (northing - M) / 6_367_449.146 * (180.0 / math.pi)

    lat_r = math.radians(lat_deg)
    cos_lat = math.cos(lat_r)
    if cos_lat == 0:
        return lat_deg, central_meridian

    lon_offset = math.degrees(easting / (6_378_137.0 * cos_lat))
    return lat_deg, central_meridian + lon_offset


def _flatten_geom_coords(geom: dict) -> list[tuple[float, float]]:
    """Extract all (x, y) pairs from any GeoJSON geometry."""
    coords: list[tuple[float, float]] = []
    gtype = geom.get("type", "")
    raw = geom.get("coordinates", [])
    if gtype == "Polygon":
        for ring in raw:
            coords.extend((c[0], c[1]) for c in ring)
    elif gtype == "MultiPolygon":
        for poly in raw:
            for ring in poly:
                coords.extend((c[0], c[1]) for c in ring)
    elif gtype == "Point" and raw:
        coords.append((raw[0], raw[1]))
    return coords


def assign_tampere_nox_to_postal_codes(
    areas: list[dict], samples: list[dict],
) -> dict[str, float]:
    """Assign Tampere NOx-derived AQI to postal codes by nearest sample.

    For each Tampere postal code centroid (in WGS84), find the nearest NOx
    sample point and assign its AQI.  If no sample is within 5 km, assign a
    clean suburban baseline.
    """
    logger.info("Assigning Tampere NOx data to postal codes...")

    if not samples:
        return {}

    results: dict[str, float] = {}
    tampere_areas = [a for a in areas if a["pno"][:2] in TAMPERE_PREFIXES]

    for area in tampere_areas:
        min_dist = float("inf")
        nearest_aqi: float | None = None

        for s in samples:
            d = haversine_km(area["lat"], area["lon"], s["lat"], s["lon"])
            if d < min_dist:
                min_dist = d
                nearest_aqi = s["aqi"]

        if nearest_aqi is not None and min_dist <= 5.0:
            results[area["pno"]] = round(nearest_aqi, 1)
        else:
            # Outside the modeled core -- assign clean suburban baseline
            results[area["pno"]] = 20.0

    logger.info("  Assigned AQI to %d Tampere postal codes", len(results))
    return results


# ---------------------------------------------------------------------------
# Turku: Distance-from-center estimation
# ---------------------------------------------------------------------------

# City center coordinates
TURKU_CENTER = (60.4518, 22.2666)
TAMPERE_CENTER = (61.4978, 23.7610)


def estimate_turku_aqi(
    areas: list[dict], fmi_stations: list[dict],
) -> dict[str, float]:
    """Estimate Turku AQI using FMI baseline + distance-from-center gradient.

    Helsinki spatial pattern (observed in existing data):
        center 0-2 km: ~42-48
        inner 2-5 km:  ~35-42
        suburb 5-10 km: ~28-35
        outer 10-20 km: ~20-28

    Turku is smaller, so the gradient is compressed:
        center 0-1.5 km: ~35-41
        inner 1.5-4 km:  ~28-35
        suburb 4-8 km:   ~22-28
        outer 8+ km:     ~18-22
    """
    logger.info("Estimating Turku region AQI...")

    # Rural floor from nearest FMI station (capped to avoid inversion)
    rural_floor = 18.0
    for s in fmi_stations:
        d = haversine_km(TURKU_CENTER[0], TURKU_CENTER[1], s["lat"], s["lon"])
        if d < 150:
            rural_floor = min(max(s["aqi"], rural_floor), 22.0)
            logger.info(
                "  FMI calibration: station at %.0f km, AQI=%.1f -> rural floor=%.1f",
                d, s["aqi"], rural_floor,
            )

    results: dict[str, float] = {}
    for area in areas:
        if area["pno"][:2] not in TURKU_PREFIXES:
            continue

        d = haversine_km(
            area["lat"], area["lon"], TURKU_CENTER[0], TURKU_CENTER[1],
        )

        if d < 1.5:
            aqi = 38.0 + (1.5 - d) * 3.0
        elif d < 4.0:
            aqi = 30.0 + (4.0 - d) / 2.5 * 8.0
        elif d < 8.0:
            aqi = 24.0 + (8.0 - d) / 4.0 * 6.0
        elif d < 20.0:
            aqi = rural_floor + (20.0 - d) / 12.0 * (24.0 - rural_floor)
        else:
            aqi = rural_floor

        results[area["pno"]] = round(aqi, 1)

    logger.info("  Estimated AQI for %d Turku postal codes", len(results))
    return results


# ---------------------------------------------------------------------------
# Fallback: distance + FMI estimation for any region
# ---------------------------------------------------------------------------


def _estimate_from_fmi(
    areas: list[dict],
    fmi_stations: list[dict],
    prefixes: tuple[str, ...],
    center: tuple[float, float],
    center_aqi: float,
    suburban_aqi: float,
    scale_km: float,
) -> dict[str, float]:
    """Estimate AQI using exponential decay from city center."""
    # Adjust suburban floor from nearest FMI station (cap to stay below center)
    for s in fmi_stations:
        d = haversine_km(center[0], center[1], s["lat"], s["lon"])
        if d < 100:
            suburban_aqi = min(max(s["aqi"], suburban_aqi), center_aqi * 0.6)

    results: dict[str, float] = {}
    for area in areas:
        if area["pno"][:2] not in prefixes:
            continue
        d = haversine_km(area["lat"], area["lon"], center[0], center[1])
        decay = math.exp(-d / scale_km)
        aqi = suburban_aqi + (center_aqi - suburban_aqi) * decay
        results[area["pno"]] = round(aqi, 1)
    return results


# ---------------------------------------------------------------------------
# Load existing data for fallback
# ---------------------------------------------------------------------------


def load_existing_data() -> dict[str, float]:
    """Load existing air_quality.json if present."""
    if not OUTPUT_FILE.exists():
        return {}
    try:
        with open(OUTPUT_FILE, encoding="utf-8") as f:
            data = json.load(f)
        logger.info("Loaded %d entries from existing %s", len(data), OUTPUT_FILE.name)
        return {k: float(v) for k, v in data.items()}
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Could not read existing data: %s", e)
        return {}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    logger.info("=" * 60)
    logger.info("Air quality data pipeline")
    logger.info("=" * 60)

    areas = load_postal_areas()
    if not areas:
        logger.error("No postal code areas loaded. Exiting.")
        sys.exit(1)

    hki_count = sum(1 for a in areas if a["pno"][:2] in HELSINKI_METRO_PREFIXES)
    tre_count = sum(1 for a in areas if a["pno"][:2] in TAMPERE_PREFIXES)
    tku_count = sum(1 for a in areas if a["pno"][:2] in TURKU_PREFIXES)
    logger.info(
        "Postal codes by region: Helsinki metro=%d, Tampere=%d, Turku=%d",
        hki_count, tre_count, tku_count,
    )

    existing = load_existing_data()
    results: dict[str, float] = {}

    # --- Phase 1: Helsinki metro ---
    # Prefer ENFUSER-based postal averages (spatially modeled at ~250 m)
    # over nearest-station assignment (only ~13 stations).
    enfuser_file = SCRIPT_DIR / "air_quality_enfuser.json"
    enfuser_results: dict[str, float] = {}
    if enfuser_file.exists():
        try:
            with open(enfuser_file, encoding="utf-8") as f:
                enfuser_results = {k: float(v) for k, v in json.load(f).items()}
            logger.info(
                "Loaded ENFUSER postal averages: %d postal codes",
                len(enfuser_results),
            )
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("Could not read ENFUSER data: %s", e)

    if len(enfuser_results) >= hki_count * 0.5:
        results.update(enfuser_results)
        logger.info(
            "Helsinki metro: %d postal codes from ENFUSER model",
            len(enfuser_results),
        )
    else:
        # Fall back to HSY nearest-station assignment
        logger.info("ENFUSER data insufficient, falling back to HSY stations")
        hsy_stations = fetch_hsy_stations()
        if hsy_stations:
            hsy_results = assign_hsy_to_postal_codes(areas, hsy_stations)
            if len(hsy_results) >= hki_count * 0.5:
                results.update(hsy_results)
                logger.info(
                    "Helsinki metro: %d postal codes from HSY live data",
                    len(hsy_results),
                )
            else:
                logger.warning(
                    "HSY covered only %d/%d Helsinki postal codes -- "
                    "using existing data as fallback",
                    len(hsy_results), hki_count,
                )
                for pno, val in existing.items():
                    if pno[:2] in HELSINKI_METRO_PREFIXES:
                        results[pno] = val
        else:
            logger.warning("HSY unavailable -- preserving existing Helsinki data")
            for pno, val in existing.items():
                if pno[:2] in HELSINKI_METRO_PREFIXES:
                    results[pno] = val

    # --- Phase 2: FMI nationwide background ---
    fmi_stations = fetch_fmi_stations()

    # --- Phase 3: Tampere ---
    tampere_samples = fetch_tampere_nox_samples()
    if tampere_samples:
        tre_results = assign_tampere_nox_to_postal_codes(areas, tampere_samples)
        if tre_results:
            results.update(tre_results)
            logger.info(
                "Tampere: %d postal codes from NOx modeling", len(tre_results),
            )
    else:
        logger.info(
            "Tampere NOx data unavailable -- using FMI + distance estimation",
        )
        tre_results = _estimate_from_fmi(
            areas, fmi_stations, TAMPERE_PREFIXES,
            center=TAMPERE_CENTER,
            center_aqi=35.0, suburban_aqi=20.0, scale_km=12.0,
        )
        results.update(tre_results)
        logger.info("Tampere: %d postal codes from distance model", len(tre_results))

    # --- Phase 4: Turku ---
    tku_results = estimate_turku_aqi(areas, fmi_stations)
    if tku_results:
        results.update(tku_results)

    # --- Validate ---
    if not results:
        logger.error(
            "No air quality data produced from any source. "
            "Exiting without overwriting %s.",
            OUTPUT_FILE.name,
        )
        sys.exit(1)

    total_areas = len(areas)
    coverage = len(results) / total_areas * 100
    logger.info(
        "Total coverage: %d/%d postal codes (%.1f%%)",
        len(results), total_areas, coverage,
    )

    hki_final = sum(1 for k in results if k[:2] in HELSINKI_METRO_PREFIXES)
    tre_final = sum(1 for k in results if k[:2] in TAMPERE_PREFIXES)
    tku_final = sum(1 for k in results if k[:2] in TURKU_PREFIXES)
    logger.info(
        "  Helsinki metro: %d, Tampere: %d, Turku: %d",
        hki_final, tre_final, tku_final,
    )

    values = list(results.values())
    logger.info(
        "  AQI range: %.1f - %.1f, mean: %.1f",
        min(values), max(values), sum(values) / len(values),
    )

    sorted_results = dict(sorted(results.items()))
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted_results, f, indent=2)
    logger.info("Wrote %d postal codes to %s", len(results), OUTPUT_FILE.name)


if __name__ == "__main__":
    main()
