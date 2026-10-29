#!/usr/bin/env python3
"""The 2026 Riksdag election per Swedish DeSO area -> scripts/se/election_deso.json.

Sources (Valmyndigheten, free to use with Valmyndigheten named as the source):
  Final count per election district (valdistrikt), riksdagsvalet 2026:
    roster-per-distrikt-slutligt-antal-roster-inklusive-totalt-valdeltagande-riksdagsvalet-2026.xlsx
  Election district boundaries 2026 (valdistrikt-riket-2026.zip, EPSG:3006).
  Both from https://www.val.se/valresultat-och-statistik/statistik-och-data/radata-val-2026

Sweden publishes results for ~6,300 districts, finer than Finland's municipal figures.
Districts and DeSOs are drawn independently, so each district's counts are apportioned
to the DeSOs it overlaps, in proportion to where its residents live:

  * Every district x DeSO piece is weighted by SCB's 1 km population grid
    (stat:befolkning_1km_2025, the grid fetch_se_water_proximity.py caches): each
    populated cell gives its residents to the pieces it overlaps, by area.
  * A district whose pieces hold no populated cell falls back to area.

Party votes, valid votes, votes cast and the electorate are apportioned that way, and
every metric is computed from the apportioned counts, with the formulas Finland uses
(scripts/fetch_election_results.py):

  party shares       % of valid votes, the eight Riksdag parties
  political lean     vote-weighted left-right position, CHES 2019 lrgen (the survey
                     Finland's index uses), x10 -> 0 (left) ... 100 (right)
  party diversity    normalised Shannon entropy of a district's party shares; a DeSO
                     takes the valid-vote-weighted mean of its districts' values, because
                     the index depends on how many parties a unit holds and apportioning
                     would add every neighbour's one-vote parties to that count

Turnout needs one more step. Early votes that reach a municipality too late for the
polling stations are counted on the Wednesday in an "uppsamlingsdistrikt", a collection
district with votes and no area or electorate: median 5.5 % of a municipality's votes,
1.4 % to 23 %, and highest in sparsely populated municipalities. Valmyndigheten's district
turnout leaves them out, which would draw Dorotea 23 points below Ovanåker for reasons of
post. The collection votes are therefore spread over the municipality's districts in
proportion to the votes counted there, so each municipality's DeSOs add up to its
published turnout. Party shares use only the votes counted in the districts, which are
the ones with a place.

Usage: python scripts/se/fetch_se_election.py
"""

from __future__ import annotations

import io
import json
import math
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import openpyxl
import requests
import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import box, shape
from shapely.ops import transform  # noqa: F401 (pyproj callable)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fetch_se_water_proximity import population_grid  # noqa: E402

CACHE = HERE / "cache"
RAW_DESO = CACHE / "deso_2025_raw.geojson"
OUT = HERE / "election_deso.json"
BASE = "https://www.val.se/download"
RESULTS_URL = (f"{BASE}/18.7faaad3f1a0b0c300e458a/1790069872234/"
               "roster-per-distrikt-slutligt-antal-roster-inklusive-totalt-valdeltagande-riksdagsvalet-2026.xlsx")
DISTRICTS_URL = f"{BASE}/18.332cf48819bd61ac1513889/1785491689960/valdistrikt-riket-2026.zip"
CELL_M = 1000

# Valmyndigheten's column name -> abbreviation, the eight parties in the Riksdag.
PARTIES = {
    "Arbetarepartiet-Socialdemokraterna": "S",
    "Moderaterna": "M",
    "Sverigedemokraterna": "SD",
    "Vänsterpartiet": "V",
    "Centerpartiet": "C",
    "Kristdemokraterna": "KD",
    "Miljöpartiet de gröna": "MP",
    "Liberalerna (tidigare Folkpartiet)": "L",
}
# CHES 2019 (CHES2019V3.csv, country 16) general left-right placement, 0-10.
PARTY_LR = {"V": 1.71, "S": 3.88, "MP": 3.29, "C": 6.82, "L": 6.53, "M": 7.71, "KD": 7.82, "SD": 8.47}
META_COLS = 9  # Valtyp ... Länsnamn, before the first party column

