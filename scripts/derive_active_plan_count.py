#!/usr/bin/env python3
"""
CF-5: derive the per-postal "kaavoitus- ja hankeaktiivisuus" (planning &
development activity) count from the already-committed, geometry-derived
planning data and emit a {pno: count} snapshot.

`active_plan_count` for a postal code = the number of distinct kaavat & hankkeet
(municipal vireillä asemakaavat + Väylävirasto state projects) that geometrically
intersect that postal polygon. That intersection is computed network-free by
build_planning_data.mjs, whose output `scripts/area_planning.json` is a
{pno: [entries...]} map; the count is simply `len(entries)` (0 when the pno is
absent). This is REAL geometry-derived, sub-postal data — NOT a municipality
proxy — so it is flagged is_proxy:false in data_sources.json.

IN-1: a postal code gets a real count where planning is nearby (>0) or where its
municipality is one of the 5 that publish a plan WFS (an honest measured 0). Every
other 0 means "no source for this municipality" and is emitted as null, not a
fabricated zero. The pno universe is taken from the committed GeoJSON so the
snapshot covers exactly the same areas the app loads.

Output: scripts/active_plan_count.json — a {pno: int} snapshot (all pnos, sorted,
indent=2, ensure_ascii=False), mirroring scripts/construction_activity.json. It is
joined back in by prepare_data.py (full refresh) and injected into the committed
GeoJSON via inject_layer_values.py (offline propagation); after running this,
inject + `npm run build:data` so the change reaches the src/data artifacts.

Build-order note: build_planning_data.mjs (which produces area_planning.json) runs
LAST inside `npm run build:data`, AFTER build_region_data reads the GeoJSON. Because
area_planning.json is deterministic from the committed planning_raw fetches, its
counts are stable, so injecting the counts into the GeoJSON before build:data is
consistent with what the next area_planning.json regeneration produces.

Usage:
  python scripts/derive_active_plan_count.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
AREA_PLANNING = Path(__file__).parent / "area_planning.json"
GEOJSON = ROOT / "public" / "data" / "metro_neighborhoods.geojson"
CITY_PLANS = Path(__file__).parent / "planning_raw" / "city_plans.geojson"
OUT = Path(__file__).parent / "active_plan_count.json"


def main() -> None:
    with open(AREA_PLANNING, encoding="utf-8") as f:
        area_planning = json.load(f)
    counts = {str(pno): len(entries) for pno, entries in area_planning.items()}

    # IN-1: only the municipalities that publish a plan WFS have a real "0 = no plan
    # nearby". Elsewhere a 0 just means "no source for this municipality" and must be
    # null. A positive count is always real (incl. national Vaylavirasto projects).
    served = set(json.loads(CITY_PLANS.read_text(encoding="utf-8"))["_cities"])

    with open(GEOJSON, encoding="utf-8") as f:
        geo = json.load(f)

    result: dict[str, int | None] = {}
    for feat in geo["features"]:
        props = feat["properties"]
        pno = str(props.get("postinumeroalue") or props.get("pno") or "")
        if not pno:
            continue
        c = int(counts.get(pno, 0))
        result[pno] = c if (c > 0 or props.get("municipality") in served) else None

    result = dict(sorted(result.items()))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")

    values = [v for v in result.values() if v is not None]
    nonzero = sum(1 for v in values if v > 0)
    mx = max(values) if values else 0
    print(
        f"Wrote {OUT.name}: {len(result)} postal codes "
        f"({len(values)} with a value, {nonzero} > 0, "
        f"{len(result) - len(values)} null no-source, max {mx})."
    )


if __name__ == "__main__":
    main()
