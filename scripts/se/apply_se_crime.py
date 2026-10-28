#!/usr/bin/env python3
"""Write Brå's crime figures (crime_kommun.json) into the committed se_deso.geojson.

build_se_geojson.py does the same on a full rebuild, but that needs the shore-clipped
boundary cache (git-ignored, refetched from SCB). This patches the committed file in
place: the same three properties from the same function (crime_props), placed where a
rebuild puts them (after water_proximity_m), so a later rebuild produces the same bytes.
The file is re-serialized exactly as build_se_geojson.py writes it, so `git diff` shows
values only.

Usage: python scripts/se/apply_se_crime.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_se_geojson import CRIME_KEYS, OUT, crime_props, load  # noqa: E402


def main() -> None:
    crime = load("crime_kommun.json")["kommuner"]
    fc = json.loads(OUT.read_text())
    filled = 0
    for f in fc["features"]:
        old = f["properties"]
        new = {}
        for k, v in old.items():
            if k in CRIME_KEYS:
                continue
            new[k] = v
            if k == "water_proximity_m":
                new.update(crime_props(crime, old["pno"]))
        if "water_proximity_m" not in old:
            raise SystemExit(f"{old['pno']}: no water_proximity_m to place the crime figures after")
        f["properties"] = new
        filled += new["violent_crime_rate"] is not None
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}: violent_crime_rate on {filled} of {len(fc['features'])} DeSO areas", file=sys.stderr)


if __name__ == "__main__":
    main()
