#!/usr/bin/env python3
"""Re-derive `walkability_index` in the committed GeoJSON from its six components.

Why this exists
---------------
`prepare_data.calculate_walkability` was fixed to score each component at its
MID-RANK percentile. The docstring of `_percentile_score` records what the old
`<=` scoring did: "299 areas whose six walkability components are all exactly 0
scored 76/100, and the national scale never went below 64."

That fix never reached the shipped artifact. `npm run build:data` only READS
`public/data/metro_neighborhoods.geojson` -- it never runs `prepare_data.py` --
so the pre-fix column survived every rebuild, byte-for-byte, and the idempotency
gate reproduced it faithfully. Measured before this script ran: min 64, max 100,
37 distinct values, 1,412 areas tied at exactly 76, and 208 areas with all six
components at zero displayed as 76/100 next to the "0 grocery stores, 0 schools,
0 healthcare" service counts on their own profile page.

This is the same offline propagation pass as `derive_qw1_layers.py` and
`in1_clean.py`: the canonical implementation stays in `prepare_data.py`, so a
future full refresh reproduces these values, and this script exists only to
bring the committed artifact into line without re-fetching every live source.
It is NOT part of `build:data`, so it does not affect the idempotency gate.

No new data is introduced. Every input column is already committed on every
feature; this only re-derives a column that is itself a function of them.

Serialized with `json.dump` defaults, which is byte-identical to the committed
file on a no-op round-trip (verified by md5), so the diff is exactly the changed
`walkability_index` values.

Usage: python scripts/recompute_walkability.py [--dry-run]
"""
import argparse
import json
import math
from pathlib import Path

GEOJSON = Path(__file__).resolve().parent.parent / "public" / "data" / "metro_neighborhoods.geojson"

# Mirrors prepare_data.calculate_walkability's `components` list, in order.
COMPONENTS = [
    "restaurant_density", "grocery_density", "transit_stop_density",
    "healthcare_density", "cycling_density", "school_density",
]

# prepare_data.calculate_walkability requires this many scoreable components
# before it will emit a value; below it the area is no-data, not a low score.
MIN_COMPONENTS = 3


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


def percentile_score(value, sorted_vals):
    """Mirror prepare_data.calculate_walkability._percentile_score (mid-rank).

    Counting ties as "less than or equal" puts a value at the TOP of its own tie
    block, so the most common value in a sparse metric scores as if it beat every
    area sharing it. Splitting the tie block puts it at the midpoint instead,
    which is what a percentile means.
    """
    if not sorted_vals or value is None:
        return None
    n = len(sorted_vals)
    count_lt = sum(1 for v in sorted_vals if v < value)
    count_eq = sum(1 for v in sorted_vals if v == value)
    return round((count_lt + count_eq / 2) / n * 100, 1)


def compute(features):
    """Return {index_in_features: walkability_index or None}, mirroring the pipeline."""
    comp_values = {}
    for comp in COMPONENTS:
        vals = []
        for feat in features:
            v = safe_val(feat["properties"].get(comp))
            if v is not None and v >= 0:
                vals.append(v)
        comp_values[comp] = sorted(vals) if vals else []

    out = {}
    for i, feat in enumerate(features):
        scores = []
        for comp in COMPONENTS:
            v = safe_val(feat["properties"].get(comp))
            if v is not None and comp_values[comp]:
                s = percentile_score(v, comp_values[comp])
                if s is not None:
                    scores.append(s)
        out[i] = round(sum(scores) / len(scores), 0) if len(scores) >= MIN_COMPONENTS else None
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report the change without writing")
    args = ap.parse_args()

    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)
    features = data["features"]

    before = [f["properties"].get("walkability_index") for f in features]
    values = compute(features)
    after = [values[i] for i in range(len(features))]

    changed = sum(1 for a, b in zip(before, after) if a != b)
    nn_before = [v for v in before if v is not None]
    nn_after = [v for v in after if v is not None]
    zero_idx = [
        i for i, feat in enumerate(features)
        if all((safe_val(feat["properties"].get(c)) or 0) == 0 for c in COMPONENTS)
    ]

    def describe(label, vals):
        print(f"  {label:7s} n={len(vals):4d}  min={min(vals):5.1f}  max={max(vals):5.1f}  "
              f"distinct={len(set(vals)):3d}  mode_count={max(vals.count(v) for v in set(vals))}")

    print(f"walkability_index over {len(features)} features -- {changed} values change")
    describe("before", nn_before)
    describe("after", nn_after)
    print(f"  areas with all {len(COMPONENTS)} components at zero: {len(zero_idx)}")
    print(f"    before: {sorted({before[i] for i in zero_idx})}")
    print(f"    after:  {sorted({after[i] for i in zero_idx})}")

    if args.dry_run:
        print("dry run -- nothing written")
        return

    for i, feat in enumerate(features):
        feat["properties"]["walkability_index"] = after[i]
    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)

    # Post-conditions: the pre-fix signature must be gone. The old column bottomed
    # out at 64 with 1,412 areas tied at 76; an all-zero area must now score at the
    # bottom of the scale rather than three-quarters of the way up it.
    assert len(nn_after) == len(features), f"expected full coverage, got {len(nn_after)}"
    assert min(nn_after) < 64, f"scale still floors at {min(nn_after)}"
    assert all(after[i] == min(nn_after) for i in zero_idx), \
        "areas with no measured amenities must score at the bottom of the scale"
    print("OK: post-conditions satisfied.")


if __name__ == "__main__":
    main()
