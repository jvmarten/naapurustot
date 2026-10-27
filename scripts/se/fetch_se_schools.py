#!/usr/bin/env python3
"""Count Swedish schools per DeSO area from Skolverket's register -> scripts/se/schools_deso.json.

Source: Skolenhetsregistret (Skolverket), api.skolverket.se/skolenhetsregistret/v2, open,
no key. A school unit counts when it is AKTIV and offers any of the school types that
match Finland's school layer (Opintopolku's comprehensive and upper-secondary schools):

  GR / GRAN   grundskola / anpassad grundskola       (comprehensive)
  GY / GYAN   gymnasieskola / anpassad gymnasieskola (upper secondary)
  SAM, SP     sameskola, specialskola                (comprehensive, own forms)

Each unit is placed by its visiting address's coordinates (BESOKSADRESS) and counted
once whatever mix of types it has. A unit with no coordinates cannot be placed and is
left out; the script reports how many. Preschools (förskola) are not in this register,
so Sweden has no daycare figure from here.

Usage: python scripts/se/fetch_se_schools.py
"""

from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from shapely import STRtree, points
from shapely.geometry import shape

HERE = Path(__file__).resolve().parent
RAW = HERE / "cache" / "deso_2025_raw.geojson"
OUT = HERE / "schools_deso.json"
API = "https://api.skolverket.se/skolenhetsregistret/v2/school-units"
SCHOOL_TYPES = ["GR", "GRAN", "GY", "GYAN", "SAM", "SP"]
HEADERS = {"User-Agent": "naapurustot.fi data pipeline (+https://naapurustot.fi)"}


def get(url: str, params: dict | None = None) -> dict:
    for attempt in range(5):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=60)
            if r.status_code == 200:
                return r.json()
            if r.status_code < 500 and r.status_code != 429:
                r.raise_for_status()
        except requests.RequestException:
            if attempt == 4:
                raise
        time.sleep(2 ** attempt)
    raise RuntimeError(f"{url}: no answer after 5 attempts")


def unit_codes() -> tuple[list[str], str]:
    codes: set[str] = set()
    extract = None
    for st in SCHOOL_TYPES:
        d = get(API, {"status": "AKTIV", "school_type": st})
        units = d["data"]["attributes"]
        if not units:
            raise SystemExit(f"school type {st}: empty list — refusing to write partial counts")
        codes.update(u["schoolUnitCode"] for u in units)
        extract = extract or d["meta"]["extractDate"]
        print(f"{st}: {len(units)} active units", file=sys.stderr)
    return sorted(codes), extract


def coordinates(code: str) -> tuple[float, float] | None:
    a = get(f"{API}/{code}")["data"]["attributes"]
    for addr in a.get("addresses") or []:
        g = addr.get("geoCoordinates") or {}
        if addr.get("type") == "BESOKSADRESS" and g.get("latitude") and g.get("longitude"):
            return float(g["longitude"]), float(g["latitude"])
    return None


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"{RAW} missing — run scripts/se/fetch_se_boundaries.py first")
    codes, extract = unit_codes()
    print(f"{len(codes)} distinct units; fetching addresses...", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=8) as pool:
        coords = list(pool.map(coordinates, codes))
    placed_xy = [c for c in coords if c]
    unplaced = len(codes) - len(placed_xy)

    fc = json.loads(RAW.read_text())
    desos = [f["properties"]["deso"] for f in fc["features"]]
    tree = STRtree([shape(f["geometry"]) for f in fc["features"]])
    pi, gi = tree.query(points(placed_xy), predicate="within")
    first: dict[int, int] = {}
    for p, g in zip(pi.tolist(), gi.tolist()):
        first.setdefault(p, g)
    counts: dict[str, int] = defaultdict(int)
    for g in first.values():
        counts[desos[g]] += 1
    outside = len(placed_xy) - len(first)
    print(f"{len(first)} placed in a DeSO, {outside} outside every DeSO, {unplaced} without coordinates",
          file=sys.stderr)

    OUT.write_text(json.dumps({
        "source": "Skolverket, Skolenhetsregistret",
        "extract_date": extract[:10],
        "school_types": SCHOOL_TYPES,
        "units": len(codes),
        "without_coordinates": unplaced,
        "outside_deso": outside,
        "counts": dict(sorted(counts.items())),
    }, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"wrote {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
