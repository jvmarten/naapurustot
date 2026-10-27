#!/usr/bin/env python3
"""Clip the DeSO 2025 polygons to land -> scripts/se/cache/deso_2025_land.geojson.

SCB's DeSO polygons follow municipal boundaries, which run out into the sea: all of
Värmdö's archipelago is one polygon reaching to the territorial limit. Finland's Paavo
areas are cut at the shore, so on one map Sweden drew a smooth blob over the Baltic next
to Finland's real coastline. This cuts each DeSO to OpenStreetMap's land polygons, the
same sea/land split the basemap draws. Lakes are land in that product, as they are in
Paavo, so only the sea is removed.

Only display geometry changes: every area figure comes from SCB's tables (land area
included), never from the polygon.

Input
  scripts/se/cache/deso_2025_raw.geojson   fetch_se_boundaries.py
  scripts/se/cache/land/land-polygons-split-4326/land_polygons.shp
      https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip
      (OpenStreetMap contributors, ODbL; ~930 MB, unzip into cache/land/)

Usage: python scripts/se/clip_deso_land.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import shapefile
import shapely
from shapely.geometry import mapping, shape

HERE = Path(__file__).resolve().parent
RAW = HERE / "cache" / "deso_2025_raw.geojson"
LAND = HERE / "cache" / "land" / "land-polygons-split-4326" / "land_polygons.shp"
OUT = HERE / "cache" / "deso_2025_land.geojson"
SWEDEN_BBOX = (10.0, 55.0, 25.0, 69.5)
# Snap rounding for the overlay, ~1 cm: the land product is cut into tiles, and an
# unsnapped union of a DeSO's pieces can leave a hairline seam along a tile edge.
GRID = 1e-7


def load_land() -> list:
    minx, miny, maxx, maxy = SWEDEN_BBOX
    out = []
    with shapefile.Reader(str(LAND)) as r:
        for sr in r.iterShapes():
            bx0, by0, bx1, by1 = sr.bbox
            if bx1 < minx or bx0 > maxx or by1 < miny or by0 > maxy:
                continue
            out.append(shape(sr.__geo_interface__))
    return out


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"{RAW} missing — run scripts/se/fetch_se_boundaries.py first")
    if not LAND.exists():
        raise SystemExit(f"{LAND} missing — see this script's docstring")
    land = load_land()
    tree = shapely.STRtree(land)
    print(f"land: {len(land)} tiles over Sweden", file=sys.stderr)

    fc = json.loads(RAW.read_text())
    before = after = 0.0
    for i, f in enumerate(fc["features"]):
        g = shapely.make_valid(shape(f["geometry"]))
        hits = [land[j] for j in tree.query(g, predicate="intersects")]
        if not hits:
            raise SystemExit(f"DeSO {f['properties']['deso']} touches no land")
        pieces = [shapely.intersection(g, h, grid_size=GRID) for h in hits]
        clipped = shapely.union_all(pieces, grid_size=GRID)
        # Keep only the areal part: an overlay can return stray points or lines where a
        # DeSO edge grazes the shore.
        polys = [p for p in getattr(clipped, "geoms", [clipped]) if p.geom_type in ("Polygon", "MultiPolygon")]
        clipped = shapely.union_all(polys, grid_size=GRID) if polys else None
        if clipped is None or clipped.is_empty:
            raise SystemExit(f"DeSO {f['properties']['deso']} has no land left")
        before += g.area
        after += clipped.area
        f["geometry"] = mapping(clipped)
        if (i + 1) % 500 == 0:
            print(f"  {i + 1} / {len(fc['features'])}", file=sys.stderr)
    OUT.write_text(json.dumps(fc))
    print(f"wrote {OUT}: land is {after / before:.1%} of the DeSO polygons' area", file=sys.stderr)


if __name__ == "__main__":
    main()
