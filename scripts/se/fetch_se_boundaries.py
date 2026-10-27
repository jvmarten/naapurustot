#!/usr/bin/env python3
"""Fetch Swedish DeSO 2025 boundaries, RegSO 2025 names and the FA25 regions.

Outputs (all committed except the raw cache):
  scripts/se/cache/deso_2025_raw.geojson  full-resolution DeSO polygons (git-ignored,
                                          input to clip_deso_land.py)
  scripts/se/regso_2025.json              {regsokod: {name, kommun}} for all 3,363 RegSO
  scripts/se/deso_index.json              {desokod: {regso, kommun}} for all 6,160 DeSO
  scripts/se/fa25.json                    FA25 regions with their municipality codes
  scripts/se/kommuner.json                {kommunkod: name} from SCB, the names we display

Sources
  DeSO/RegSO: SCB geodata WFS, stat:DeSO_2025 / stat:RegSO_2025 (CC0).
  FA25: Tillväxtverket, "FA25 (2025 års indelning i FA-regioner)" (xlsx). FA regions are
        Tillväxtverket's classification, not SCB's; membership is checked against SCB's
        municipality list below and the script fails on any gap or double assignment.
  Municipality names: SCB Statistikdatabasen region list (CC0).
"""

from __future__ import annotations

import io
import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl
import requests

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
WFS = "https://geodata.scb.se/geoserver/stat/wfs"
FA25_PAGE = ("https://tillvaxtverket.se/tillvaxtverket/statistikochanalys/"
             "statistikomregionalutveckling/regionalaindelningar/faregioner.1799.html")
SCB_REGIONS = "https://statistikdatabasen.scb.se/api/v2/tables/TAB6574/metadata?lang=sv"


def wfs(layer: str, *, properties: list[str] | None = None) -> dict:
    params = {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": f"stat:{layer}", "outputFormat": "application/json",
        "srsName": "EPSG:4326",
    }
    if properties:
        params["propertyName"] = ",".join(properties)
    res = requests.get(WFS, params=params, timeout=600)
    res.raise_for_status()
    return res.json()


def slug_id(name: str) -> str:
    """FA25 region name -> region id, e.g. 'Stockholm-Solna' -> 'se_stockholm_solna'."""
    s = unicodedata.normalize("NFD", name.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return "se_" + re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def fetch_fa25(kommuner: dict[str, str]) -> list[dict]:
    page = requests.get(FA25_PAGE, timeout=60, headers={"User-Agent": "naapurustot-data"}).text
    m = re.search(r'href="(/download/[^"]*FA25[^"]*\.xlsx)"', page)
    if not m:
        raise SystemExit("FA25 xlsx link not found on the Tillväxtverket FA-regioner page")
    url = "https://tillvaxtverket.se" + m.group(1)
    xlsx = requests.get(url, timeout=60, headers={"User-Agent": "naapurustot-data"}).content
    rows = list(openpyxl.load_workbook(io.BytesIO(xlsx), read_only=True).worksheets[0].iter_rows(values_only=True))
    header, body = rows[0], rows[1:]
    if tuple(header[:4]) != ("FA25Nr", "FA25Namn", "KommunNamn", "KommunKod"):
        raise SystemExit(f"FA25 xlsx header changed: {header}")

    regions: dict[str, dict] = {}
    seen: dict[str, str] = {}
    for nr, name, _kname, kod in body:
        if not kod:
            continue
        kod = str(kod).zfill(4)
        if kod in seen:
            raise SystemExit(f"municipality {kod} assigned to FA {seen[kod]} and {nr}")
        seen[kod] = str(nr)
        r = regions.setdefault(str(nr).zfill(2), {"fa25": str(nr).zfill(2), "name": name, "id": slug_id(name), "kommuner": []})
        r["kommuner"].append(kod)

    missing = sorted(set(kommuner) - set(seen))
    extra = sorted(set(seen) - set(kommuner))
    if missing or extra:
        raise SystemExit(f"FA25 vs SCB municipalities: unassigned {missing}, unknown {extra}")
    out = sorted(regions.values(), key=lambda r: r["fa25"])
    for r in out:
        r["kommuner"].sort()
    return out


def fetch_kommuner() -> dict[str, str]:
    meta = requests.get(SCB_REGIONS, timeout=60).json()
    cat = meta["dimension"]["Region"]["category"]
    # Labels read "0114 Upplands Väsby": the code is a prefix, not part of the name.
    return {c: re.sub(r"^\d{4}\s+", "", cat["label"][c]) for c in cat["index"] if re.fullmatch(r"\d{4}", c)}


def main() -> None:
    CACHE.mkdir(exist_ok=True)

    kommuner = fetch_kommuner()
    if len(kommuner) != 290:
        raise SystemExit(f"expected 290 municipalities from SCB, got {len(kommuner)}")
    (HERE / "kommuner.json").write_text(json.dumps(kommuner, ensure_ascii=False, indent=1, sort_keys=True) + "\n")

    fa25 = fetch_fa25(kommuner)
    (HERE / "fa25.json").write_text(json.dumps(fa25, ensure_ascii=False, indent=1) + "\n")
    print(f"FA25: {len(fa25)} regions", file=sys.stderr)

    regso = wfs("RegSO_2025", properties=["regsokod", "regsonamn", "kommunkod"])
    names = {f["properties"]["regsokod"]: {"name": f["properties"]["regsonamn"], "kommun": f["properties"]["kommunkod"]}
             for f in regso["features"]}
    if len(names) != 3363:
        raise SystemExit(f"expected 3,363 RegSO 2025 areas, got {len(names)}")
    (HERE / "regso_2025.json").write_text(json.dumps(names, ensure_ascii=False, indent=1, sort_keys=True) + "\n")

    deso = wfs("DeSO_2025")
    if len(deso["features"]) != 6160:
        raise SystemExit(f"expected 6,160 DeSO 2025 areas, got {len(deso['features'])}")
    index = {}
    for f in deso["features"]:
        p = f["properties"]
        if p["regsokod"] not in names:
            raise SystemExit(f"DeSO {p['desokod']} points at unknown RegSO {p['regsokod']}")
        index[p["desokod"]] = {"regso": p["regsokod"], "kommun": p["kommunkod"]}
        f["properties"] = {"deso": p["desokod"]}
    (HERE / "deso_index.json").write_text(json.dumps(index, indent=1, sort_keys=True) + "\n")
    deso.pop("crs", None)
    (CACHE / "deso_2025_raw.geojson").write_text(json.dumps(deso))
    print(f"DeSO: {len(index)} areas, RegSO: {len(names)}", file=sys.stderr)


if __name__ == "__main__":
    main()
