#!/usr/bin/env python3
"""Write the two crime sub-group layers into the committed GeoJSON.

Offline surgery in the same shape as scripts/in1_clean.py and
scripts/data_honesty_2026_07.py: `npm run build:data` only ever reads the
committed GeoJSON, so this is not part of it and does not affect the build:data
idempotency gate.

Adds `violent_crime_rate` and `property_crime_rate` from the files
fetch_crime_index.py writes. Both are municipal figures shown on postal
geography — Finland publishes no crime statistic below municipality level — and
both are withheld below a population floor, so ~183 postal codes in the 57
smallest municipalities carry null and render as "low data" grey.

`crime_index` (total offences) is left exactly as it is: it stays a browsable
layer, it just stops being what "Turvallisuus" means.

The GeoJSON is rewritten with json.dump(data, f) — Python's DEFAULT
serialization — which is byte-identical to the committed file on a no-op round
trip, so `git diff` stays value-only.

Usage:
  python scripts/apply_crime_categories.py [--dry-run]
"""

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
GEOJSON = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"

SOURCES = {
    "violent_crime_rate": SCRIPT_DIR / "crime_violent.json",
    "property_crime_rate": SCRIPT_DIR / "crime_property.json",
}


def load(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rates = {prop: load(path) for prop, path in SOURCES.items()}
    data = load(GEOJSON)
    features = data["features"]
    print(f"Loaded {len(features)} features")

    stats = {p: {"set": 0, "null": 0} for p in SOURCES}
    for f in features:
        p = f["properties"]
        pno = p.get("pno")
        if not pno:
            continue
        for prop, table in rates.items():
            value = table.get(pno)
            if value is None:
                # Below the population floor, or the municipality has no figure.
                # Null rather than absent keeps the property present on every
                # record, which is what the columnar artifact expects.
                if p.get(prop) is not None or prop not in p:
                    p[prop] = None
                    stats[prop]["null"] += 1
            else:
                if p.get(prop) != value:
                    p[prop] = value
                stats[prop]["set"] += 1

    for prop, s in stats.items():
        pct = s["set"] / len(features) * 100
        print(f"  {prop:<22} {s['set']:>5} with a value ({pct:.1f}%), {s['null']:>4} withheld")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"\nWrote {GEOJSON}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
