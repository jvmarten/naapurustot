"""Mean Copernicus Tree Cover Density 2018 per polygon, from the CDSE S3 archive.

Shared by Finland's scripts/fetch_tree_canopy.py and Sweden's scripts/se/fetch_se_canopy.py,
so both countries are measured from one product by one method.

Product: CLMS High Resolution Layer "Tree Cover Density" 2018, 10 m, the VLCC release
(`clms_vlcc_tree-cover-density_europe_10m_yearly_v1`). Values are crown cover 0-100 % per
pixel; 255 is outside the mapped area and is not counted. The EEA ImageServer the Finnish
fetcher used to call (computeHistograms) was retired; this reads the same raster directly.

Method: every 10 m pixel whose centre lies inside a polygon is counted once, and the
area's value is the mean over those pixels — the exact histogram mean the ImageServer
returned, with no sampling. Tiles are 100 km squares in EPSG:3035 (`E43N35` = x 4.3e6,
y 3.5e6); each is downloaded, read, and deleted before the next, so disk use stays at one
tile (~10 MB).

Finding tiles needs no login (catalogue.dataspace.copernicus.eu OData); downloading them
needs CDSE S3 keys in CDSE_S3_ACCESS_KEY / CDSE_S3_SECRET_KEY.
"""

from __future__ import annotations

import logging
import os
import tempfile
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests
from shapely.geometry import box

logger = logging.getLogger(__name__)

CATALOGUE = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
S3_ENDPOINT = "https://eodata.dataspace.copernicus.eu"
PRODUCT = "TCD_S2018_R10m"
TILE_M = 100_000
NODATA = 255


def _tiles_by_name() -> dict[str, str]:
    """Every 10 m TCD 2018 tile in the archive -> its S3 prefix (no login)."""
    out: dict[str, str] = {}
    url, params = CATALOGUE, {
        "$filter": f"Collection/Name eq 'CLMS' and contains(Name,'{PRODUCT}')",
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


def mean_tcd(areas: gpd.GeoDataFrame, id_col: str, label: str = "TCD") -> dict[str, float]:
    """{area id: mean TCD %, 1 decimal} for every polygon with at least one mapped pixel.

    Raises if a tile the polygons need is missing from the archive or cannot be read:
    a partial national pass would ship as measured values for only some areas.
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

    archive = _tiles_by_name()
    missing = sorted(t for t in need if t not in archive)
    # A tile can be absent only where it holds no mapped land at all (open sea); check
    # that each such tile is really the bbox overlap of polygons that live elsewhere.
    for t in missing:
        tx, ty = int(t[1:t.index("N")]), int(t[t.index("N") + 1:])
        sq = box(tx * TILE_M, ty * TILE_M, (tx + 1) * TILE_M, (ty + 1) * TILE_M)
        if any(gdf.geometry.iloc[i].intersects(sq) for i in need[t]):
            raise SystemExit(f"{label}: tile {t} overlaps an area but is not in the archive")
        del need[t]

    s3 = _s3()
    total = np.zeros(len(gdf), dtype=np.float64)
    count = np.zeros(len(gdf), dtype=np.int64)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "tile.tif"
        for n, (tile, members) in enumerate(sorted(need.items()), 1):
            prefix = archive[tile]
            key = f"{prefix}/{prefix.rsplit('/', 1)[1]}.tif"
            s3.download_file("eodata", key, str(path))
            with rasterio.open(path) as ds:
                sub = gdf.iloc[members]
                minx, miny, maxx, maxy = sub.total_bounds
                win = from_bounds(max(minx, ds.bounds.left), max(miny, ds.bounds.bottom),
                                  min(maxx, ds.bounds.right), min(maxy, ds.bounds.top),
                                  ds.transform).round_offsets().round_lengths()
                if win.width <= 0 or win.height <= 0:
                    continue
                band = ds.read(1, window=win)
                transform = ds.window_transform(win)
            # Label raster: pixel -> 1 + index into gdf (0 = no polygon). Pixel-centre rule.
            labels = rasterize(
                ((geom, i + 1) for i, geom in zip(members, sub.geometry)),
                out_shape=band.shape, transform=transform, fill=0, dtype="int32",
            )
            valid = (labels > 0) & (band != NODATA)
            lab = labels[valid] - 1
            total += np.bincount(lab, weights=band[valid].astype(np.float64), minlength=len(gdf))
            count += np.bincount(lab, minlength=len(gdf))
            path.unlink()
            logger.info("  %s: tile %s (%d/%d), %d polygons", label, tile, n, len(need), len(members))

    return {ids[i]: round(float(total[i] / count[i]), 1) for i in range(len(gdf)) if count[i] > 0}
