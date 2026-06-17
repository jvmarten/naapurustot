#!/usr/bin/env python3
"""
Fetch 2023 parliamentary election (eduskuntavaalit, EKV-2023) results from
Statistics Finland's StatFin PxWeb "evaa" database, at MUNICIPALITY level for
all of Finland, and derive real voting-preference metrics.

This replaces the previous approach (fetch_voter_turnout.py), which fetched
per-precinct party votes only to collapse them into a single Shannon-diversity
scalar and then spread municipality means across postal codes using income as a
proxy. Here we keep the actual per-party signal.

Sources (CC BY 4.0, "Tilastokeskus, eduskuntavaalit 2023"):
- evaa 13t2: Puolueiden kannatus äänestysalueittain (party votes), KU* rollups
- evaa 13sx: Äänestystiedot äänestysalueittain (turnout), KU* rollups

Geography: Statistics Finland publishes election results down to äänestysalue
(polling precinct), but the open building register that historically linked
precincts to postal codes no longer carries the precinct field, so a national
precinct->postal crosswalk is not reproducible from current open data. We
therefore ingest at MUNICIPALITY granularity nationally (flagged is_proxy /
granularity=municipal). A separate step refines the largest cities to
sub-municipal resolution where current open precinct geometry exists.

Output: scripts/election_municipal.json keyed by municipality code, e.g.
  {"091": {"turnout_pct": 70.9, "lean": 58.1, "competitiveness": 0.78,
           "party": {"KOK": 28.4, "VIHR": 18.0, ...}}, ...}
"""

import json
import logging
import math
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent
PARTY_TABLE = "https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/evaa/13t2.px"
TURNOUT_TABLE = "https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/evaa/13sx.px"

# Parties surfaced as their own layers (the ones with material national support
# in 2023). Statistics Finland party codes -> abbreviation.
MAIN_PARTIES = {
    "03": "KOK", "02": "PS", "01": "SDP", "04": "KESK",
    "05": "VIHR", "06": "VAS", "07": "RKP", "08": "KD",
}

# Left–right positions for the derived political-lean index, 0 (left) – 10
# (right), from the 2019 Chapel Hill Expert Survey general left–right (lrgen)
# placement of Finnish parties. Used as a transparent, weighted average; the
# index itself is a derived metric, not fetched data.
PARTY_LR = {
    "VAS": 1.6, "VIHR": 3.2, "SDP": 3.6, "RKP": 6.0,
    "KESK": 5.8, "KD": 6.9, "KOK": 7.4, "PS": 8.2, "LIIKE": 7.0,
}
# All party codes -> abbrev (for totals / lean / competitiveness over the full
# field, not just the surfaced ones).
ALL_PARTY_ABBR = {
    "03": "KOK", "02": "PS", "01": "SDP", "04": "KESK", "05": "VIHR",
    "06": "VAS", "07": "RKP", "08": "KD", "09": "LIIKE", "10": "LIBE",
    "11": "Piraattip.", "12": "EOP", "14": "FP", "15": "KaL", "16": "KL",
    "17": "SKE", "19": "AP", "20": "SKP", "21": "KRIP", "22": "VKK",
    "23": "VL", "24": "SML", "99": "Muut",
}


def _municipality_codes(table_meta: dict, area_var: str) -> dict[str, str]:
    """Return {KU-code: 3-digit municipality code} from a table's area dim."""
    for v in table_meta["variables"]:
        if v["code"] == area_var:
            return {val: val[2:] for val in v["values"] if val.startswith("KU")}
    raise RuntimeError(f"area var {area_var!r} not found")


