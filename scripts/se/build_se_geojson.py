#!/usr/bin/env python3
"""Build public/data/se_deso.geojson — Sweden's counterpart of metro_neighborhoods.geojson.

One feature per DeSO 2025 area (6,160), with simplified geometry, its FA25 region, a
display name and the metrics derived from scripts/se/scb_deso.json. Like the Finnish
file it is a build:data INPUT only: it never ships in dist/.

Inputs (all produced by the fetch scripts in this directory):
  cache/deso_2025_raw.geojson   fetch_se_boundaries.py (full resolution, git-ignored)
  deso_index.json, regso_2025.json, fa25.json, kommuner.json   fetch_se_boundaries.py
  scb_deso.json                 fetch_scb_deso.py

Geometry is simplified ONCE here, on a shared-arc topology (geo2topo -> toposimplify ->
topo2geo), so neighbouring DeSOs keep a common edge instead of opening slivers. The
threshold (1e-7 deg², ~600 m² triangles at Swedish latitudes) takes 2.31 M vertices to
0.62 M while a 0.1 km² inner-city DeSO keeps its shape.

Metric definitions follow SCB's tables, NOT Paavo's. Where a key is shared with Finland
the concept is the same but the definition differs in ways stated in
src/data/data_sources.json (per-country `countries.se` entry), and colour scales and
rankings are computed per country, so the two are never put on one scale.

Missing values: SCB marks suppressed cells '..', fetched as null, and any metric whose
inputs include a null is written as null — never imputed, never zero. One exception is
exact rather than estimated: in the tenure and house-type tables SCB publishes 0 and every
count from 3 up but never a 1 or a 2 (checked over all 55,440 cells), so a suppressed cell
there holds 1 or 2 persons. A share with such a cell is then known to lie between two
bounds; when both bounds round to the same published decimal (1 or 2 of 1,746 residents
are both 0.1 %), that IS the value at the precision we publish, and it is written. When
they round differently the share stays null. Dropping these areas instead would bias every
regional aggregate: they are exactly the inner-city DeSOs with almost no detached houses,
and leaving them out pushed Stockholm-Solna's detached-house share to 51 %.

Usage: python scripts/se/build_se_geojson.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

from shapely.geometry import shape

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / "public" / "data" / "se_deso.geojson"
REGIONS_TS = ROOT / "src" / "utils" / "regionsSe.ts"
OUTLINES = HERE / "fa25_outlines.geojson"
# Region outlines are drawn at zoom 4–8, so they take a much coarser threshold than the
# areas: 1e-5 deg² keeps 17.5 k vertices for all 71 regions (Finland's 69 hold ~19 k).
OUTLINE_SIMPLIFY_DEG2 = "1e-5"
SIMPLIFY_DEG2 = "1e-7"
COORD_DECIMALS = 6

AGE_65_PLUS = ["65-69", "70-74", "75-79", "80-"]


def load(name: str):
    return json.loads((HERE / name).read_text())


def simplified_geometry() -> dict[str, dict]:
    raw = HERE / "cache" / "deso_2025_raw.geojson"
    if not raw.exists():
        raise SystemExit(f"{raw} missing — run scripts/se/fetch_se_boundaries.py first")
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        run = lambda cmd: subprocess.run(cmd, shell=True, check=True, cwd=ROOT)  # noqa: E731
        run(f'npx -y -p topojson-server geo2topo -q 1e6 deso="{raw}" > "{t}/q.topojson"')
        run(f'npx -y -p topojson-simplify toposimplify -p {SIMPLIFY_DEG2} -f "{t}/q.topojson" > "{t}/s.topojson"')
        run(f'npx -y -p topojson-client topo2geo deso="{t}/s.geojson" < "{t}/s.topojson"')
        fc = json.loads((t / "s.geojson").read_text())
    return {f["properties"]["deso"]: f["geometry"] for f in fc["features"]}


def round_coords(c):
    if isinstance(c[0], list):
        return [round_coords(x) for x in c]
    return [round(c[0], COORD_DECIMALS), round(c[1], COORD_DECIMALS)]


def pct(num, den, decimals=1):
    """Share of a whole, in percent. Capped at 100: SCB's cell noise (see
    fetch_scb_deso.py) can put a part a few persons above its own total, and a share
    above 100 % is not a value anything can have."""
    if num is None or den is None or den <= 0:
        return None
    return round(min(num / den * 100, 100.0), decimals)


def ratio(num, den, decimals=2):
    if num is None or den is None or den <= 0:
        return None
    return round(num / den, decimals)


def total(*vals):
    return None if any(v is None for v in vals) else sum(vals)


SUPPRESSED = (1, 2)  # what a '..' cell can hold in the tenure / house-type tables


def bounds(row: dict, keys: list[str]) -> tuple[float, float]:
    """Sum of `keys` as a (low, high) interval, a suppressed cell counting 1–2."""
    lo = hi = 0
    for k in keys:
        v = row.get(k)
        lo += SUPPRESSED[0] if v is None else v
        hi += SUPPRESSED[1] if v is None else v
    return lo, hi


def bounded_pct(interval: tuple[float, float], den, decimals=1):
    """The share when both ends of `interval` round to the same value, else None."""
    lo, hi = pct(interval[0], den, decimals), pct(interval[1], den, decimals)
    return lo if lo is not None and lo == hi else None


def midpoint(interval: tuple[float, float]) -> float:
    """Count for the regional sums (Σ numerator / Σ denominator). A suppressed cell
    adds its midpoint, 1.5, so each contributes at most half a person of error."""
    return (interval[0] + interval[1]) / 2


def display_names(index: dict, regso: dict) -> dict[str, str]:
    """RegSO name for each DeSO; numbered (in DeSO-code order) when a RegSO holds several.

    DeSO areas have no names of their own. The number is our label, not SCB's — it only
    tells apart areas that would otherwise share a name in lists and search.
    """
    by_regso = defaultdict(list)
    for deso, rec in index.items():
        by_regso[rec["regso"]].append(deso)
    names = {}
    for code, desos in by_regso.items():
        base = regso[code]["name"]
        desos.sort()
        for i, deso in enumerate(desos, 1):
            names[deso] = base if len(desos) == 1 else f"{base} {i}"
    return names


def write_regions(fa25: list[dict], features: list[dict]) -> None:
    """Emit src/utils/regionsSe.ts: the FA25 regions as compact tuples, largest first."""
    bbox: dict[str, list[float]] = {}
    pop: dict[str, int] = defaultdict(int)
    for f in features:
        rid = f["properties"]["city"]
        pop[rid] += f["properties"]["he_vakiy"] or 0
        b = shape(f["geometry"]).bounds
        cur = bbox.setdefault(rid, list(b))
        cur[0], cur[1] = min(cur[0], b[0]), min(cur[1], b[1])
        cur[2], cur[3] = max(cur[2], b[2]), max(cur[3], b[3])
    ordered = sorted(fa25, key=lambda r: (-pop[r["id"]], r["id"]))
    ids = [r["id"] for r in ordered]
    if len(set(ids)) != len(ids):
        raise SystemExit("FA25 region ids collide after slugging")
    rows = []
    for r in ordered:
        b = [round(v, 4) for v in bbox[r["id"]]]
        rows.append(f"  ['{r['id']}', {b[0]}, {b[1]}, {b[2]}, {b[3]}, {len(r['kommuner'])}],")
    union = "\n".join(f"  | '{i}'" for i in ids)
    REGIONS_TS.write_text(f"""// Generated by scripts/se/build_se_geojson.py from Tillväxtverket's FA25 regions and
