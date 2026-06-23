#!/usr/bin/env python3
"""
Derive a per-postal-code foreign-language-speaker time series (2020..latest) and
write it into the committed metro_neighborhoods.geojson, in place.

Method (a municipality-distributed estimate; is_proxy:true):
  - 2020 is REAL postal-code data (scripts/foreign_language_pct.json, Statistics
    Finland via OKM) — the only openly-usable postal-code language figure.
  - For each later year y, every postal code's value is its real 2020 value scaled
    by how its municipality's foreign-language share changed:

        est_pct_p(y) = clamp( pct_p(2020) * share_kunta(y) / share_kunta(2020), 0, 100 )

    where share_kunta(y) is the municipal "share of foreign-language speakers, %"
    from StatFin vaerak 159t (scripts/foreign_language_municipal.json, written by
    fetch_foreign_language_municipal.py). This preserves the real 2020 within-city
    distribution and moves the level by the real municipal change. It is an
    ESTIMATE for years after 2020 (Statistics Finland publishes no postal-code
    language data after the 2020 extract), hence is_proxy:true.

Outputs written:
  - public/data/metro_neighborhoods.geojson, properties per feature:
      foreign_language_history          JSON "[[2020, real], [2021, est], ...]"
      foreign_language_municipal_pct    latest year's estimate (scalar snapshot)
  - scripts/foreign_language_history.json  {pno: [[year, value], ...]} — the
    committed snapshot prepare_data.py joins during a full pipeline rebuild
    (mirrors the join here so the GeoJSON stays consistent with a refresh).

The real 2020 postal layer (foreign_language_pct) is left untouched and remains
is_proxy:false; this estimate complements, never replaces, it.

Run `npm run build:data` afterwards to regenerate src/data artifacts.
"""

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
GEOJSON = ROOT / "public" / "data" / "metro_neighborhoods.geojson"
POSTAL_2020_FILE = Path(__file__).parent / "foreign_language_pct.json"
MUNICIPAL_SERIES_FILE = Path(__file__).parent / "foreign_language_municipal.json"
HISTORY_OUT_FILE = Path(__file__).parent / "foreign_language_history.json"

HISTORY_PROP = "foreign_language_history"
SCALAR_PROP = "foreign_language_municipal_pct"
BASE_YEAR = "2020"


def build_postal_history(
    postal_2020: dict[str, float],
    muni_series: dict[str, dict[str, float]],
    pno_to_kunta: dict[str, str],
) -> dict[str, list[list[float]]]:
    """Derive {pno: [[year, value], ...]} for every postal code that has a real
    2020 value and a municipality with a usable share series."""
    history: dict[str, list[list[float]]] = {}
    skipped_no_kunta = skipped_no_series = skipped_no_base = 0

    for pno, v0 in postal_2020.items():
        if v0 is None:
            continue
        kunta = pno_to_kunta.get(str(pno))
        if kunta is None:
            skipped_no_kunta += 1
            continue
        series = muni_series.get(kunta)
        if not series:
            skipped_no_series += 1
            continue
        base = series.get(BASE_YEAR)
        if base is None or base <= 0:
            skipped_no_base += 1
            continue

        v0 = float(v0)
        points: list[list[float]] = []
        for year in sorted(series, key=int):
            if year == BASE_YEAR:
                val = round(v0, 1)
            else:
                ratio = series[year] / base
                val = round(min(max(v0 * ratio, 0.0), 100.0), 1)
            points.append([int(year), val])

        if len(points) >= 2:
            history[str(pno)] = points

    print(
        f"  Derived history for {len(history)} postal codes "
        f"(skipped: {skipped_no_kunta} no-kunta, {skipped_no_series} no-series, "
        f"{skipped_no_base} no-2020-base)"
    )
    return history


def main():
    postal_2020 = json.loads(POSTAL_2020_FILE.read_text(encoding="utf-8"))
    muni_series = json.loads(MUNICIPAL_SERIES_FILE.read_text(encoding="utf-8"))
    print(
        f"Loaded {len(postal_2020)} postal 2020 values, "
        f"{len(muni_series)} municipal series"
    )

    gj = json.loads(GEOJSON.read_text(encoding="utf-8"))

    # pno -> 3-digit kunta code, from the GeoJSON itself.
    pno_to_kunta: dict[str, str] = {}
    for feat in gj["features"]:
        p = feat.get("properties", {})
        pno = p.get("pno") or p.get("postinumeroalue")
        kunta = p.get("kunta")
        if pno is not None and kunta is not None:
            pno_to_kunta[str(pno)] = str(kunta).zfill(3)

    history = build_postal_history(postal_2020, muni_series, pno_to_kunta)

    # Persist the committed snapshot prepare_data.py consumes on a full rebuild.
    sorted_history = {pno: history[pno] for pno in sorted(history)}
    HISTORY_OUT_FILE.write_text(
        json.dumps(sorted_history, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Wrote {len(sorted_history)} entries to {HISTORY_OUT_FILE.name}")

    # Write both properties into the GeoJSON (clear-then-set so absent codes are null).
    n_hist = n_scalar = 0
    for feat in gj["features"]:
        p = feat["properties"]
        pno = p.get("pno") or p.get("postinumeroalue")
        series = history.get(str(pno)) if pno is not None else None
        if series:
            p[HISTORY_PROP] = json.dumps(series)
            p[SCALAR_PROP] = float(series[-1][1])
            n_hist += 1
            n_scalar += 1
        else:
            p[HISTORY_PROP] = None
            p[SCALAR_PROP] = None

    GEOJSON.write_text(json.dumps(gj), encoding="utf-8")
    print(
        f"Applied {HISTORY_PROP} ({n_hist}) and {SCALAR_PROP} ({n_scalar}) "
        f"to {GEOJSON.name}."
    )


if __name__ == "__main__":
    main()
