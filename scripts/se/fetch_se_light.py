#!/usr/bin/env python3
"""Night-time light (VIIRS radiance) per Swedish DeSO area -> scripts/se/light_deso.json.

Finland's method (scripts/fetch_viirs_cmr.py + aggregate_viirs_postal.py), applied to
Sweden: the mean NearNadir_Composite_Snow_Free radiance (nW/cm²/sr) of NASA's Black Marble
annual composite (VNP46A4, collection 2, 15 arc-second pixels) over each area, counting
the pixels whose centre is inside it. The year is Finland's (2024; the Finnish grid
matches that composite cell for cell), so both countries share one product and one set
of colour stops.

Sweden (lon 10.9-24.2, lat 55.3-69.1) lies in the 10-degree tiles h19v02, h19v03 and h20v02.
Granules are found through NASA's CMR and read from LAADS DAAC. Both need a NASA
Earthdata bearer token: in this project's cloud sessions the network proxy adds it to
requests for those two hosts, so the script sends EARTHDATA_TOKEN only when it is set.
Tiles (~150 MB each) are cached under scripts/se/cache/viirs_h5/.

Areas are the shore-clipped display polygons (public/data/se_deso.geojson), as Finland's
postal polygons stop at the shore. A pixel is ~460 m x ~230 m at 60 °N, so a small city
DeSO can hold no pixel centre at all; it takes the mean of the pixels it touches instead
(the script prints how many), never a zero. Fill and negative values are no data.

Usage: python scripts/se/fetch_se_light.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import h5py
import numpy as np
import requests
import shapely
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely import STRtree
from shapely.geometry import box, shape

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SE_GEOJSON = ROOT / "public" / "data" / "se_deso.geojson"
CACHE = HERE / "cache" / "viirs_h5"
OUT = HERE / "light_deso.json"
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
YEAR = 2024
TILES = [(19, 2), (19, 3), (20, 2)]  # h20v03 (50-60 °N, 20-30 °E) holds no Swedish land
FIELDS = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields"


def headers() -> dict:
    token = os.environ.get("EARTHDATA_TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}


def granule_url(h: int, v: int) -> str:
    params = {"short_name": "VNP46A4", "version": "2",
              "producer_granule_id": f"VNP46A4.A{YEAR}001.h{h:02d}v{v:02d}.002.*",
              "options[producer_granule_id][pattern]": "true", "page_size": "5"}
    r = requests.get(CMR_URL, params=params, headers=headers(), timeout=60)
    r.raise_for_status()
    entries = r.json()["feed"]["entry"]
    if len(entries) != 1:
        raise SystemExit(f"h{h:02d}v{v:02d}: {len(entries)} granules for {YEAR}")
    urls = [lk["href"] for lk in entries[0]["links"]
            if lk["href"].endswith(".h5") and lk["href"].startswith("https://data.laadsdaac")]
    if not urls:
        raise SystemExit(f"h{h:02d}v{v:02d}: no LAADS download link")
    return urls[0]


def tile(h: int, v: int) -> Path:
    cached = sorted(CACHE.glob(f"VNP46A4.A{YEAR}001.h{h:02d}v{v:02d}.002.*.h5"))
    if cached:
        return cached[-1]
    url = granule_url(h, v)
    path = CACHE / url.rsplit("/", 1)[-1]
    CACHE.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        try:
            with requests.get(url, headers=headers(), stream=True, timeout=600) as r:
                r.raise_for_status()
                part = path.with_suffix(".part")
                with open(part, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            part.rename(path)
            return path
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt * 2)
    raise AssertionError


def read(path: Path):
    """Radiance (row 0 = north) and the pixel grid's top-left corner and pixel size."""
    with h5py.File(path, "r") as f:
        ds = f[f"{FIELDS}/NearNadir_Composite_Snow_Free"]
        raw = ds[...].astype(np.float64)
        fill = float(np.asarray(ds.attrs["_FillValue"]).ravel()[0])
        scale = float(np.asarray(ds.attrs.get("scale_factor", 1.0)).ravel()[0])
        offset = float(np.asarray(ds.attrs.get("offset", 0.0)).ravel()[0])
        lat = f[f"{FIELDS}/lat"][:]
        lon = f[f"{FIELDS}/lon"][:]
    rad = np.where(raw == fill, np.nan, raw * scale + offset)
    rad = np.where(rad < 0, np.nan, rad)
    if lat[0] < lat[-1]:
        rad, lat = rad[::-1], lat[::-1]
    px_lon, px_lat = abs(float(lon[1] - lon[0])), abs(float(lat[1] - lat[0]))
    return rad, float(lon[0]) - px_lon / 2, float(lat[0]) + px_lat / 2, px_lon, px_lat


