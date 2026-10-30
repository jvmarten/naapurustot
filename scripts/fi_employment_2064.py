#!/usr/bin/env python3
"""Offline surgery over the committed GeoJSON: Finland's employment rate on a 20–64 basis.

Same shape and conventions as scripts/data_honesty_2026_07.py: a one-time,
deterministic correction of already-committed source data, not part of
`npm run build:data`.

`employment_rate` was Paavo's employed / ALL residents (pt_tyoll / pt_vakiy),
babies and pensioners included — a median Finnish area read 41 % against 83.5 %
for a Swedish DeSO, whose figure is SCB's employed share of 20–64-year-olds. The
two shared one key and one map. This recomputes Finland's from the same Paavo
row as employed / residents aged 20–64 (prepare_data.fi_employment_rate), which
is SCB's and the EU's definition. Paavo does not split the employed by age, so
the numerator still holds working under-20s and over-64s: nationally 77.2 %
against ~74 % from StatFin 115w's by-age counts. Areas where the employed
outnumber the 20–64 population get no value.

The GeoJSON is rewritten with json.dump(data, f), Python's default serialization,
which is how the committed file is written.
"""
import json
import os
import sys

GEOJSON = os.path.join(os.path.dirname(__file__), "..", "public", "data", "metro_neighborhoods.geojson")

# Mirrors prepare_data.fi_employment_rate (that module needs geopandas to import).
AGE_BANDS_20_64 = (
    "he_20_24", "he_25_29", "he_30_34", "he_35_39", "he_40_44",
    "he_45_49", "he_50_54", "he_55_59", "he_60_64",
)


def _val(v):
    return None if v is None or v == -1 else v


def fi_employment_rate(props):
    employed = _val(props.get("pt_tyoll"))
    bands = [_val(props.get(k)) for k in AGE_BANDS_20_64]
    if employed is None or any(b is None for b in bands):
        return None
    pop_20_64 = sum(bands)
    if pop_20_64 <= 0 or employed > pop_20_64:
        return None
    return round(employed / pop_20_64 * 100, 1)


def main() -> int:
    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)
    changed = dropped = 0
    for feat in data["features"]:
        p = feat["properties"]
        new = fi_employment_rate(p)
        if new != p.get("employment_rate"):
            changed += 1
            if new is None:
                dropped += 1
        p["employment_rate"] = new
    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"employment_rate: {changed} areas changed, {dropped} left without a value")
    return 0


if __name__ == "__main__":
    sys.exit(main())
