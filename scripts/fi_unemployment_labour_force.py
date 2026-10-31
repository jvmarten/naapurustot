#!/usr/bin/env python3
"""Offline surgery over the committed GeoJSON: Finland's unemployment rate per labour force.

Same conventions as scripts/fi_employment_2064.py: a one-time, deterministic correction
of already-committed source data, not part of `npm run build:data`.

`unemployment_rate` and every point of `unemployment_history` were Paavo's unemployed /
ALL residents (pt_tyott / he_vakiy) — children and pensioners in the base, so a median
area read 4.7 % where Statistics Finland's own definition gives 10.2 %. Both now use the
labour force, pt_tyott / (pt_tyoll + pt_tyott), which is what Statistics Finland and SCB
publish. The latest value comes from the GeoJSON's own counts; the history refetches
pt_tyoll and pt_tyott per Paavo release from the same WFS prepare_data.py reads
(pno_tilasto_<year>), the years the committed series already carry. Before rewriting,
every committed history point is reproduced from that fetch (under the old formula, or
the new one on a re-run), so a silent change on the server cannot slip new numbers in
under the old series.

The GeoJSON is rewritten with json.dump(data, f), Python's default serialization,
which is how the committed file is written.
"""
import json
import os
import sys
import urllib.request

GEOJSON = os.path.join(os.path.dirname(__file__), "..", "public", "data", "metro_neighborhoods.geojson")
WFS = (
    "https://geo.stat.fi/geoserver/postialue/wfs?service=WFS&version=2.0.0&request=GetFeature"
    "&typeNames=postialue:pno_tilasto_{year}&outputFormat=application/json"
    "&propertyName=postinumeroalue,pt_tyoll,pt_tyott,he_vakiy"
)


def _val(v):
    return None if v is None or v == -1 else v


def labour_force_rate(unemployed, employed):
    unemployed, employed = _val(unemployed), _val(employed)
    if unemployed is None or employed is None or unemployed + employed <= 0:
        return None
    return round(unemployed / (unemployed + employed) * 100, 1)


def fetch_year(year: int) -> dict:
    with urllib.request.urlopen(WFS.format(year=year), timeout=180) as r:
        feats = json.load(r)["features"]
    return {f["properties"]["postinumeroalue"]: f["properties"] for f in feats}


def main() -> int:
    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)
    feats = [ft["properties"] for ft in data["features"]]

    years = sorted({y for p in feats for y, _ in (p.get("unemployment_history") or [])})
    paavo = {y: fetch_year(y) for y in years}

    # Guard: the fetch must reproduce every committed point, under the old formula on
    # the first run or the new one on a re-run (which then rewrites nothing).
    for p in feats:
        for y, committed in (p.get("unemployment_history") or []):
            r = paavo[y].get(p["pno"])
            pop, unemployed = (_val(r.get("he_vakiy")), _val(r.get("pt_tyott"))) if r else (None, None)
            old = round(unemployed / pop * 100, 1) if pop and unemployed is not None else None
            new = labour_force_rate(r.get("pt_tyott"), r.get("pt_tyoll")) if r else None
            if not any(v is not None and abs(v - committed) <= 0.051 for v in (old, new)):
                print(f"{p['pno']} {y}: fetched data does not reproduce the committed {committed}", file=sys.stderr)
                return 1

    changed = 0
    for p in feats:
        new = labour_force_rate(p.get("pt_tyott"), p.get("pt_tyoll"))
        hist = []
        for y, _ in (p.get("unemployment_history") or []):
            r = paavo[y][p["pno"]]
            v = labour_force_rate(r.get("pt_tyott"), r.get("pt_tyoll"))
            if v is not None:
                hist.append([y, v])
        new_hist = hist if len(hist) >= 2 else None
        if new != p.get("unemployment_rate") or new_hist != p.get("unemployment_history"):
            changed += 1
        p["unemployment_rate"] = new
        p["unemployment_history"] = new_hist

    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"unemployment: {changed} areas rewritten over Paavo releases {years}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
