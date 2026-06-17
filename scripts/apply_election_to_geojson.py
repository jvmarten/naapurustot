#!/usr/bin/env python3
"""
Write the 2023 parliamentary election voting-preference metrics into the
committed metro_neighborhoods.geojson, in place.

Two real-data tiers, no income proxy:
  * Tier A (national): each municipality's real result, applied to every postal
    code in that municipality. For the 251 of 309 municipalities where a polling
    precinct already spans several postal codes (e.g. Salla = 1 precinct / 14
    postal codes), this IS the finest resolution the data has — not a proxy.
    Source: scripts/election_municipal.json (fetch_election_results.py).
  * Tier B (sub-municipal): for the cities that publish current polling-precinct
    boundaries, precinct results are apportioned to postal codes and override
    Tier A. Source: scripts/election_submunicipal.json — OPTIONAL, applied only
    where present (produced by the sub-municipal refinement step).

This mirrors the join that prepare_data.py performs during a full pipeline
rebuild (see join_election_data there); both read the same JSON artifacts and
apply the same precedence (sub-municipal over municipal), so the committed
GeoJSON stays consistent with a quarterly refresh.

Run `npm run build:data` afterwards to regenerate src/data artifacts.
"""

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
GEOJSON = ROOT / "public" / "data" / "metro_neighborhoods.geojson"
MUNI_FILE = Path(__file__).parent / "election_municipal.json"
SUB_FILE = Path(__file__).parent / "election_submunicipal.json"

# Surfaced party-share properties: party abbreviation -> GeoJSON property name.
PARTY_PROPS = {
    "KOK": "party_vote_kok_pct", "SDP": "party_vote_sdp_pct",
    "PS": "party_vote_ps_pct", "KESK": "party_vote_kesk_pct",
    "VIHR": "party_vote_vihr_pct", "VAS": "party_vote_vas_pct",
    "RKP": "party_vote_rkp_pct",
}
ALL_PROPS = ["voter_turnout_pct", "party_diversity_index",
             "political_lean_index", *PARTY_PROPS.values()]


def _metrics_to_props(m: dict) -> dict:
    """Map an election metrics record to GeoJSON property values."""
    party = m.get("party", {})
    out = {
        "voter_turnout_pct": m.get("turnout_pct"),
        "party_diversity_index": m.get("competitiveness"),
        "political_lean_index": m.get("lean"),
    }
    for abbr, prop in PARTY_PROPS.items():
        out[prop] = party.get(abbr)
    return out


def main():
    muni = json.loads(MUNI_FILE.read_text(encoding="utf-8"))
    sub = json.loads(SUB_FILE.read_text(encoding="utf-8")) if SUB_FILE.exists() else {}
    print(f"Loaded {len(muni)} municipalities"
          + (f", {len(sub)} sub-municipal postal codes" if sub else " (no sub-municipal tier)"))

    gj = json.loads(GEOJSON.read_text(encoding="utf-8"))
    n_muni = n_sub = 0
    for feat in gj["features"]:
        p = feat["properties"]
        kunta, pno = p.get("kunta"), p.get("pno")

        # Default: clear all election props (so a postcode with no data is null,
        # not stale).
        for prop in ALL_PROPS:
            p[prop] = None

        m = muni.get(kunta)
        if m:
            p.update(_metrics_to_props(m))
            n_muni += 1

        s = sub.get(pno)
        if s:
            p.update(_metrics_to_props(s))
            n_sub += 1

    GEOJSON.write_text(json.dumps(gj), encoding="utf-8")
    print(f"Applied municipal tier to {n_muni} postal codes, "
          f"sub-municipal override to {n_sub}. Wrote {GEOJSON.name}.")


if __name__ == "__main__":
    main()
