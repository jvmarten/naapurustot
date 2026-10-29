#!/usr/bin/env python3
"""Road traffic noise (Lden) per Swedish DeSO area -> scripts/se/noise_deso.json.

Finland's method (scripts/fetch_noise_pollution.py), applied to Sweden: the area-weighted
mean of the noise bands' midpoints over each area, with ground outside every contour at
the same 40 dB background. Bands as Finland reads them: 55-60 -> 57.5 ... and the open
"> 75 dB" band as 75-80 -> 77.5.

Source: the European Environment Agency's road-noise Lden contours from the Environmental
Noise Directive's fourth round, as reported by Sweden (major roads, over three million
vehicles a year, and all roads in the agglomerations, e.g. Stockholm, Göteborg, Malmö,
Örebro, Helsingborg): EEA image service
noiseStoryMap/NoiseContours_road_lden ("Update April 2026"), 10 m cells in EPSG:3035,
classes 1-5 = 55-60, 60-65, 65-70, 70-75, > 75 dB, 15 = outside every contour.

Class 0 is outside the mosaic's footprint: 12 % of DeSO land, almost all of it northern
Lapland (no road there carries the traffic the directive maps) and inland Småland. Like
15 it means no contour was reported, so it takes the background; the script prints the
share so a change in the footprint shows up.

The service is read in 40 km tiles (4,000 px, LZ77-compressed TIFF, ~0.5 MB each) where
they touch a DeSO, and each DeSO's pixels are counted with its shore-clipped display
polygon (public/data/se_deso.geojson), as Finland's postal polygons stop at the shore.
EPSG:3035 is equal-area, so a pixel count is an area. Tiles are cached under
scripts/se/cache/noise/.

Usage: python scripts/se/fetch_se_noise.py
"""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

import numpy as np
import requests
import shapely
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely import STRtree
from shapely.geometry import box, shape

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SE_GEOJSON = ROOT / "public" / "data" / "se_deso.geojson"
CACHE = HERE / "cache" / "noise"
OUT = HERE / "noise_deso.json"
SERVICE = ("https://noise.discomap.eea.europa.eu/arcgis/rest/services/noiseStoryMap/"
           "NoiseContours_road_lden/ImageServer/exportImage")
TILE_M = 40_000
CELL_M = 10
PX = TILE_M // CELL_M
NODATA = 15
OUTSIDE = 0  # beyond the mosaic's footprint; counted separately to see whether any land has it
MIDPOINTS = {1: 57.5, 2: 62.5, 3: 67.5, 4: 72.5, 5: 77.5}
BACKGROUND_DB = 40.0

to_3035 = Transformer.from_crs("EPSG:4326", "EPSG:3035", always_xy=True).transform


def tile(x0: int, y0: int) -> np.ndarray:
    path = CACHE / f"{x0}_{y0}.tif"
    if not path.exists():
        params = {"bbox": f"{x0},{y0},{x0 + TILE_M},{y0 + TILE_M}", "bboxSR": 3035, "imageSR": 3035,
                  "size": f"{PX},{PX}", "format": "tiff", "compression": "LZ77", "f": "image",
                  "interpolation": "RSP_NearestNeighbor"}
        for attempt in range(4):
            try:
                r = requests.get(SERVICE, params=params, timeout=180)
                r.raise_for_status()
                if not r.content.startswith(b"II"):
                    raise RuntimeError(f"not a TIFF: {r.content[:200]!r}")
                break
            except (requests.RequestException, RuntimeError):
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt * 2)
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    a = np.array(Image.open(io.BytesIO(path.read_bytes())))
    if a.shape != (PX, PX):
        raise SystemExit(f"tile {x0},{y0}: unexpected shape {a.shape}")
    bad = set(np.unique(a).tolist()) - set(MIDPOINTS) - {NODATA, OUTSIDE}
    if bad:
        raise SystemExit(f"tile {x0},{y0}: unexpected classes {bad}")
    return a


def main() -> None:
    fc = json.loads(SE_GEOJSON.read_text())
    codes, geoms = [], []
    for f in fc["features"]:
        codes.append(f["properties"]["pno"])
        geoms.append(shapely.make_valid(shapely.transform(shape(f["geometry"]),
                                                          lambda c: np.column_stack(to_3035(c[:, 0], c[:, 1])))))
    tree = STRtree(geoms)
    xmin, ymin, xmax, ymax = shapely.total_bounds(geoms)
    x_start, y_start = int(xmin // TILE_M * TILE_M), int(ymin // TILE_M * TILE_M)
    counts = np.zeros((len(codes), 8), dtype=np.int64)  # [0 background, 1..5 bands, total, outside footprint]
    tiles = [(x, y) for x in range(x_start, int(xmax) + 1, TILE_M) for y in range(y_start, int(ymax) + 1, TILE_M)]
    done = 0
    for x0, y0 in tiles:
        hits = tree.query(box(x0, y0, x0 + TILE_M, y0 + TILE_M), predicate="intersects")
        if len(hits) == 0:
            continue
        a = tile(x0, y0)
        labels = rasterize(((geoms[i], k + 1) for k, i in enumerate(hits)), out_shape=(PX, PX),
                           transform=from_origin(x0, y0 + TILE_M, CELL_M, CELL_M), fill=0, dtype="int32")
        inside = labels > 0
        raw = a[inside]
        np.add.at(counts[:, 7], hits[labels[inside][raw == OUTSIDE] - 1], 1)
        cls = np.where(raw == NODATA, 0, raw)
        lab = labels[inside] - 1
        for c in range(6):
            np.add.at(counts[:, c], hits[lab[cls == c]], 1)
        np.add.at(counts[:, 6], hits[lab], 1)
        done += 1
        if done % 25 == 0:
            print(f"  {done} tiles", file=sys.stderr)
    values = {}
    for k, code in enumerate(codes):
        n = counts[k, 6]
        if n == 0:
            continue
        s = counts[k, 0] * BACKGROUND_DB + sum(counts[k, c] * MIDPOINTS[c] for c in MIDPOINTS)
        values[code] = round(float(s / n), 1)
    outside = counts[:, 7].sum() / counts[:, 6].sum()
    print(f"pixels outside the mosaic footprint: {100 * outside:.3f} % of DeSO land "
          f"({int((counts[:, 7] > 0).sum())} DeSOs touch it)", file=sys.stderr)
    missing = [c for c in codes if c not in values]
    if missing:
        print(f"no pixels for {len(missing)} DeSOs: {missing[:10]}", file=sys.stderr)
    OUT.write_text(json.dumps({
        "source": "EEA, END round 4 road noise Lden contours (NoiseContours_road_lden, update April 2026)",
        "values": dict(sorted(values.items())),
    }, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}: {len(values)} of {len(codes)} DeSOs from {done} tiles", file=sys.stderr)


if __name__ == "__main__":
    main()
