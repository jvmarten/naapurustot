#!/usr/bin/env python3
"""Write the layers added after Sweden's first release into the committed se_deso.geojson:
single-person households and building age (SCB), tree canopy (Copernicus) and EV
charging (OpenStreetMap).

build_se_geojson.py does the same on a full rebuild, but that needs the shore-clipped
boundary cache (git-ignored, refetched from SCB). This patches the committed file in
place with the same function (extra_props), placed where a rebuild puts it (after the
crime figures, before walkability_index), so a later rebuild produces the same bytes.

Usage: python scripts/se/apply_se_layers.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_se_geojson import CRIME_KEYS, OUT, extra_props, load  # noqa: E402

ANCHOR = CRIME_KEYS[-1]


def main() -> None:
    scb = load("scb_deso.json")["tables"]
    canopy = load("canopy_deso.json")
    osm = load("osm_deso.json")["counts"]
    fc = json.loads(OUT.read_text())
    for f in fc["features"]:
        old = f["properties"]
        deso = old["pno"]
        if ANCHOR not in old:
            raise SystemExit(f"{deso}: no {ANCHOR} to place the new layers after")
        extra = extra_props(scb["households"]["data"].get(deso, {}),
                            scb["building_age"]["data"].get(deso, {}),
                            canopy, osm, old["pinta_ala"], deso)
        new = {}
        for k, v in old.items():
            if k in extra:
                continue
            new[k] = v
            if k == ANCHOR:
                new.update(extra)
        f["properties"] = new
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")
    n = len(fc["features"])
    for k in ("single_person_hh_pct", "avg_construction_year", "tree_canopy_pct", "tree_canopy_history",
              "ev_charging_density"):
        print(f"{k}: {sum(f['properties'][k] is not None for f in fc['features'])} of {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
