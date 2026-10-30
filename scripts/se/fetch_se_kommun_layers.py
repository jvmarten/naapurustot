#!/usr/bin/env python3
"""Municipal figures for seven Swedish layers -> scripts/se/kommun_layers.json.

None of these is published below the municipality (rent also per city district in
Stockholm and Malmö), so each DeSO carries its kommun's (or district's) figure and the
registry flags them is_proxy, as Finland's municipal figures are.

  rent         SCB TAB4590 (kommun) and TAB4549 (stadsdelsområden), "Hyra i
               hyreslägenheter": mean annual rent per m² in rental flats, divided by 12
               into a monthly figure, as Finland's €/m²/month. Districts: Stockholm's 11
               current stadsdelsområden and Malmö's five stadsområden, matched to the
               districts fetch_se_districts.py assigns DeSOs to. SCB's Göteborg districts
               are the ten pre-2021 SDNs, which no current boundary matches, so Göteborg
               takes its kommun figure. CC0.
  house_price  SCB TAB1169, "Försålda småhus": mean purchase price of permanent
               detached houses sold (köpeskilling, tkr) per kommun. CC0.
  house_price_change
               The same mean's change from HOUSE_CHANGE_FROM to HOUSE_YEAR, Finland's
               property-price window (2020–). SCB publishes every kommun however few
               houses sold; the fewest is Dorotea (11 in 2020, 8 in 2025), so the counts
               are written alongside.
  broadband    PTS bredbandskartläggning 2025 (bredbandskartan's GeoServer,
               w_i_read:bbk_kommun_2025_1000_tat): share of households and workplaces
               with access to at least 100 Mbit/s, "Totalt" column of the 2020 goal
               table — Finland's figure is buildings with >= 100 Mbit/s access.
  accidents    Trafikanalys, Vägtrafikskador (api.trafa.se product t1004): police-reported
               road accidents with a fatality or a severe or slight injury, by the kommun
               where they happened, mean of 2022-2024 per 1,000 residents (SCB 2025, the
               sum of the kommun's DeSOs). Trafikanalys prints "–" for nothing to report;
               every year's kommuner add up to its national total with "–" read as 0,
               which the script checks.
  construction SCB TAB2538, completed dwellings in newly constructed buildings (both
               building types) in CONSTRUCTION_YEARS per 1,000 residents (SCB 2025, as for
               accidents) — Finland's construction_activity is the dwellings completed
               2020 onward per 1,000 residents of the municipality. Every year's kommuner
               add up to SCB's national total, which the script checks.
  projection   SCB TAB6300, Befolkningsframskrivning 2022: projected population from
               PROJECTION_BASE to PROJECTION_TARGET per kommun, as Finland's
               population_projection_pct (Tilastokeskus 2024, base year to 2040). 2022 is
               SCB's latest regional projection: its 2023-2025 editions are national only.

Usage: python scripts/se/fetch_se_kommun_layers.py
"""

from __future__ import annotations

import itertools
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / "kommun_layers.json"
SCB = "https://statistikdatabasen.scb.se/api/v2/tables/{}/data?lang=sv&outputFormat=json-stat2"
PTS_WFS = "https://hajk-bredbandskartan.pts.se/geoserver/w_i_read/wfs"
TRAFA = "https://api.trafa.se/api/data"
RENT_YEAR = "2026"
HOUSE_YEAR = "2025"
HOUSE_CHANGE_FROM = "2020"
ACCIDENT_YEARS = ["2022", "2023", "2024"]
CONSTRUCTION_YEARS = [str(y) for y in range(2020, 2026)]
PROJECTION_BASE, PROJECTION_TARGET = "2022", "2040"

# SCB TAB4549 district code -> the district name in deso_district.json.
RENT_DISTRICTS = {
    "O08KUN": "Stadsdelsområde Kungsholmen (Sthlm)",
    "P09NIS": "Stadsdelsområde Norra innerstaden (Sthlm)",
    "O12SÖM": "Stadsdelsområde Södermalm (Sthlm)",
    "O14EÅV": "Stadsdelsområde Enskede - Årsta - Vantör (Sthlm)",
    "O18FAR": "Stadsdelsområde Farsta (Sthlm)",
    "P22HÄL": "Stadsdelsområde Hägersten-Älvsjö (Sthlm)",
    "O15SKA": "Stadsdelsområde Skarpnäck (Sthlm)",
    "O24SKH": "Stadsdelsområde Skärholmen (Sthlm)",
    "O07BRO": "Stadsdelsområde Bromma (Sthlm)",
    "O05HVÄ": "Stadsdelsområde Hässelby - Vällingby (Sthlm)",
    "P01JÄR": "Stadsdelsområde Järva (Sthlm)",
    "SOF002": "Stadsområde Innerstaden (Mö)",
    "SOF001": "Stadsområde Norr (Mö)",
    "SOF004": "Stadsområde Söder (Mö)",
    "SOF003": "Stadsområde Väster (Mö)",
    "SOF005": "Stadsområde Öster (Mö)",
}


