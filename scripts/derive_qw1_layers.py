#!/usr/bin/env python3
"""QW-1: bake the two derived Paavo layers into the committed GeoJSON.

Two ratios, derived from Paavo columns already present on every shipped feature:
  low_income_pct       = hr_pi_tul / hr_tuy * 100   -- share of households in the lowest
                         national income decile (higher = worse).
  job_self_sufficiency = tp_tyopy / pt_tyoll * 100  -- jobs located in the area per 100
                         employed residents (>100 = net job importer / employment hub,
                         <100 = commuter / residential area). Diverging around 100.

`npm run build:data` only READS this committed GeoJSON (it never runs prepare_data.py), so
these derived fields must be baked in by this one-time offline pass -- exactly like
scripts/in1_clean.py. prepare_data.py::calculate_metrics is patched to compute the identical
values via safe_div, so a future full refresh reproduces the same bytes. This script is NOT
part of build:data, so it does not affect the build:data idempotency gate.

Serialized with json.dump defaults (ensure_ascii=True, (', ',': ') separators, no indent /
trailing newline) -- byte-identical to the committed file on a no-op round-trip, so the git
diff is exactly the two new key/value pairs appended to each feature's properties.

Usage: python scripts/derive_qw1_layers.py
"""
import json
from pathlib import Path

GEOJSON = Path(__file__).resolve().parent.parent / "public" / "data" / "metro_neighborhoods.geojson"


def sdiv(a, b):
    """Match prepare_data.safe_div: None on a missing/-1 operand or a zero denominator;
    otherwise round(a / b * 100, 1)."""
    a = None if a in (None, -1, -1.0) else a
    b = None if b in (None, -1, -1.0) else b
    if a is None or b is None or b == 0:
        return None
    return round(a / b * 100, 1)


def main() -> None:
    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)
    features = data["features"]
    for feat in features:
        p = feat["properties"]
        p["low_income_pct"] = sdiv(p.get("hr_pi_tul"), p.get("hr_tuy"))
        p["job_self_sufficiency"] = sdiv(p.get("tp_tyopy"), p.get("pt_tyoll"))
    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)

    li = sum(1 for x in features if x["properties"].get("low_income_pct") is not None)
    js = sum(1 for x in features if x["properties"].get("job_self_sufficiency") is not None)
    print(f"low_income_pct non-null:       {li}")
    print(f"job_self_sufficiency non-null: {js}")
    assert li == 2927, f"expected 2927 low_income_pct, got {li}"
    assert js == 2937, f"expected 2937 job_self_sufficiency, got {js}"
    print("OK: post-conditions satisfied.")


if __name__ == "__main__":
    main()
