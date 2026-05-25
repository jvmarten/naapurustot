#!/usr/bin/env python3
"""
Fetch VIIRS Black Marble VNP46A4 nighttime radiance tiles for all of Finland
and build a grid GeoJSON of non-zero pixels.

Replaces the broken blackmarblepy path (uses dead api/v1/files endpoint) with
direct CMR granule discovery + LAADS DAAC HDF5 download.

Tiles covering Finland: h19-h21 (longitude 10-40 deg E), v01-v02 (latitude
50-80 deg N). VIIRS uses 10x10 deg tiles with 2400x2400 ~500 m pixels.

Output: public/data/light_pollution_grid.geojson
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import h5py
import httpx
import numpy as np
from shapely.geometry import box
from shapely.ops import unary_union
from shapely.prepared import prep
import geopandas as gpd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

ROOT = Path(__file__).parent.parent
GEOJSON_FILE = ROOT / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_FILE = ROOT / "public" / "data" / "light_pollution_grid.geojson"
CACHE_DIR = Path(__file__).parent / "cache" / "viirs_h5"

CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
SHORT_NAME = "VNP46A4"
VERSION = "2"

# VIIRS sinusoidal-ish tile grid: 10 deg per tile, h0=180W, v0=90N
# Finland (lon 20-32, lat 60-70) is in h19-h21, v01-v02.
TILES = [(h, v) for h in (19, 20, 21) for v in (1, 2)]


def get_token() -> str:
    token = os.environ.get("EARTHDATA_TOKEN")
    if not token:
        logger.error("EARTHDATA_TOKEN env var required")
        sys.exit(1)
    return token


def find_granule_url(token: str, year: int, h: int, v: int) -> str | None:
    """Query CMR for a specific VIIRS tile and return its direct download URL."""
    params = {
        "short_name": SHORT_NAME,
        "version": VERSION,
        "temporal": f"{year}-01-01T00:00:00Z,{year}-12-31T23:59:59Z",
        # Filter by tile via producer_granule_id pattern
        "producer_granule_id": f"{SHORT_NAME}.A{year}001.h{h:02d}v{v:02d}.002.*",
        "options[producer_granule_id][pattern]": "true",
        "page_size": "5",
    }
    r = httpx.get(
        CMR_URL,
        params=params,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    r.raise_for_status()
    entries = r.json().get("feed", {}).get("entry", [])
    if not entries:
        return None
    for link in entries[0].get("links", []):
        href = link.get("href", "")
        if href.endswith(".h5") and href.startswith("https://data.laadsdaac"):
            return href
    return None


def download_tile(token: str, url: str) -> Path:
    """Download a tile's .h5 file to cache and return the path."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fname = url.rsplit("/", 1)[-1]
    out = CACHE_DIR / fname
    if out.exists() and out.stat().st_size > 1000:
        logger.info("  Cached: %s (%.1f MB)", fname, out.stat().st_size / 1024 / 1024)
        return out

    logger.info("  Downloading %s ...", fname)
    with httpx.stream(
        "GET",
        url,
        headers={"Authorization": f"Bearer {token}"},
        timeout=600,
        follow_redirects=True,
    ) as r:
        r.raise_for_status()
        with open(out, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=1 << 20):
                f.write(chunk)
    logger.info("    Done (%.1f MB)", out.stat().st_size / 1024 / 1024)
    return out


def read_radiance(h5_path: Path):
    """Extract radiance + per-pixel lng/lat coords from a VNP46A4 tile.

    Tiles are 2400x2400 at 15 arcsec (~500m) resolution. Lat/lon arrays in
    the file give cell-center coordinates, so cell bounds are +/- half a pixel.
    """
    base = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields"
    with h5py.File(h5_path, "r") as f:
        ds = f[f"{base}/NearNadir_Composite_Snow_Free"]
        raw = ds[...].astype(np.float64)
        fill = ds.attrs.get("_FillValue")
        scale = float(ds.attrs.get("scale_factor", [1.0])[0])
        offset = float(ds.attrs.get("offset", [0.0])[0])
        lat = f[f"{base}/lat"][:]
        lon = f[f"{base}/lon"][:]

    if fill is not None:
        fill_val = float(np.asarray(fill).ravel()[0])
        raw[raw == fill_val] = np.nan
    radiance = raw * scale + offset

    # Pixel size from coordinate spacing (handles ascending or descending arrays).
    px_lon = abs(float(lon[1] - lon[0]))
    px_lat = abs(float(lat[1] - lat[0]))
    return radiance, lon, lat, px_lon, px_lat