// SCB's DeSO 2025 boundaries. Do not edit by hand; re-run the script.
//
// Sweden's 71 FA25 functional regions (funktionella analysregioner), largest population
// first. Each row: [id, west, south, east, north, municipality count]. Tuples, not
// objects, and no centre, zoom or municipality codes (regions.ts derives the first two
// from the bounds; the codes live in scripts/se/fa25.json): this file is part of the
// map's bundle budget, and those cost 1.4 kB gzipped that nothing at runtime reads.

export type SeRegionId =
{union};

export const SE_REGION_ROWS: readonly (readonly [SeRegionId, number, number, number, number, number])[] = [
{chr(10).join(rows)}
];
""")


def write_outlines(features: list[dict]) -> None:
    """FA25 region outlines: the region's DeSOs dissolved on their shared arcs
    (topomerge), simplified, as scripts/se/fa25_outlines.geojson. build:data merges this
    with Finland's seutukunta outlines into src/data/region_outlines.topojson."""
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        fc = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"city": f["properties"]["city"]}, "geometry": f["geometry"]}
            for f in features]}
        (t / "deso.geojson").write_text(json.dumps(fc))
        run = lambda cmd: subprocess.run(cmd, shell=True, check=True, cwd=ROOT)  # noqa: E731
        run(f'npx -y -p topojson-server geo2topo -q 1e5 deso="{t}/deso.geojson" > "{t}/q.json"')
        run(f'npx -y -p topojson-client topomerge fa=deso -k "d.properties.city" < "{t}/q.json" > "{t}/m.json"')
        run(f'npx -y -p topojson-simplify toposimplify -p {OUTLINE_SIMPLIFY_DEG2} -f < "{t}/m.json" > "{t}/s.json"')
        run(f'npx -y -p topojson-client topo2geo fa="{t}/fa.geojson" < "{t}/s.json"')
        merged = json.loads((t / "fa.geojson").read_text())
    out = []
    for f in sorted(merged["features"], key=lambda f: f["id"]):
        g = f["geometry"]
        out.append({"type": "Feature", "properties": {"region": f["id"]},
                    "geometry": {"type": g["type"], "coordinates": round_coords(g["coordinates"])}})
    OUTLINES.write_text(json.dumps({"type": "FeatureCollection", "features": out}, separators=(",", ":")) + "\n")