to_3006 = Transformer.from_crs("EPSG:4326", "EPSG:3006", always_xy=True).transform


def cached(url: str, name: str) -> bytes:
    path = CACHE / name
    if not path.exists():
        r = requests.get(url, timeout=600)
        r.raise_for_status()
        CACHE.mkdir(exist_ok=True)
        path.write_bytes(r.content)
    return path.read_bytes()


def read_results() -> tuple[dict, dict, dict]:
    """({district: {party: votes}}, {district: (cast, electorate, kommun)}, {kommun: cast})."""
    wb = openpyxl.load_workbook(io.BytesIO(cached(RESULTS_URL, "riksdag_2026_distrikt.xlsx")), read_only=True)
    rows = wb["Antal_distrikt"].iter_rows(values_only=True)
    header = next(rows)
    parties = header[META_COLS:]
    missing = set(PARTIES) - set(parties)
    if missing:
        raise SystemExit(f"party columns not found: {missing}")
    votes = {}
    for r in rows:
        if r[1] is None:
            continue
        votes[r[1]] = {p: v for p, v in zip(parties, r[META_COLS:]) if v}
    turnout, kommun_cast = {}, defaultdict(int)
    rows = wb["Valdeltagande_distrikt"].iter_rows(values_only=True)
    header = next(rows)
    if header[9:11] != ("Röster", "Röstberättigade"):
        raise SystemExit(f"unexpected turnout columns: {header}")
    for r in rows:
        if r[1] is None:
            continue
        turnout[r[1]] = (r[9], r[10], r[3])
        kommun_cast[r[3]] += r[9]
    if set(votes) != set(turnout):
        raise SystemExit("district lists differ between the vote and turnout sheets")
    return votes, turnout, dict(kommun_cast)


def read_districts() -> dict[str, object]:
    with zipfile.ZipFile(io.BytesIO(cached(DISTRICTS_URL, "valdistrikt_2026.zip"))) as z:
        fc = json.loads(z.read("valdistrikt-riket-2026.geojson"))
    if "3006" not in fc["crs"]["properties"]["name"]:
        raise SystemExit(f"unexpected district CRS: {fc['crs']}")
    return {f["properties"]["Valdistriktskod"]: shapely.make_valid(shape(f["geometry"])) for f in fc["features"]}


def read_deso() -> dict[str, object]:
    if not RAW_DESO.exists():
        raise SystemExit(f"{RAW_DESO} missing: run scripts/se/fetch_se_boundaries.py first")
    fc = json.loads(RAW_DESO.read_text())
    return {f["properties"]["deso"]: shapely.make_valid(transform(to_3006, shape(f["geometry"])))
            for f in fc["features"]}


def pieces(districts: dict, deso: dict) -> list[tuple[str, str, object]]:
    """(district, deso, intersection) for every overlap with positive area."""
    codes = list(deso)
    tree = STRtree([deso[c] for c in codes])
    out = []
    for d, geom in districts.items():
        for i in tree.query(geom, predicate="intersects"):
            inter = geom.intersection(deso[codes[i]])
            if inter.area > 1.0:
                out.append((d, codes[i], inter))
    return out


def grid_weights(parts: list) -> np.ndarray:
    """Residents of SCB's 1 km grid falling in each piece, cells split by area."""
    cells = population_grid()
    half = CELL_M / 2
    boxes = [box(x - half, y - half, x + half, y + half) for x, y, _ in cells]
    pop = np.array([n for _, _, n in cells], dtype=float)
    tree = STRtree(boxes)
    w = np.zeros(len(parts))
    for k, (_, _, geom) in enumerate(parts):
        for i in tree.query(geom, predicate="intersects"):
            a = boxes[i].intersection(geom).area
            if a > 0:
                w[k] += pop[i] * a / (CELL_M * CELL_M)
    return w


def entropy_index(votes: dict[str, float]) -> float | None:
    """Finland's competitiveness: Shannon entropy of shares over ln(parties with votes)."""
    total = sum(votes.values())
    fracs = [v / total for v in votes.values() if v > 0] if total > 0 else []
    if len(fracs) < 2:
        return None
    return -sum(f * math.log(f) for f in fracs) / math.log(len(fracs))


