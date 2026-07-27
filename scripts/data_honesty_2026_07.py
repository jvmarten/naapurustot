#!/usr/bin/env python3
"""Offline surgery over the committed GeoJSON for the 2026-07 data-honesty pass.

Same shape and conventions as scripts/in1_clean.py: a one-time, deterministic
correction of already-committed source data. `npm run build:data` only ever
reads the committed GeoJSON, so this script is not part of it and does not
affect the build:data idempotency gate.

Three corrections, all of which replace values that were presented as
measurements of a place with values that actually measure that place:

  1. air_quality_index — 284 areas were not measurements at all.
     * 91 Turku-region areas (postal prefixes 20/21) came from
       `estimate_turku_aqi`, a hand-tuned function of distance from the market
       square. Reproducing it from the shipped values matches 91/91 exactly at
       rural_floor=20.6, and it deviates from the modelled value by up to 17.8
       points (20800: shipped 40.4, SILAM 22.6).
     * 193 Tampere-region areas came from a NOx model where a sample was within
       5 km and a hardcoded 20.0 "clean suburban baseline" otherwise — 149 of
       them hold exactly that constant, which is the single most common
       air-quality value in the country.
     Both are replaced by FMI SILAM, which already covers all 3,018 areas and is
     already committed. The result is two real model products with no overlap:
     HSY/FMI ENFUSER for the 166 capital-region areas it resolves, SILAM
     everywhere else. The NOx tier goes too — three different products inside
     one national choropleth cannot be compared across a region border, which is
     the whole purpose of the layer.

  2. crime_index — refetched nationally from StatFin 13h4 for 2025.
     167 capital-region areas had been frozen since 2026-03 on an unrelated
     source at roughly half the national scale (merge_results preserved any
     existing 0xxxx value unless --overwrite, which was never passed), so
     Espoo's median area sat at the 13th national crime percentile. Every area
     now comes from one national fetch at one year.

  3. grocery_density — recomputed for all areas from the now-complete OSM cache.
     Five of the 69 seutukunta bboxes had no cached Overpass response, and a
     failed region silently became a region with no shops: 237 postal codes
     covering ~536,000 residents shipped a measured-looking 0, including the
     centre of Tampere. scripts/refetch_missing_overpass.py fills the gaps;
     this recomputes the density from the complete national point set using the
     same containment rule as prepare_data.join_groceries.

The GeoJSON is rewritten with json.dump(data, f) — Python's DEFAULT
serialization (ensure_ascii=True, ", "/": " separators, no indent, no trailing
newline) — which is byte-identical to the committed file on a no-op round trip,
so `git diff` stays value-only.

Run `npm run build:data` afterwards to propagate into src/data, then
`python scripts/validate_data.py --write-baseline` if coverage changed.

Usage:
  python scripts/data_honesty_2026_07.py [--dry-run]
"""

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
GEOJSON = ROOT / "public" / "data" / "metro_neighborhoods.geojson"

AIR_FINAL = SCRIPT_DIR / "air_quality.json"
AIR_SILAM = SCRIPT_DIR / "air_quality_silam.json"
AIR_ENFUSER = SCRIPT_DIR / "air_quality_enfuser.json"
CRIME = SCRIPT_DIR / "crime_index.json"
CACHE_DIR = SCRIPT_DIR / "cache"


