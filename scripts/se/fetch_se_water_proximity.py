#!/usr/bin/env python3
"""Population-weighted distance from residents to the nearest water, per Swedish DeSO
area -> scripts/se/water_proximity_deso.json.

Finland's method (scripts/fetch_water_proximity.py), applied to Sweden:

- Water is OpenStreetMap natural=water (closed ways and multipolygons, OUTER rings only,
  so an island in a lake counts as lake, as in Finland; polygons under 1 ha dropped) and
  natural=coastline ways as lines. Read from the whole-Sweden extract, because Overpass
  is not reachable from every machine this runs on. Finnish water near the border is not
  in the Swedish extract; the Torne river lies in both, and the few DeSOs whose nearest
  water would be a Finnish lake are on the river anyway.
- Residents are SCB's 1 km population grid (stat:befolkning_1km_2025, CC0), the
  counterpart of Statistics Finland's grid. Each populated cell whose centre lies in a
  DeSO contributes its centre-to-water distance, weighted by its inhabitants.
- A DeSO holding no populated cell centre (small inner-city areas) is measured from its
  representative point, as Finland measures its sub-cell postal areas.

Distances are in metres, rounded to 10 m, in SWEREF 99 TM (EPSG:3006).

Usage: python scripts/se/fetch_se_water_proximity.py <sweden-latest.osm.pbf>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import osmium
import requests
import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import transform

HERE = Path(__file__).resolve().parent
RAW = HERE / "cache" / "deso_2025_raw.geojson"
GRID_CACHE = HERE / "cache" / "befolkning_1km_2025.json"
OUT = HERE / "water_proximity_deso.json"
WFS = "https://geodata.scb.se/geoserver/stat/wfs"
GRID_LAYER = "stat:befolkning_1km_2025"
MIN_WATER_AREA_M2 = 10_000

to_3006 = Transformer.from_crs("EPSG:4326", "EPSG:3006", always_xy=True).transform


def population_grid() -> list[tuple[float, float, int]]:
    """(x, y, residents) per populated 1 km cell centre, EPSG:3006. Cached."""
    if GRID_CACHE.exists():
        return [tuple(c) for c in json.loads(GRID_CACHE.read_text())["cells"]]
    cells, start, page = [], 0, 20000
    while True:
        r = requests.get(WFS, params={
            "service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": GRID_LAYER,
            "outputFormat": "application/json", "count": page, "startIndex": start,
            "sortBy": "objectid", "propertyName": "objectid,beftotalt,sp_geometry",
        }, timeout=300)
        r.raise_for_status()
        feats = r.json()["features"]
        for f in feats:
            n = f["properties"]["beftotalt"]
            if n and n > 0:
                c = shape(f["geometry"]).centroid
                cells.append((round(c.x), round(c.y), n))
        print(f"  grid: {start + len(feats)} cells read", file=sys.stderr)
        if len(feats) < page:
            break
        start += page
    if not cells:
        raise SystemExit("SCB population grid came back empty")
    GRID_CACHE.parent.mkdir(exist_ok=True)
    GRID_CACHE.write_text(json.dumps({"layer": GRID_LAYER, "crs": "EPSG:3006", "cells": cells}))
    return cells


def water_geometries(pbf: str) -> list:
    """Water polygons (outer rings, ≥ 1 ha) and coastline lines, EPSG:3006."""
    out = []
    small = 0
    for obj in osmium.FileProcessor(pbf).with_locations().with_areas():
        tags = obj.tags
        if isinstance(obj, osmium.osm.Area):
            if tags.get("natural") != "water":
                continue
            for ring in obj.outer_rings():
                coords = [(n.lon, n.lat) for n in ring if n.location.valid()]
                if len(coords) < 4:
                    continue
                try:
                    poly = transform(to_3006, Polygon(coords))
                except Exception:
                    continue
                if poly.is_empty:
                    continue
                if poly.area < MIN_WATER_AREA_M2:
                    small += 1
                    continue
                out.append(poly)
        elif isinstance(obj, osmium.osm.Way) and tags.get("natural") == "coastline":
            coords = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
            if len(coords) >= 2:
                out.append(transform(to_3006, LineString(coords)))
    print(f"  water: {len(out)} geometries kept, {small} under 1 ha dropped", file=sys.stderr)
    return out


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    if not RAW.exists():
        raise SystemExit(f"{RAW} missing — run scripts/se/fetch_se_boundaries.py first")
    cells = population_grid()
    water = water_geometries(sys.argv[1])
    if not water:
        raise SystemExit("no water geometries — refusing to write")
    tree = STRtree(water)
    water_arr = np.asarray(water, dtype=object)

    fc = json.loads(RAW.read_text())
    codes = [f["properties"]["deso"] for f in fc["features"]]
    desos = [transform(to_3006, shape(f["geometry"])) for f in fc["features"]]
    deso_tree = STRtree(desos)

    pts = shapely.points([(c[0], c[1]) for c in cells])
    pop = np.array([c[2] for c in cells], dtype=float)
    pi, gi = deso_tree.query(pts, predicate="within")
    first: dict[int, int] = {}
    for p, g in zip(pi.tolist(), gi.tolist()):
        first.setdefault(p, g)
    cell_idx = np.array(sorted(first))
    dist = shapely.distance(pts[cell_idx], water_arr[tree.nearest(pts[cell_idx])])
    weighted: dict[int, float] = {}
    residents: dict[int, float] = {}
    for ci, d in zip(cell_idx.tolist(), dist.tolist()):
        g = first[ci]
        weighted[g] = weighted.get(g, 0.0) + pop[ci] * d
        residents[g] = residents.get(g, 0.0) + pop[ci]

    values: dict[str, int] = {}
    for g, w in weighted.items():
        values[codes[g]] = int(round(w / residents[g] / 10) * 10)
    missing = [g for g in range(len(codes)) if codes[g] not in values]
    if missing:
        rp = np.asarray([desos[g].representative_point() for g in missing], dtype=object)
        d = shapely.distance(rp, water_arr[tree.nearest(rp)])
        for g, v in zip(missing, d.tolist()):
            values[codes[g]] = int(round(v / 10) * 10)
    print(f"  {len(weighted)} DeSOs from grid cells, {len(missing)} from their representative point",
          file=sys.stderr)

    v = sorted(values.values())
    OUT.write_text(json.dumps({
        "source": "OpenStreetMap (natural=water ≥ 1 ha, natural=coastline) + SCB 1 km population grid 2025",
        "grid_layer": GRID_LAYER,
        "values": dict(sorted(values.items())),
    }, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"wrote {OUT}: min {v[0]} m, median {v[len(v) // 2]} m, p90 {v[int(len(v) * .9)]} m, max {v[-1]} m, "
          f"zero {sum(1 for x in v if x == 0)}", file=sys.stderr)


if __name__ == "__main__":
    main()