def scb(table: str, selection: dict[str, list[str]]) -> dict[tuple, float | None]:
    body = {"selection": [{"variableCode": k, "valueCodes": v} for k, v in selection.items()]}
    r = requests.post(SCB.format(table), json=body, timeout=120)
    r.raise_for_status()
    d = r.json()
    cats = [list(d["dimension"][k]["category"]["index"]) for k in d["id"]]
    return dict(zip(itertools.product(*cats), d["value"]))


def rent(kommuner: dict) -> dict:
    k = scb("TAB4590", {"Region": list(kommuner), "Hyresuppg": ["Ah_kvm"], "ContentsCode": ["000000RZ"],
                        "Tid": [RENT_YEAR]})
    d = scb("TAB4549", {"Stadsdel": list(RENT_DISTRICTS), "Hyresuppg": ["Ah_kvm"], "ContentsCode": ["000000XZ"],
                        "Tid": [RENT_YEAR]})
    month = lambda v: None if v is None else round(v / 12, 1)  # noqa: E731
    out = {"kommuner": {key[0]: month(v) for key, v in k.items()},
           "districts": {RENT_DISTRICTS[key[0]]: month(v) for key, v in d.items()}}
    if sum(v is None for v in out["districts"].values()):
        raise SystemExit(f"rent: a mapped district has no {RENT_YEAR} value: {out['districts']}")
    return out


def house_price(kommuner: dict) -> dict:
    v = scb("TAB1169", {"Region": list(kommuner), "Fastighetstyp": ["220"], "ContentsCode": ["BO0501C2"],
                        "Tid": [HOUSE_YEAR]})
    return {key[0]: None if x is None else round(x * 1000) for key, x in v.items()}


def house_price_change(kommuner: dict) -> dict:
    v = scb("TAB1169", {"Region": list(kommuner), "Fastighetstyp": ["220"],
                        "ContentsCode": ["BO0501C1", "BO0501C2"], "Tid": [HOUSE_CHANGE_FROM, HOUSE_YEAR]})
    out, sold = {}, {}
    for k in kommuner:
        before, after = v[(k, "220", "BO0501C2", HOUSE_CHANGE_FROM)], v[(k, "220", "BO0501C2", HOUSE_YEAR)]
        out[k] = None if not before or after is None else round((after - before) / before * 100, 1)
        sold[k] = [v[(k, "220", "BO0501C1", y)] for y in (HOUSE_CHANGE_FROM, HOUSE_YEAR)]
    return {"kommuner": out, "sold": sold}


def norm(name: str) -> str:
    return re.sub(r"[^a-zåäö]", "", name.lower())


def broadband(kommuner: dict) -> dict:
    for attempt in range(4):
        r = requests.get(PTS_WFS, params={"service": "WFS", "version": "2.0.0", "request": "GetFeature",
                                          "typeNames": "w_i_read:bbk_kommun_2025_1000_tat",
                                          "propertyName": "visning_1,info",
                                          "outputFormat": "application/json"}, timeout=300)
        if r.ok and r.text.startswith("{"):
            break
        time.sleep(2 ** attempt * 2)
    else:
        raise SystemExit(f"broadband: PTS WFS answered {r.status_code}: {r.text[:200]!r}")
    by_name = {norm(n): c for c, n in kommuner.items()}
    out = {}
    for f in r.json()["features"]:
        p = f["properties"]
        name = p["visning_1"].split("|")[0].strip()
        code = by_name.get(norm(name))
        if not code:
            raise SystemExit(f"broadband: PTS kommun {name!r} matches no SCB name")
        parts = (p["info"] or "").split("BREDBANDSMÅL 2020")
        if len(parts) < 2:
            # PTS prints no tables for a kommun whose split would reveal a handful of
            # addresses (Sundbyberg: one household outside tätort). Left out, not imputed.
            out[code] = None
            continue
        m = re.search(r"\|100 Mbit/s\|(>\s*)?([\d,]+)%", parts[1])
        if not m:
            raise SystemExit(f"broadband: no 100 Mbit/s total for {name}")
        out[code] = 99.99 if m.group(1) else float(m.group(2).replace(",", "."))
    if set(out) != set(kommuner):
        raise SystemExit(f"broadband: {len(out)} kommuner, missing {sorted(set(kommuner) - set(out))}")
    withheld = sorted(k for k, v in out.items() if v is None)
    if len(withheld) > 5:
        raise SystemExit(f"broadband: {len(withheld)} kommuner without a table, the layout changed?")
    return out


