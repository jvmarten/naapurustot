#!/usr/bin/env python3
"""Land borders of the countries the map carries data for -> src/data/country_borders.geojson.

The map draws a country border strong where it touches a country whose data is on
screen. From zoom 5 the basemap's own boundary tiles say which countries a border
separates (`adm0_l` / `adm0_r`, ISO 3166-1 alpha-3); below zoom 5 OpenFreeMap's tiles
carry no country codes at all, so those zooms draw these lines instead.

Source: Natural Earth 1:10m "Admin 0 – Boundary Lines" (land), public domain,
https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_boundary_lines_land.zip
Every line with Finland or Sweden on either side is kept, with its two sides renamed to
the tiles' property names so one paint expression serves both sources.

Usage: python scripts/fetch_country_borders.py
"""

from __future__ import annotations

import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import requests
import shapefile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data" / "country_borders.geojson"
URL = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_boundary_lines_land.zip"
LAYER = "ne_10m_admin_0_boundary_lines_land"
COUNTRIES = {"FIN", "SWE"}
DECIMALS = 4  # ~10 m; the lines are drawn below zoom 5, where a pixel is ~5 km


def main() -> None:
    res = requests.get(URL, timeout=120)
    res.raise_for_status()
    features = []
    with tempfile.TemporaryDirectory() as tmp:
        zipfile.ZipFile(io.BytesIO(res.content)).extractall(tmp)
        with shapefile.Reader(str(Path(tmp) / f"{LAYER}.shp")) as r:
            for rec, shp in zip(r.iterRecords(), r.iterShapes()):
                left, right = rec["ADM0_A3_L"], rec["ADM0_A3_R"]
                if not COUNTRIES & {left, right}:
                    continue
                # A record can hold several parts; joining them would draw chords between them.
                ends = list(shp.parts[1:]) + [len(shp.points)]
                parts = [[[round(x, DECIMALS), round(y, DECIMALS)] for x, y in shp.points[a:b]]
                         for a, b in zip(shp.parts, ends)]
                geometry = ({"type": "LineString", "coordinates": parts[0]} if len(parts) == 1
                            else {"type": "MultiLineString", "coordinates": parts})
                features.append({"type": "Feature", "properties": {"adm0_l": left, "adm0_r": right},
                                 "geometry": geometry})
    if not features:
        raise SystemExit("no Finnish or Swedish border lines found — refusing to write")
    features.sort(key=lambda f: (f["properties"]["adm0_l"], f["properties"]["adm0_r"], json.dumps(f["geometry"]["coordinates"])[:40]))
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}: {len(features)} lines", file=sys.stderr)


if __name__ == "__main__":
    main()
