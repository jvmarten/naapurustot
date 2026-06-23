#!/usr/bin/env python3
"""
Write the foreign-language municipal value AND the per-postal foreign-language
estimate time series into the committed metro_neighborhoods.geojson, in place.

Three foreign-language layers, three honestly-flagged properties:
  - foreign_language_pct          (NOT written here) real 2020 postal data, the
                                  only openly-published postal-code figure.
  - foreign_language_municipal_pct  the real LATEST-year municipal share (StatFin
                                  vaerak 159t) assigned flat to every postal code
                                  of the municipality (is_proxy: a real municipal
                                  figure shown at a finer granularity).
  - foreign_language_est_pct      the latest-year postal ESTIMATE (is_proxy), with
                                  foreign_language_history carrying the full
                                  [[2020, real], [2021, est], ...] series for the
                                  time slider.

Estimate method (years after 2020):
    est_pct_p(y) = clamp( pct_p(2020) * share_kunta(y) / share_kunta(2020), 0, 100 )
2020 is the real postal value; later years scale the real 2020 within-city
distribution by each municipality's real vaerak 159t share change. Statistics
Finland publishes no postal-code language data after the 2020 extract, so later
years can only be an estimate.

Inputs (committed):
  scripts/foreign_language_pct.json        {pno: pct}  real 2020 postal
  scripts/foreign_language_municipal.json  {kunta: {year: share}}  vaerak 159t

Outputs:
  public/data/metro_neighborhoods.geojson  (foreign_language_municipal_pct,
                                            foreign_language_est_pct,
                                            foreign_language_history per feature)
  scripts/foreign_language_history.json     {pno: [[year, value], ...]} — committed
                                            snapshot prepare_data.py joins on rebuild.

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
EST_PROP = "foreign_language_est_pct"
MUNI_PROP = "foreign_language_municipal_pct"
BASE_YEAR = "2020"


def latest_year_of(muni_series: dict[str, dict[str, float]]) -> str:
    """Latest reference year present across the municipal series (as a string)."""
    years = {int(y) for vals in muni_series.values() for y in vals}
    if not years:
        raise ValueError("Municipal series carries no years")
    return str(max(years))


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
    latest = latest_year_of(muni_series)
    print(
        f"Loaded {len(postal_2020)} postal 2020 values, "
        f"{len(muni_series)} municipal series (latest year {latest})"
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

    # Write the three properties into the GeoJSON (clear-then-set so absent → null).
    n_hist = n_est = n_muni = 0
    for feat in gj["features"]:
        p = feat["properties"]
        pno = p.get("pno") or p.get("postinumeroalue")
        kunta = pno_to_kunta.get(str(pno)) if pno is not None else None

        # Flat real municipal value (latest year), is_proxy.
        muni_val = muni_series.get(kunta, {}).get(latest) if kunta else None
        p[MUNI_PROP] = float(muni_val) if muni_val is not None else None
        if muni_val is not None:
            n_muni += 1

        # Estimate time series + its latest-year scalar, is_proxy.
        series = history.get(str(pno)) if pno is not None else None
        if series:
            p[HISTORY_PROP] = json.dumps(series)
            p[EST_PROP] = float(series[-1][1])
            n_hist += 1
            n_est += 1
        else:
            p[HISTORY_PROP] = None
            p[EST_PROP] = None

    GEOJSON.write_text(json.dumps(gj), encoding="utf-8")
    print(
        f"Applied {MUNI_PROP} ({n_muni}), {EST_PROP} ({n_est}), "
        f"{HISTORY_PROP} ({n_hist}) to {GEOJSON.name}."
    )


if __name__ == "__main__":
    main()