def main() -> None:
    fc = json.loads(SE_GEOJSON.read_text())
    codes = [f["properties"]["pno"] for f in fc["features"]]
    geoms = [shapely.make_valid(shape(f["geometry"])) for f in fc["features"]]
    tree = STRtree(geoms)
    centre_sum, centre_n = np.zeros(len(codes)), np.zeros(len(codes), dtype=np.int64)
    rasters = []
    for h, v in TILES:
        rad, west, north, px_lon, px_lat = read(tile(h, v))
        transform = from_origin(west, north, px_lon, px_lat)
        rasters.append((rad, transform))
        rows, cols = rad.shape
        hits = tree.query(box(west, north - rows * px_lat, west + cols * px_lon, north),
                          predicate="intersects")
        if len(hits) == 0:
            continue
        # Pixel centres: each lies in at most one DeSO, so one label raster serves all.
        labels = rasterize(((geoms[i], k + 1) for k, i in enumerate(hits)), out_shape=rad.shape,
                           transform=transform, fill=0, dtype="int32")
        m = np.isfinite(rad) & (labels > 0)
        lab = hits[labels[m] - 1]
        np.add.at(centre_sum, lab, rad[m])
        np.add.at(centre_n, lab, 1)
        print(f"  h{h:02d}v{v:02d}: {len(hits)} DeSOs", file=sys.stderr)

    def touched_mean(g) -> float | None:
        """Mean of every pixel the polygon touches. Rasterized alone: touched pixels are
        shared with neighbours, and in one label raster the neighbour drawn last takes them."""
        total, n = 0.0, 0
        for rad, transform in rasters:
            x0, y0, x1, y1 = g.bounds
            c0, r0 = ~transform * (x0, y1)
            c1, r1 = ~transform * (x1, y0)
            r0, c0 = max(int(r0) - 1, 0), max(int(c0) - 1, 0)
            r1, c1 = min(int(r1) + 2, rad.shape[0]), min(int(c1) + 2, rad.shape[1])
            if r0 >= r1 or c0 >= c1:
                continue
            win = rad[r0:r1, c0:c1]
            mask = rasterize([(g, 1)], out_shape=win.shape, transform=transform * transform.translation(c0, r0),
                             fill=0, dtype="uint8", all_touched=True).astype(bool) & np.isfinite(win)
            total += float(win[mask].sum())
            n += int(mask.sum())
        return total / n if n else None

    values, touched_only, missing = {}, [], []
    for k, code in enumerate(codes):
        if centre_n[k] > 0:
            values[code] = round(float(centre_sum[k] / centre_n[k]), 2)
            continue
        mean = touched_mean(geoms[k])
        if mean is None:
            missing.append(code)
        else:
            values[code] = round(mean, 2)
            touched_only.append(code)
    print(f"{len(touched_only)} DeSOs hold no pixel centre and take the pixels they touch", file=sys.stderr)
    if missing:
        print(f"no pixels for {len(missing)} DeSOs: {missing[:10]}", file=sys.stderr)
    OUT.write_text(json.dumps({
        "source": f"NASA Black Marble VNP46A4 collection 2, {YEAR} annual composite, "
                  "NearNadir_Composite_Snow_Free, tiles " + ", ".join(f"h{h}v{v:02d}" for h, v in TILES),
        "year": YEAR,
        "values": dict(sorted(values.items())),
    }, separators=(",", ":")) + "\n")
    vals = sorted(values.values())
    print(f"wrote {OUT}: {len(values)} of {len(codes)} DeSOs; min {vals[0]}, median "
          f"{vals[len(vals) // 2]}, max {vals[-1]} nW/cm²/sr", file=sys.stderr)


if __name__ == "__main__":
    main()
