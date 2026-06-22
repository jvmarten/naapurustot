#!/usr/bin/env python3
"""
Write the municipal foreign-language share (foreign_language_municipal_pct) into
the committed metro_neighborhoods.geojson, in place.

Source: scripts/foreign_language_municipal.json — {pno: share%}, the latest
Statistics Finland municipal "share of foreign-language speakers" (vaerak 159t)
assigned to each postal code (fetch_foreign_language_municipal.py). This is a
municipality figure distributed to a finer granularity than the source publishes
(is_proxy:true); it complements, and never replaces, the real postal-code 2020
foreign_language_pct layer.

This mirrors the join that prepare_data.py performs during a full pipeline rebuild
(_join_pno_value into "foreign_language_municipal_pct"); both read the same JSON
artifact, so the committed GeoJSON stays consistent with a refresh.

Run `npm run build:data` afterwards to regenerate src/data artifacts.
"""

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
GEOJSON = ROOT / "public" / "data" / "metro_neighborhoods.geojson"
DATA_FILE = Path(__file__).parent / "foreign_language_municipal.json"

PROP = "foreign_language_municipal_pct"


def main():
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    print(f"Loaded {len(data)} postal-code foreign-language values")

    gj = json.loads(GEOJSON.read_text(encoding="utf-8"))
    n = 0
    for feat in gj["features"]:
        p = feat["properties"]
        pno = p.get("pno") or p.get("postinumeroalue")
        val = data.get(str(pno)) if pno is not None else None
        # Clear-then-set so a postcode with no data is null, not stale.
        p[PROP] = float(val) if val is not None else None
        if val is not None:
            n += 1

    GEOJSON.write_text(json.dumps(gj), encoding="utf-8")
    print(f"Applied {PROP} to {n} postal codes. Wrote {GEOJSON.name}.")


if __name__ == "__main__":
    main()
