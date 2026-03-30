#!/usr/bin/env python3
"""Fetch traffic accident data from Vaylavirasto (Finnish Transport Infrastructure
Agency) open data WFS and compute accidents per 1,000 residents per postal code.

Data source
-----------
Vaylavirasto open traffic accident register, served via OGC WFS:
  Endpoint : https://avoinapi.vaylapilvi.fi/vaylatiedot/ows
  Layer    : onnettomuudet
  CRS      : EPSG:3067 (ETRS-TM35FIN) natively; we request WGS84 output
  Docs     : https://vayla.fi/en/transport-network/data/open-data/api
  Licence  : CC BY 4.0

Method
------
1. Fetch accident point data (WFS GetFeature, GeoJSON) for three regions
   (Helsinki metro, Turku, Tampere) for the most recent three calendar years.
2. Load postal code boundary polygons from the project GeoJSON.
3. Spatial-join each accident point to its postal code area using geopandas.
4. Count accidents per postal code, normalise by population
   (he_vakiy field) to get accidents per 1,000 residents per year.
5. Save the result as scripts/traffic_accidents.json.

Output: scripts/traffic_accidents.json
Format: {"00100": 2.7, "00120": 1.3, ...}

Usage:
    python scripts/fetch_traffic_accidents.py
"""
from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from pyproj import Transformer
from shapely.geometry import Point

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_PATH = SCRIPT_DIR / "traffic_accidents.json"
CACHE_DIR = SCRIPT_DIR / "cache"

# ---------------------------------------------------------------------------
# WFS configuration
# ---------------------------------------------------------------------------

WFS_URL = "https://avoinapi.vaylapilvi.fi/vaylatiedot/ows"
LAYER_NAME = "onnettomuudet"

# Years to fetch -- three most recent full calendar years give a stable rate.
YEARS = [2022, 2023, 2024]
NUM_YEARS = len(YEARS)

# Bounding boxes in WGS84 (lat_min, lon_min, lat_max, lon_max).
# These are converted to EPSG:3067 for the CQL_FILTER BBOX clause because
# the WFS layer stores geometries in EPSG:3067.
REGION_BBOXES_WGS84 = {
    "helsinki_metro": (60.10, 24.50, 60.40, 25.25),
    "turku": (60.25, 21.50, 60.75, 22.90),
    "tampere": (61.20, 23.10, 62.20, 25.00),
}

# Minimum postal-code population for computing rates.  Areas below this
# threshold (industrial zones, harbours, etc.) produce unreliable rates.
MIN_POPULATION = 50

# ---------------------------------------------------------------------------
# Retry / rate-limit
# ---------------------------------------------------------------------------

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 3  # seconds; exponential: 3, 9, 27
RATE_LIMIT_DELAY = 2.0  # seconds between successive WFS calls

# ---------------------------------------------------------------------------
# Cache helpers (same pattern as other scripts in this project)
# ---------------------------------------------------------------------------


def _cache_path(key: str) -> Path:
    safe = (
        key.replace("/", "_")
        .replace(":", "_")
        .replace("?", "_")
        .replace("&", "_")
        .replace(" ", "_")
    )
    return CACHE_DIR / f"{safe}.json"


def _save_cache(key: str, data: object) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(key)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    logger.info("  Cached response -> %s", path.name)


def _load_cache(key: str) -> object | None:
    path = _cache_path(key)
    if path.exists():
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        logger.info("  Loaded from cache: %s", path.name)
        return data
    return None


# ---------------------------------------------------------------------------
# HTTP helper with retries
# ---------------------------------------------------------------------------


def _request_with_retry(
    method: str,
    url: str,
    *,
    label: str,
    retries: int = MAX_RETRIES,
    **kwargs: object,
) -> requests.Response:
    """Execute an HTTP request with exponential-backoff retries."""
    kwargs.setdefault("timeout", 120)
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.request(method, url, **kwargs)
            r.raise_for_status()
            return r
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                wait = RETRY_BACKOFF_BASE**attempt
                logger.warning(
                    "  Retry %d/%d for %s in %ds (%s)",
                    attempt,
                    retries,
                    label,
                    wait,
                    exc,
                )
                time.sleep(wait)
    raise last_exc  # type: ignore[misc]


def _rate_limit() -> None:
    """Sleep briefly between API calls to be a good citizen."""
    time.sleep(RATE_LIMIT_DELAY)


# ---------------------------------------------------------------------------
# Convert WGS84 bounding boxes to EPSG:3067 for CQL_FILTER
# ---------------------------------------------------------------------------

