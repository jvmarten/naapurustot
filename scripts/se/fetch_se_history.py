#!/usr/bin/env python3
"""Fetch Swedish per-DeSO history (SCB) for the areas whose boundaries did not move.

Writes scripts/se/history_deso.json: for each DeSO 2025 area that is continuous with a
DeSO 2018 area, yearly series of

  population          TAB6574  residents 31 December (000007Y7, totalt, 1+2)
  economic_standard   TAB6684  median ekonomisk standard, tkr, fixed prices (000008AB)
  unemployment        TAB6680  unemployed / labour force, ages 20-64, % (0000089W / 0000089V)

Nothing is estimated. SCB publishes each table under both DeSO versions: the DeSO 2018
codes (`0114A0010`) carry the years before DeSO 2025 existed and the DeSO 2025 codes
(`0114A0010_DeSO2025`) the years from then on — each family reads 0 or `..` in the other's
years. A series can therefore be joined only where a 2025 area is the same area as the
2018 one with its code. That is decided from SCB's own boundaries (geodata WFS
stat:DeSO_2018 / stat:DeSO_2025, EPSG:3006), never from the statistics:

  continuous  = same code in both versions, and the symmetric difference of the two
                polygons is under CONTINUITY_MAX of the 2025 area.

The 1 % threshold was measured, not chosen: among same-code areas, the 2023 -> 2024
population change (the step that crosses versions) has the same distribution as an
ordinary year (2022 -> 2023: p95 5.1 %) for every boundary change below 1 % (p95 4.0-5.1 %),
and drifts above it once the boundary moves more (1-5 %: p95 6.3 %; >= 5 %: 10.0 %).
That gives 4,605 of 6,160 areas; the others get no history rather than a series whose
first years describe a different piece of ground.

Each series is cut to its latest HISTORY_POINTS years: six points is the window Finland's
Paavo history carries, so a change computed from first to last spans five years in both.

Source: SCB Statistikdatabasen (PxWeb API v2) and SCB geodata, CC0 ("Källa: SCB").
Usage: python scripts/se/fetch_se_history.py   (downloads ~170 MB of boundaries to cache/)
"""

from __future__ import annotations

import json
import sys
from itertools import product
from pathlib import Path

import requests
from shapely.geometry import shape

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fetch_scb_deso import API, SUFFIX, _get, _post, _prod  # noqa: E402

OUT = HERE / "history_deso.json"
CACHE = HERE / "cache"
WFS = "https://geodata.scb.se/geoserver/stat/wfs"
CONTINUITY_MAX = 0.01
HISTORY_POINTS = 6
MAX_CELLS = 100_000

# key -> (table, {variable: [codes]} besides Region/Tid, how a year's value is formed)
SERIES = {
    "population": ("TAB6574", {"Alder": ["totalt"], "Kon": ["1+2"], "ContentsCode": ["000007Y7"]}),
    "economic_standard": ("TAB6684", {"ContentsCode": ["000008AB"]}),
    "unemployment": ("TAB6680", {"Kon": ["1+2"], "Alder": ["20-64"], "ContentsCode": ["0000089W", "0000089V"]}),
}


def boundaries(layer: str) -> dict[str, object]:
    path = CACHE / f"{layer}.geojson"
    if not path.exists():
        CACHE.mkdir(exist_ok=True)
        res = requests.get(WFS, params={"service": "WFS", "version": "2.0.0", "request": "GetFeature",
                                        "typeNames": f"stat:{layer}", "outputFormat": "application/json"},
                           timeout=900)
        res.raise_for_status()
        path.write_bytes(res.content)
    out = {}
    for f in json.loads(path.read_text())["features"]:
        g = shape(f["geometry"])
        out[f["properties"]["desokod"]] = g if g.is_valid else g.buffer(0)
    return out


def continuity() -> tuple[list[str], dict]:
    old, new = boundaries("DeSO_2018"), boundaries("DeSO_2025")
    if len(new) != 6160:
        raise SystemExit(f"expected 6,160 DeSO 2025 areas, got {len(new)}")
    same_code = [c for c in new if c in old]
    keep = sorted(c for c in same_code if old[c].symmetric_difference(new[c]).area < CONTINUITY_MAX * new[c].area)
    stats = {"deso_2025": len(new), "same_code": len(same_code), "continuous": len(keep),
             "max_boundary_change": CONTINUITY_MAX}
    print(f"continuity: {stats}", file=sys.stderr)
    return keep, stats


