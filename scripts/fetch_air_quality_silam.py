#!/usr/bin/env python3
"""
Fetch FMI SILAM nationwide air quality forecast and assign values to every
Finnish postal code. Fills in coverage outside the high-resolution cities
(Helsinki metro from HSY/ENFUSER, Tampere NOx modelling, Turku gradient).

Data source:
  FMI SILAM Europe surface air quality forecast.
  Covers all of Europe (incl. all of Finland) at ~5-10 km grid resolution.
  Producer: silamaq_europe_surface (FMI open data /download endpoint).
  Parameters: PM25Concentration, NO2Concentration  (ug/m^3).

  SILAM does not publish a pre-computed composite AQ index, only individual
  species. We compute the Finnish hourly AQI sub-index per species using
  the Ilmatieteen laitos / HSY thresholds, take the worst (max) sub-index
  per grid cell, then convert to our 0-100 scale using the same calibration
  as the ENFUSER pipeline.

Method:
  1. Load postal-code centroids from public/data/metro_neighborhoods.geojson.
  2. Download SILAM NetCDF for PM2.5 and NO2 over the Finland bounding box.
  3. Average each species across the forecast hours, then compute the
     Finnish AQI sub-index per grid cell. Take the max as the composite.
  4. For each postal-code centroid, sample the nearest grid cell.
  5. Convert FMI sub-index (1-5 continuous) to our 0-100 scale.
  6. Write scripts/air_quality_silam.json.

The output file is consumed by scripts/fetch_air_quality.py as a final
nationwide fill-in phase. It NEVER overrides higher-resolution data from
HSY/ENFUSER (Helsinki metro), Tampere NOx, or Turku.

Output: scripts/air_quality_silam.json  {"postal_code": air_quality_index}
Scale: 0-100+, higher = worse air quality.

Usage:
    python scripts/fetch_air_quality_silam.py
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
SILAM_PRODUCER = "silamaq_europe_surface"

# Bounding box covering all of mainland Finland and Ahvenanmaa.
FINLAND_BBOX = "19.0,59.5,32.0,70.5"

# Finnish hourly AQI thresholds (ug/m^3) -- HSY ilmanlaatuindeksi spec.
# Boundaries map to sub-index values 1, 2, 3, 4, 5 (Good ... Very Poor).
SPECIES_THRESHOLDS = {
    "PM25Concentration": (10.0, 25.0, 50.0, 75.0),
    "NO2Concentration":  (40.0, 70.0, 150.0, 200.0),
}

# Same FMI sub-index (1-5 continuous) -> our 0-100 scale conversion as ENFUSER.
# Calibrated so clean air (sub-index ~1.0) -> ~15 and heavy urban traffic
# (sub-index ~3.5) -> ~55.
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


def fetch_silam_species(param: str) -> bytes | None:
    """Hit FMI /download for one SILAM species over Finland.

    Returns the latest forecast NetCDF or None on failure.
    """
    now = datetime.now(timezone.utc)
    end_time = now.replace(minute=0, second=0, microsecond=0)
    start_time = end_time - timedelta(hours=1)

    params = {
        "producer": SILAM_PRODUCER,
        "param": param,
        "bbox": FINLAND_BBOX,
        "levels": "0",
        "starttime": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endtime": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "format": "netcdf",
        "projection": "EPSG:4326",
    }

    logger.info("  Fetching SILAM %s ...", param)

    try:
        resp = requests.get(
            FMI_DOWNLOAD_URL, params=params, timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as e:
        logger.warning("    request failed: %s", e)
        return None

    if resp.status_code != 200 or len(resp.content) < 1024:
        logger.warning(
            "    HTTP %d (%d bytes): %s",
            resp.status_code, len(resp.content),
            resp.headers.get("x-download-error", resp.text[:200].strip()),
        )
        return None

    logger.info("    received %.1f KB", len(resp.content) / 1024)
    return resp.content


# ---------------------------------------------------------------------------
# NetCDF parsing
# ---------------------------------------------------------------------------


def parse_silam_netcdf(
    data: bytes,
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Return (lats, lons, values_2d) from a SILAM NetCDF.

    Averages across the time dimension to get a single grid.
    """
    import netCDF4 as nc

    tmp = tempfile.NamedTemporaryFile(suffix=".nc", delete=False)
    try:
        tmp.write(data)
        tmp.close()

        ds = nc.Dataset(tmp.name)

        lat_var = next((v for v in ("lat", "latitude", "y") if v in ds.variables), None)
        lon_var = next((v for v in ("lon", "longitude", "x") if v in ds.variables), None)
        if lat_var is None or lon_var is None:
            logger.error("    NetCDF missing lat/lon variables")
            ds.close()
            return None

        lats = np.asarray(ds.variables[lat_var][:])
        lons = np.asarray(ds.variables[lon_var][:])

        coord_names = {lat_var, lon_var, "time", "time_h", "time_bounds_h",
                       "crs", "level", "height"}
        data_var = None
        for vname, v in ds.variables.items():
            if vname not in coord_names and len(v.shape) >= 2:
                data_var = vname
                break

        if data_var is None:
            logger.error("    No data variable found in NetCDF")
            ds.close()
            return None

        raw = np.asarray(ds.variables[data_var][:], dtype=float)
        fill = getattr(ds.variables[data_var], "_FillValue", None)
        if fill is not None:
            raw = np.where(raw == fill, np.nan, raw)

        while raw.ndim > 2:
            with np.errstate(invalid="ignore"):
                raw = np.nanmean(raw, axis=0)

        logger.info(
            "    grid %d x %d, var=%s, range %.2f - %.2f ug/m3",
            len(lats), len(lons), data_var,
            float(np.nanmin(raw)), float(np.nanmax(raw)),
        )

        ds.close()
        return lats, lons, raw
    finally:
        os.unlink(tmp.name)


