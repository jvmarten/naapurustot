"""Mean Copernicus Tree Cover Density per polygon and year, from the CDSE S3 archive.

Shared by Finland's scripts/fetch_tree_canopy.py and Sweden's scripts/se/fetch_se_canopy.py,
so both countries are measured from one product by one method.

Product: CLMS High Resolution Layer "Tree Cover Density", 10 m, the yearly VLCC release
(`clms_vlcc_tree-cover-density_europe_10m_yearly_v1`, 2018-2024). Values are crown cover
0-100 % per pixel; 255 is outside the mapped area and is not counted. Every year is
published on the same 100 km EPSG:3035 grid, so one label raster per tile serves every
year, and a year-to-year difference is the product's own change, not a regridding. The EEA
ImageServer the Finnish fetcher used to call (computeHistograms, 2018 only) was retired.

Method: every 10 m pixel whose centre lies inside a polygon is counted once, and the
area's value is the mean over those pixels — the exact histogram mean the ImageServer
returned, with no sampling. Tiles are named by their lower-left corner (`E43N35` = x 4.3e6,
y 3.5e6); each tile's years are downloaded together, read, and deleted before the next
tile, so disk use stays at one tile per year (~10 MB each).

Finding tiles needs no login (catalogue.dataspace.copernicus.eu OData); downloading them
needs CDSE S3 keys in CDSE_S3_ACCESS_KEY / CDSE_S3_SECRET_KEY.
"""

from __future__ import annotations

import logging
import os
import tempfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests
from shapely.geometry import box

logger = logging.getLogger(__name__)

CATALOGUE = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
S3_ENDPOINT = "https://eodata.dataspace.copernicus.eu"
# Every year the yearly product holds. The newest is what the map shows; the series feeds
# the year slider (tree_canopy_history).
YEARS = (2018, 2019, 2020, 2021, 2022, 2023, 2024)
TILE_M = 100_000
NODATA = 255


def _tiles_by_name(year: int) -> dict[str, str]:
    """Every 10 m TCD tile of `year` in the archive -> its S3 prefix (no login)."""
    out: dict[str, str] = {}
    url, params = CATALOGUE, {
        "$filter": f"Collection/Name eq 'CLMS' and contains(Name,'TCD_S{year}_R10m')",
        "$top": 1000, "$orderby": "Name",
    }
    while url:
        r = requests.get(url, params=params, timeout=120)
        r.raise_for_status()
        d = r.json()
        for p in d["value"]:
            # CLMS_HRLVLCC_TCD_S2018_R10m_E43N35_03035_V01_R00 -> E43N35
            out[p["Name"].split("_")[5]] = p["S3Path"].removeprefix("/eodata/")
        url, params = d.get("@odata.nextLink"), None
    return out


