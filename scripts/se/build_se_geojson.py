#!/usr/bin/env python3
"""Build public/data/se_deso.geojson — Sweden's counterpart of metro_neighborhoods.geojson.

One feature per DeSO 2025 area (6,160), with simplified geometry, its FA25 region, a
display name and the metrics derived from scripts/se/scb_deso.json. Like the Finnish
file it is a build:data INPUT only: it never ships in dist/.

Inputs (all produced by the fetch scripts in this directory):
  cache/deso_2025_land.geojson  clip_deso_land.py (fetch_se_boundaries.py's full-resolution
                                polygons cut at the shore; git-ignored)
  deso_index.json, regso_2025.json, fa25.json, kommuner.json   fetch_se_boundaries.py
  scb_deso.json                 fetch_scb_deso.py
  osm_deso.json                 fetch_se_osm.py (OpenStreetMap service counts)
  schools_deso.json             fetch_se_schools.py (Skolverket's school register)
  air_quality_deso.json         fetch_se_air_quality.py (FMI SILAM)
  water_proximity_deso.json     fetch_se_water_proximity.py (OSM water + SCB 1 km grid)
  canopy_deso.json              fetch_se_canopy.py (Copernicus Tree Cover Density, 2018-)
  crime_kommun.json             fetch_se_crime.py (Brå, per municipality and city district)
  deso_district.json            fetch_se_districts.py (DeSO -> district in the three largest cities)
  election_deso.json            fetch_se_election.py (Valmyndigheten, riksdagsvalet 2026)
  kommun_layers.json            fetch_se_kommun_layers.py (rent, house prices, broadband, road accidents)
  noise_deso.json               fetch_se_noise.py (EEA road-noise Lden contours)

Geometry is cut at the shore first (clip_deso_land.py: SCB's polygons run out into the
sea, Paavo's do not), then simplified ONCE here, on a shared-arc topology (geo2topo ->
toposimplify -> topo2geo), so neighbouring DeSOs keep a common edge instead of opening
slivers. The threshold (3e-7 deg², ~1,800 m² triangles at Swedish latitudes) keeps the
national file near 0.65 M vertices with the coast and archipelagos drawn, while a 0.1 km²
inner-city DeSO keeps its shape; islands under MIN_PART_KM2 are then dropped.

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
import math
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
SIMPLIFY_DEG2 = "3e-7"
# Islands and holes smaller than this are dropped after the shore clip
# (clip_deso_land.py). Paavo's smallest island is ~0.004 km², so 0.01 km² keeps the
# coast as detailed as Finland's while Stockholm's archipelago does not double its
# region file. Outlines are drawn at zoom 4–8, where 0.5 km² is a few pixels.
MIN_PART_KM2 = 0.01
OUTLINE_MIN_PART_KM2 = 0.5
COORD_DECIMALS = 6

AGE_65_PLUS = ["65-69", "70-74", "75-79", "80-"]


def load(name: str):
    return json.loads((HERE / name).read_text())


def simplified_geometry() -> dict[str, dict]:
    raw = HERE / "cache" / "deso_2025_land.geojson"
    if not raw.exists():
        raise SystemExit(f"{raw} missing — run fetch_se_boundaries.py, then clip_deso_land.py")
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        run = lambda cmd: subprocess.run(cmd, shell=True, check=True, cwd=ROOT)  # noqa: E731
        run(f'npx -y -p topojson-server geo2topo -q 1e6 deso="{raw}" > "{t}/q.topojson"')
        run(f'npx -y -p topojson-simplify toposimplify -p {SIMPLIFY_DEG2} -f "{t}/q.topojson" > "{t}/s.topojson"')
        run(f'npx -y -p topojson-client topo2geo deso="{t}/s.geojson" < "{t}/s.topojson"')
        fc = json.loads((t / "s.geojson").read_text())
    return {f["properties"]["deso"]: drop_small_parts(f["geometry"], MIN_PART_KM2) for f in fc["features"]}


def ring_km2(ring) -> float:
    """Planar ring area in km², scaled at the ring's own latitude (lng/lat degrees)."""
    a = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        a += x0 * y1 - x1 * y0
    return abs(a) / 2 * 111.32 ** 2 * math.cos(math.radians(ring[0][1]))


def drop_small_parts(geom: dict, min_km2: float) -> dict:
    """Drop islands and holes under min_km2. The largest part always stays, so no area
    loses its polygon."""
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    largest = max(polys, key=lambda p: ring_km2(p[0]))
    kept = [[p[0]] + [h for h in p[1:] if ring_km2(h) >= min_km2]
            for p in polys if p is largest or ring_km2(p[0]) >= min_km2]
    if len(kept) == 1:
        return {"type": "Polygon", "coordinates": kept[0]}
    return {"type": "MultiPolygon", "coordinates": kept}


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


