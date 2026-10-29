#!/usr/bin/env python3
"""Five more Swedish figures -> scripts/se/extra_layers.json.

  new_buildings  SCB TAB6540 (Bostadsbebyggelsens ålder), per DeSO, 2025: residential
                 buildings built 2021-2030 as a share of those with a known construction
                 decade. Finland's new_construction counts buildings under construction;
                 this counts ones recently finished, so it is its own layer. SCB's ".."
                 in this table is a zero, which the DeSO sums prove (new_buildings). CC0.
  jobs           SCB TAB1828, per kommun, 2024: jobs located in the kommun (employed people
                 working there, wherever they live) per 100 employed residents (wherever
                 they work) — Finland's job self-sufficiency ratio. CC0.
  avg_age        SCB TAB637, per kommun, 2025: mean age of the population. CC0.
  sickness_days  Kolada N00957 (Försäkringskassan's ohälsotal), per kommun: days of
                 sickness, rehabilitation, activity and disability benefit per resident
                 aged 16-64, latest published year.
  pensioners     Kolada N02287, per kommun: pensioners as a share of residents aged 65-74.
  planned_homes  Kolada N07923 (SKR's survey of the kommuner), per kommun: new homes that
                 current legally binding detailed plans allow, per 1,000 residents, at
                 31 December. Biennial; a kommun that did not answer is left empty.

Kolada (RKA, the Council for the Promotion of Municipal Analysis) republishes these from
Försäkringskassan, SCB and SKR, free to use. Its "status: Missing" cells are left empty.

Usage: python scripts/se/fetch_se_extra.py
"""

from __future__ import annotations

import itertools
import json
import sys
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
OUT = HERE / "extra_layers.json"
SCB = "https://statistikdatabasen.scb.se/api/v2/tables/{}/data?lang=sv&outputFormat=json-stat2"
KOLADA = "https://api.kolada.se/v3/data/kpi/{}/year/{}"
SUFFIX = "_DeSO2025"
KOLADA_KPIS = {"sickness_days": "N00957", "pensioners": "N02287", "planned_homes": "N07923"}


def scb(table: str, selection: dict[str, list[str]]) -> dict[tuple, float | None]:
    body = {"selection": [{"variableCode": k, "valueCodes": v} for k, v in selection.items()]}
    r = requests.post(SCB.format(table), json=body, timeout=300)
    r.raise_for_status()
    d = r.json()
    cats = [list(d["dimension"][k]["category"]["index"]) for k in d["id"]]
    return dict(zip(itertools.product(*cats), d["value"]))


def new_buildings(deso: list[str], kommuner: dict) -> dict:
    """SCB prints ".." for a DeSO with no building of the decade: read as 0, each kommun's
    DeSOs add up to the kommun's own published 2021-2030 count (281 of 290 exactly, the
    rest within SCB's +-2 cell noise). The script re-checks that before writing."""
    codes = [c + SUFFIX for c in deso]
    out, sums = {}, {}
    for i in range(0, len(codes), 1500):
        v = scb("TAB6540", {"Region": codes[i:i + 1500], "ByggAr": ["2021-2030", "Okänt", "Totalt"],
                            "ContentsCode": ["0000080B"], "Tid": ["2025"]})
        for code in codes[i:i + 1500]:
            new, unknown, total = (v.get((code, b, "0000080B", "2025")) for b in ("2021-2030", "Okänt", "Totalt"))
            new = new or 0
            sums[code[:4]] = sums.get(code[:4], 0) + new
            known = None if total is None else total - (unknown or 0)
            out[code[:-len(SUFFIX)]] = None if not known or known <= 0 else round(100 * new / known, 1)
    k = scb("TAB6540", {"Region": list(kommuner), "ByggAr": ["2021-2030"], "ContentsCode": ["0000080B"],
                        "Tid": ["2025"]})
    off = [c for c in kommuner if abs((k[(c, "2021-2030", "0000080B", "2025")] or 0) - sums.get(c, 0)) > 3]
    if len(off) > 5:
        raise SystemExit(f"new buildings: {len(off)} kommuner do not add up with '..' read as 0: {off[:10]}")
    return out


def jobs(kommuner: dict) -> dict:
    v = scb("TAB1828", {"Kommun": list(kommuner), "Kon": ["1+2"],
                        "ContentsCode": ["000000QI", "000000QJ", "000000QK"], "Tid": ["2024"]})
    out = {}
    for k in kommuner:
        in_, out_, local = (v[(k, "1+2", c, "2024")] for c in ("000000QI", "000000QJ", "000000QK"))
        out[k] = round(100 * (in_ + local) / (out_ + local), 1)
    return out


def avg_age(kommuner: dict) -> dict:
    v = scb("TAB637", {"Region": list(kommuner), "Kon": ["1+2"], "ContentsCode": ["BE0101G9"], "Tid": ["2025"]})
    return {key[0]: x for key, x in v.items()}


def kolada(kpi: str, kommuner: dict) -> tuple[int, dict]:
    """The latest year Kolada holds values for, and each kommun's total (gender T)."""
    for year in range(2026, 2019, -1):
        rows = requests.get(KOLADA.format(kpi, year), timeout=120).json()["values"]
        vals = {}
        for row in rows:
            if row["municipality"] not in kommuner:
                continue
            t = next((x for x in row["values"] if x["gender"] == "T"), None)
            vals[row["municipality"]] = None if t is None or t["status"] or t["value"] is None else t["value"]
        if sum(v is not None for v in vals.values()) > 150:
            return year, {k: vals.get(k) for k in kommuner}
    raise SystemExit(f"Kolada {kpi}: no year with values for most kommuner")


def main() -> None:
    kommuner = json.loads((HERE / "kommuner.json").read_text())
    deso = sorted(json.loads((HERE / "deso_index.json").read_text()))
    out = {
        "new_buildings": {"year": 2025, "deso": new_buildings(deso, kommuner)},
        "jobs": {"year": 2024, "kommuner": jobs(kommuner)},
        "avg_age": {"year": 2025, "kommuner": avg_age(kommuner)},
    }
    for key, kpi in KOLADA_KPIS.items():
        year, vals = kolada(kpi, kommuner)
        out[key] = {"year": year, "kpi": kpi,
                    "kommuner": {k: None if v is None else round(v, 1) for k, v in vals.items()}}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    for key, rec in out.items():
        vals = rec.get("deso") or rec["kommuner"]
        print(f"{key} ({rec['year']}): {sum(v is not None for v in vals.values())} of {len(vals)}", file=sys.stderr)


if __name__ == "__main__":
    main()
