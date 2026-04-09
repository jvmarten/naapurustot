#!/usr/bin/env python3
"""
Fetch fine-grained air quality grid data from FMI's ENFUSER model and
generate a GeoJSON grid for the Helsinki metropolitan area.

Data source:
  FMI ENFUSER air quality forecast (near real-time)
  ~13 m native resolution, aggregated here to ~250 m grid cells.
  Stored query: fmi::forecast::enfuser::airquality::helsinki-metropolitan::grid
  Parameters: AQIndex (1-5 scale), NO2, PM2.5, PM10, O3

Method:
  1. Download ENFUSER NetCDF from FMI open data for Helsinki metro bbox.
  2. Read the native-resolution grid (~13 m cells).
  3. Aggregate into ~250 m output cells by averaging.
  4. Clip to the metro area boundary (point-in-polygon against neighborhoods).
  5. Convert FMI AQ index (1-5) to our 0-100 scale.
  6. Output GeoJSON for map rendering + JSON for postal code aggregation.

Output:
  public/data/air_quality_grid.geojson  (grid cells for map display)
  scripts/air_quality_enfuser.json      (postal code averages from grid)

Usage:
    python scripts/fetch_air_quality_grid.py
"""
from __future__ import annotations

import json
import logging
import math
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests

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
ROOT_DIR = SCRIPT_DIR.parent
GEOJSON_PATH = ROOT_DIR / "public" / "data" / "metro_neighborhoods.geojson"
GRID_OUTPUT = ROOT_DIR / "public" / "data" / "air_quality_grid.geojson"
POSTAL_OUTPUT = SCRIPT_DIR / "air_quality_enfuser.json"

# ---------------------------------------------------------------------------
# FMI ENFUSER API
# ---------------------------------------------------------------------------

FMI_DOWNLOAD_URL = "https://opendata.fmi.fi/download"
ENFUSER_PRODUCER = "enfuser_helsinki_metropolitan"

# Helsinki metro bounding box (covers postal codes 00*, 01*, 02*)
# Slightly padded to ensure full coverage
METRO_BBOX = "24.45,60.05,25.27,60.42"

# Output grid cell size (~250 m at 60°N)
# 250 m ≈ 0.00449° latitude, ≈ 0.00898° longitude at cos(60°)
CELL_LAT = 0.00225
CELL_LNG = 0.0045

# FMI AQ index (1-5 continuous) to our 0-100 scale conversion.
# Calibrated to match existing postal-code values:
#   suburban clean air (FMI ~1.0) → 15-20 on our scale
#   city center traffic (FMI ~2.5-3.5) → 39-55
ENFUSER_TO_AQ_SCALE = 16.25
ENFUSER_TO_AQ_OFFSET = 15.0

REQUEST_TIMEOUT = 120

# Helsinki metro postal code prefixes
HELSINKI_METRO_PREFIXES = ("00", "01", "02")


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def point_in_polygon(px: float, py: float, polygon: list) -> bool:
    """Ray-casting point-in-polygon test."""
    inside = False
    n = len(polygon)
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i][0], polygon[i][1]
        xj, yj = polygon[j][0], polygon[j][1]
        if ((yi > py) != (yj > py)) and (
            px < (xj - xi) * (py - yi) / (yj - yi) + xi
        ):
            inside = not inside
        j = i
    return inside


def point_in_multipolygon(px: float, py: float, multipolygon: list) -> bool:
    """Check if point is inside a MultiPolygon geometry."""
    for polygon in multipolygon:
        exterior = polygon[0]
        if point_in_polygon(px, py, exterior):
            in_hole = False
            for hole in polygon[1:]:
                if point_in_polygon(px, py, hole):
                    in_hole = True
                    break
            if not in_hole:
                return True
    return False


def point_in_feature(px: float, py: float, geom: dict) -> bool:
    """Check if point is inside a GeoJSON geometry."""
    gtype = geom.get("type", "")
    coords = geom.get("coordinates", [])
    if gtype == "Polygon":
        return point_in_multipolygon(px, py, [coords])
    elif gtype == "MultiPolygon":
        return point_in_multipolygon(px, py, coords)
    return False


