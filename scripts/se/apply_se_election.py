#!/usr/bin/env python3
"""Write the 2026 Riksdag election (election_deso.json) into the committed se_deso.geojson.

build_se_geojson.py does the same on a full rebuild, but that needs the shore-clipped
boundary cache (git-ignored, refetched from SCB). This patches the committed file in
place with the same function (election_props), placed where a rebuild puts it (after
ev_charging_density, before walkability_index), so a later rebuild produces the same bytes.

Usage: python scripts/se/apply_se_election.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_se_geojson import ELECTION_KEYS, OUT, election_props, load  # noqa: E402

ANCHOR = "ev_charging_density"


def main() -> None:
    election = load("election_deso.json")
    fc = json.loads(OUT.read_text())
    for f in fc["features"]:
        old = f["properties"]
        if ANCHOR not in old:
            raise SystemExit(f"{old['pno']}: no {ANCHOR} to place the election figures after")
        new = {}
        for k, v in old.items():
            if k in ELECTION_KEYS:
                continue
            new[k] = v
            if k == ANCHOR:
                new.update(election_props(election, old["pno"]))
        f["properties"] = new
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")
    n = len(fc["features"])
    for k in ELECTION_KEYS:
        print(f"{k}: {sum(f['properties'][k] is not None for f in fc['features'])} of {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
