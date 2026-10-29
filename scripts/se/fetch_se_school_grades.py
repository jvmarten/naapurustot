#!/usr/bin/env python3
"""Upper-secondary grade points per Swedish DeSO -> scripts/se/school_grades_deso.json.

Finland's school_quality (scripts/fetch_school_quality.py) is the mean matriculation result
of the lukios located in a postal area over the last three spring sessions, and null where
there is none. Sweden's counterpart is Skolverket's "genomsnittlig betygspoäng" for
students leaving gymnasieskolan with a diploma (0-20 scale), per school unit and programme,
from the planned-educations API v3 (open data, no key):

  /compact-school-units?typeOfSchooling=gy      every upper-secondary school unit, with
                                                SWEREF 99 TM coordinates
  /school-units/{code}/statistics/gy            programMetrics[].gradesPointsForStudents,
                                                one value per school year

A programme's figure is the mean of its three latest published years (Finland's three
spring sessions); a school's is the plain mean of its programmes, because Skolverket gives
programme sizes only as "cirka 40". Each DeSO takes the mean of the schools inside its
(full-resolution) polygon; a DeSO with no upper-secondary school is left empty, as
Finland's postal areas without a lukio are.

Usage: python scripts/se/fetch_se_school_grades.py
"""

from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
import shapely
import shapely.ops
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import Point, shape

HERE = Path(__file__).resolve().parent
RAW_DESO = HERE / "cache" / "deso_2025_raw.geojson"
OUT = HERE / "school_grades_deso.json"
API = "https://api.skolverket.se/planned-educations/v3"
HEADERS = {"Accept": "application/vnd.skolverket.plannededucations.api.v3.hal+json"}
YEARS = 3

to_3006 = Transformer.from_crs("EPSG:4326", "EPSG:3006", always_xy=True).transform


def get(url: str, **params) -> dict:
    for attempt in range(5):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=60)
            if r.status_code == 404:
                return {}
            r.raise_for_status()
            return r.json()["body"]
        except (requests.RequestException, ValueError, KeyError):
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    return {}


def schools() -> list[dict]:
    out, page = [], 0
    while True:
        body = get(f"{API}/compact-school-units", typeOfSchooling="gy", size=100, page=page)
        out += body["_embedded"]["compactSchoolUnits"]
        if page + 1 >= body["page"]["totalPages"]:
            return out
        page += 1


def num(v: str | None) -> float | None:
    try:
        return float(v.replace(",", ".")) if v else None
    except ValueError:
        return None


def school_score(code: str) -> float | None:
    body = get(f"{API}/school-units/{code}/statistics/gy")
    programmes = []
    for p in body.get("programMetrics") or []:
        vals = [num(x["value"]) for x in p.get("gradesPointsForStudents") or [] if x.get("valueType") == "EXISTS"]
        vals = [v for v in vals if v is not None][:YEARS]
        if vals:
            programmes.append(sum(vals) / len(vals))
    return sum(programmes) / len(programmes) if programmes else None


def main() -> None:
    units = [u for u in schools() if not u.get("abroadSchool") and u.get("sweref99Latitude")]
    print(f"{len(units)} upper-secondary school units", file=sys.stderr)
    with ThreadPoolExecutor(6) as ex:
        scores = dict(zip((u["schoolUnitCode"] for u in units), ex.map(school_score, (u["schoolUnitCode"] for u in units))))
    fc = json.loads(RAW_DESO.read_text())
    codes = [f["properties"]["deso"] for f in fc["features"]]
    geoms = [shapely.make_valid(shapely.ops.transform(to_3006, shape(f["geometry"]))) for f in fc["features"]]
    tree = STRtree(geoms)
    per_deso: dict[str, list[float]] = {}
    placed = 0
    for u in units:
        s = scores.get(u["schoolUnitCode"])
        if s is None:
            continue
        pt = Point(float(u["sweref99Longitude"]), float(u["sweref99Latitude"]))
        hit = tree.query(pt, predicate="intersects")
        if len(hit):
            per_deso.setdefault(codes[hit[0]], []).append(s)
            placed += 1
    print(f"{sum(s is not None for s in scores.values())} schools with grade points, {placed} placed in a DeSO",
          file=sys.stderr)
    values = {c: round(sum(v) / len(v), 1) for c, v in sorted(per_deso.items())}
    OUT.write_text(json.dumps({"source": "Skolverket, planned-educations API v3 (gradesPointsForStudents)",
                               "values": values}, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}: {len(values)} DeSOs", file=sys.stderr)


if __name__ == "__main__":
    main()
