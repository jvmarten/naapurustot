#!/usr/bin/env python3
"""Offline surgery over the committed GeoJSON for the 2026-08 services pass.

Same shape and conventions as scripts/data_honesty_2026_07.py and
scripts/in1_clean.py: a one-time, deterministic correction of already-committed
source data. `npm run build:data` only ever reads the committed GeoJSON, so this
script is not part of it and does not affect the build:data idempotency gate.

THE DEFECT

Every OSM service join in prepare_data.py ends with

    round(count / (area_m2 / 1_000_000), 1)

One decimal place means any density below 0.05/km2 becomes exactly 0.0. The
median Finnish postal area is 52 km2 and 2,238 of the 3,018 areas are larger
than 20 km2, so *a single real grocery store, school, daycare or clinic rounds
away in three-quarters of the country*. Because "OSM found nothing" is written
as 0 as well, the two are indistinguishable downstream: coverage_pct reads
100 %, is_proxy reads false, and every honesty signal in the app stays silent
while the map affirmatively certifies a fabricated zero.

Measured against the complete 69-region Overpass cache, **3,169 (metric, area)
pairs ship 0.0 while OSM already places at least one facility inside the
polygon**:

    grocery      563 areas   1,401,190 residents
    school       912 areas   1,456,597 residents
    daycare      362 areas   1,015,185 residents
    healthcare   412 areas   1,172,438 residents
    restaurant   703 areas   1,036,407 residents
    cycling      217 areas     103,203 residents

84100 Ylivieska Keskus (13,623 residents, 252.3 km2) is the worst case: it ships
0.0 for grocery, school, daycare *and* healthcare although the cache holds 6
supermarkets, 12 schools, 2 daycares and 6 healthcare POIs inside it. At one
decimal it would need 13 grocery stores before the map showed anything but zero.

THE CORRECTION

  1. A `*_count` integer property for the five consumer-facing service layers
     (grocery, school, daycare, healthcare, restaurant). This is the honest,
     human-meaningful quantity — "6 grocery stores" is true and checkable, where
     "0.0 /km2" is false — and it is what the profile page now renders.

  2. All six `*_density` values recomputed at 4 decimals. Four is exactly
     sufficient and not arbitrary: the largest postal area in Finland is 99800
     Ivalo at 7,143.8 km2, so the smallest possible positive density is
     1 / 7143.8 = 0.00014, which survives round(v, 4). No real facility can
     round to zero at this precision.

     The layers keep per-km2 semantics — that is what makes them comparable
     across areas — but the map colour stops are recalibrated separately, and
     the count is what the profile page shows.

  3. cycling_density is recomputed at the same precision but deliberately gets
     NO count property. It counts `out center` points of *way records*, so it
     measures how finely contributors split ways rather than any physical
     quantity; 99800 Ivalo scores 174. Publishing that as a number of things
     would be a new false claim. Rescuing its 217 rounding zeros is a strict
     improvement on the existing (flawed) semantics, and replacing it with real
     km/km2 from Digiroad `dr_tielinkki` linkkityyp=8 is tracked separately.

The counts come from the same cache and the same containment rule the pipeline
itself uses, via data_honesty_2026_07.poi_counts — a strict `contains` test with
first-containing-polygon-wins, so a point on a shared boundary is counted once.

WHAT THIS DOES NOT FIX

OSM is genuinely incomplete on top of the rounding, and biased against small
towns: the national grocery total is 55 % of Statistics Finland's establishment
count (1,602 vs 2,906), daycares 56 %, restaurants 68 %, schools 81 %. Fixing
the arithmetic makes the numbers honest about what OSM knows; it does not make
OSM complete. Replacing grocery/restaurant with StatFin 14j7 and schools with
the Tilastokeskus Oppilaitokset WFS is tracked separately.

The GeoJSON is rewritten with json.dump(data, f) — Python's DEFAULT
serialization (ensure_ascii=True, ", "/": " separators, no indent, no trailing
newline) — which is byte-identical to the committed file on a no-op round trip,
so `git diff` stays value-only.

Run `npm run build:data` afterwards to propagate into src/data, then
`python scripts/validate_data.py --write-baseline` if coverage changed.

Usage:
  python scripts/services_honesty_2026_08.py [--dry-run]
"""

import argparse
import importlib.util
import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
GEOJSON = ROOT / "public" / "data" / "metro_neighborhoods.geojson"

# Reuse the cache reader, spatial index and containment rule from the 2026-07
# pass rather than restating them — they already mirror prepare_data's join_*
# functions exactly, and a second copy would be free to drift from the pipeline.
_spec = importlib.util.spec_from_file_location(
    "data_honesty_2026_07", SCRIPT_DIR / "data_honesty_2026_07.py"
)
_dh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_dh)

# The five layers where a count is a real, showable quantity. cycling_density is
# recomputed too (see module docstring) but counts way records, not things.
COUNTED = {
    "grocery_density": "grocery_count",
    "school_density": "school_count",
    "daycare_density": "daycare_count",
    "healthcare_density": "healthcare_count",
    "restaurant_density": "restaurant_count",
}

# 1 / 7143.8 km2 (99800 Ivalo, the largest postal area) = 0.00014, so 4 decimals
# is the coarsest precision at which no real facility can round to zero.
DENSITY_DECIMALS = 4


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change without writing")
    args = ap.parse_args()

    print(f"Reading {GEOJSON.name}...")
    data = _dh.load(GEOJSON)
    features = data["features"]
    print(f"  {len(features)} features")

    print("Building spatial index over the postal polygons...")
    index = _dh.build_index(features)

    print("Counting cached OSM POIs per postal code...")
    counts_by_metric = {
        metric: _dh.poi_counts(index, prefix)
        for metric, prefix in _dh.POI_METRICS.items()
    }

    rescued = {m: 0 for m in _dh.POI_METRICS}
    rescued_pop = {m: 0 for m in _dh.POI_METRICS}
    changed = {m: 0 for m in _dh.POI_METRICS}

    for f in features:
        p = f["properties"]
        pno = p.get("pno", "")
        area_m2 = p.get("pinta_ala")
        area_km2 = (area_m2 / 1_000_000) if isinstance(area_m2, (int, float)) and area_m2 > 0 else None

        for metric, counts in counts_by_metric.items():
            count = counts.get(pno, 0)
            before = p.get(metric)

            if area_km2 is None:
                # No area to divide by: the density is genuinely unknown, not 0.
                # prepare_data already writes None here; keep that.
                density = None
            else:
                density = round(count / area_km2, DENSITY_DECIMALS)

            if count >= 1 and (before == 0 or before is None) and density:
                rescued[metric] += 1
                rescued_pop[metric] += p.get("he_vakiy") or 0
            if before != density:
                changed[metric] += 1

            p[metric] = density

            count_key = COUNTED.get(metric)
            if count_key:
                # Written for every feature so the columnar encoder sees a stable
                # key set in a stable first-seen order across all 3,018 rows.
                p[count_key] = count if area_km2 is not None else None

    print("\nRescued from a false measured zero:")
    total = 0
    for metric in _dh.POI_METRICS:
        print(f"  {metric:<20} {rescued[metric]:>4} areas  "
              f"{rescued_pop[metric]:>10,} residents  "
              f"({changed[metric]} values changed)")
        total += rescued[metric]
    print(f"  {'TOTAL':<20} {total:>4} (metric, area) pairs")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"\nWrote {GEOJSON}")
    print("Next: npm run build:data")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