def fetch_party_votes() -> dict[str, dict[str, float]]:
    """{muni_code: {party_abbr: votes}} for every municipality."""
    meta = requests.get(PARTY_TABLE, timeout=30).json()
    area_var = next(v["code"] for v in meta["variables"] if "lue" in v["code"])
    ku = _municipality_codes(meta, area_var)
    party_codes = [c for c in ALL_PARTY_ABBR]

    query = {
        "query": [
            {"code": area_var, "selection": {"filter": "item", "values": list(ku)}},
            {"code": "sukupuoli_9_20180101", "selection": {"filter": "item", "values": ["SSS"]}},
            {"code": "puolue_4_20230303", "selection": {"filter": "item", "values": party_codes}},
            {"code": "contentscode", "selection": {"filter": "item", "values": ["evaa_aanet"]}},
        ],
        "response": {"format": "json-stat2"},
    }
    data = requests.post(PARTY_TABLE, json=query, timeout=90).json()
    values = data["value"]
    a_idx = data["dimension"][area_var]["category"]["index"]
    p_idx = data["dimension"]["puolue_4_20230303"]["category"]["index"]
    n_p = len(p_idx)

    result: dict[str, dict[str, float]] = {}
    for kucode, ai in a_idx.items():
        muni = ku[kucode]
        votes: dict[str, float] = {}
        for pcode, pi in p_idx.items():
            v = values[ai * n_p + pi]
            if v:
                votes[ALL_PARTY_ABBR[pcode]] = float(v)
        if votes:
            result[muni] = votes
    return result


def fetch_turnout() -> dict[str, float]:
    """{muni_code: turnout_pct}."""
    meta = requests.get(TURNOUT_TABLE, timeout=30).json()
    area_var = next(v["code"] for v in meta["variables"] if "lue" in v["code"])
    ku = _municipality_codes(meta, area_var)

    query = {
        "query": [
            {"code": area_var, "selection": {"filter": "item", "values": list(ku)}},
            {"code": "sukupuoli_9_20180101", "selection": {"filter": "item", "values": ["SSS"]}},
            {"code": "contentscode", "selection": {"filter": "item", "values": ["evaa_aanpros"]}},
        ],
        "response": {"format": "json-stat2"},
    }
    data = requests.post(TURNOUT_TABLE, json=query, timeout=90).json()
    values = data["value"]
    a_idx = data["dimension"][area_var]["category"]["index"]
    return {ku[k]: float(values[i]) for k, i in a_idx.items() if values[i] is not None}


def derive_metrics(votes: dict[str, float]) -> dict:
    """Per-party shares + lean index + competitiveness from a vote dict."""
    total = sum(votes.values())
    if total <= 0:
        return {}
    shares = {p: round(100.0 * v / total, 1) for p, v in votes.items()}

    # Political lean: vote-weighted average left–right position (parties with a
    # known position), rescaled 0–100 (0 = left, 100 = right).
    lr_num = sum(votes[p] * PARTY_LR[p] for p in votes if p in PARTY_LR)
    lr_den = sum(votes[p] for p in votes if p in PARTY_LR)
    lean = round(10.0 * lr_num / lr_den, 1) if lr_den > 0 else None

    # Competitiveness: normalised Shannon entropy of vote shares (0 = one party
    # dominates, 1 = perfectly even). Kept as the neutral "political diversity".
    fracs = [v / total for v in votes.values() if v > 0]
    n = len(fracs)
    h = -sum(f * math.log(f) for f in fracs)
    comp = round(h / math.log(n), 3) if n > 1 else 0.0

    largest = max(shares, key=shares.get)
    return {"lean": lean, "competitiveness": comp, "largest_party": largest,
            "party": {p: shares.get(p) for p in MAIN_PARTIES.values() if p in shares}}


def main():
    logger.info("Fetching 2023 parliamentary party votes by municipality...")
    party_votes = fetch_party_votes()
    logger.info("  %d municipalities", len(party_votes))

    logger.info("Fetching turnout by municipality...")
    turnout = fetch_turnout()

    out: dict[str, dict] = {}
    for muni, votes in party_votes.items():
        m = derive_metrics(votes)
        if not m:
            continue
        m["turnout_pct"] = turnout.get(muni)
        out[muni] = m

    (OUT_DIR / "election_municipal.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    logger.info("Wrote election_municipal.json (%d municipalities)", len(out))

    # Proof summary
    names = {"091": "Helsinki", "049": "Espoo", "837": "Tampere",
             "853": "Turku", "564": "Oulu", "405": "Lappeenranta",
             "047": "Enontekiö", "732": "Salla"}
    for code, name in names.items():
        m = out.get(code)
        if not m:
            continue
        ps = ", ".join(f"{p} {m['party'][p]}%" for p in m["party"])
        logger.info("  %-12s turnout=%.1f%% lean=%s largest=%s | %s",
                    name, m["turnout_pct"] or 0, m["lean"], m["largest_party"], ps)


if __name__ == "__main__":
    main()
