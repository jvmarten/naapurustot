#!/usr/bin/env python3
"""DeSO -> city district for Stockholm, Göteborg and Malmö -> scripts/se/deso_district.json.

Brå publishes reported crime for these three cities' districts as well as for the whole
municipality (fetch_se_crime.py). To use that finer figure each DeSO in the three cities
needs its district, so this downloads the cities' own district boundaries and assigns each
DeSO to the district holding the largest share of its area. Names are written as Brå's
database labels them, which is the key fetch_se_crime.py uses.

Sources (the boundaries are used only for this lookup; no geometry ships in the app):
  Stockholm  Stadsbyggnadskontoret, "Stadskartans Stadsdelsnämnder 2023 (11 st)", the 11
             stadsdelsområden in force from 2024 (Järva, Norra innerstaden), on
             dataportalen.stockholm.se. EPSG:3011. The record states no licence.
  Göteborg   Statistik och analys, "Stadsområde" (four, from 2021, boundaries as of
             2025-01-01), goteborg.se, CC0 1.0. EPSG:3007.
  Malmö      "Stadsområden" (five, 2013-2017), opendata.malmo.se, CC0. Malmö replaced them
             as an administrative division in 2017, but Brå still reports by them, so they
             are the right boundaries for its figures. WGS84.

The script fails unless every DeSO of the three municipalities gets a district, and
reports how many straddle a boundary (largest share under 90 %).

Usage: python scripts/se/fetch_se_districts.py
"""

from __future__ import annotations

import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import requests
import shapefile
import shapely
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import unary_union

HERE = Path(__file__).resolve().parent
GEOJSON = HERE.parent.parent / "public" / "data" / "se_deso.geojson"
OUT = HERE / "deso_district.json"
HEADERS = {"User-Agent": "naapurustot.fi data pipeline (+https://naapurustot.fi)"}
STRADDLE = 0.9

SOURCES = {
    "0180": {
        "url": "https://dataportalen.stockholm.se/dataportalen/Data/Stadsbyggnadskontoret/"
               "Stadskartans_Stadsdelsnamnder_2023.zip",
        "epsg": 3011, "field": "Namn", "encoding": "utf-8",
        # The file names each nämnd in the genitive ("Kungsholmens").
        "names": {
            "Bromma": "Stadsdelsområde Bromma (Sthlm)",
            "Enskede-Årsta-Vantörs": "Stadsdelsområde Enskede - Årsta - Vantör (Sthlm)",
            "Farsta": "Stadsdelsområde Farsta (Sthlm)",
            "Hägersten-Älvsjö": "Stadsdelsområde Hägersten-Älvsjö (Sthlm)",
            "Hässelby-Vällingby": "Stadsdelsområde Hässelby - Vällingby (Sthlm)",
            "Järva": "Stadsdelsområde Järva (Sthlm)",
            "Kungsholmens": "Stadsdelsområde Kungsholmen (Sthlm)",
            "Norra innerstadens": "Stadsdelsområde Norra innerstaden (Sthlm)",
            "Skarpnäcks": "Stadsdelsområde Skarpnäck (Sthlm)",
            "Skärholmens": "Stadsdelsområde Skärholmen (Sthlm)",
            "Södermalms": "Stadsdelsområde Södermalm (Sthlm)",
        },
    },
    "1480": {
        "url": "https://goteborg.se/wps/wcm/connect/3f9a9bc0-d462-424a-b344-93d134b42a4f/"
               "Stadsomr%C3%A5de_shp.zip?MOD=AJPERES",
        "epsg": 3007, "field": "NAMN", "encoding": "latin1",
        "names": {
            "Centrum": "Stadsområde Centrum (Gbg)",
            "Hisingen": "Stadsområde Hisingen (Gbg)",
            "Nordost": "Stadsområde Nordost (Gbg)",
            "Sydväst": "Stadsområde Sydväst (Gbg)",
        },
    },
    "1280": {
        "url": "https://opendata-api.malmo.se/dataset/276d8ab5-18f6-4cf6-8d16-c947781388cc/"
               "resource/ff193dfb-fecb-49ba-bf93-efaef663e966/download/stadsomraden_4326.geojson",
        "epsg": 4326, "field": "sof_namn",
        "names": {
            "NORR": "Stadsområde Norr (Mö)",
            "ÖSTER": "Stadsområde Öster (Mö)",
            "SÖDER": "Stadsområde Söder (Mö)",
            "VÄSTER": "Stadsområde Väster (Mö)",
            "INNERSTADEN": "Stadsområde Innerstaden (Mö)",
        },
    },
}


def districts(src: dict) -> dict[str, object]:
    """Brå district name -> shapely geometry in WGS84 lon/lat."""
    res = requests.get(src["url"], headers=HEADERS, timeout=120)
    res.raise_for_status()
    tf = Transformer.from_crs(src["epsg"], 4326, always_xy=True)
    to_wgs = lambda c: np.column_stack(tf.transform(c[:, 0], c[:, 1]))  # noqa: E731
    out: dict[str, list] = {}
    if src["epsg"] == 4326:
        for f in res.json()["features"]:
            out.setdefault(src["names"][f["properties"][src["field"]]], []).append(shape(f["geometry"]))
    else:
        with tempfile.TemporaryDirectory() as tmp:
            zipfile.ZipFile(io.BytesIO(res.content)).extractall(tmp)
            shp = next(Path(tmp).glob("*.shp"))
            with shapefile.Reader(str(shp), encoding=src["encoding"]) as r:
                for sr in r.iterShapeRecords():
                    name = src["names"][sr.record[src["field"]]]
                    out.setdefault(name, []).append(shapely.transform(shape(sr.shape.__geo_interface__), to_wgs))
    if set(out) != set(src["names"].values()):
        raise SystemExit(f"{src['url']}: districts {sorted(out)} != {sorted(src['names'].values())}")
    # Both sources hold self-touching rings that GEOS refuses to intersect as they are.
    return {k: unary_union([shapely.make_valid(g) for g in v]) for k, v in out.items()}


def main() -> None:
    feats = json.loads(GEOJSON.read_text())["features"]
    assigned: dict[str, str] = {}
    for kommun, src in SOURCES.items():
        polys = districts(src)
        straddle = 0
        for f in feats:
            if f["properties"]["kunta"] != kommun:
                continue
            g = shapely.make_valid(shape(f["geometry"]))
            shares = {k: g.intersection(p).area / g.area for k, p in polys.items()}
            best = max(shares, key=shares.get)
            if shares[best] == 0:
                raise SystemExit(f"{f['properties']['pno']}: in no district of {kommun}")
            straddle += shares[best] < STRADDLE
            assigned[f["properties"]["pno"]] = best
        n = sum(1 for f in feats if f["properties"]["kunta"] == kommun)
        print(f"{kommun}: {n} DeSO areas in {len(polys)} districts, {straddle} straddle a boundary "
              f"(largest share < {STRADDLE:.0%})", file=sys.stderr)
    OUT.write_text(json.dumps(dict(sorted(assigned.items())), ensure_ascii=False, indent=0) + "\n")
    print(f"wrote {OUT}: {len(assigned)} DeSO areas", file=sys.stderr)


if __name__ == "__main__":
    main()
