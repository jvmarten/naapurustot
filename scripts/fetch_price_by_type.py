#!/usr/bin/env python3
"""€/m² by dwelling type and the year's sales count, per postal code.

Source: Statistics Finland, PxWeb `ashi` table 13mu ("Vanhojen osakeasuntojen
neliöhinnat ja kauppojen lukumäärät postinumeroalueittain, vuosittain"), the same
table `property_price_sqm` and `property_price_history` come from. That table
publishes every postal code's €/m² and number of sales of old dwellings in housing
companies split by building type:

  1  Kerrostalo yksiöt      -> price_sqm_studio
  2  Kerrostalo kaksiot     -> price_sqm_two_room
  3  Kerrostalo kolmiot+    -> price_sqm_three_room
  5  Rivitalot yhteensä     -> price_sqm_rowhouse

and `property_sales_count` is the sum of the four types' sales counts for the
same year (the four are disjoint; the table carries no total row).

Statistics Finland's own suppression is kept as absence, never filled in:
  - a price of "..." means the cell had too few sales to publish (fewer than six
    in every case measured for 2025) -> that type's price is left out;
  - "." in both columns means no sales of that type at all. Central Helsinki
    (00100, 420 sales of flats) answers "." for row houses, which is what
    establishes this reading, so "." counts as zero sales in the total.
A postal code with no published sales of any type gets no count at all.

Each also gets a `<prop>_history` series, [[year, value], ...] from 2020 (where the
table's sales counts begin), only where the latest year is published and at least
two years are.

Outputs:
  scripts/property_price_by_type.json  {"year": 2025, "areas": {"00100": {...}}}

With --apply, also writes the five properties into
public/data/metro_neighborhoods.geojson (byte-preserving, like
inject_layer_values.py). prepare_data.py joins the same file on a full rebuild.
Run `npm run build:data` afterwards.

Usage:
    python scripts/fetch_price_by_type.py            # fetch + write JSON
    python scripts/fetch_price_by_type.py --apply    # also patch the GeoJSON
"""

import argparse
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
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUT_FILE = SCRIPT_DIR / "property_price_by_type.json"

ASHI_TABLE = ("ashi", "13mu")
# Building-type code -> GeoJSON property for that type's €/m².
TYPE_PROPS = {
    "1": "price_sqm_studio",
    "2": "price_sqm_two_room",
    "3": "price_sqm_three_room",
    "5": "price_sqm_rowhouse",
}
COUNT_PROP = "property_sales_count"
ALL_PROPS = [*TYPE_PROPS.values(), COUNT_PROP]
HISTORY_PROPS = [prop + "_history" for prop in ALL_PROPS]
# Sales counts in 13mu begin in 2020; the overall price history uses the same window.
HISTORY_START_YEAR = 2020

NO_SALES = "."
SUPPRESSED = {"..", "..."}


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


def _year_record(cells):
    """One postal code's figures for one year from its four (type, price, count) cells."""
    rec, n, any_published, count_suppressed = {}, 0, False, False
    for ty, price, count in cells:
        if count == NO_SALES:
            any_published = True  # published as "no sales"
        elif count in SUPPRESSED:
            count_suppressed = True
        else:
            n += int(count)
            any_published = True
        if price not in SUPPRESSED and price != NO_SALES:
            p = round(float(price))
            if p > 0:
                rec[TYPE_PROPS[ty]] = p
        elif price not in SUPPRESSED | {NO_SALES}:
            raise RuntimeError(f"unexpected ashi cell marker: {price!r}")
    # A total is written only when every type's count was published.
    if any_published and not count_suppressed and n > 0:
        rec[COUNT_PROP] = n
    return rec