# ---------------------------------------------------------------------------
# FMI ENFUSER data fetch
# ---------------------------------------------------------------------------


def fetch_enfuser_netcdf(param: str = "AQIndex") -> bytes | None:
    """Download ENFUSER NetCDF from FMI for the Helsinki metro area.

    Fetches the most recent available data (last few hours).
    """
    now = datetime.now(timezone.utc)
    # ENFUSER updates hourly; request a 2-hour window ending now
    end_time = now.replace(minute=0, second=0, microsecond=0)
    start_time = end_time - timedelta(hours=1)

    params = {
        "producer": ENFUSER_PRODUCER,
        "param": param,
        "bbox": METRO_BBOX,
        "levels": "0",
        "starttime": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endtime": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "format": "netcdf",
        "projection": "EPSG:4326",
    }

    logger.info(
        "Fetching ENFUSER %s data for bbox %s, time %s...",
        param, METRO_BBOX, start_time.isoformat(),
    )

    try:
        resp = requests.get(
            FMI_DOWNLOAD_URL, params=params, timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.error("FMI download failed: %s", e)
        return None

    if len(resp.content) < 200:
        logger.error(
            "FMI returned suspiciously small response (%d bytes): %s",
            len(resp.content), resp.text[:200],
        )
        return None

    logger.info("  Downloaded %d bytes", len(resp.content))
    return resp.content


def parse_enfuser_netcdf(data: bytes) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Parse ENFUSER NetCDF and return (lats, lons, values) arrays.

    Returns the time-averaged 2D grid of AQ index values.
    """
    import netCDF4 as nc

    tmp = tempfile.NamedTemporaryFile(suffix=".nc", delete=False)
    try:
        tmp.write(data)
        tmp.close()

        ds = nc.Dataset(tmp.name)

        # Find the data variable (name varies, e.g. index_of_airquality_194)
        data_var = None
        for vname in ds.variables:
            if vname not in ("time", "crs", "lat", "lon", "latitude", "longitude"):
                var = ds.variables[vname]
                if len(var.shape) >= 2:
                    data_var = vname
                    break

        if data_var is None:
            logger.error("No data variable found in NetCDF")
            ds.close()
            return None

        logger.info("  Data variable: %s, shape: %s", data_var, ds.variables[data_var].shape)

        lats = ds.variables["lat"][:].data
        lons = ds.variables["lon"][:].data
        raw = ds.variables[data_var][:].data  # shape: (time, lat, lon)

        # Handle fill values / masked data
        fill_value = getattr(ds.variables[data_var], "_FillValue", None)
        if fill_value is not None:
            raw = np.where(raw == fill_value, np.nan, raw)

        # Average over time dimension
        if raw.ndim == 3:
            with np.errstate(invalid="ignore"):
                values = np.nanmean(raw, axis=0)  # shape: (lat, lon)
        else:
            values = raw

        logger.info(
            "  Grid: %d lat × %d lon, value range: %.2f - %.2f",
            len(lats), len(lons),
            np.nanmin(values), np.nanmax(values),
        )

        ds.close()
        return lats, lons, values
    finally:
        os.unlink(tmp.name)


# ---------------------------------------------------------------------------
# Grid aggregation
# ---------------------------------------------------------------------------


def enfuser_to_aq_index(fmi_value: float) -> float:
    """Convert ENFUSER/FMI AQ index (1-5 continuous) to our 0-100 scale."""
    return ENFUSER_TO_AQ_OFFSET + (fmi_value - 1.0) * ENFUSER_TO_AQ_SCALE


def aggregate_to_grid(
    lats: np.ndarray,
    lons: np.ndarray,
    values: np.ndarray,
    neighborhoods: list[dict],
) -> list[dict]:
    """Aggregate ENFUSER native grid to ~250 m output cells.

    For each output cell:
    1. Average the ENFUSER pixels that fall within it.
    2. Check that the cell center is inside the metro area.
    3. Convert to our AQ index scale.
    """
    min_lat, max_lat = float(lats.min()), float(lats.max())
    min_lon, max_lon = float(lons.min()), float(lons.max())

    n_rows = int(math.ceil((max_lat - min_lat) / CELL_LAT))
    n_cols = int(math.ceil((max_lon - min_lon) / CELL_LNG))

    logger.info(
        "  Aggregating to %d × %d output cells (%.0f m resolution)...",
        n_cols, n_rows, CELL_LAT * 111_300,
    )

    # Pre-compute ENFUSER pixel row/col → output cell mapping
    # For each ENFUSER lat, find which output row it belongs to
    enfuser_row_to_out = np.floor((lats - min_lat) / CELL_LAT).astype(int)
    enfuser_col_to_out = np.floor((lons - min_lon) / CELL_LNG).astype(int)

    # Accumulate values into output cells
    cell_sum = np.zeros((n_rows, n_cols), dtype=np.float64)
    cell_count = np.zeros((n_rows, n_cols), dtype=np.int32)

    for r_idx in range(len(lats)):
        out_r = enfuser_row_to_out[r_idx]
        if out_r < 0 or out_r >= n_rows:
            continue
        for c_idx in range(len(lons)):
            out_c = enfuser_col_to_out[c_idx]
            if out_c < 0 or out_c >= n_cols:
                continue
            v = values[r_idx, c_idx]
            if not np.isnan(v) and v > 0:
                cell_sum[out_r, out_c] += v
                cell_count[out_r, out_c] += 1

    # Build GeoJSON features
    features = []
    skipped_outside = 0

    for row in range(n_rows):
        cell_min_lat = min_lat + row * CELL_LAT
        cell_max_lat = cell_min_lat + CELL_LAT
        center_lat = (cell_min_lat + cell_max_lat) / 2

        for col in range(n_cols):
            if cell_count[row, col] == 0:
                continue

            cell_min_lng = min_lon + col * CELL_LNG
            cell_max_lng = cell_min_lng + CELL_LNG
            center_lng = (cell_min_lng + cell_max_lng) / 2

            # Check if cell center is inside any neighborhood
            inside = False
            for n in neighborhoods:
                if point_in_feature(center_lng, center_lat, n["geometry"]):
                    inside = True
                    break

            if not inside:
                skipped_outside += 1
                continue

            avg_fmi = cell_sum[row, col] / cell_count[row, col]
            aq_index = round(enfuser_to_aq_index(avg_fmi), 1)

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [round(cell_min_lng, 6), round(cell_min_lat, 6)],
                        [round(cell_max_lng, 6), round(cell_min_lat, 6)],
                        [round(cell_max_lng, 6), round(cell_max_lat, 6)],
                        [round(cell_min_lng, 6), round(cell_max_lat, 6)],
                        [round(cell_min_lng, 6), round(cell_min_lat, 6)],
                    ]],
                },
                "properties": {
                    "air_quality": aq_index,
                },
            })

        if row % 20 == 0:
            logger.info("    Row %d/%d (%d cells so far)", row, n_rows, len(features))

    logger.info(
        "  Generated %d grid cells (%d skipped outside metro area)",
        len(features), skipped_outside,
    )
    return features


# ---------------------------------------------------------------------------
# Postal code aggregation from grid
# ---------------------------------------------------------------------------


def aggregate_to_postal_codes(
    grid_features: list[dict],
    neighborhoods: list[dict],
) -> dict[str, float]:
    """Compute average AQ index per postal code from pre-built grid cells.

    Uses the already-aggregated ~250 m grid cells (much faster than iterating
    through millions of raw ENFUSER pixels). For each grid cell center, finds
    which postal code it belongs to and accumulates the average.
    """
    logger.info("Computing postal code averages from grid cells...")

    hki_neighborhoods = [
        n for n in neighborhoods
        if n.get("pno", "")[:2] in HELSINKI_METRO_PREFIXES
    ]

    # Extract grid cell centers and values
    cells = []
    for feat in grid_features:
        coords = feat["geometry"]["coordinates"][0]
        cx = (coords[0][0] + coords[2][0]) / 2
        cy = (coords[0][1] + coords[2][1]) / 2
        cells.append((cx, cy, feat["properties"]["air_quality"]))

    logger.info("  %d grid cells against %d postal codes", len(cells), len(hki_neighborhoods))

    # For each postal code, find grid cells inside it
    results: dict[str, float] = {}
    for n_idx, nbr in enumerate(hki_neighborhoods):
        pno = nbr["pno"]
        geom = nbr["geometry"]
        total = 0.0
        count = 0

        for cx, cy, aq in cells:
            if point_in_feature(cx, cy, geom):
                total += aq
                count += 1

        if count > 0:
            results[pno] = round(total / count, 1)

        if (n_idx + 1) % 40 == 0:
            logger.info(
                "    %d/%d postal codes processed (%d with data)",
                n_idx + 1, len(hki_neighborhoods), len(results),
            )

    logger.info("  Computed averages for %d postal codes", len(results))
    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    logger.info("=" * 60)
    logger.info("ENFUSER air quality grid pipeline")
    logger.info("=" * 60)

    # Load neighborhoods
    if not GEOJSON_PATH.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_PATH)
        sys.exit(1)

    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)

    neighborhoods = []
    for feat in geojson["features"]:
        props = feat.get("properties", {})
        pno = props.get("pno", "")
        geom = feat.get("geometry")
        if pno and geom:
            neighborhoods.append({
                "pno": pno,
                "geometry": geom,
            })

    hki_count = sum(
        1 for n in neighborhoods
        if n["pno"][:2] in HELSINKI_METRO_PREFIXES
    )
    logger.info("Loaded %d neighborhoods (%d Helsinki metro)", len(neighborhoods), hki_count)

    # Fetch ENFUSER data
    nc_data = fetch_enfuser_netcdf("AQIndex")
    if nc_data is None:
        logger.error("Failed to fetch ENFUSER data. Exiting.")
        sys.exit(1)

    parsed = parse_enfuser_netcdf(nc_data)
    if parsed is None:
        logger.error("Failed to parse ENFUSER NetCDF. Exiting.")
        sys.exit(1)

    lats, lons, values = parsed

    # Filter to Helsinki metro neighborhoods only for grid clipping
    hki_neighborhoods = [
        n for n in neighborhoods
        if n["pno"][:2] in HELSINKI_METRO_PREFIXES
    ]

    # Generate grid GeoJSON
    grid_features = aggregate_to_grid(lats, lons, values, hki_neighborhoods)

    if not grid_features:
        logger.error("No grid cells generated. Exiting.")
        sys.exit(1)

    # Stats
    aq_vals = [f["properties"]["air_quality"] for f in grid_features]
    logger.info(
        "  AQ index range: %.1f - %.1f, mean: %.1f, median: %.1f",
        min(aq_vals), max(aq_vals),
        sum(aq_vals) / len(aq_vals),
        sorted(aq_vals)[len(aq_vals) // 2],
    )

    # Write grid GeoJSON
    grid_geojson = {
        "type": "FeatureCollection",
        "features": grid_features,
    }
    with open(GRID_OUTPUT, "w", encoding="utf-8") as f:
        json.dump(grid_geojson, f)

    size_mb = os.path.getsize(GRID_OUTPUT) / 1024 / 1024
    logger.info("Wrote %s (%.1f MB, %d cells)", GRID_OUTPUT, size_mb, len(grid_features))

    # Aggregate to postal codes (using pre-built grid cells for speed)
    postal_results = aggregate_to_postal_codes(grid_features, neighborhoods)

    if postal_results:
        sorted_results = dict(sorted(postal_results.items()))
        with open(POSTAL_OUTPUT, "w", encoding="utf-8") as f:
            json.dump(sorted_results, f, indent=2)
        logger.info(
            "Wrote %s (%d postal codes)",
            POSTAL_OUTPUT, len(postal_results),
        )

    logger.info("Done!")


if __name__ == "__main__":
    main()