def _s3():
    import boto3
    logging.getLogger("botocore").setLevel(logging.WARNING)
    return boto3.client(
        "s3", endpoint_url=S3_ENDPOINT, region_name="default",
        aws_access_key_id=os.environ["CDSE_S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["CDSE_S3_SECRET_KEY"],
    )


def mean_tcd(areas: gpd.GeoDataFrame, id_col: str, label: str = "TCD",
             years: tuple[int, ...] = YEARS) -> dict[int, dict[str, float]]:
    """{year: {area id: mean TCD %, 1 decimal}} for every polygon with a mapped pixel.

    Raises if a tile the polygons need is missing from any year or cannot be read: a
    partial national pass would ship as measured values for only some areas, and a year
    missing one tile would draw that tile's areas as a change that never happened.
    """
    import rasterio
    from rasterio.features import rasterize
    from rasterio.windows import from_bounds

    gdf = areas[[id_col, "geometry"]].dropna(subset=["geometry"]).to_crs(epsg=3035)
    gdf = gdf[~gdf.geometry.is_empty].reset_index(drop=True)
    ids = gdf[id_col].tolist()

    # Tiles each polygon's bbox touches.
    need: dict[str, list[int]] = defaultdict(list)
    for i, (minx, miny, maxx, maxy) in enumerate(gdf.geometry.bounds.itertuples(index=False)):
        for tx in range(int(minx // TILE_M), int(maxx // TILE_M) + 1):
            for ty in range(int(miny // TILE_M), int(maxy // TILE_M) + 1):
                need[f"E{tx}N{ty}"].append(i)

    archive = {y: _tiles_by_name(y) for y in years}
    # A tile can be absent only where it holds no mapped land at all (open sea); check
    # that each such tile is really the bbox overlap of polygons that live elsewhere.
    for t in sorted(need):
        absent = [y for y in years if t not in archive[y]]
        if not absent:
            continue
        tx, ty = int(t[1:t.index("N")]), int(t[t.index("N") + 1:])
        sq = box(tx * TILE_M, ty * TILE_M, (tx + 1) * TILE_M, (ty + 1) * TILE_M)
        if any(gdf.geometry.iloc[i].intersects(sq) for i in need[t]):
            raise SystemExit(f"{label}: tile {t} overlaps an area but is not in the archive for {absent}")
        del need[t]

    s3 = _s3()
    total = {y: np.zeros(len(gdf), dtype=np.float64) for y in years}
    count = {y: np.zeros(len(gdf), dtype=np.int64) for y in years}
    with tempfile.TemporaryDirectory() as tmp, ThreadPoolExecutor(len(years)) as pool:
        for n, (tile, members) in enumerate(sorted(need.items()), 1):
            paths = {y: Path(tmp) / f"{y}.tif" for y in years}

            def fetch(y: int) -> None:
                prefix = archive[y][tile]
                s3.download_file("eodata", f"{prefix}/{prefix.rsplit('/', 1)[1]}.tif", str(paths[y]))

            list(pool.map(fetch, years))
            sub = gdf.iloc[members]
            labels = transform = win = None
            for y in years:
                with rasterio.open(paths[y]) as ds:
                    if win is None:
                        minx, miny, maxx, maxy = sub.total_bounds
                        win = from_bounds(max(minx, ds.bounds.left), max(miny, ds.bounds.bottom),
                                          min(maxx, ds.bounds.right), min(maxy, ds.bounds.top),
                                          ds.transform).round_offsets().round_lengths()
                        transform = ds.window_transform(win)
                    elif ds.window_transform(win) != transform:
                        raise SystemExit(f"{label}: tile {tile} {y} is not on the other years' grid")
                    band = ds.read(1, window=win) if win.width > 0 and win.height > 0 else None
                paths[y].unlink()
                if band is None:
                    continue
                if labels is None:
                    # Label raster: pixel -> 1 + index into gdf (0 = no polygon). Pixel-centre rule.
                    labels = rasterize(
                        ((geom, i + 1) for i, geom in zip(members, sub.geometry)),
                        out_shape=band.shape, transform=transform, fill=0, dtype="int32",
                    )
                    inside = labels > 0
                valid = inside & (band != NODATA)
                lab = labels[valid] - 1
                total[y] += np.bincount(lab, weights=band[valid].astype(np.float64), minlength=len(gdf))
                count[y] += np.bincount(lab, minlength=len(gdf))
            logger.info("  %s: tile %s (%d/%d), %d polygons", label, tile, n, len(need), len(members))

    return {y: {ids[i]: round(float(total[y][i] / count[y][i]), 1)
                for i in range(len(gdf)) if count[y][i] > 0} for y in years}


def history(by_year: dict[int, dict[str, float]]) -> dict[str, list[list[float]]]:
    """{area id: [[year, value], ...]} in year order, the shape the *_history columns use."""
    out: dict[str, list[list[float]]] = defaultdict(list)
    for y in sorted(by_year):
        for k, v in by_year[y].items():
            out[k].append([y, v])
    return dict(sorted(out.items()))
