#!/usr/bin/env python3
"""Write night-time light (light_deso.json) into the committed se_deso.geojson.

build_se_geojson.py does the same on a full rebuild, but that needs the shore-clipped
boundary cache (git-ignored, refetched from SCB). This patches the committed file in
place with the same function (light_props), placed where a rebuild puts it (after the
extra2_props figures, before walkability_index), so a later rebuild produces the same bytes.

Usage: python scripts/se/apply_se_light.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_se_geojson import EXTRA_KEYS, LIGHT_KEYS, OUT, light_props, load  # noqa: E402

ANCHOR = EXTRA_KEYS[-1]


def main() -> None:
    light = load("light_deso.json")
    fc = json.loads(OUT.read_text())
    for f in fc["features"]:
        old = f["properties"]
        if ANCHOR not in old:
            raise SystemExit(f"{old['pno']}: no {ANCHOR} to place the new layers after")
        new = {}
        for k, v in old.items():
            if k in LIGHT_KEYS:
                continue
            new[k] = v
            if k == ANCHOR:
                new.update(light_props(light, old["pno"]))
        f["properties"] = new
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")
    n = len(fc["features"])
    for k in LIGHT_KEYS:
        print(f"{k}: {sum(f['properties'][k] is not None for f in fc['features'])} of {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
