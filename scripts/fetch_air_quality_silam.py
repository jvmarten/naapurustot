#!/usr/bin/env python3
"""
Fetch FMI SILAM nationwide air quality forecast and assign values to every
Finnish postal code. Fills in coverage outside the high-resolution cities
(Helsinki metro from HSY/ENFUSER, Tampere NOx modelling, Turku gradient).

Data source:
  FMI SILAM Europe air quality forecast (operational model run by FMI).
  Covers all of Europe (incl. all of Finland) at ~5-10 km grid resolution.
  Downloaded as NetCDF from FMI open data, same /download endpoint as the
  ENFUSER fetcher.

  Stored producer names change between SILAM model versions, so we try a
  short list of known producers and use whichever responds first.

Method:
  1. Load postal-code centroids from public/data/metro_neighborhoods.geojson.
  2. Download one SILAM NetCDF over the Finland bounding box.
  3. For each postal-code centroid, sample the nearest grid cell.
  4. Convert FMI AQ index (1-5 continuous) to our 0-100 scale, matching the
     calibration used by the ENFUSER pipeline.
  5. Write scripts/air_quality_silam.json.

The output file is consumed by scripts/fetch_air_quality.py as a final
nationwide fill-in phase. It NEVER overrides higher-resolution data from
HSY/ENFUSER (Helsinki metro), Tampere NOx, or Turku.

Output: scripts/air_quality_silam.json  {"postal_code": air_quality_index}
Scale: 0-100+, higher = worse air quality.

Usage:
    python scripts/fetch_air_quality_silam.py
    python scripts/fetch_air_quality_silam.py --producer silam_europe_v5_8
"""
from __future__ import annotations

import argparse
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
OUTPUT_FILE = SCRIPT_DIR / "air_quality_silam.json"

# ---------------------------------------------------------------------------
# FMI SILAM API
# ---------------------------------------------------------------------------

FMI_DOWNLOAD_URL = "https://opendata.fmi.fi/download"

# Candidate SILAM producer names. FMI rotates these as model versions change;
# we try each until one returns a usable NetCDF.
SILAM_PRODUCERS = (
    "silam_europe_v5_8",
    "silam_europe_v5_7",
    "silam_europe",
)

# Bounding box covering all of mainland Finland and Ahvenanmaa.
# Slightly padded so postal codes near the borders fall well inside the grid.
FINLAND_BBOX = "19.0,59.5,32.0,70.5"

# Same FMI AQ index (1-5 continuous) -> our 0-100 scale conversion as ENFUSER.
# Calibrated so suburban clean air (FMI ~1.0) -> ~15 and heavy urban traffic
# (FMI ~3.5) -> ~55.
FMI_TO_AQ_SCALE = 16.25
FMI_TO_AQ_OFFSET = 15.0

REQUEST_TIMEOUT = 180


# ---------------------------------------------------------------------------
# Postal-code centroid loading
# ---------------------------------------------------------------------------


def load_postal_centroids() -> list[dict]:
    """Load all postal codes with WGS84 centroids from the GeoJSON."""
    if not GEOJSON_PATH.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_PATH)
        sys.exit(1)

    logger.info("Loading postal codes from %s...", GEOJSON_PATH.name)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        gj = json.load(f)

    out: list[dict] = []
    for feat in gj.get("features", []):
        props = feat.get("properties", {})
        pno = props.get("pno", "")
        geom = feat.get("geometry")
        if not pno or not geom:
            continue

        coords = _flatten_coords(geom)
        if not coords:
            continue

        avg_lon = sum(c[0] for c in coords) / len(coords)
        avg_lat = sum(c[1] for c in coords) / len(coords)
        out.append({"pno": pno, "lat": avg_lat, "lon": avg_lon})

    logger.info("  Loaded %d postal codes with centroids", len(out))
    return out


def _flatten_coords(geom: dict) -> list[tuple[float, float]]:
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
    return coords


# ---------------------------------------------------------------------------
# FMI SILAM data fetch
# ---------------------------------------------------------------------------


