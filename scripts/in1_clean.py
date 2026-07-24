#!/usr/bin/env python3
"""IN-1: one-time, network-free offline surgery over the committed GeoJSON to
purge fabricated / suppressed values that were shipping as real measurements.

Two deterministic mutations over public/data/metro_neighborhoods.geojson:

  1. Paavo -1 suppression sentinels -> null. Statistics Finland uses -1 as a
     confidentiality/suppression marker across every he_/ko_/hr_/tr_/te_/ra_/pt_/tp_
     column (plus pinta_ala). ~13,481 such values were leaking into
     region_properties.json, the open-data CSV and /api/v1 as if they were counts.
     The 3 derived *_change_pct metrics legitimately hold real -1.0 % values and are
     outside this prefix scope, so they are untouched.

  2. active_plan_count no-source zeros -> null. Only 5 municipalities publish a plan
     WFS; a 0 outside them means "no source", not "measured zero". Keep a count where
     it is > 0 (real, incl. national Vaylavirasto projects) OR the municipality is one
     of the 5 served cities (an honest measured 0); null the rest (~2,113 areas).

NOTE: an earlier revision of this script also nulled the fabricated 40.0 dB noise floor,
but that was intentionally reverted. Uncovered areas keep the 40 dB quiet-residential
baseline (the layer note states it is a modeled background level), pending a
distance-to-road/rail noise model. noise_pollution is exempted in validate_data.py's
DISTINCTNESS_EXEMPT accordingly, so this script no longer touches it.

This is a one-time correction of the already-committed source data. It is NOT part of
`npm run build:data` (which only reads the committed GeoJSON), so it does not affect
the build:data idempotency gate. After running this, run `npm run build:data` to
propagate the cleaned values into src/data, then
`python scripts/validate_data.py --write-baseline`.

The GeoJSON is rewritten with json.dump(data, f) using Python's DEFAULT serialization
(ensure_ascii=True, (', ', ': ') separators, no indent, no trailing newline) -- verified
byte-identical to the committed file on a no-op round-trip, so only the mutated values
change and `git diff` stays value-only.

Usage:
  python scripts/in1_clean.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEOJSON = ROOT / "public" / "data" / "metro_neighborhoods.geojson"
CITY_PLANS = Path(__file__).resolve().parent / "planning_raw" / "city_plans.geojson"

PAAVO_SUPPRESSION_PREFIXES = ("he_", "ko_", "hr_", "tr_", "te_", "ra_", "pt_", "tp_")


def _is_suppressed_key(key: str) -> bool:
    return key.startswith(PAAVO_SUPPRESSION_PREFIXES) or key == "pinta_ala"


def main() -> None:
    served = set(json.loads(CITY_PLANS.read_text(encoding="utf-8"))["_cities"])

    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)
    features = data["features"]

    neg1 = 0
    apc_nulled = 0
    for feat in features:
        props = feat["properties"]
        # 1. Paavo -1 suppression sentinels
        for key, val in list(props.items()):
            if (val == -1 or val == -1.0) and _is_suppressed_key(key):
                props[key] = None
                neg1 += 1
        # 2. active_plan_count no-source zeros
        apc = props.get("active_plan_count")
        if apc is not None and not (apc > 0 or props.get("municipality") in served):
            props["active_plan_count"] = None
            apc_nulled += 1

    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)

    # Post-conditions
    apc_nonnull = sum(
        1 for x in features if x["properties"].get("active_plan_count") is not None
    )
    remaining_neg1 = sum(
        1
        for x in features
        for k, v in x["properties"].items()
        if _is_suppressed_key(k) and (v == -1 or v == -1.0)
    )
    print(f"Paavo -1 sentinels nulled:                 {neg1}")
    print(f"active_plan_count no-source zeros nulled:  {apc_nulled} -> non-null {apc_nonnull}")
    print(f"remaining -1 under suppression prefixes:   {remaining_neg1}")
    assert remaining_neg1 == 0, "suppression sentinels remain under the prefix scope"
    assert apc_nonnull == 905, f"expected 905 active_plan_count non-null, got {apc_nonnull}"
    print("OK: post-conditions satisfied.")


if __name__ == "__main__":
    main()
