#!/usr/bin/env python3
"""Air quality index per Swedish DeSO area from FMI's SILAM model -> scripts/se/air_quality_deso.json.

The same pipeline as Finland's nationwide fill-in (scripts/fetch_air_quality_silam.py,
whose functions this reuses): SILAM Europe surface PM2.5 and NO2, each turned into the
Finnish hourly AQI sub-index, the worse of the two taken per ~5–10 km grid cell, and the
cell under each area sampled onto the same 0–100 scale (higher = worse air). Finland's
city-scale models (HSY ENFUSER, Tampere, Turku) have no Swedish counterpart here, so every
Swedish value is SILAM's, and like Finland's SILAM values it is flagged `is_proxy`.

A DeSO is sampled at its representative point (the `lat`/`lon` build_se_geojson.py
writes, always inside the polygon). The forecast hour fetched is recorded as `valid_time`:
SILAM is a forecast of one hour's weather-driven concentrations, not an annual mean.

Usage: python scripts/se/fetch_se_air_quality.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import fetch_air_quality_silam as silam  # noqa: E402

GEOJSON = HERE.parent.parent / "public" / "data" / "se_deso.geojson"
OUT = HERE / "air_quality_deso.json"
SWEDEN_BBOX = "10.5,55.0,24.5,69.5"


def main() -> None:
    feats = json.loads(GEOJSON.read_text())["features"]
    centroids = [{"pno": f["properties"]["pno"], "lat": f["properties"]["lat"], "lon": f["properties"]["lon"]}
                 for f in feats]
    valid = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    grid = None
    stack = []
    for sp, thresholds in silam.SPECIES_THRESHOLDS.items():
        data = silam.fetch_silam_species(sp, SWEDEN_BBOX)
        parsed = data and silam.parse_silam_netcdf(data)
        if not parsed:
            raise SystemExit(f"SILAM {sp}: no data — refusing to write a partial index")
        lats, lons, conc = parsed
        if grid is None:
            grid = (lats, lons)
        elif lats.shape != grid[0].shape or lons.shape != grid[1].shape:
            raise SystemExit(f"SILAM {sp}: grid differs from the first species")
        stack.append(silam.concentration_to_subindex(conc, thresholds))
    composite = np.nanmax(np.stack(stack), axis=0)
    sampled = silam.sample_grid(centroids, grid[0], grid[1], composite)
    if len(sampled) != len(centroids):
        raise SystemExit(f"sampled {len(sampled)} of {len(centroids)} DeSO areas — refusing to write")
    values = {pno: round(silam.fmi_index_to_aq_scale(v), 1) for pno, v in sorted(sampled.items())}
    OUT.write_text(json.dumps({
        "source": "FMI SILAM Europe surface forecast (silamaq_europe_surface), PM2.5 + NO2",
        "valid_time": valid.strftime("%Y-%m-%dT%H:%MZ"),
        "values": values,
    }, separators=(",", ":"), sort_keys=True) + "\n")
    v = sorted(values.values())
    print(f"wrote {OUT}: {len(v)} areas, min {v[0]}, median {v[len(v) // 2]}, max {v[-1]}", file=sys.stderr)


if __name__ == "__main__":
    main()
