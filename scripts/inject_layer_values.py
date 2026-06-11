#!/usr/bin/env python3
"""
Surgically inject or update a single property in the metro_neighborhoods GeoJSON
from a {pno: value} JSON file, preserving the file's exact byte formatting.

Why this exists: the canonical prepare_data.py pipeline re-fetches several live
sources (OSM/Overpass green spaces, Digitransit, HSY, ...) on every run, so a full
re-run is NOT reproducible offline and would drift many unrelated metrics. A pure
json round-trip with compact separators reproduces GDAL/fiona's GeoJSON output
byte-for-byte (verified: load → dump(separators=(',',':'), ensure_ascii=False)
yields an identical file), so this utility propagates one fetched layer into the
committed GeoJSON with a diff limited to exactly that property. The new source is
ALSO wired into prepare_data.py (load_/join_) so the canonical quarterly refresh
stays complete; this script is the offline propagation path. After running it, run
`npm run build:data` so the change reaches the src/data artifacts the app loads.

Value types are preserved as written in the values file (int stays int, float
stays float), matching how the rest of the GeoJSON stores numeric columns.

Usage:
  python scripts/inject_layer_values.py <property> <values.json>           # full replace; None where pno absent
  python scripts/inject_layer_values.py <property> <values.json> --merge   # only update present pno, keep the rest
"""
import argparse
import json
from pathlib import Path

GEOJSON = Path(__file__).parent.parent / "public" / "data" / "metro_neighborhoods.geojson"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("property")
    ap.add_argument("values")
    ap.add_argument("--merge", action="store_true",
                    help="only set values for postal codes present in the file; "
                         "leave existing values for the rest untouched")
    args = ap.parse_args()

    with open(args.values, encoding="utf-8") as f:
        values = {str(k): v for k, v in json.load(f).items()}

    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)

    matched = 0
    for feat in data["features"]:
        props = feat["properties"]
        pno = str(props.get("postinumeroalue") or props.get("pno") or "")
        if pno in values and values[pno] is not None:
            props[args.property] = values[pno]
            matched += 1
        elif not args.merge:
            props[args.property] = None

    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)

    print(f"Injected '{args.property}': {matched}/{len(data['features'])} features matched "
          f"({'merge' if args.merge else 'full-replace'} mode)")


if __name__ == "__main__":
    main()