_transformer_4326_to_3067 = Transformer.from_crs(
    "EPSG:4326", "EPSG:3067", always_xy=True
)


def _bbox_wgs84_to_3067(
    lat_min: float, lon_min: float, lat_max: float, lon_max: float
) -> str:
    """Return ``xmin,ymin,xmax,ymax`` string in EPSG:3067."""
    x_min, y_min = _transformer_4326_to_3067.transform(lon_min, lat_min)
    x_max, y_max = _transformer_4326_to_3067.transform(lon_max, lat_max)
    return f"{x_min:.0f},{y_min:.0f},{x_max:.0f},{y_max:.0f}"


# ---------------------------------------------------------------------------
# Fetch accidents from WFS
# ---------------------------------------------------------------------------


def _build_year_filter(years: list[int]) -> str:
    """Build a CQL OR clause matching ``onnettomuuden_tapahtumapvm`` for *years*.

    The WFS field stores dates as ``MM/YYYY`` strings, so we use LIKE
    patterns to match by year.
    """
    clauses = [f"onnettomuuden_tapahtumapvm LIKE '%/{y}'" for y in years]
    return "(" + " OR ".join(clauses) + ")"


def fetch_accidents_for_region(
    region_name: str,
    bbox_wgs84: tuple[float, float, float, float],
    years: list[int],
) -> list[dict]:
    """Fetch accident GeoJSON features for a single region and year range.

    Returns a list of GeoJSON feature dicts with WGS84 coordinates.
    Falls back to cache if the API request fails.
    """
    cache_key = f"accidents_{region_name}_{'_'.join(str(y) for y in years)}"
    bbox_3067 = _bbox_wgs84_to_3067(*bbox_wgs84)
    year_filter = _build_year_filter(years)
    cql = f"BBOX(geometry,{bbox_3067}) AND {year_filter}"

    params = {
        "service": "wfs",
        "request": "GetFeature",
        "typeName": LAYER_NAME,
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "CQL_FILTER": cql,
        "count": "10000",
    }

    logger.info(
        "Fetching accidents for %s (%s)...",
        region_name,
        ", ".join(str(y) for y in years),
    )

    try:
        r = _request_with_retry(
            "GET", WFS_URL, label=f"accidents {region_name}", params=params
        )
        data = r.json()

        if "features" not in data:
            logger.error(
                "  Unexpected WFS response for %s: %s",
                region_name,
                str(data)[:300],
            )
            raise ValueError("No 'features' key in WFS response")

        features = data["features"]
        logger.info(
            "  Fetched %d accident features for %s", len(features), region_name
        )
        _save_cache(cache_key, features)
        return features

    except Exception as exc:
        logger.warning(
            "  Fetch failed for %s: %s -- trying cache...", region_name, exc
        )
        cached = _load_cache(cache_key)
        if cached is not None and isinstance(cached, list):
            logger.info(
                "  Using cached data for %s (%d features)",
                region_name,
                len(cached),
            )
            return cached
        logger.error("  No cached data available for %s either.", region_name)
        return []


def fetch_all_accidents() -> list[dict]:
    """Fetch accidents for all regions and return a combined, deduplicated
    list of GeoJSON feature dicts.
    """
    all_features: list[dict] = []
    first = True

    for region_name, bbox in REGION_BBOXES_WGS84.items():
        if not first:
            _rate_limit()
        first = False
        features = fetch_accidents_for_region(region_name, bbox, YEARS)
        all_features.extend(features)

    # Deduplicate by internal_id (bounding boxes may overlap at region borders)
    seen: set[int] = set()
    unique: list[dict] = []
    for feat in all_features:
        iid = feat.get("properties", {}).get("internal_id")
        if iid is not None:
            if iid in seen:
                continue
            seen.add(iid)
        unique.append(feat)

    logger.info(
        "Total unique accident features: %d (deduped from %d)",
        len(unique),
        len(all_features),
    )
    return unique


# ---------------------------------------------------------------------------
# Spatial join: assign each accident to a postal code area
# ---------------------------------------------------------------------------


