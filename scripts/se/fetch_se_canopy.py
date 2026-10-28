#!/usr/bin/env python3
"""Tree canopy per Swedish DeSO area -> scripts/se/canopy_deso.json.

Finland's method and product (scripts/tcd_cdse.py): the mean Copernicus Tree Cover
Density 2018 (10 m) over every pixel inside the area, read from the CDSE S3 archive.
Measured against the shore-clipped polygons in public/data/se_deso.geojson, so the sea
SCB's own boundaries run out over does not dilute a coastal area's figure; lakes stay
inside, as in Finland's postal areas.

Needs CDSE S3 keys in CDSE_S3_ACCESS_KEY / CDSE_S3_SECRET_KEY.

Usage: python scripts/se/fetch_se_canopy.py
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import geopandas as gpd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from tcd_cdse import mean_tcd  # noqa: E402

GEOJSON = HERE.parent.parent / "public" / "data" / "se_deso.geojson"
OUT = HERE / "canopy_deso.json"


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    deso = gpd.read_file(GEOJSON)[["pno", "geometry"]]
    values = mean_tcd(deso, "pno", label="Sweden TCD")
    missing = len(deso) - len(values)
    if missing:
        raise SystemExit(f"{missing} DeSO areas got no mapped pixel")
    OUT.write_text(json.dumps({
        "source": "Copernicus HRL Tree Cover Density 2018, 10 m (CLMS VLCC release, CDSE)",
        "values": dict(sorted(values.items())),
    }, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}: {len(values)} DeSO areas", file=sys.stderr)


if __name__ == "__main__":
    main()