def load(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# 1. Air quality
# ---------------------------------------------------------------------------

def air_quality_values() -> dict[str, float]:
    """ENFUSER where it resolves the area, FMI SILAM everywhere else."""
    silam = load(AIR_SILAM)
    enfuser = load(AIR_ENFUSER)
    return {pno: enfuser.get(pno, v) for pno, v in silam.items()}


# ---------------------------------------------------------------------------
# 3. Grocery density
# ---------------------------------------------------------------------------

# Every OSM density metric is computed the same way: count cached POI points that
# fall inside the postal polygon, divide by its area in km2, round to 1 decimal.
POI_METRICS = {
    "grocery_density": "OSM_groceries",
    "healthcare_density": "OSM_healthcare",
    "school_density": "OSM_schools",
    "daycare_density": "OSM_daycares",
    "restaurant_density": "OSM_restaurants",
    "cycling_density": "OSM_cycling",
}


def build_index(features: list):
    """STRtree over the postal polygons, as prepare_data._build_spatial_index does."""
    from shapely.geometry import shape
    from shapely.strtree import STRtree

    geoms, pnos = [], []
    for f in features:
        geom = f.get("geometry")
        if not geom:
            continue
        g = shape(geom)
        if g.is_empty:
            continue
        geoms.append(g)
        pnos.append(f["properties"].get("pno", ""))
    return STRtree(geoms), geoms, pnos


def poi_counts(index, cache_prefix: str) -> dict[str, int]:
    """Count cached OSM POIs per postal code for one layer.

    Mirrors prepare_data's join_* functions exactly: a strict `contains` test, and
    the first containing polygon wins, so a point on a shared boundary is counted
    once rather than twice.
    """
    from shapely.geometry import Point

    tree, geoms, pnos = index

    elements, seen = [], set()
    cache_files = sorted(CACHE_DIR.glob(f"overpass_{cache_prefix}_*.json"))
    if not cache_files:
        raise SystemExit(f"No cached responses found for {cache_prefix}")
    for path in cache_files:
        for el in load(path):
            eid = (el.get("type", ""), el.get("id", ""))
            if eid in seen:
                continue
            seen.add(eid)
            elements.append(el)

    counts: dict[str, int] = {}
    for el in elements:
        lat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        lon = el.get("lon") or (el.get("center", {}) or {}).get("lon")
        if lat is None or lon is None:
            continue
        point = Point(float(lon), float(lat))
        for ci in tree.query(point):
            if geoms[ci].contains(point):
                counts[pnos[ci]] = counts.get(pnos[ci], 0) + 1
                break
    print(f"  {cache_prefix:<18} {len(cache_files):>2} region files, "
          f"{len(elements):>5} unique POIs, {len(counts):>4} areas with >=1")
    return counts


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change without writing")
    args = ap.parse_args()

    data = load(GEOJSON)
    features = data["features"]
    print(f"Loaded {len(features)} features")

    air = air_quality_values()
    crime = load(CRIME)
    index = build_index(features)
    counts = {metric: poi_counts(index, prefix) for metric, prefix in POI_METRICS.items()}

    tracked = ["air_quality_index", "crime_index", *POI_METRICS]
    changed = {k: 0 for k in tracked}
    nulled = {k: 0 for k in tracked}
    air_deltas: list[tuple[str, float, float]] = []

    for f in features:
        p = f["properties"]
        pno = p.get("pno")
        if not pno:
            continue

        # 1. air quality
        new_air = air.get(pno)
        if new_air is not None:
            old = p.get("air_quality_index")
            if old != new_air:
                changed["air_quality_index"] += 1
                if old is not None:
                    air_deltas.append((pno, old, new_air))
                p["air_quality_index"] = new_air
        elif p.get("air_quality_index") is not None:
            p["air_quality_index"] = None
            nulled["air_quality_index"] += 1

        # 2. crime
        new_crime = crime.get(pno)
        if new_crime is not None:
            if p.get("crime_index") != new_crime:
                changed["crime_index"] += 1
                p["crime_index"] = new_crime
        elif p.get("crime_index") is not None:
            # No national value for this area: we cannot say what its crime
            # level is, so neither should the map.
            p["crime_index"] = None
            p.pop("crime_index_history", None)
            p.pop("crime_index_change_pct", None)
            nulled["crime_index"] += 1

        # 3. OSM POI densities
        area_m2 = p.get("pinta_ala")
        for metric in POI_METRICS:
            if isinstance(area_m2, (int, float)) and area_m2 > 0:
                density = round(counts[metric].get(pno, 0) / (area_m2 / 1_000_000), 1)
                if p.get(metric) != density:
                    changed[metric] += 1
                    p[metric] = density
            elif p.get(metric) is not None:
                p[metric] = None
                nulled[metric] += 1

    print("\nChanged values:")
    for k, v in changed.items():
        print(f"  {k:<20} {v:>5} changed, {nulled[k]} nulled")

    if air_deltas:
        air_deltas.sort(key=lambda t: abs(t[1] - t[2]), reverse=True)
        print("\n  largest air-quality corrections:")
        for pno, old, new in air_deltas[:5]:
            print(f"    {pno}: {old} -> {new} ({new - old:+.1f})")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"\nWrote {GEOJSON}")

    # Keep the committed intermediate consistent with what was applied, so a
    # later pipeline run does not silently reintroduce the fabricated values.
    with open(AIR_FINAL, "w", encoding="utf-8") as f:
        json.dump(air, f, ensure_ascii=False, indent=2)
    print(f"Wrote {AIR_FINAL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
