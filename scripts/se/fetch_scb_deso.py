#!/usr/bin/env python3
"""Fetch Statistics Sweden (SCB) tables at DeSO 2025 level.

Writes scripts/se/scb_deso.json: raw counts and published values per DeSO code,
plus the year each table was read at. build_se_geojson.py turns these into the
map's metrics; nothing here derives or estimates anything.

Source: SCB Statistikdatabasen, PxWeb API v2 (CC0, "Källa: SCB").
  https://statistikdatabasen.scb.se/api/v2/

Two things about these tables that are easy to get wrong:

* Every table carries BOTH DeSO versions. `0114A0010` is DeSO 2018 and
  `0114A0010_DeSO2025` is DeSO 2025; only the suffixed codes match the 2025
  boundaries (scripts/se/fetch_se_boundaries.py). The suffix is stripped on output.
* From reference year 2025 SCB adds a small controlled random noise to every cell
  to protect individuals, so a total need not equal the sum of its parts. Shares
  are therefore always taken against the table's own published total for the
  categories involved, never against a sum we computed.

The API allows 150,000 cells per call and 30 calls per 10 s; requests are batched
by region well under the first and spaced under the second.
"""

from __future__ import annotations

import json
import sys
import time
from itertools import product
from pathlib import Path

import requests

API = "https://statistikdatabasen.scb.se/api/v2"
OUT = Path(__file__).resolve().parent / "scb_deso.json"
SUFFIX = "_DeSO2025"
MAX_CELLS = 100_000
MIN_INTERVAL_S = 0.45

# key -> (table, {variable: [codes]} besides Region/Tid). Every listed code is read;
# the per-DeSO record is keyed "<code>|<code>…" in the order the variables are given.
TABLES: dict[str, tuple[str, dict[str, list[str]]]] = {
    # Folkmängden per region efter ålder och kön
    "age_sex": ("TAB6574", {
        "Alder": ["totalt", "-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39",
                  "40-44", "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-"],
        "Kon": ["1+2"],
        "ContentsCode": ["000007Y7"],
    }),
    "sex": ("TAB6574", {
        "Alder": ["totalt"],
        "Kon": ["1", "2"],
        "ContentsCode": ["000007Y7"],
    }),
    # Folkmängden per region efter utländsk/svensk bakgrund och kön
    "background": ("TAB6571", {
        "UtlBakgrund": ["SA", "1"],
        "Kon": ["1+2"],
        "ContentsCode": ["000007Y4"],
    }),
    # Antal hushåll per region efter hushållstyp
    "households": ("TAB6568", {
        "Hushallstyp": ["TOTALT", "SBMB", "SBUB", "ESMB", "ESUB", "OVRIGA"],
        "ContentsCode": ["000007Y1"],
    }),
    # Antal personer efter region och upplåtelseform
    "tenure": ("TAB6253", {
        "Upplatelseform": ["TOTALT", "ÄG/ANDEL", "BOSTADSRÄTT", "HYRESRÄTT", "ÖVRIGT"],
        "ContentsCode": ["000007DQ"],
    }),
    # Antal personer efter region och hustyp
    "house_type": ("TAB6065", {
        "Hustyp": ["TOTALT", "SMÅHUS", "FLERBOST", "ÖVRHUS", "SPEC", "OKÄND"],
        "ContentsCode": ["0000077F"],
    }),
    # Ekonomisk standard, andel av befolkningen per inkomstklass efter region (fasta priser)
    "economic_standard": ("TAB6684", {
        "ContentsCode": ["000008AB", "000008A5"],  # median tkr, persons
    }),
    # Låg respektive hög ekonomisk standard efter region och ålder
    "low_high_standard": ("TAB6685", {
        "Alder": ["tot"],
        "ContentsCode": ["000008AC", "000008AD", "000008AE"],  # low %, high %, persons
    }),
    # Arbetsmarknadsstatus efter bostadens belägenhet, region (DeSO/RegSO), kön och ålder
    "labour": ("TAB6680", {
        "Kon": ["1+2"],
        "Alder": ["20-64"],
        "ContentsCode": ["0000089X", "0000089W", "0000089V", "0000089Y"],  # employed, unemployed, labour force, total
    }),
    # Befolkning 25–65 år efter region och utbildningsnivå
    "education": ("TAB6534", {
        "UtbildningsNiva": ["21", "3+4", "5", "6", "US"],
        "ContentsCode": ["000007Z6"],
    }),
    # Land- och vattenareal per den 1 januari efter region och arealtyp
    "area": ("TAB6420", {
        "ArealTyp": ["01", "05"],  # land, total
        "ContentsCode": ["000007DY"],  # km²
    }),
    # Bostadsbebyggelsens ålder efter region (avg_construction_year, by decade)
    "building_age": ("TAB6540", {
        "ByggAr": ["-1920", "1921-1930", "1931-1940", "1941-1950", "1951-1960", "1961-1970",
                   "1971-1980", "1981-1990", "1991-2000", "2001-2010", "2011-2020", "2021-2030",
                   "Okänt", "Totalt"],
        "ContentsCode": ["0000080B"],  # antal
    }),
}


