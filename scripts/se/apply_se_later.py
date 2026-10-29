#!/usr/bin/env python3
"""Write rent, house prices, broadband, road accidents (kommun_layers.json) and road noise
(noise_deso.json) into the committed se_deso.geojson.

build_se_geojson.py does the same on a full rebuild, but that needs the shore-clipped
boundary cache (git-ignored, refetched from SCB). This patches the committed file in
place with the same function (later_props), placed where a rebuild puts it (after the
election figures, before walkability_index), so a later rebuild produces the same bytes.

Usage: python scripts/se/apply_se_later.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_se_geojson import ELECTION_KEYS, LATER_KEYS, OUT, later_props, load  # noqa: E402

ANCHOR = ELECTION_KEYS[-1]


def main() -> None:
    layers = load("kommun_layers.json")
    noise = load("noise_deso.json")
    district_of = load("deso_district.json")
    fc = json.loads(OUT.read_text())
    for f in fc["features"]:
        old = f["properties"]
        if ANCHOR not in old:
            raise SystemExit(f"{old['pno']}: no {ANCHOR} to place the new layers after")
        new = {}
        for k, v in old.items():
            if k in LATER_KEYS:
                continue
            new[k] = v
            if k == ANCHOR:
                new.update(later_props(layers, noise, district_of, old["pno"]))
        f["properties"] = new
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")
    n = len(fc["features"])
    for k in LATER_KEYS:
        print(f"{k}: {sum(f['properties'][k] is not None for f in fc['features'])} of {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