# Same precision as Finland's service densities (prepare_data.POI_DENSITY_DECIMALS):
# at fewer decimals one facility in a large rural DeSO rounds to a measured-looking 0.
POI_DENSITY_DECIMALS = 4

# (count file key, density property, count property). Cycling counts way records, which
# measure how contributors split ways rather than a number of things, so it has no count
# column — the rule Finland's `_assign_poi_density` states.
OSM_SERVICES = [
    ("healthcare", "healthcare_density", "healthcare_count"),
    ("grocery", "grocery_density", "grocery_count"),
    ("restaurant", "restaurant_density", "restaurant_count"),
    ("cycling", "cycling_density", None),
    ("transit", "transit_stop_density", None),
]


def services(counts: dict[str, int], key: str, pinta_ala_m2: int | None, density: str,
             count: str | None) -> dict:
    """Density per km² of total area (pinta_ala, as Finland's) plus the raw count. The
    counts come from national sources covering every DeSO, so an area absent from them
    holds zero. With no area to divide by the density is unknown, not zero."""
    n = counts.get(key, 0)
    out = {density: None if not pinta_ala_m2 else round(n / (pinta_ala_m2 / 1e6), POI_DENSITY_DECIMALS)}
    if count:
        out[count] = None if not pinta_ala_m2 else n
    return out


# Finland's walkability components (prepare_data.calculate_walkability), in its order.
WALK_COMPONENTS = [
    "restaurant_density", "grocery_density", "transit_stop_density",
    "healthcare_density", "cycling_density", "school_density",
]
WALK_MIN_COMPONENTS = 3


def add_walkability(features: list[dict]) -> None:
    """walkability_index: the mean mid-rank percentile of the six service densities, as
    Finland's — taken over Sweden's DeSO areas, so it is each area's standing in its own
    country. A tie block scores at its midpoint (prepare_data's `_percentile_score`)."""
    import bisect
    cols = {c: sorted(f["properties"][c] for f in features if f["properties"].get(c) is not None)
            for c in WALK_COMPONENTS}
    for f in features:
        scores = []
        for c in WALK_COMPONENTS:
            v, vals = f["properties"].get(c), cols[c]
            if v is None or not vals:
                continue
            lt, le = bisect.bisect_left(vals, v), bisect.bisect_right(vals, v)
            scores.append(round((lt + (le - lt) / 2) / len(vals) * 100, 1))
        f["properties"]["walkability_index"] = (
            round(sum(scores) / len(scores)) if len(scores) >= WALK_MIN_COMPONENTS else None)


CRIME_KEYS = ["violent_crime_rate", "property_crime_rate", "crime_index"]

# Residential buildings by construction decade (TAB6540) -> the year each decade counts
# as, Finland's convention (fetch_building_age.DECADE_MIDPOINTS): the open first class at
# 1900, each decade at its middle, and the current one at the middle of the years it
# has had so far (2021–2025 for a stock counted on 31 December 2025). Okänt is left out.
BUILT_DECADES = {
    "-1920": 1900, "1921-1930": 1925, "1931-1940": 1935, "1941-1950": 1945,
    "1951-1960": 1955, "1961-1970": 1965, "1971-1980": 1975, "1981-1990": 1985,
    "1991-2000": 1995, "2001-2010": 2005, "2011-2020": 2015, "2021-2030": 2023,
}


def avg_construction_year(row: dict) -> int | None:
    """Mean construction year of the DeSO's residential buildings, by decade midpoint."""
    n = total_year = 0
    for decade, year in BUILT_DECADES.items():
        k = row.get(f"{decade}|0000080B")
        if k:
            n += k
            total_year += k * year
    return round(total_year / n) if n else None


def extra_props(hh: dict, built: dict, canopy: dict, osm: dict, pinta_ala, deso: str) -> dict:
    """Layers added after the first national release, in the order a rebuild writes them
    (after the crime figures). apply_se_layers.py writes the same into the committed file."""
    hh_total = hh.get("TOTALT|000007Y1")
    props = {
        "single_person_hh_pct": pct(hh.get("ESUB|000007Y1"), hh_total),
        "avg_construction_year": avg_construction_year(built),
        "tree_canopy_pct": canopy["values"].get(deso),
        "tree_canopy_history": canopy["history"].get(deso),
    }
    props.update(services({"ev": osm["ev"].get(deso, 0)}, "ev", pinta_ala, "ev_charging_density", None))
    return props