_last_call = 0.0


def _get(url: str, **kw) -> requests.Response:
    return _call("GET", url, **kw)


def _post(url: str, **kw) -> requests.Response:
    return _call("POST", url, **kw)


def _call(method: str, url: str, **kw) -> requests.Response:
    global _last_call
    for attempt in range(5):
        wait = MIN_INTERVAL_S - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
        res = requests.request(method, url, timeout=120, **kw)
        if res.status_code == 429 or res.status_code >= 500:
            time.sleep(2 ** attempt * 2)
            continue
        res.raise_for_status()
        return res
    res.raise_for_status()
    return res


def table_meta(table: str) -> dict:
    return _get(f"{API}/tables/{table}/metadata", params={"lang": "sv"}).json()


def latest_year(meta: dict) -> str:
    years = list(meta["dimension"]["Tid"]["category"]["index"])
    return max(years)


def deso_codes(meta: dict) -> list[str]:
    codes = [c for c in meta["dimension"]["Region"]["category"]["index"] if c.endswith(SUFFIX)]
    if len(codes) != 6160:
        raise SystemExit(f"expected 6,160 DeSO 2025 regions, table lists {len(codes)}")
    return codes


def fetch_table(table: str, dims: dict[str, list[str]]) -> tuple[str, dict[str, dict[str, float | None]]]:
    meta = table_meta(table)
    year = latest_year(meta)
    regions = deso_codes(meta)
    for var, codes in dims.items():
        known = set(meta["dimension"][var]["category"]["index"])
        missing = [c for c in codes if c not in known]
        if missing:
            raise SystemExit(f"{table}: {var} has no {missing}")

    per_region = 1
    for codes in dims.values():
        per_region *= len(codes)
    batch = max(1, MAX_CELLS // per_region)

    out: dict[str, dict[str, float | None]] = {}
    for start in range(0, len(regions), batch):
        chunk = regions[start:start + batch]
        selection = [{"variableCode": "Region", "valueCodes": chunk},
                     {"variableCode": "Tid", "valueCodes": [year]}]
        selection += [{"variableCode": v, "valueCodes": c} for v, c in dims.items()]
        res = _post(f"{API}/tables/{table}/data", params={"lang": "sv", "outputFormat": "json-stat2"},
                    json={"selection": selection})
        ds = res.json()
        ids = ds["id"]
        sizes = ds["size"]
        index = {d: list(ds["dimension"][d]["category"]["index"]) for d in ids}
        values = ds["value"]
        if isinstance(values, dict):  # sparse form
            values = [values.get(str(i)) for i in range(int(_prod(sizes)))]
        for flat, coords in enumerate(product(*(range(s) for s in sizes))):
            cats = {d: index[d][i] for d, i in zip(ids, coords)}
            deso = cats["Region"].removesuffix(SUFFIX)
            key = "|".join(cats[v] for v in dims)
            out.setdefault(deso, {})[key] = values[flat]
        print(f"  {table} {year}: {min(start + batch, len(regions))}/{len(regions)}", file=sys.stderr)
    return year, out


def _prod(xs):
    p = 1
    for x in xs:
        p *= x
    return p


def main() -> None:
    """All tables, or with `--only key,key` just those, merged into the existing file."""
    only = None
    if len(sys.argv) == 3 and sys.argv[1] == "--only":
        only = sys.argv[2].split(",")
        unknown = [k for k in only if k not in TABLES]
        if unknown:
            raise SystemExit(f"no such table key: {unknown}")
    result: dict = {"source": "SCB Statistikdatabasen (PxWeb API v2), CC0", "tables": {}}
    if only:
        result = json.loads(OUT.read_text())
    for key, (table, dims) in TABLES.items():
        if only and key not in only:
            continue
        year, data = fetch_table(table, dims)
        result["tables"][key] = {"table": table, "year": int(year), "data": data}
    OUT.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