def main() -> None:
    index = load("deso_index.json")
    regso = load("regso_2025.json")
    fa25 = load("fa25.json")
    kommuner = load("kommuner.json")
    scb = load("scb_deso.json")["tables"]

    region_of = {k: r["id"] for r in fa25 for k in r["kommuner"]}
    names = display_names(index, regso)
    geoms = simplified_geometry()
    if set(geoms) != set(index):
        raise SystemExit("simplified geometry and DeSO index disagree")

    def t(key, deso):
        return scb[key]["data"].get(deso, {})

    vintage = {k: v["year"] for k, v in scb.items()}
    features = []
    for deso in sorted(index):
        kommun = index[deso]["kommun"]
        age = t("age_sex", deso)
        pop = age.get("totalt|1+2|000007Y7")
        sex = t("sex", deso)
        men, women = sex.get("totalt|1|000007Y7"), sex.get("totalt|2|000007Y7")
        bg = t("background", deso)
        hh = t("households", deso)
        ten = t("tenure", deso)
        house = t("house_type", deso)
        es = t("economic_standard", deso)
        lh = t("low_high_standard", deso)
        lab = t("labour", deso)
        edu = t("education", deso)
        area = t("area", deso)

        land_km2 = area.get("01|000007DY")
        total_km2 = area.get("05|000007DY")
        hh_total = hh.get("TOTALT|000007Y1")
        median_tkr = es.get("000008AB")
        edu_known = total(*(edu.get(f"{c}|000007Z6") for c in ["21", "3+4", "5", "6"]))
        tenure_total = ten.get("TOTALT|000007DQ")
        house_total = house.get("TOTALT|0000077F")

        T = "|000007DQ"
        owned = bounds(ten, ["ÄG/ANDEL" + T, "BOSTADSRÄTT" + T])
        if tenure_total is not None:
            # The same quantity from the other side: total − hyresrätt − uppgift saknas.
            # Both intervals hold the true count, so their intersection does too.
            rest = bounds(ten, ["HYRESRÄTT" + T, "ÖVRIGT" + T])
            owned = (max(owned[0], tenure_total - rest[1]), min(owned[1], tenure_total - rest[0]))
            if owned[0] > owned[1]:  # SCB's cell noise can make the sides disagree slightly
                owned = bounds(ten, ["ÄG/ANDEL" + T, "BOSTADSRÄTT" + T])
        rented = bounds(ten, ["HYRESRÄTT" + T])
        smahus = bounds(house, ["SMÅHUS|0000077F"])

        geom = geoms[deso]
        pt = shape(geom).representative_point()
        props = {
            "pno": deso,
            "nimi": names[deso],
            "namn": names[deso],
            "kunta": kommun,
            "municipality": kommuner[kommun],
            "city": region_of[kommun],
            "regso": index[deso]["regso"],
            "lat": round(pt.y, 5),
            "lon": round(pt.x, 5),
            "vuosi": vintage["age_sex"],
            "pinta_ala": None if total_km2 is None else round(total_km2 * 1_000_000),
            "he_vakiy": pop,
            "he_naiset": women,
            "he_miehet": men,
            "population_density": None if pop is None or not land_km2 else round(pop / land_km2, 2),
            "elderly_ratio_pct": pct(total(*(age.get(f"{a}|1+2|000007Y7") for a in AGE_65_PLUS)), pop),
            "gender_ratio": ratio(women, men),
            "foreign_background_pct": pct(bg.get("1|1+2|000007Y4"), bg.get("SA|1+2|000007Y4")),
            "avg_household_size": ratio(pop, hh_total),
            "families_with_children_pct": pct(total(hh.get("SBMB|000007Y1"), hh.get("ESMB|000007Y1")), hh_total),
            "single_parent_hh_pct": pct(hh.get("ESMB|000007Y1"), hh_total),
            "ownership_rate": bounded_pct(owned, tenure_total),
            "rental_rate": bounded_pct(rented, tenure_total),
            "detached_house_share": bounded_pct(smahus, house_total),
            "economic_standard_median": None if median_tkr is None else round(median_tkr * 1000),
            "low_economic_standard_pct": lh.get("tot|000008AC"),
            "employment_rate": pct(lab.get("1+2|20-64|0000089X"), lab.get("1+2|20-64|0000089Y")),
            "unemployment_rate": pct(lab.get("1+2|20-64|0000089W"), lab.get("1+2|20-64|0000089V")),
            "higher_education_rate": pct(total(edu.get("5|000007Z6"), edu.get("6|000007Z6")), edu_known),
            # Numerators and denominators behind the rates above, so a region's figure is
            # Σ numerator / Σ denominator (computeMetroAverages) rather than an average of
            # per-area percentages. te_taly is the household count, Paavo's name for it.
            "te_taly": hh_total,
            "se_lf": lab.get("1+2|20-64|0000089V"),
            "se_unemp": lab.get("1+2|20-64|0000089W"),
            "se_emp": lab.get("1+2|20-64|0000089X"),
            "se_pop2064": lab.get("1+2|20-64|0000089Y"),
            "se_edu": edu_known,
            "se_edu3": total(edu.get("5|000007Z6"), edu.get("6|000007Z6")),
            "se_ten": tenure_total,
            "se_own": midpoint(owned) if tenure_total else None,
            "se_rent": midpoint(rented) if tenure_total else None,
            "se_hus": house_total,
            "se_smahus": midpoint(smahus) if house_total else None,
            "se_land": land_km2,
        }
        features.append({"type": "Feature", "properties": props, "geometry": {
            "type": geom["type"], "coordinates": round_coords(geom["coordinates"])}})

    write_regions(fa25, features)
    write_outlines(features)

    fc = {"type": "FeatureCollection", "vintage": vintage, "features": features}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {OUT} ({len(features)} features, {OUT.stat().st_size / 1e6:.1f} MB)", file=sys.stderr)


if __name__ == "__main__":
    main()