def main() -> None:
    votes, turnout, kommun_cast = read_results()
    districts = read_districts()
    collection = {d for d, (_, el, _) in turnout.items() if el == 0}
    placed = set(votes) - collection
    if placed - set(districts):
        raise SystemExit(f"districts with results but no boundary: {sorted(placed - set(districts))[:10]}")
    if set(districts) - placed:
        raise SystemExit(f"boundaries with no results: {sorted(set(districts) - placed)[:10]}")
    print(f"{len(placed)} districts with a boundary, {len(collection)} collection districts", file=sys.stderr)

    # Collection votes per municipality, spread in proportion to the votes counted in districts.
    counted = defaultdict(int)
    for d in placed:
        counted[turnout[d][2]] += turnout[d][0]
    scale = {k: kommun_cast[k] / counted[k] for k in counted}

    deso = read_deso()
    parts = pieces(districts, deso)
    weights = grid_weights(parts)
    by_district = defaultdict(list)
    for k, (d, _, geom) in enumerate(parts):
        by_district[d].append(k)
    share = np.zeros(len(parts))
    fallback = 0
    for d, ks in by_district.items():
        w = weights[ks]
        if w.sum() <= 0:
            w = np.array([parts[k][2].area for k in ks])
            fallback += 1
        share[ks] = w / w.sum()
    print(f"{len(parts)} district x DeSO pieces; {fallback} districts apportioned by area", file=sys.stderr)

    acc = defaultdict(lambda: {"votes": defaultdict(float), "valid": 0.0, "cast": 0.0, "electorate": 0.0,
                               "div_num": 0.0, "div_den": 0.0})
    div = {d: entropy_index(votes[d]) for d in placed}
    for k, (d, code, _) in enumerate(parts):
        s = share[k]
        a = acc[code]
        valid = sum(votes[d].values())
        for p, v in votes[d].items():
            a["votes"][p] += s * v
        a["valid"] += s * valid
        cast, electorate, kommun = turnout[d]
        a["cast"] += s * cast * scale[kommun]
        a["electorate"] += s * electorate
        if div[d] is not None:
            a["div_num"] += s * valid * div[d]
            a["div_den"] += s * valid

    # Apportioning moves counts between areas and must not create or lose any.
    want = {"valid": sum(sum(votes[d].values()) for d in placed),
            "electorate": sum(turnout[d][1] for d in placed),
            "cast": sum(kommun_cast.values())}
    for key, total in want.items():
        got = sum(a[key] for a in acc.values())
        if abs(got / total - 1) > 1e-6:
            raise SystemExit(f"apportioned {key} {got:.0f} != published {total}")
    print(f"national turnout {100 * want['cast'] / want['electorate']:.2f} %", file=sys.stderr)

    out = {}
    for code in sorted(deso):
        a = acc.get(code)
        if not a or a["valid"] < 1 or a["electorate"] < 1:
            continue
        pv = {abbr: a["votes"].get(name, 0.0) for name, abbr in PARTIES.items()}
        lr_den = sum(pv.values())
        out[code] = {
            "turnout_pct": round(100 * a["cast"] / a["electorate"], 1),
            "lean": round(10 * sum(pv[p] * PARTY_LR[p] for p in pv) / lr_den, 1),
            "diversity": round(a["div_num"] / a["div_den"], 3) if a["div_den"] > 0 else None,
            "party": {p: round(100 * v / a["valid"], 1) for p, v in pv.items()},
        }
    missing = sorted(set(deso) - set(out))
    if missing:
        print(f"no election figures for {len(missing)} DeSOs: {missing[:10]}", file=sys.stderr)
    OUT.write_text(json.dumps({
        "source": "Valmyndigheten, riksdagsvalet 2026, slutlig rösträkning per valdistrikt",
        "election": "2026-09-13",
        "values": out,
    }, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"wrote {OUT}: {len(out)} of {len(deso)} DeSOs", file=sys.stderr)


if __name__ == "__main__":
    main()