def read(table: str, dims: dict[str, list[str]], regions: list[str], years: list[str]) -> dict:
    """{(region, year): {"<code>|<code>…": value}} for the given regions and years."""
    per_region = len(years) * _prod([len(c) for c in dims.values()])
    batch = max(1, MAX_CELLS // per_region)
    out: dict = {}
    for start in range(0, len(regions), batch):
        selection = [{"variableCode": "Region", "valueCodes": regions[start:start + batch]},
                     {"variableCode": "Tid", "valueCodes": years}]
        selection += [{"variableCode": v, "valueCodes": c} for v, c in dims.items()]
        ds = _post(f"{API}/tables/{table}/data", params={"lang": "sv", "outputFormat": "json-stat2"},
                   json={"selection": selection}).json()
        ids, sizes = ds["id"], ds["size"]
        index = {d: list(ds["dimension"][d]["category"]["index"]) for d in ids}
        values = ds["value"]
        if isinstance(values, dict):
            values = [values.get(str(i)) for i in range(int(_prod(sizes)))]
        for flat, coords in enumerate(product(*(range(s) for s in sizes))):
            cats = {d: index[d][i] for d, i in zip(ids, coords)}
            key = "|".join(cats[v] for v in dims)
            out.setdefault((cats["Region"], cats["Tid"]), {})[key] = values[flat]
    return out


def first_year_of_2025_codes(table: str, dims: dict, years: list[str], probe: list[str]) -> str:
    """The first year SCB publishes under DeSO 2025 codes: before it they read 0 or `..`."""
    data = read(table, dims, [c + SUFFIX for c in probe], years)
    for y in years:
        if any(v for (r, yy), row in data.items() if yy == y for v in row.values()):
            return y
    raise SystemExit(f"{table}: no year with DeSO 2025 values")


def main() -> None:
    keep, stats = continuity()
    series: dict[str, dict[str, list]] = {d: {} for d in keep}
    tables = {}
    for key, (table, dims) in SERIES.items():
        meta = _get(f"{API}/tables/{table}/metadata", params={"lang": "sv"}).json()
        years = sorted(meta["dimension"]["Tid"]["category"]["index"])
        switch = first_year_of_2025_codes(table, dims, years, keep[:200])
        before, after = [y for y in years if y < switch], [y for y in years if y >= switch]
        old = read(table, dims, keep, before) if before else {}
        new = read(table, dims, [c + SUFFIX for c in keep], after)
        for deso in keep:
            points = []
            for y in years:
                row = old.get((deso, y)) if y < switch else new.get((deso + SUFFIX, y))
                v = value(key, row or {})
                if v is not None:
                    points.append([int(y), v])
            points = points[-HISTORY_POINTS:]
            # A gap inside the window would make first -> last span a different number of
            # years for this area than for its neighbours.
            if len(points) >= 2 and points[-1][0] - points[0][0] == len(points) - 1:
                series[deso][key] = points
        tables[key] = {"table": table, "years": [int(years[0]), int(years[-1])], "deso_2025_from": int(switch)}
        n = sum(1 for s in series.values() if key in s)
        print(f"{key}: {table} {years[0]}-{years[-1]}, DeSO 2025 codes from {switch}; {n} areas", file=sys.stderr)

    out = {"source": "SCB Statistikdatabasen (PxWeb API v2) and SCB geodata (DeSO 2018/2025), CC0",
           "continuity": stats, "tables": tables,
           "series": {d: s for d, s in series.items() if s}}
    OUT.write_text(json.dumps(out, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}", file=sys.stderr)


def value(key: str, row: dict) -> float | int | None:
    if key == "population":
        v = row.get("totalt|1+2|000007Y7")
        return int(v) if v else None  # 0 is SCB's "not this version", never a measured nobody
    if key == "economic_standard":
        v = row.get("000008AB")
        return round(v * 1000) if v else None
    unemp, lf = row.get("1+2|20-64|0000089W"), row.get("1+2|20-64|0000089V")
    if unemp is None or not lf:
        return None
    return round(min(unemp / lf, 1) * 100, 1)


if __name__ == "__main__":
    main()
