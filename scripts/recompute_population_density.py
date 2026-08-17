#!/usr/bin/env python3
"""Re-derive `population_density` at 2 decimals in the committed GeoJSON.

`prepare_data.py` rounded persons/km² to a whole number. Finland's northern postal
areas run to thousands of km², so that wrote **0 for areas that have residents** --
measured on the shipped artifact: 194 zeros, of which **177 have a population**,
including Inari Keskus (1,194 residents over 3,423 km², a real 0.35/km²) and Utsjoki
Keskus (639 over 2,859 km²). It is the same false zero POI_DENSITY_DECIMALS exists to
prevent, in the one density derived in-pipeline rather than fetched.

Unlike the three fetched service densities, this one needs NO network: both inputs
(`he_vakiy`, `pinta_ala`) are already committed on every feature, so the column is a
pure function of data in the file. `prepare_data.py` is patched to the same 2 decimals,
so a future full refresh reproduces these values.

Same offline propagation pass as `recompute_walkability.py` / `derive_qw1_layers.py`;
NOT part of `build:data`, so it does not affect the idempotency gate.

Serialized with `json.dump` defaults, byte-identical to the committed file on a no-op
round-trip, so the diff is exactly the changed values.

Usage: python scripts/recompute_population_density.py [--dry-run]
"""
import argparse
import json
import math
from pathlib import Path

GEOJSON = Path(__file__).resolve().parent.parent / "public" / "data" / "metro_neighborhoods.geojson"

# Mirrors prepare_data.py's population-density block.
DECIMALS = 2


def safe_val(v):
    """Mirror prepare_data.safe_val: None for a missing, suppressed (-1) or NaN value."""
    if v is None or v == -1 or v == -1.0:
        return None
    try:
        if math.isnan(v):
            return None
    except (TypeError, ValueError):
        pass
    return v


def density(props):
    pop = safe_val(props.get("he_vakiy"))
    area_m2 = safe_val(props.get("pinta_ala"))
    if pop is None or area_m2 is None or area_m2 <= 0:
        return None
    return round(pop / (area_m2 / 1_000_000), DECIMALS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report the change without writing")
    args = ap.parse_args()

    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)
    features = data["features"]

    before = [f["properties"].get("population_density") for f in features]
    after = [density(f["properties"]) for f in features]

    def inhabited_zeros(vals):
        return [
            i for i, v in enumerate(vals)
            if v == 0 and (safe_val(features[i]["properties"].get("he_vakiy")) or 0) > 0
        ]

    changed = sum(1 for a, b in zip(before, after) if a != b)
    bz, az = inhabited_zeros(before), inhabited_zeros(after)
    print(f"population_density over {len(features)} features -- {changed} values change")
    print(f"  inhabited areas reading 0/km2:  before {len(bz)}  ->  after {len(az)}")
    for i in sorted(bz, key=lambda i: -(features[i]['properties'].get('he_vakiy') or 0))[:3]:
        p = features[i]["properties"]
        print(f"    {p.get('pno')} {p.get('nimi')}: pop {p.get('he_vakiy')}, "
              f"{(p.get('pinta_ala') or 0) / 1e6:.0f} km2 -> {before[i]} becomes {after[i]}")

    if args.dry_run:
        print("dry run -- nothing written")
        return

    for i, feat in enumerate(features):
        feat["properties"]["population_density"] = after[i]
    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)

    # An area with residents can never be zero people per km2.
    assert not az, f"{len(az)} inhabited areas still read 0/km2"
    # Coverage must not move: this re-rounds, it does not add or drop values.
    assert sum(1 for v in after if v is not None) == sum(1 for v in before if v is not None), \
        "non-null coverage changed; this pass must only re-round"
    print("OK: post-conditions satisfied.")


if __name__ == "__main__":
    main()