# election_deso.json party abbreviation -> property. Sweden's parties are not Finland's, so
# they get keys of their own; turnout, diversity and lean share Finland's keys.
ELECTION_PARTIES = {
    "S": "party_vote_se_s_pct", "M": "party_vote_se_m_pct", "SD": "party_vote_se_sd_pct",
    "V": "party_vote_se_v_pct", "C": "party_vote_se_c_pct", "KD": "party_vote_se_kd_pct",
    "MP": "party_vote_se_mp_pct", "L": "party_vote_se_l_pct",
}
ELECTION_KEYS = ["voter_turnout_pct", "party_diversity_index", "political_lean_index", *ELECTION_PARTIES.values()]


def election_props(election: dict, deso: str) -> dict:
    """The 2026 Riksdag election, apportioned from Valmyndigheten's districts
    (fetch_se_election.py). Written after extra_props; apply_se_election.py patches the
    committed file with the same function."""
    rec = election["values"].get(deso)
    if not rec:
        return dict.fromkeys(ELECTION_KEYS)
    props = {
        "voter_turnout_pct": rec["turnout_pct"],
        "party_diversity_index": rec["diversity"],
        "political_lean_index": rec["lean"],
    }
    props.update({key: rec["party"][abbr] for abbr, key in ELECTION_PARTIES.items()})
    return props


LATER_KEYS = ["rent_sqm_month_sek", "house_price_sek", "broadband_coverage_pct",
              "traffic_accident_rate", "noise_pollution"]


def later_props(layers: dict, noise: dict, district_of: dict[str, str], deso: str) -> dict:
    """Rent, house prices, broadband and accidents per kommun (rent per city district in
    Stockholm and Malmö) and road noise per DeSO. Written after election_props;
    apply_se_later.py patches the committed file with the same function."""
    kommun = deso[:4]
    rent = layers["rent"]["districts"].get(district_of.get(deso, ""))
    return {
        "rent_sqm_month_sek": rent if rent is not None else layers["rent"]["kommuner"].get(kommun),
        "house_price_sek": layers["house_price"]["kommuner"].get(kommun),
        "broadband_coverage_pct": layers["broadband"]["kommuner"].get(kommun),
        "traffic_accident_rate": layers["accidents"]["kommuner"].get(kommun),
        "noise_pollution": noise["values"].get(deso),
    }


def crime_props(crime: dict, district_of: dict[str, str], deso: str) -> dict:
    """Brå's figures for the DeSO's city district in Stockholm, Göteborg and Malmö, else for
    its municipality (a DeSO code starts with its kommun code). Brå publishes nothing finer."""
    district = district_of.get(deso)
    rec = crime["districts"][district] if district else crime["kommuner"].get(deso[:4], {})
    return {k: rec.get(k) for k in CRIME_KEYS}


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
        g = drop_small_parts(f["geometry"], OUTLINE_MIN_PART_KM2)
        out.append({"type": "Feature", "properties": {"region": f["id"]},
                    "geometry": {"type": g["type"], "coordinates": round_coords(g["coordinates"])}})
    OUTLINES.write_text(json.dumps({"type": "FeatureCollection", "features": out}, separators=(",", ":")) + "\n")


def main() -> None:
    index = load("deso_index.json")
    regso = load("regso_2025.json")
    fa25 = load("fa25.json")
    kommuner = load("kommuner.json")
    scb = load("scb_deso.json")["tables"]
    osm = load("osm_deso.json")["counts"]
    schools = load("schools_deso.json")["counts"]
    air = load("air_quality_deso.json")["values"]
    water = load("water_proximity_deso.json")["values"]
    canopy = load("canopy_deso.json")
    crime = load("crime_kommun.json")
    district_of = load("deso_district.json")
    election = load("election_deso.json")
    layers = load("kommun_layers.json")
    noise = load("noise_deso.json")

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
        for key, density, count in OSM_SERVICES:
            props.update(services({key: osm[key].get(deso, 0)}, key, props["pinta_ala"], density, count))
        props.update(services({"school": schools.get(deso, 0)}, "school", props["pinta_ala"],
                              "school_density", "school_count"))
        props["air_quality_index"] = air.get(deso)
        props["water_proximity_m"] = water.get(deso)
        props.update(crime_props(crime, district_of, deso))
        props.update(extra_props(hh, t("building_age", deso), canopy, osm, props["pinta_ala"], deso))
        props.update(election_props(election, deso))
        props.update(later_props(layers, noise, district_of, deso))
        features.append({"type": "Feature", "properties": props, "geometry": {
            "type": geom["type"], "coordinates": round_coords(geom["coordinates"])}})

    add_walkability(features)
    write_regions(fa25, features)
    write_outlines(features)

    fc = {"type": "FeatureCollection", "vintage": vintage, "features": features}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {OUT} ({len(features)} features, {OUT.stat().st_size / 1e6:.1f} MB)", file=sys.stderr)


if __name__ == "__main__":
    main()
