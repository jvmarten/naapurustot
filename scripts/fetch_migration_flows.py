#!/usr/bin/env python3
"""Where a municipality's movers come from and go to: the top origins and destinations.

Source: Statistics Finland, StatFin muutl 11a1 ("Kuntien välinen muutto tulo- ja
lähtöalueittain"), the full municipality × municipality matrix of moves between
municipalities, both sexes. Summed over the same three latest years as
net_migration_rate (fetch_municipal_tax_migration.py), so the panel's list sits under
the figure it explains.

This is municipal data: no public source breaks moves down below the municipality,
so the panel says whose figures they are rather than drawing flows between postal
codes nobody measured.

Output (fetched by the panel on demand as a static asset, never bundled):
  src/data/migration_flows.json
    {"years": [2023, 2025],
     "names": {"091": "Helsinki", ...},            # Finnish names
     "sv":    {"091": "Helsingfors", ...},         # Swedish names where they differ
     "flows": {"091": [[["049", 12345], ...],      # top origins (moved here from)
                       [["049", 23456], ...]]}}    # top destinations (moved there)

Usage:
    python scripts/fetch_migration_flows.py
"""

import json
import logging
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
import pxweb  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent
OUT_FILE = SCRIPT_DIR.parent / "src" / "data" / "migration_flows.json"
SV_NAMES_FILE = SCRIPT_DIR / "fi_municipality_names_sv.json"

TABLE = ("muutl", "11a1")
YEARS = 3
TOP = 3


def _post(url, query):
    last = None
    for attempt in range(1, 4):
        try:
            r = requests.post(url, json=query, timeout=180)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as exc:
            last = exc
            logger.warning("  attempt %d failed: %s", attempt, exc)
            time.sleep(2 ** attempt)
    raise last


def main():
    # Finnish names: the fi table answers "Tulo - Akaa"; strip the prefix.
    url, meta = pxweb.fetch_table_meta(*TABLE, lang="fi")
    year_code = pxweb.year_var_code(meta)
    years = sorted(next(v for v in meta["variables"] if v["code"] == year_code)["values"])[-YEARS:]
    to_var, from_var = [v for v in meta["variables"] if "KU091" in v["values"]]
    if not to_var["text"].lower().startswith("tulo"):
        to_var, from_var = from_var, to_var
    sex_var = next(v for v in meta["variables"] if v["code"].startswith("sukupuoli"))
    info_var = next(v for v in meta["variables"] if v["code"] == "contentscode")
    names = {c[2:]: t.split(" - ", 1)[1] for c, t in zip(to_var["values"], to_var["valueTexts"])
             if c.startswith("KU")}
    munis = sorted(c for c in to_var["values"] if c.startswith("KU"))

    flows = {}  # (from, to) -> moves over the window
    for year in years:
        query = {
            "query": [
                {"code": to_var["code"], "selection": {"filter": "item", "values": munis}},
                {"code": from_var["code"], "selection": {"filter": "item", "values": munis}},
                {"code": sex_var["code"], "selection": {"filter": "item", "values": ["SSS"]}},
                {"code": year_code, "selection": {"filter": "item", "values": [year]}},
                {"code": info_var["code"], "selection": {"filter": "all", "values": ["*"]}},
            ],
            "response": {"format": "json"},
        }
        data = _post(url, query)
        cols = [c["code"] for c in data["columns"]]
        i_to, i_from = cols.index(to_var["code"]), cols.index(from_var["code"])
        n = 0
        for row in data["data"]:
            v = row["values"][0]
            if v in (".", "..", "...", "-", "0"):
                continue
            src, dst = row["key"][i_from][2:], row["key"][i_to][2:]
            if src == dst:
                continue
            flows[(src, dst)] = flows.get((src, dst), 0) + int(v)
            n += 1
        logger.info("  %s: %d non-zero municipality pairs", year, n)
        time.sleep(1)

    inbound, outbound = {}, {}
    for (src, dst), moves in flows.items():
        inbound.setdefault(dst, []).append([src, moves])
        outbound.setdefault(src, []).append([dst, moves])
    top = lambda xs: sorted(xs, key=lambda x: (-x[1], x[0]))[:TOP]  # noqa: E731
    out_flows = {m[2:]: [top(inbound.get(m[2:], [])), top(outbound.get(m[2:], []))] for m in munis}

    sv_all = json.loads(SV_NAMES_FILE.read_text(encoding="utf-8"))["names"] if SV_NAMES_FILE.exists() else {}
    used = {code for pair in out_flows.values() for side in pair for code, _ in side} | set(out_flows)
    result = {
        "years": [int(years[0]), int(years[-1])],
        "names": {c: names[c] for c in sorted(used) if c in names},
        "sv": {c: sv_all[c] for c in sorted(used) if c in sv_all and sv_all[c] != names.get(c)},
        "flows": out_flows,
    }
    OUT_FILE.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    logger.info("Wrote %s: %d municipalities, %s–%s (%d bytes)", OUT_FILE.name, len(out_flows),
                years[0], years[-1], OUT_FILE.stat().st_size)


if __name__ == "__main__":
    main()
