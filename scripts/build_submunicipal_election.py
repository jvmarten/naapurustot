#!/usr/bin/env python3
"""
Tier B: refine the 2023 parliamentary election voting-preference metrics to
SUB-MUNICIPAL (postal-code) resolution for the cities that publish current
polling-precinct (äänestysalue) boundaries as open data.

Method (real data, areal interpolation — no income proxy):
  1. Fetch the city's precinct boundary polygons (vintage-aligned to 2023).
  2. Fetch real per-precinct party votes (evaa 13t2) and electorate/turnout
     (evaa 13sx) from Statistics Finland.
  3. Apportion each precinct's votes to the postal-code polygons it overlaps,
     weighted by intersection area (precinct boundaries are drawn ~equal
     population, so within a dense city area weighting tracks population well).
  4. Per postal code: party shares, turnout, lean and competitiveness, computed
     from the apportioned totals (same formulas as fetch_election_results.py).

Output: scripts/election_submunicipal.json keyed by postal code — consumed by
apply_election_to_geojson.py / prepare_data.py, where it OVERRIDES the municipal
(Tier A) value for those postal codes.

Coverage is intentionally partial: only municipalities with open current precinct
geometry. Everywhere else the municipal figure (Tier A) stands, which for most of
Finland is already the finest resolution the data has.

Currently wired: Pääkaupunkiseutu (Helsinki, Espoo, Vantaa, Kauniainen), the
largest open precinct dataset (CC BY 4.0, kartta.hel.fi). Add more cities by
extending SOURCES.
"""

import io
import json
import logging
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import requests

from fetch_election_results import (ALL_PARTY_ABBR, derive_metrics)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

ROOT = Path(__file__).parent.parent
GEOJSON = ROOT / "public" / "data" / "metro_neighborhoods.geojson"
OUT_FILE = Path(__file__).parent / "election_submunicipal.json"

PARTY_TABLE = "https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/evaa/13t2.px"
TURNOUT_TABLE = "https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/evaa/13sx.px"
WORK_CRS = "EPSG:3067"  # metric, for area-weighted interpolation


def _norm_alue(tunnus: str) -> str:
    """Normalise a precinct id to the evaa form: digits zero-padded to 3 + letters.
    e.g. '49A' -> '049A', '11B' -> '011B', '5' -> '005'."""
    t = str(tunnus).strip().upper()
    digits = "".join(c for c in t if c.isdigit())
    letters = "".join(c for c in t if c.isalpha())
    return f"{int(digits):03d}{letters}" if digits else t


def load_capital_region_precincts() -> gpd.GeoDataFrame:
    """Pääkaupunkiseutu 2023 precinct polygons -> GeoDataFrame [kunta, alue, geometry]."""
    url = "https://kartta.hel.fi/avoindata/2023_PKS_aanestysaluejako.zip"
    logger.info("Fetching capital-region precinct boundaries (2023)...")
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
            member = next(n for n in z.namelist() if n.lower().endswith(".gpkg"))
            z.extract(member, tmp)
        g = gpd.read_file(Path(tmp) / member)

    name_to_code = {
        "HELSINGIN KAUPUNKI": "091", "ESPOON KAUPUNKI": "049",
        "VANTAAN KAUPUNKI": "092", "KAUNIAISTEN KAUPUNKI": "235",
    }
    g["kunta"] = g["kunta"].map(name_to_code)
    g["alue"] = g["tunnus"].map(_norm_alue)
    g = g[g["kunta"].notna()][["kunta", "alue", "geometry"]].to_crs(WORK_CRS)
    logger.info("  %d precinct polygons across %s", len(g), sorted(g["kunta"].unique()))
    return g