def spatial_join_accidents(
    accident_features: list[dict],
    postal_gdf: gpd.GeoDataFrame,
) -> pd.DataFrame:
    """Join accident points to postal code polygons.

    Returns a DataFrame with at least columns ``pno`` and ``he_vakiy``
    (one row per matched accident).
    """
    logger.info("Building accident GeoDataFrame (%d points)...", len(accident_features))

    points = []
    for feat in accident_features:
        coords = feat["geometry"]["coordinates"]
        # coords may be [lon, lat] or [lon, lat, z]
        lon, lat = coords[0], coords[1]
        points.append(Point(lon, lat))

    accidents_gdf = gpd.GeoDataFrame(
        {"idx": range(len(points))},
        geometry=points,
        crs="EPSG:4326",
    )

    logger.info("Performing spatial join...")
    joined = gpd.sjoin(
        accidents_gdf,
        postal_gdf[["pno", "he_vakiy", "geometry"]],
        how="inner",
        predicate="within",
    )
    logger.info(
        "  Matched %d of %d accidents to postal code areas",
        len(joined),
        len(accidents_gdf),
    )
    return joined


# ---------------------------------------------------------------------------
# Compute per-postal-code accident rate
# ---------------------------------------------------------------------------


def compute_accident_rates(joined: pd.DataFrame) -> dict[str, float]:
    """Compute accidents per 1,000 residents per year for each postal code.

    The rate is: ``(total_accidents / num_years) / (population / 1000)``.

    Returns ``{postal_code: rate, ...}`` rounded to one decimal place.
    """
    logger.info("Computing accident rates per postal code...")

    counts = joined.groupby("pno").size().reset_index(name="accident_count")
    pop = joined.groupby("pno")["he_vakiy"].first().reset_index()
    merged = counts.merge(pop, on="pno")

    results: dict[str, float] = {}
    low_pop_skipped = 0

    for _, row in merged.iterrows():
        pno = str(row["pno"])
        count = int(row["accident_count"])
        population = row["he_vakiy"]

        if population is None or population < MIN_POPULATION:
            low_pop_skipped += 1
            continue

        annual_accidents = count / NUM_YEARS
        rate = annual_accidents / (population / 1000.0)
        results[pno] = round(rate, 1)

    logger.info(
        "  Computed rates for %d postal codes (skipped %d with population < %d)",
        len(results),
        low_pop_skipped,
        MIN_POPULATION,
    )
    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    logger.info("=" * 60)
    logger.info("Traffic accident rate calculator")
    logger.info("  Data source: Vaylavirasto open accident register (WFS)")
    logger.info("  Endpoint: %s", WFS_URL)
    logger.info("  Layer: %s", LAYER_NAME)
    logger.info("  Years: %s", ", ".join(str(y) for y in YEARS))
    logger.info("=" * 60)

    # --- Validate prerequisites -------------------------------------------
    if not GEOJSON_PATH.exists():
        logger.error("GeoJSON not found at %s", GEOJSON_PATH)
        sys.exit(1)

    # --- Step 1: Fetch accident data from WFS -----------------------------
    accident_features = fetch_all_accidents()
    if not accident_features:
        logger.error(
            "No accident data fetched from the Vaylavirasto WFS. "
            "The API may be temporarily unavailable. Exiting."
        )
        sys.exit(1)

    # --- Step 2: Load postal code boundaries ------------------------------
    logger.info("Loading postal code boundaries from %s", GEOJSON_PATH)
    postal_gdf = gpd.read_file(GEOJSON_PATH)
    logger.info("  Loaded %d postal code areas", len(postal_gdf))

    # Ensure he_vakiy is numeric
    postal_gdf["he_vakiy"] = pd.to_numeric(postal_gdf["he_vakiy"], errors="coerce")

    # --- Step 3: Spatial join ---------------------------------------------
    joined = spatial_join_accidents(accident_features, postal_gdf)
    if joined.empty:
        logger.error("No accidents matched any postal code area. Exiting.")
        sys.exit(1)

    # --- Step 4: Compute rates --------------------------------------------
    rates = compute_accident_rates(joined)
    if not rates:
        logger.error("No accident rates computed. Exiting.")
        sys.exit(1)

    # --- Step 5: Save results ---------------------------------------------
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(rates, f, indent=2, sort_keys=True, ensure_ascii=False)
    logger.info("Saved results to %s (%d entries)", OUTPUT_PATH, len(rates))

    # --- Summary statistics -----------------------------------------------
    values = list(rates.values())
    if values:
        sorted_vals = sorted(values)
        logger.info(
            "  Min rate:    %.1f per 1,000 residents/year", min(values)
        )
        logger.info(
            "  Max rate:    %.1f per 1,000 residents/year", max(values)
        )
        logger.info(
            "  Mean rate:   %.1f per 1,000 residents/year",
            sum(values) / len(values),
        )
        logger.info(
            "  Median rate: %.1f per 1,000 residents/year",
            sorted_vals[len(sorted_vals) // 2],
        )

    logger.info("Done.")


if __name__ == "__main__":
    main()
