#!/usr/bin/env python
"""
IN-1: Fetch national infrastructure projects (hankkeet) from the Väylävirasto
(FTIA) OGC API Features endpoint and write a normalized GeoJSON that the planning
builder (build_planning_data.mjs) shards into the app.

Scope: STATE road / rail / waterway projects only — this is genuinely national
today (every area in Finland gets real content). It deliberately EXCLUDES
municipal trams / light rail and city development (those come from the per-city
zoning feeds in fetch_city_zoning.py).

License: CC BY 4.0 — © Väylävirasto / Finnish Transport Infrastructure Agency.

The API returns GeoJSON in lon/lat (WGS84) by default, with 3D coordinates (the
Z ordinate is dropped). Each collection is < 600 features, so a single
limit=10000 request fetches it whole. Output is committed so the node builder in
`build:data` stays network-free; re-run on the quarterly data refresh.
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://avoinapi.vaylapilvi.fi/vaylatiedot/ogc/features/v1"

# collection id -> (canonical type, Finnish subtype label)
COLLECTIONS = {
    "hanketiedot:tiehankkeet": ("road", "Tiehanke"),
    "hanketiedot:ratahankkeet": ("rail", "Ratahanke"),
    "hanketiedot:vesivaylahankkeet": ("waterway", "Vesiväylähanke"),
}

OUT = Path(__file__).parent / "planning_raw" / "vayla_projects.geojson"
# Stamped with the fetch date so build_planning_data.mjs derives the planning
# snapshot from real data vintage (deterministic), not the build-time clock.
SNAPSHOT = Path(__file__).parent / "planning_raw" / "snapshot.txt"
FALLBACK_URL = "https://vayla.fi/hankkeet"


def fetch_collection(coll: str) -> dict:
    url = f"{BASE}/collections/{coll}/items?limit=10000&f=json"
    req = urllib.request.Request(url, headers={"User-Agent": "naapurustot-data/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def year_of(v) -> str | None:
    """aloitus/lopetus is sometimes a 4-char year, sometimes an ISO datetime."""
    if not v:
        return None
    s = str(v).strip()
    return s[:4] if s[:4].isdigit() else None


def strip_z(geom: dict) -> dict:
    """Drop the 3rd (elevation) ordinate so the output is 2D GeoJSON."""
    def walk(c):
        if c and isinstance(c[0], (int, float)):
            return [c[0], c[1]]
        return [walk(x) for x in c]

    g = dict(geom)
    g["coordinates"] = walk(geom["coordinates"])
    return g


def main() -> int:
    out_features = []
    for coll, (ptype, label) in COLLECTIONS.items():
        try:
            fc = fetch_collection(coll)
        except Exception as e:  # noqa: BLE001 — one bad collection must not kill the rest
            print(f"  WARN {coll}: {e}", file=sys.stderr)
            continue
        feats = fc.get("features", [])
        print(f"  {coll}: {len(feats)} features")
        for f in feats:
            p = f.get("properties", {}) or {}
            name = (p.get("nimi") or "").strip()
            geom = f.get("geometry")
            if not name or not geom or not geom.get("coordinates"):
                continue
            start, end = year_of(p.get("aloitus")), year_of(p.get("lopetus"))
            date = "–".join([x for x in (start, end) if x]) or None
            url = (p.get("linkki") or "").strip() or None
            out_features.append({
                "type": "Feature",
                "geometry": strip_z(geom),
                "properties": {
                    "name": name,
                    "kind": "project",
                    "ptype": ptype,          # road / rail / waterway
                    "subtype": label,        # Finnish project-type label
                    "status": "kaynnissa",   # ongoing (collection excludes paattyneet_hankkeet)
                    "date": date,            # "2022–2028" / "2025" / None
                    "url": url or FALLBACK_URL,
                    "source": "Väylävirasto",
                },
            })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": out_features}, ensure_ascii=False),
        encoding="utf-8",
    )
    # Advance the planning snapshot only on a successful fetch, so a failed/empty
    # run can't push the "tilanne <snapshot>" caption past the data it actually has.
    if out_features:
        SNAPSHOT.write_text(datetime.now(timezone.utc).date().isoformat() + "\n", encoding="utf-8")
    print(f"Wrote {len(out_features)} Väylä project features -> {OUT.relative_to(Path.cwd())}")
    return 0 if out_features else 1


if __name__ == "__main__":
    raise SystemExit(main())
