#!/usr/bin/env python3
"""Two municipality-level figures, distributed to every postal code of the municipality.

  municipal_tax_rate   — the municipality's 2026 income tax rate (kunnallisvero-
                         prosentti, %), from Verohallinto's decision "Kuntien ja
                         seurakuntien tuloveroprosentit vuonna 2026". The page embeds
                         the 308-row table as the `:rows` prop of its table component;
                         that prop is what is parsed here (column_0 = kunta,
                         column_1 = tuloveroprosentti).

  net_migration_rate   — total net migration (inter-municipal net migration plus net
                         immigration, StatFin muutl 11ae `muutl-koknetmuutto`) per 1,000
                         residents per year, over the three latest years: the sum of
                         net migration divided by the sum of year-end populations, × 1,000.
                         Three years, because a single year in a municipality of a few
                         thousand moves by a handful of households.

Both are municipal figures, so every postal code carries its municipality's value and
the registry flags them is_proxy. The rate is the rate every resident of the
municipality pays; the migration figure is the municipality's, not the area's.

Outputs:
  scripts/municipal_tax_rate.json     {pno: 7.5}
  scripts/net_migration_rate.json     {pno: 3.2}
  scripts/municipal_tax_migration_meta.json   {"tax_year": 2026, "migration_years": [..]}

With --apply, writes both properties into public/data/metro_neighborhoods.geojson
(byte-preserving). prepare_data.py joins the same files on a full rebuild.
Run `npm run build:data` afterwards.
"""

import argparse
import html
import json
import logging
import re
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
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
TAX_FILE = SCRIPT_DIR / "municipal_tax_rate.json"
MIGRATION_FILE = SCRIPT_DIR / "net_migration_rate.json"
META_FILE = SCRIPT_DIR / "municipal_tax_migration_meta.json"

TAX_YEAR = 2026
TAX_URL = ("https://www.vero.fi/syventavat-vero-ohjeet/paatokset/47465/"
           "kuntien-ja-seurakuntien-tuloveroprosentit-vuonna-2026/")
# Verohallinto names the one bilingual-named municipality we spell both ways.
NAME_ALIASES = {"Maarianhamina - Mariehamn": "Maarianhamina"}

MIGRATION_TABLE = ("muutl", "11ae")
MIGRATION_YEARS = 3
NET_ITEM = "muutl-koknetmuutto"
POP_ITEM = "muutl-vaesto"


def _req(method, url, **kw):
    last = None
    for attempt in range(1, 4):
        try:
            r = requests.request(method, url, timeout=120, **kw)
            r.raise_for_status()
            return r
        except requests.RequestException as exc:
            last = exc
            logger.warning("  attempt %d failed: %s", attempt, exc)
            time.sleep(2 ** attempt)
    raise last


def fetch_tax_rates():
    page = _req("GET", TAX_URL).text
    m = re.search(r':rows="(\[.*?\])"', page, re.S)
    if not m:
        raise RuntimeError("vero.fi page no longer embeds the rate table as a :rows prop")
    rows = json.loads(html.unescape(m.group(1)))
    rates = {}
    for r in rows:
        name = r["column_0"]["text"].strip()
        rate = float(r["column_1"]["text"].replace(",", "."))
        if not 0 < rate < 20:
            raise RuntimeError(f"implausible tax rate {rate} for {name}")
        rates[name] = rate
    logger.info("Verohallinto %d: %d municipal rates (%.2f–%.2f)", TAX_YEAR, len(rates),
                min(rates.values()), max(rates.values()))
    return rates


def fetch_migration():
    url, meta = pxweb.fetch_table_meta(*MIGRATION_TABLE)
    year_code = pxweb.year_var_code(meta)
    years = sorted(next(v for v in meta["variables"] if v["code"] == year_code)["values"])[-MIGRATION_YEARS:]
    area_var = next(v for v in meta["variables"] if any(x.startswith("KU") for x in v["values"]))
    info_var = next(v for v in meta["variables"] if NET_ITEM in v["values"])
    munis = [v for v in area_var["values"] if v.startswith("KU")]
    query = {
        "query": [
            {"code": year_code, "selection": {"filter": "item", "values": years}},
            {"code": area_var["code"], "selection": {"filter": "item", "values": munis}},
            {"code": info_var["code"], "selection": {"filter": "item", "values": [NET_ITEM, POP_ITEM]}},
        ],
        "response": {"format": "json"},
    }
    data = _req("POST", url, json=query).json()
    cols = [c["code"] for c in data["columns"]]
    i_area = cols.index(area_var["code"])
    vcols = [c["code"] for c in data["columns"] if c.get("type") == "c"]
    i_net, i_pop = vcols.index(NET_ITEM), vcols.index(POP_ITEM)
    sums = {}
    for row in data["data"]:
        code = row["key"][i_area][2:]
        net, pop = row["values"][i_net], row["values"][i_pop]
        if net in (".", "..", "...") or pop in (".", "..", "..."):
            continue
        s = sums.setdefault(code, [0, 0, 0])
        s[0] += int(net)
        s[1] += int(pop)
        s[2] += 1
    rates = {code: round(net / pop * 1000, 1) for code, (net, pop, n) in sums.items()
             if n == len(years) and pop > 0}
    logger.info("StatFin 11ae %s–%s: net migration for %d municipalities", years[0], years[-1], len(rates))
    return [int(y) for y in years], rates


def distribute(features, tax_by_name, mig_by_code):
    tax, mig = {}, {}
    unmatched = set()
    for f in features:
        p = f["properties"]
        pno = str(p.get("postinumeroalue") or p.get("pno") or "")
        name = NAME_ALIASES.get(p.get("municipality"), p.get("municipality"))
        if name in tax_by_name:
            tax[pno] = tax_by_name[name]
        else:
            unmatched.add(name)
        code = p.get("kunta")
        if code in mig_by_code:
            mig[pno] = mig_by_code[code]
    if unmatched:
        raise RuntimeError(f"no 2026 tax rate for municipalities {sorted(map(str, unmatched))}")
    return tax, mig


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="also write the properties into the GeoJSON")
    args = ap.parse_args()

    with open(GEOJSON_PATH, encoding="utf-8") as f:
        head = f.read(32)
        f.seek(0)
        geo = json.load(f)
    tax_by_name = fetch_tax_rates()
    years, mig_by_code = fetch_migration()
    tax, mig = distribute(geo["features"], tax_by_name, mig_by_code)
    logger.info("Postal codes: %d with a tax rate, %d with net migration (of %d)",
                len(tax), len(mig), len(geo["features"]))

    TAX_FILE.write_text(json.dumps(dict(sorted(tax.items())), separators=(",", ":")) + "\n", encoding="utf-8")
    MIGRATION_FILE.write_text(json.dumps(dict(sorted(mig.items())), separators=(",", ":")) + "\n", encoding="utf-8")
    META_FILE.write_text(json.dumps({"tax_year": TAX_YEAR, "migration_years": years}) + "\n", encoding="utf-8")

    if args.apply:
        for f in geo["features"]:
            p = f["properties"]
            pno = str(p.get("postinumeroalue") or p.get("pno") or "")
            p["municipal_tax_rate"] = tax.get(pno)
            p["net_migration_rate"] = mig.get(pno)
        with open(GEOJSON_PATH, "w", encoding="utf-8") as f:
            if head.startswith('{"type": '):
                json.dump(geo, f)
            else:
                json.dump(geo, f, ensure_ascii=False, separators=(",", ":"))
        logger.info("Patched %s", GEOJSON_PATH.name)


if __name__ == "__main__":
    main()