def _fmi_download(producer: str, param: str) -> bytes | None:
    """Hit FMI /download for a SILAM producer + parameter over Finland."""
    now = datetime.now(timezone.utc)
    end_time = now.replace(minute=0, second=0, microsecond=0)
    start_time = end_time - timedelta(hours=1)

    params = {
        "producer": producer,
        "param": param,
        "bbox": FINLAND_BBOX,
        "levels": "0",
        "starttime": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endtime": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "format": "netcdf",
        "projection": "EPSG:4326",
    }

    logger.info(
        "  Requesting producer=%s param=%s bbox=%s ...",
        producer, param, FINLAND_BBOX,
    )

    try:
        resp = requests.get(
            FMI_DOWNLOAD_URL, params=params, timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as e:
        logger.warning("    request failed: %s", e)
        return None

    if resp.status_code != 200:
        logger.warning(
            "    HTTP %d (%d bytes): %s",
            resp.status_code, len(resp.content), resp.text[:200].strip(),
        )
        return None

    if len(resp.content) < 1024:
        logger.warning(
            "    response too small (%d bytes): %s",
            len(resp.content), resp.text[:200].strip(),
        )
        return None

    logger.info("    received %.1f MB", len(resp.content) / 1024 / 1024)
    return resp.content


def fetch_silam_aqindex(
    producers: tuple[str, ...] = SILAM_PRODUCERS,
    param: str = "AQIndex",
) -> tuple[bytes, str] | None:
    """Try each SILAM producer until one returns data. Returns (nc_bytes, producer)."""
    logger.info("Fetching SILAM nationwide air quality forecast...")
    for producer in producers:
        nc = _fmi_download(producer, param)
        if nc is not None:
            logger.info("  Using producer: %s", producer)
            return nc, producer
    logger.error(
        "  All SILAM producers failed. Tried: %s", ", ".join(producers),
    )
    return None


# ---------------------------------------------------------------------------
# NetCDF parsing and sampling
# ---------------------------------------------------------------------------


def parse_silam_netcdf(
    data: bytes,
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Return (lats, lons, values_2d) from a SILAM NetCDF.

    Time dimension is averaged out so we get a single grid representing the
    most recent forecast window.
    """
    import netCDF4 as nc

    tmp = tempfile.NamedTemporaryFile(suffix=".nc", delete=False)
    try:
        tmp.write(data)
        tmp.close()

        ds = nc.Dataset(tmp.name)

        # Find the lat/lon coordinate variables (names vary)
        lat_var = lon_var = None
        for name in ("lat", "latitude", "y"):
            if name in ds.variables:
                lat_var = name
                break
        for name in ("lon", "longitude", "x"):
            if name in ds.variables:
                lon_var = name
                break

        if lat_var is None or lon_var is None:
            logger.error("    NetCDF missing lat/lon variables")
            ds.close()
            return None

        lats = np.asarray(ds.variables[lat_var][:])
        lons = np.asarray(ds.variables[lon_var][:])

        # Pick the first multi-dimensional data variable that isn't a coordinate
        coord_names = {lat_var, lon_var, "time", "crs", "level", "height"}
        data_var = None
        for vname, v in ds.variables.items():
            if vname in coord_names:
                continue
            if len(v.shape) >= 2:
                data_var = vname
                break

        if data_var is None:
            logger.error("    No data variable found in NetCDF")
            ds.close()
            return None

        raw = np.asarray(ds.variables[data_var][:])
        fill = getattr(ds.variables[data_var], "_FillValue", None)
        if fill is not None:
            raw = np.where(raw == fill, np.nan, raw)

        # Average across non-spatial dimensions (typically time, possibly level)
        while raw.ndim > 2:
            with np.errstate(invalid="ignore"):
                raw = np.nanmean(raw, axis=0)

        logger.info(
            "  Grid: %d lat x %d lon, var=%s, range %.2f - %.2f",
            len(lats), len(lons), data_var,
            float(np.nanmin(raw)), float(np.nanmax(raw)),
        )

        ds.close()
        return lats, lons, raw
    finally:
        os.unlink(tmp.name)


def sample_grid(
    centroids: list[dict],
    lats: np.ndarray,
    lons: np.ndarray,
    values: np.ndarray,
) -> dict[str, float]:
    """Nearest-neighbor sample of the grid at each centroid.

    SILAM resolution is ~5-10 km; postal-code centroids are tens of meters
    accurate, so nearest cell is plenty. Skips centroids whose nearest cell
    is NaN (e.g. outside coverage or a fill value).
    """
    # Ensure ascending lat/lon for searchsorted
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        values = values[::-1, :]
    if lons[0] > lons[-1]:
        lons = lons[::-1]
        values = values[:, ::-1]

    results: dict[str, float] = {}
    skipped_out = 0
    skipped_nan = 0

    for area in centroids:
        lat, lon = area["lat"], area["lon"]

        # Skip if outside the grid bbox altogether
        if (
            lat < float(lats[0]) or lat > float(lats[-1])
            or lon < float(lons[0]) or lon > float(lons[-1])
        ):
            skipped_out += 1
            continue

        # Nearest index by binary search + neighbor compare
        i = int(np.searchsorted(lats, lat))
        j = int(np.searchsorted(lons, lon))
        i = max(1, min(i, len(lats) - 1))
        j = max(1, min(j, len(lons) - 1))
        if abs(lats[i - 1] - lat) < abs(lats[i] - lat):
            i -= 1
        if abs(lons[j - 1] - lon) < abs(lons[j] - lon):
            j -= 1

        v = float(values[i, j])
        if not math.isfinite(v):
            skipped_nan += 1
            continue

        results[area["pno"]] = v

    logger.info(
        "  Sampled %d postal codes (%d outside grid, %d NaN)",
        len(results), skipped_out, skipped_nan,
    )
    return results


# ---------------------------------------------------------------------------
# Scale conversion
# ---------------------------------------------------------------------------


def fmi_index_to_aq_scale(fmi_value: float) -> float:
    """Convert FMI 1-5 AQ index to our 0-100 scale (matches ENFUSER calibration)."""
    return FMI_TO_AQ_OFFSET + (fmi_value - 1.0) * FMI_TO_AQ_SCALE


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--producer",
        help="Override the SILAM producer name (default: try a known list).",
    )
    parser.add_argument(
        "--param",
        default="AQIndex",
        help="FMI parameter name to fetch (default: AQIndex).",
    )
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("SILAM nationwide air quality pipeline")
    logger.info("=" * 60)

    centroids = load_postal_centroids()
    if not centroids:
        logger.error("No postal codes loaded; aborting.")
        sys.exit(1)

    producers = (args.producer,) if args.producer else SILAM_PRODUCERS
    fetched = fetch_silam_aqindex(producers, args.param)
    if fetched is None:
        logger.error(
            "Could not fetch SILAM data from any producer. "
            "Check producer names at https://en.ilmatieteenlaitos.fi/open-data-producers"
        )
        sys.exit(1)

    nc_data, _producer = fetched
    parsed = parse_silam_netcdf(nc_data)
    if parsed is None:
        sys.exit(1)

    lats, lons, fmi_values = parsed
    raw = sample_grid(centroids, lats, lons, fmi_values)

    if not raw:
        logger.error("No postal codes sampled from grid; aborting.")
        sys.exit(1)

    results = {pno: round(fmi_index_to_aq_scale(v), 1) for pno, v in raw.items()}

    vals = list(results.values())
    logger.info(
        "AQ index 0-100 scale: min=%.1f max=%.1f mean=%.1f",
        min(vals), max(vals), sum(vals) / len(vals),
    )

    sorted_out = dict(sorted(results.items()))
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted_out, f, indent=2)
    logger.info("Wrote %s (%d postal codes)", OUTPUT_FILE.name, len(results))


if __name__ == "__main__":
    main()