def fetch_precinct_results(munis: set[str]) -> tuple[dict, dict]:
    """Per-precinct party votes and (electorate, voted) for the given municipalities.

    Returns ({(kunta, alue): {party: votes}}, {(kunta, alue): (electorate, voted)}).
    Precinct codes in evaa are vp(2) + kunta(3) + alue, e.g. 01091049A.
    """
    # Party votes (13t2)
    meta = requests.get(PARTY_TABLE, timeout=30).json()
    area_var = next(v["code"] for v in meta["variables"] if "lue" in v["code"])
    precincts = [c for v in meta["variables"] if v["code"] == area_var
                 for c in v["values"] if c[:1].isdigit() and c != "2023"
                 and c[2:5] in munis]
    q = {"query": [
        {"code": area_var, "selection": {"filter": "item", "values": precincts}},
        {"code": "sukupuoli_9_20180101", "selection": {"filter": "item", "values": ["SSS"]}},
        {"code": "puolue_4_20230303", "selection": {"filter": "item", "values": list(ALL_PARTY_ABBR)}},
        {"code": "contentscode", "selection": {"filter": "item", "values": ["evaa_aanet"]}},
    ], "response": {"format": "json-stat2"}}
    data = requests.post(PARTY_TABLE, json=q, timeout=120).json()
    vals = data["value"]
    a_idx = data["dimension"][area_var]["category"]["index"]
    p_idx = data["dimension"]["puolue_4_20230303"]["category"]["index"]
    n_p = len(p_idx)
    votes: dict = {}
    for code, ai in a_idx.items():
        key = (code[2:5], code[5:])
        v = {ALL_PARTY_ABBR[pc]: float(vals[ai * n_p + pi])
             for pc, pi in p_idx.items() if vals[ai * n_p + pi]}
        if v:
            votes[key] = v

    # Electorate + voted (13sx)
    meta2 = requests.get(TURNOUT_TABLE, timeout=30).json()
    av2 = next(v["code"] for v in meta2["variables"] if "lue" in v["code"])
    precincts2 = [c for v in meta2["variables"] if v["code"] == av2
                  for c in v["values"] if c[:1].isdigit() and c != "2023"
                  and c[2:5] in munis]
    q2 = {"query": [
        {"code": av2, "selection": {"filter": "item", "values": precincts2}},
        {"code": "sukupuoli_9_20180101", "selection": {"filter": "item", "values": ["SSS"]}},
        {"code": "contentscode", "selection": {"filter": "item", "values": ["evaa_ao", "evaa_aanest"]}},
    ], "response": {"format": "json-stat2"}}
    d2 = requests.post(TURNOUT_TABLE, json=q2, timeout=120).json()
    vals2 = d2["value"]
    a2 = d2["dimension"][av2]["category"]["index"]
    c2 = d2["dimension"]["contentscode"]["category"]["index"]
    nc = len(c2)
    turnout: dict = {}
    for code, ai in a2.items():
        ao = vals2[ai * nc + c2["evaa_ao"]]
        aanest = vals2[ai * nc + c2["evaa_aanest"]]
        if ao:
            turnout[(code[2:5], code[5:])] = (float(ao), float(aanest or 0))
    return votes, turnout


def load_postal_polygons(munis: set[str]) -> gpd.GeoDataFrame:
    """Postal-code polygons for the target municipalities, in WORK_CRS."""
    g = gpd.read_file(GEOJSON)
    if g.crs is None:
        g = g.set_crs("EPSG:4326")
    g = g[g["kunta"].isin(munis)][["pno", "kunta", "geometry"]].to_crs(WORK_CRS)
    g = g[g.geometry.notna() & ~g.geometry.is_empty]
    logger.info("  %d postal polygons across target municipalities", len(g))
    return g


def main():
    precincts = load_capital_region_precincts()
    munis = set(precincts["kunta"].unique())

    logger.info("Fetching per-precinct results from StatFin evaa...")
    votes, turnout = fetch_precinct_results(munis)
    logger.info("  %d precincts with party votes, %d with turnout", len(votes), len(turnout))

    postal = load_postal_polygons(munis)
    postal_sindex = postal.sindex

    # Accumulators per postal code.
    acc_votes: dict[str, dict[str, float]] = {}
    acc_ao: dict[str, float] = {}
    acc_aanest: dict[str, float] = {}
    matched = unmatched = 0

    for _, prow in precincts.iterrows():
        key = (prow["kunta"], prow["alue"])
        pv = votes.get(key)
        if not pv:
            unmatched += 1
            continue
        matched += 1
        pgeom = prow.geometry
        parea = pgeom.area
        if parea <= 0:
            continue
        ao, aanest = turnout.get(key, (0.0, 0.0))

        # Candidate postal polygons by bbox, then exact intersection area.
        for idx in postal_sindex.query(pgeom):
            prow2 = postal.iloc[idx]
            inter = pgeom.intersection(prow2.geometry)
            if inter.is_empty:
                continue
            w = inter.area / parea
            if w <= 0:
                continue
            pno = prow2["pno"]
            d = acc_votes.setdefault(pno, {})
            for party, n in pv.items():
                d[party] = d.get(party, 0.0) + n * w
            acc_ao[pno] = acc_ao.get(pno, 0.0) + ao * w
            acc_aanest[pno] = acc_aanest.get(pno, 0.0) + aanest * w

    logger.info("  matched %d precincts to votes, %d unmatched (merged/advance-only)",
                matched, unmatched)

    out: dict[str, dict] = {}
    for pno, pv in acc_votes.items():
        m = derive_metrics({p: v for p, v in pv.items() if v > 0})
        if not m:
            continue
        ao = acc_ao.get(pno, 0.0)
        m["turnout_pct"] = round(100.0 * acc_aanest.get(pno, 0.0) / ao, 1) if ao > 0 else None
        out[pno] = m

    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    logger.info("Wrote %s (%d postal codes)", OUT_FILE.name, len(out))

    # Proof: within-Helsinki spread (should NOT be flat, unlike the municipal tier).
    sample = {"00100": "Helsinki centre", "00840": "Laajasalo",
              "00940": "Kontula/E-Helsinki", "02150": "Otaniemi (Espoo)"}
    for pno, name in sample.items():
        m = out.get(pno)
        if m:
            ps = ", ".join(f"{p} {m['party'][p]}%" for p in m["party"] if m["party"].get(p))
            logger.info("  %-22s turnout=%s lean=%s | %s", name, m["turnout_pct"], m["lean"], ps)


if __name__ == "__main__":
    main()