def fetch():
    url, meta = pxweb.fetch_table_meta(*ASHI_TABLE)
    year_code = pxweb.year_var_code(meta)
    year_var = next(v for v in meta["variables"] if v["code"] == year_code)
    years = sorted(y for y in year_var["values"] if int(y) >= HISTORY_START_YEAR)
    latest = years[-1]
    postal_var = next(v for v in meta["variables"] if "00100" in v["values"])
    info_var = next(v for v in meta["variables"] if "keskihinta_aritm_nw" in v["values"])
    named = {year_code, postal_var["code"], info_var["code"]}
    type_var = next(v for v in meta["variables"] if v["code"] not in named)
    missing = set(TYPE_PROPS) - set(type_var["values"])
    if missing:
        raise RuntimeError(f"ashi 13mu building types changed: missing {sorted(missing)} in {type_var['values']}")
    price_item, count_item = "keskihinta_aritm_nw", next(v for v in info_var["values"] if v != "keskihinta_aritm_nw")

    query = {
        "query": [
            {"code": year_code, "selection": {"filter": "item", "values": years}},
            {"code": postal_var["code"], "selection": {"filter": "all", "values": ["*"]}},
            {"code": type_var["code"], "selection": {"filter": "item", "values": list(TYPE_PROPS)}},
            {"code": info_var["code"], "selection": {"filter": "item", "values": [price_item, count_item]}},
        ],
        "response": {"format": "json"},
    }
    data = _post(url, query)
    cols = [c["code"] for c in data["columns"]]
    i_year, i_pno, i_type = cols.index(year_code), cols.index(postal_var["code"]), cols.index(type_var["code"])
    vcols = [c["code"] for c in data["columns"] if c.get("type") == "c"]
    i_price, i_count = vcols.index(price_item), vcols.index(count_item)

    cells = {}  # (pno, year) -> [(type, price, count)]
    for row in data["data"]:
        k = row["key"]
        cells.setdefault((k[i_pno][:5], k[i_year]), []).append(
            (k[i_type], row["values"][i_price], row["values"][i_count]))
    by_pno = {}
    for (pno, year), c in cells.items():
        by_pno.setdefault(pno, {})[year] = _year_record(c)

    out = {}
    for pno, by_year in sorted(by_pno.items()):
        rec = dict(by_year.get(latest, {}))
        # A series only where the latest year itself is published, so the sparkline
        # always ends on the value the row prints.
        for prop in list(rec):
            series = [[int(y), by_year[y][prop]] for y in years if prop in by_year.get(y, {})]
            if len(series) >= 2:
                rec[prop + "_history"] = series
        if rec:
            out[pno] = rec
    logger.info("ashi 13mu %s–%s: %d postal codes with a %s price or sales count", years[0], latest, len(out), latest)
    for prop in ALL_PROPS:
        logger.info("  %-22s %4d  (history %d)", prop, sum(1 for r in out.values() if prop in r),
                    sum(1 for r in out.values() if prop + "_history" in r))
    return int(latest), out


def apply(areas):
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        head = f.read(32)
        f.seek(0)
        data = json.load(f)
    default_format = head.startswith('{"type": ')
    matched = 0
    for feat in data["features"]:
        p = feat["properties"]
        pno = str(p.get("postinumeroalue") or p.get("pno") or "")
        rec = areas.get(pno, {})
        if rec:
            matched += 1
        for prop in ALL_PROPS:
            p[prop] = rec.get(prop)
        # Stored as JSON strings, like property_price_history.
        for prop in HISTORY_PROPS:
            p[prop] = json.dumps(rec[prop]) if prop in rec else None
    with open(GEOJSON_PATH, "w", encoding="utf-8") as f:
        if default_format:
            json.dump(data, f)
        else:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    logger.info("Patched %d of %d features in %s", matched, len(data["features"]), GEOJSON_PATH.name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="also write the properties into the GeoJSON")
    args = ap.parse_args()
    year, areas = fetch()
    OUT_FILE.write_text(json.dumps({"year": year, "areas": areas}, ensure_ascii=False, separators=(",", ":")) + "\n",
                        encoding="utf-8")
    logger.info("Wrote %s", OUT_FILE.name)
    if args.apply:
        apply(areas)


if __name__ == "__main__":
    main()
