#!/usr/bin/env python3
"""
Aggregate cached VIIRS Black Marble pixels to postal-code mean radiance.

Reads .h5 tiles from scripts/cache/viirs_h5/ (downloaded by fetch_viirs_cmr.py)
and computes the mean NearNadir_Composite_Snow_Free radiance for each postal
code polygon in metro_neighborhoods.geojson. Output overwrites
scripts/light_pollution.json so the values flow into the choropleth + tooltip
via the existing prepare_data.py pipeline.

This replaces the OSM streetlight-density values that were previously in
light_pollution.json (those have different units and disagree with the VIIRS
grid layer at sub-postal resolution — e.g. Litmanen shows bright grid cells
but had 0 lamps/km^2 from OSM because the area is OSM-undermapped).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import h5py
import numpy as np
import geopandas as gpd
from rasterio.features import rasterize
from rasterio.transform import from_origin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

ROOT = Path(__file__).parent.parent
GEOJSON_FILE = ROOT / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_FILE = Path(__file__).parent / "light_pollution.json"
CACHE_DIR = Path(__file__).parent / "cache" / "viirs_h5"


def read_tile(path: Path):
    """Return radiance array + per-pixel lng/lat for one VNP46A4 tile."""
    base = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields"
    with h5py.File(path, "r") as f:
        ds = f[f"{base}/NearNadir_Composite_Snow_Free"]
        radiance = ds[...].astype(np.float64)
        fill = ds.attrs.get("_FillValue")
        scale = float(ds.attrs.get("scale_factor", [1.0])[0])
        offset = float(ds.attrs.get("offset", [0.0])[0])
        lat = f[f"{base}/lat"][:]
        lon = f[f"{base}/lon"][:]
    if fill is not None:
        radiance[radiance == float(np.asarray(fill).ravel()[0])] = np.nan
    radiance = radiance * scale + offset
    radiance = np.where(radiance < 0, np.nan, radiance)
    return radiance, lon, lat


def main():
    logger.info("Loading postal polygons ...")
    gdf = gpd.read_file(GEOJSON_FILE)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    gdf = gdf[gdf["pno"].notna() & (gdf["pno"] != "")].copy()
    logger.info("  %d postal codes", len(gdf))

    h5_files = sorted(CACHE_DIR.glob("*.h5"))
    if not h5_files:
        raise SystemExit(f"No tiles cached in {CACHE_DIR}. Run fetch_viirs_cmr.py first.")
    # Latest year only (cache may contain prior runs)
    latest_year = max(int(p.name.split(".A")[1][:4]) for p in h5_files)
    h5_files = [p for p in h5_files if f".A{latest_year}001." in p.name]
    logger.info("  using %d tiles from year %d", len(h5_files), latest_year)

    # Sums + counts per postal code, accumulated across tiles
    pno_to_sum: dict[str, float] = {}
    pno_to_count: dict[str, int] = {}

    for h5 in h5_files:
        logger.info("Tile %s ...", h5.name)
        radiance, lon, lat = read_tile(h5)
        rows, cols = radiance.shape
        # Pixel grid is regular in lat/lon — build a rasterio-style transform.
        # lat is descending (north to south), lon ascending (west to east).
        # Rasterize wants origin = top-left + pixel size; lat[0] is north edge.
        px_lon = abs(float(lon[1] - lon[0]))
        px_lat = abs(float(lat[1] - lat[0]))
        # Center coords -> top-left of pixel grid
        north = float(lat.max()) + px_lat / 2 if lat[0] > lat[-1] else float(lat.max()) + px_lat / 2
        west = float(lon.min()) - px_lon / 2
        transform = from_origin(west, north, px_lon, px_lat)

        # If lat is ascending in the array, flip it so row 0 = north.
        if lat[0] < lat[-1]:
            radiance = radiance[::-1, :]

        # Clip postal polygons to tile bbox for speed
        tile_minx = west
        tile_maxx = float(lon.max()) + px_lon / 2
        tile_maxy = north
        tile_miny = float(lat.min()) - px_lat / 2
        in_tile = gdf.cx[tile_minx:tile_maxx, tile_miny:tile_maxy]
        if in_tile.empty:
            logger.info("  no postal codes in tile bbox")
            continue
        logger.info("  rasterizing %d polygons ...", len(in_tile))

        # Rasterize each polygon to its integer index. 0 = no polygon.
        # We use 1-based indices so 0 means background.
        shapes = ((geom, i + 1) for i, geom in enumerate(in_tile.geometry))
        labels = rasterize(
            shapes,
            out_shape=(rows, cols),
            transform=transform,
            fill=0,
            dtype="int32",
        )

        # For each polygon index, sum + count radiance values in its pixels.
        pno_list = in_tile["pno"].tolist()
        valid = np.isfinite(radiance) & (labels > 0)
        if not valid.any():
            continue
        # numpy bincount over labels for both sum and count
        flat_labels = labels[valid].ravel()
        flat_rad = radiance[valid].ravel()
        max_label = len(pno_list)
        sums = np.bincount(flat_labels, weights=flat_rad, minlength=max_label + 1)
        counts = np.bincount(flat_labels, minlength=max_label + 1)
        for i, pno in enumerate(pno_list, start=1):
            if counts[i] == 0:
                continue
            pno_to_sum[pno] = pno_to_sum.get(pno, 0.0) + float(sums[i])
            pno_to_count[pno] = pno_to_count.get(pno, 0) + int(counts[i])
        logger.info("  added pixels for %d postal codes",
                    sum(1 for i in range(1, max_label + 1) if counts[i] > 0))

    logger.info("Computing means ...")
    means: dict[str, float] = {}
    for pno in pno_to_sum:
        n = pno_to_count[pno]
        if n == 0:
            continue
        means[pno] = round(pno_to_sum[pno] / n, 2)

    # Postal codes with no VIIRS coverage at all → keep 0 (truly dark).
    for pno in gdf["pno"]:
        means.setdefault(pno, 0.0)

    OUTPUT_FILE.write_text(json.dumps(means, indent=2, ensure_ascii=False), encoding="utf-8")
    vals = [v for v in means.values() if v > 0]
    logger.info(
        "Wrote %d postal codes (%d with radiance>0) to %s",
        len(means), len(vals), OUTPUT_FILE.name,
    )
    if vals:
        vals.sort()
        logger.info(
            "  Radiance: min=%.2f, median=%.2f, max=%.2f nW/cm^2/sr",
            vals[0], vals[len(vals) // 2], vals[-1],
        )


if __name__ == "__main__":
    main()