def accidents(kommuner: dict, population: dict[str, int]) -> dict:
    lans = sorted({k[:2] for k in kommuner})
    per = defaultdict(dict)
    for year in ACCIDENT_YEARS:
        q = f"t1004|ar:{year}|lan:{','.join(lans)}|kommun|antolyckdsl"
        rows = requests.get(TRAFA, params={"query": q, "lang": "sv"}, timeout=120).json()["Rows"]
        for row in rows:
            if row.get("IsTotal"):
                continue
            c = {x["Column"]: (x["Name"], x["Value"]) for x in row["Cell"]}
            v = c["antolyckdsl"][1]
            per[c["kommun"][0]][year] = 0 if v == "–" else int(v)
        q = f"t1004|ar:{year}|antolyckdsl"
        total = int(requests.get(TRAFA, params={"query": q, "lang": "sv"}, timeout=120).json()["Rows"][0]["Cell"][-1]["Value"])
        got = sum(per[k].get(year, 0) for k in per)
        if got != total:
            raise SystemExit(f"accidents {year}: kommuner sum to {got}, national total {total}")
    if set(per) != set(kommuner) or any(len(v) != len(ACCIDENT_YEARS) for v in per.values()):
        raise SystemExit("accidents: not every kommun has every year")
    return {k: round(sum(v.values()) / len(ACCIDENT_YEARS) / population[k] * 1000, 2) for k, v in per.items()}


def construction(kommuner: dict, population: dict[str, int]) -> dict:
    types = ["FLERBO", "SMÅHUS"]
    v = scb("TAB2538", {"Region": ["00", *kommuner], "Hustyp": types, "ContentsCode": ["BO0101A5"],
                        "Tid": CONSTRUCTION_YEARS})
    if any(x is None for x in v.values()):
        raise SystemExit("construction: SCB left a cell empty")
    for y in CONSTRUCTION_YEARS:
        nat = sum(v[("00", h, "BO0101A5", y)] for h in types)
        got = sum(v[(k, h, "BO0101A5", y)] for k in kommuner for h in types)
        if got != nat:
            raise SystemExit(f"construction {y}: kommuner sum to {got}, national total {nat}")
    built = {k: sum(v[(k, h, "BO0101A5", y)] for h in types for y in CONSTRUCTION_YEARS) for k in kommuner}
    return {k: round(n / population[k] * 1000, 1) for k, n in built.items()}


def projection(kommuner: dict) -> dict:
    v = scb("TAB6300", {"Region": list(kommuner), "ContentsCode": ["000006N0"],
                        "Tid": [PROJECTION_BASE, PROJECTION_TARGET]})
    out = {}
    for k in kommuner:
        base, target = v[(k, "000006N0", PROJECTION_BASE)], v[(k, "000006N0", PROJECTION_TARGET)]
        if not base or target is None:
            raise SystemExit(f"projection: {k} has no {PROJECTION_BASE}/{PROJECTION_TARGET} population")
        out[k] = round((target - base) / base * 100, 1)
    return out


def main() -> None:
    kommuner = json.loads((HERE / "kommuner.json").read_text())
    fc = json.loads((ROOT / "public" / "data" / "se_deso.geojson").read_text())
    population = defaultdict(int)
    for f in fc["features"]:
        population[f["properties"]["pno"][:4]] += f["properties"]["he_vakiy"] or 0
    out = {
        "rent": {"year": int(RENT_YEAR), **rent(kommuner)},
        "house_price": {"year": int(HOUSE_YEAR), "kommuner": house_price(kommuner)},
        "house_price_change": {"years": f"{HOUSE_CHANGE_FROM}–{HOUSE_YEAR}", **house_price_change(kommuner)},
        "broadband": {"year": 2025, "kommuner": broadband(kommuner)},
        "accidents": {"years": "2022–2024", "kommuner": accidents(kommuner, population)},
        "construction": {"years": f"{CONSTRUCTION_YEARS[0]}–{CONSTRUCTION_YEARS[-1]}",
                         "kommuner": construction(kommuner, population)},
        "projection": {"years": f"{PROJECTION_BASE}–{PROJECTION_TARGET}", "kommuner": projection(kommuner)},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    for key in ("house_price", "house_price_change", "broadband", "accidents", "construction", "projection"):
        vals = out[key]["kommuner"]
        print(f"{key}: {sum(v is not None for v in vals.values())} of {len(vals)} kommuner", file=sys.stderr)
    print(f"rent: {sum(v is not None for v in out['rent']['kommuner'].values())} kommuner, "
          f"{len(out['rent']['districts'])} districts", file=sys.stderr)


if __name__ == "__main__":
    main()