# ---------------------------------------------------------------------------
# Finnish AQI sub-index computation
# ---------------------------------------------------------------------------


def concentration_to_subindex(
    conc: np.ndarray, thresholds: tuple[float, float, float, float],
) -> np.ndarray:
    """Map a concentration field (ug/m^3) to a continuous Finnish AQI 1-5 sub-index.

    Linear interpolation between threshold boundaries:
      0       -> 1.0   (clean)
      t1      -> 2.0   (upper bound of Good)
      t2      -> 3.0   (upper bound of Satisfactory)
      t3      -> 4.0   (upper bound of Fair)
      t4+     -> 5.0   (Poor / Very Poor; capped)
    """
    t1, t2, t3, t4 = thresholds
    c = np.where(np.isnan(conc), 0.0, conc)
    si = np.where(
        c <= t1, 1.0 + c / t1,
        np.where(
            c <= t2, 2.0 + (c - t1) / (t2 - t1),
            np.where(
                c <= t3, 3.0 + (c - t2) / (t3 - t2),
                np.where(
                    c <= t4, 4.0 + (c - t3) / (t4 - t3),
                    5.0,
                ),
            ),
        ),
    )
    si = np.clip(si, 1.0, 5.0)
    si = np.where(np.isnan(conc), np.nan, si)
    return si


def fmi_index_to_aq_scale(fmi_value: float) -> float:
    """Convert FMI 1-5 sub-index to our 0-100 scale (matches ENFUSER calibration)."""
    return FMI_TO_AQ_OFFSET + (fmi_value - 1.0) * FMI_TO_AQ_SCALE


# ---------------------------------------------------------------------------
# Grid sampling
# ---------------------------------------------------------------------------


def sample_grid(
    centroids: list[dict],
    lats: np.ndarray,
    lons: np.ndarray,
    values: np.ndarray,
) -> dict[str, float]:
    """Nearest-neighbor sample of the grid at each centroid."""
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

        if (
            lat < float(lats[0]) or lat > float(lats[-1])
            or lon < float(lons[0]) or lon > float(lons[-1])
        ):
            skipped_out += 1
            continue

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
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Fetch SILAM nationwide AQI.")
    parser.add_argument(
        "--species",
        default=",".join(SPECIES_THRESHOLDS.keys()),
        help=(
            "Comma-separated SILAM species to fetch and combine into the "
            "composite Finnish AQI. Default: PM25Concentration,NO2Concentration."
        ),
    )
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("SILAM nationwide air quality pipeline")
    logger.info("=" * 60)

    species_list = [s.strip() for s in args.species.split(",") if s.strip()]
    unknown = [s for s in species_list if s not in SPECIES_THRESHOLDS]
    if unknown:
        logger.error("Unknown species (no AQI thresholds): %s", unknown)
        sys.exit(1)

    centroids = load_postal_centroids()
    if not centroids:
        logger.error("No postal codes loaded; aborting.")
        sys.exit(1)

    # Fetch each species, parse to a 2D grid, convert to sub-index 1-5
    logger.info("Fetching SILAM species from FMI (%s)...", SILAM_PRODUCER)
    grid_lats: np.ndarray | None = None
    grid_lons: np.ndarray | None = None
    subindex_stack: list[np.ndarray] = []
    fetched: list[str] = []

    for sp in species_list:
        nc_data = fetch_silam_species(sp)
        if nc_data is None:
            logger.warning("  Skipping %s -- fetch failed", sp)
            continue

        parsed = parse_silam_netcdf(nc_data)
        if parsed is None:
            logger.warning("  Skipping %s -- parse failed", sp)
            continue

        lats, lons, conc = parsed
        if grid_lats is None:
            grid_lats, grid_lons = lats, lons
        elif lats.shape != grid_lats.shape or lons.shape != grid_lons.shape:
            logger.warning("  Skipping %s -- grid shape mismatch", sp)
            continue

        si = concentration_to_subindex(conc, SPECIES_THRESHOLDS[sp])
        subindex_stack.append(si)
        fetched.append(sp)
        logger.info(
            "    sub-index range: %.2f - %.2f (mean %.2f)",
            float(np.nanmin(si)), float(np.nanmax(si)), float(np.nanmean(si)),
        )

    if not subindex_stack:
        logger.error("No SILAM species fetched successfully; aborting.")
        sys.exit(1)

    logger.info("Combining %d species: %s", len(fetched), ", ".join(fetched))
    composite = np.nanmax(np.stack(subindex_stack, axis=0), axis=0)

    raw = sample_grid(centroids, grid_lats, grid_lons, composite)
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