def load_finland_boundary():
    if not GEOJSON_FILE.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_FILE)
        sys.exit(1)
    logger.info("Loading Finland boundary from %s ...", GEOJSON_FILE.name)
    gdf = gpd.read_file(GEOJSON_FILE)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    boundary = unary_union(gdf.geometry).buffer(0)
    logger.info("  Boundary from %d postal codes, bounds=%s", len(gdf), boundary.bounds)
    return boundary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2024)
    ap.add_argument(
        "--min-radiance",
        type=float,
        default=2.0,
        help="Minimum radiance (nW/cm^2/sr) to include. 2.0 matches the legend "
             "minimum — below that the cell would render as solid black, "
             "indistinguishable from no cell at all.",
    )
    args = ap.parse_args()

    token = get_token()
    boundary = load_finland_boundary()
    # PreparedGeometry caches the boundary's spatial index — point-in-polygon
    # and box-intersects checks are ~10x faster than on the raw geometry.
    boundary_prep = prep(boundary)
    bounds_minx, bounds_miny, bounds_maxx, bounds_maxy = boundary.bounds

    features: list[dict] = []
    for h, v in TILES:
        logger.info("Tile h%02d v%02d ...", h, v)
        url = find_granule_url(token, args.year, h, v)
        if not url:
            logger.warning("  No granule for year %d", args.year)
            continue
        h5 = download_tile(token, url)
        radiance, lon, lat, px_lon, px_lat = read_radiance(h5)
        rows, cols = radiance.shape
        logger.info("  Raster: %d x %d, lon %.3f-%.3f, lat %.3f-%.3f, px %.5fx%.5f deg",
                    cols, rows, lon.min(), lon.max(), lat.min(), lat.max(), px_lon, px_lat)

        # Tile bbox; skip whole tile if outside Finland
        tile_bbox = box(float(lon.min()) - px_lon/2, float(lat.min()) - px_lat/2,
                        float(lon.max()) + px_lon/2, float(lat.max()) + px_lat/2)
        if not boundary.intersects(tile_bbox):
            logger.info("  Tile outside Finland boundary, skipping")
            continue

        # Threshold filter + bbox filter first (fast vectorized), then per-cell
        # prepared-geometry intersection check.
        lon_in = (lon >= bounds_minx - px_lon) & (lon <= bounds_maxx + px_lon)
        lat_in = (lat >= bounds_miny - px_lat) & (lat <= bounds_maxy + px_lat)
        mask = (
            np.isfinite(radiance)
            & (radiance >= args.min_radiance)
            & lat_in[:, None]
            & lon_in[None, :]
        )
        r_idxs, c_idxs = np.where(mask)
        logger.info("  Pixels in bbox above threshold %.1f: %d", args.min_radiance, len(r_idxs))
        kept = 0
        for r_idx, c_idx in zip(r_idxs, c_idxs):
            val = float(radiance[r_idx, c_idx])
            cy = float(lat[r_idx])
            cx = float(lon[c_idx])
            x_min, x_max = cx - px_lon / 2, cx + px_lon / 2
            y_min, y_max = cy - px_lat / 2, cy + px_lat / 2
            cell = box(x_min, y_min, x_max, y_max)
            if not boundary_prep.intersects(cell):
                continue
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [round(x_min, 6), round(y_min, 6)],
                        [round(x_max, 6), round(y_min, 6)],
                        [round(x_max, 6), round(y_max, 6)],
                        [round(x_min, 6), round(y_max, 6)],
                        [round(x_min, 6), round(y_min, 6)],
                    ]],
                },
                "properties": {"radiance": round(val, 2)},
            })
            kept += 1
        logger.info("  Kept %d cells from this tile", kept)

    logger.info("Total cells across tiles: %d", len(features))
    if not features:
        logger.error("No cells generated")
        sys.exit(1)

    vals = [f["properties"]["radiance"] for f in features]
    logger.info(
        "Radiance: min=%.2f, median=%.2f, max=%.2f nW/cm^2/sr",
        min(vals), sorted(vals)[len(vals) // 2], max(vals),
    )

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    logger.info(
        "Wrote %d cells to %s (%.1f MB)",
        len(features), OUTPUT_FILE.name, OUTPUT_FILE.stat().st_size / 1024 / 1024,
    )


if __name__ == "__main__":
    main()
