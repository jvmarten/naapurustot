#!/usr/bin/env python3
"""Fetch every school and daycare centre in Finland from the national registers.

Sources
  Schools    Opetushallitus' organisation register (Opintopolku organisaatiopalvelu):
             every ACTIVE oppilaitos of type 11 peruskoulu, 12 peruskouluasteen
             erityiskoulu, 15 lukio or 19 perus- ja lukioasteen koulu. Vocational
             colleges and adult education are deliberately not "schools" here.
  Daycares   Varda, the statutory national early-education register, as mirrored by
             the same service: every active varhaiskasvatuksen toimipaikka whose
             operating form is päiväkoti (vardatoimintamuoto_tm01), municipal and
             private alike. Varda does not cover Åland — early education there is
             under Åland's own legislation — so Åland's postal areas get NO daycare
             value rather than a zero (see ALAND_MUNICIPALITIES).

WHY NOT OPENSTREETMAP

These two layers were OSM counts until 2026-10. Checked area by area against these
registers, OSM had ~75 % of the country's daycare centres outside the capital region
and showed 0 daycares for 411 postal areas (606,131 residents) that have at least one;
for schools it counted vocational colleges, adult-education centres and separately
mapped buildings (+1,219 against the register) while OSM tagging errors removed real
schools (02620 Karakallio's grades 7–9 school has been tagged amenity=kindergarten
since 2024-12). A register is complete by law and does not depend on how a volunteer
tagged a polygon.

PLACEMENT

A unit is placed by its VISITING STREET ADDRESS, looked up in the national address
register (Ryhti open_address, SYKE, CC BY 4.0: 3.9 M addresses with coordinates),
and the point is assigned to the postal polygon that contains it — the same rule as
every point layer on the map. The registers' own postal codes are typed by hand and
are not used first: checked against the capital-region cities' service register at
the same street address, 2.8 % of them name a neighbouring area (Karamäen päiväkoti,
Kalasääksenkuja 4 in Karakallio, is registered under 02710 Viherlaakso), Helsinki
files its own daycares under the city's central code 00099, and Espoo files schools
under a PO box (02070) with a visiting code of 00000. Within the address register,
an address point the generalised polygons miss (a shoreline building) takes that
address's own postal code, and a house number the register does not hold takes the
postal code of its street when every address within ±STREET_NUMBER_WINDOW numbers
shares one. A unit the address register cannot place falls back to, in order:
  1. its own visiting-address postal code, when that is a real postal area;
  2. Suomi.fi-palvelutietovaranto (PTV, CC0) — a service location with the same name
     in the same municipality.
A unit none of these can place is reported and left out; more than MAX_UNPLACED_SHARE
of a layer unplaced aborts the run, since that means the address data changed shape.
Finnish schools abroad (kotipaikka 200) are not in any postal area and are dropped.

GUARDS

Every search must return exactly the number of hits it reports and every detail batch
must return every OID it was asked for, or the run aborts — a partial register written
as complete becomes a measured-looking 0 in every area it lost.

Output: scripts/education_registers.json — one row per unit (oid, name, municipality,
postal code, how it was placed), so every count traces back to named facilities.
prepare_data.py turns it into school_count/daycare_count and their densities;
`--apply-geojson` does the same directly on the committed GeoJSON (offline path).

Usage:
  python scripts/fetch_education_registers.py [--apply-geojson]
"""

import argparse
import datetime
import json
import logging
import re
import sys
import time
import unicodedata
from collections import Counter
from pathlib import Path

import requests

from regions_config import REGION_MUNICIPALITY_CODES

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).resolve().parent
GEOJSON = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT = SCRIPT_DIR / "education_registers.json"

ORG_API = "https://virkailija.opintopolku.fi/organisaatio-service/api"
RYHTI_ADDRESSES = ("https://paikkatiedot.ymparisto.fi/geoserver/ryhti_building/ogc/features/v1"
                   "/collections/open_address/items")
PTV_API = "https://api.palvelutietovaranto.suomi.fi/api/v11"
# Opintopolku asks every caller to identify itself.
HEADERS = {"Caller-Id": "naapurustot.fi.data-pipeline",
           "User-Agent": "naapurustot.fi data pipeline (+https://naapurustot.fi)"}

SCHOOL_TYPES = ("11", "12", "15", "19")
DAYCARE_CENTRE = "vardatoimintamuoto_tm01"
ABROAD = "200"
ALAND_MUNICIPALITIES = (REGION_MUNICIPALITY_CODES["mariehamns_stad"]
                        | REGION_MUNICIPALITY_CODES["alands_landsbygd"]
                        | REGION_MUNICIPALITY_CODES["alands_skargard"])
RYHTI_BATCH = 25  # street addresses per CQL query (keeps the GET URL short)
STREET_NUMBER_WINDOW = 4
MAX_UNPLACED_SHARE = 0.03
DENSITY_DECIMALS = 4  # prepare_data.POI_DENSITY_DECIMALS


def _request(method: str, url: str, **kw):
    for attempt in range(1, 5):
        try:
            r = requests.request(method, url, headers=HEADERS, timeout=180, **kw)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001 - retried, then raised
            if attempt == 4:
                raise RuntimeError(f"{method} {url} failed after 4 attempts: {e}") from e
            logger.warning("  %s %s failed (attempt %d): %s", method, url, attempt, e)
            time.sleep(5 * attempt)


def _search(params: dict) -> list[str]:
    """OIDs of every active organisation matching *params*, guarded against truncation."""
    data = _request("GET", f"{ORG_API}/hae", params={
        "aktiiviset": "true", "suunnitellut": "false", "lakkautetut": "false", **params})
    found = []

    def walk(o):
        found.append(o["oid"])
        for c in o.get("children") or []:
            walk(c)

    for o in data.get("organisaatiot") or []:
        walk(o)
    if len(found) != data.get("numHits"):
        raise RuntimeError(f"organisation search {params} returned {len(found)} of "
                           f"{data.get('numHits')} hits — refusing a partial register")
    return found


def _details(oids: list[str]) -> list[dict]:
    out = []
    for i in range(0, len(oids), 500):
        batch = oids[i:i + 500]
        got = _request("POST", f"{ORG_API}/findbyoids", json=batch)
        if {o["oid"] for o in got} != set(batch):
            raise RuntimeError(f"findbyoids returned {len(got)} of {len(batch)} organisations")
        out += got
    return out


def _postal(addr: dict | None) -> str | None:
    m = re.fullmatch(r"posti_(\d{5})", (addr or {}).get("postinumeroUri") or "")
    return m.group(1) if m else None


def _norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


def _street_parts(s: str | None) -> tuple[str, int] | None:
    """('Kotkakuja', 5) from 'Kotkakuja 5 A' or 'Kievarinraitti 1-3'; None for a PO box."""
    m = re.match(r"\s*(.+?)\s+(\d+)", (s or "").split(",")[0])
    if not m or _norm(m.group(1)) in ("pl", "pb", "po box", "postilokero"):
        return None
    return re.sub(r"\s+", " ", m.group(1)).strip(), int(m.group(2))


def _ogc_items(url: str, cql: str) -> list[dict]:
    """Every feature an OGC API Features query matches, following `next` links."""
    feats: list[dict] = []
    data = _request("GET", url, params={"f": "json", "filter-lang": "cql-text",
                                        "filter": cql, "limit": 1000})
    matched = data.get("numberMatched")
    while True:
        feats += data.get("features") or []
        nxt = next((ln["href"] for ln in data.get("links") or [] if ln.get("rel") == "next"), None)
        if not nxt:
            break
        data = _request("GET", nxt)
    if isinstance(matched, int) and matched != len(feats):
        raise RuntimeError(f"address query returned {len(feats)} of {matched} matched features")
    return feats


def _street_match_key(s: str) -> str:
    """'Kyösti Kallion Tie' and 'Kyösti Kallion tie', 'Kaarelan Raitti' and
    'Kaarelanraitti', 'Wirenin' and 'Wirénin' all compare equal."""
    s = unicodedata.normalize("NFKD", s.lower())
    return re.sub(r"[\s\-.'’]", "", "".join(c for c in s if not unicodedata.combining(c)))


def _first_word(street: str) -> str:
    return re.split(r"[\s\-]", street)[0].replace("'", "''").replace("%", "").replace("_", "")


def _address_hits(units: list[dict]) -> dict[str, dict]:
    """oid -> {"points": [(x, y)], "postal_codes": [...], "street_only": bool}.

    The registers write street names in any case and spacing ('TENAVATIE 3 B',
    'Kyösti Kallion Tie 1', 'Kaarelan Raitti 1'), so each address is asked for by
    the first word of its street, case-insensitively, plus the house number in the
    municipality — a handful of candidates — and the full name is compared locally
    with _street_match_key. One query per RYHTI_BATCH addresses.

    A house number the address register does not hold at all (Kylätie 5,
    Punavuorenkatu 8 — corner buildings and mistyped numbers) is placed by its
    street instead, but only when every address within ±STREET_NUMBER_WINDOW house
    numbers on that street shares one postal code; a street that changes area there
    (Kasarmikatu 10 is 00140, 12 is 00130) is left to the fallbacks.
    """
    by_muni: dict[str, list] = {}
    for u in units:
        parts = _street_parts(u["street"])
        if parts and u["municipality"]:
            by_muni.setdefault(u["municipality"], []).append((u, parts))
    found: dict[str, dict] = {}
    _lookup(by_muni, RYHTI_BATCH, found)
    # The service has answered a batch short without any error, so every address
    # still missing is asked once more on its own before anything else is tried.
    retry: dict[str, list] = {}
    for muni, items in by_muni.items():
        missing = [it for it in items if it[0]["oid"] not in found]
        if missing:
            retry[muni] = missing
    _lookup(retry, 1, found)

    for muni, items in sorted(retry.items()):
        for u, (street, number) in items:
            if u["oid"] in found:
                continue
            first = _first_word(street)
            cql = (f"municipality_number='{muni}' AND "
                   f"(address_name_fin ILIKE '{first}%' OR address_name_swe ILIKE '{first}%')")
            key = _street_match_key(street)
            near = {f["properties"].get("postal_code") for f in _ogc_items(RYHTI_ADDRESSES, cql)
                    if isinstance(f["properties"].get("number_part_of_address_number"), int)
                    and abs(f["properties"]["number_part_of_address_number"] - number) <= STREET_NUMBER_WINDOW
                    and key in (_street_match_key(f["properties"].get("address_name_fin") or ""),
                                _street_match_key(f["properties"].get("address_name_swe") or ""))}
            if len(near) == 1 and None not in near:
                found[u["oid"]] = {"points": [], "postal_codes": list(near), "street_only": True}
    return found


def _lookup(by_muni: dict[str, list], batch: int, found: dict) -> None:
    for muni, items in sorted(by_muni.items()):
        for i in range(0, len(items), batch):
            chunk = items[i:i + batch]
            clauses = []
            for _, (street, number) in chunk:
                first = _first_word(street)
                clauses.append(f"((address_name_fin ILIKE '{first}%' OR address_name_swe ILIKE '{first}%')"
                               f" AND number_part_of_address_number={number})")
            cql = f"municipality_number='{muni}' AND ({' OR '.join(clauses)})"
            idx: dict = {}
            for f in _ogc_items(RYHTI_ADDRESSES, cql):
                p, g = f["properties"], f.get("geometry")
                if not g:
                    continue
                for n in (p.get("address_name_fin"), p.get("address_name_swe")):
                    if n:
                        idx.setdefault((_street_match_key(n), p.get("number_part_of_address_number")),
                                       []).append((*g["coordinates"][:2], p.get("postal_code")))
            for u, (street, number) in chunk:
                hits = idx.get((_street_match_key(street), number))
                if hits:
                    found[u["oid"]] = {"points": [(x, y) for x, y, _ in hits],
                                       "postal_codes": [pc for _, _, pc in hits],
                                       "street_only": False}


def _unit(o: dict, layer: str) -> dict:
    name = o.get("nimi") or {}
    return {
        "oid": o["oid"],
        "code": o.get("oppilaitosKoodi") or o.get("toimipistekoodi"),
        "name": name.get("fi") or name.get("sv") or name.get("en"),
        "name_sv": name.get("sv"),
        "type": (o.get("oppilaitosTyyppiUri") or "").split("#")[0].replace("oppilaitostyyppi_", "") or None,
        "municipality": (o.get("kotipaikkaUri") or "").replace("kunta_", ""),
        "street": (o.get("kayntiosoite") or {}).get("osoite"),
        "visiting_postal": _postal(o.get("kayntiosoite")),
        "layer": layer,
    }


def fetch_units() -> list[dict]:
    units = []
    school_oids = []
    for t in SCHOOL_TYPES:
        school_oids += _search({"oppilaitostyyppi": f"oppilaitostyyppi_{t}#1"})
    for o in _details(sorted(set(school_oids))):
        units.append(_unit(o, "school"))
    logger.info("Schools: %d active (types %s)", len(school_oids), ", ".join(SCHOOL_TYPES))

    vaka = _details(sorted(set(_search({"organisaatiotyyppi": "organisaatiotyyppi_08"}))))
    no_form = [o for o in vaka if not (o.get("varhaiskasvatuksenToimipaikkaTiedot") or {}).get("toimintamuoto")]
    if len(no_form) > 0.01 * len(vaka):
        raise RuntimeError(f"{len(no_form)} of {len(vaka)} Varda units carry no operating form")
    centres = [o for o in vaka
               if (o.get("varhaiskasvatuksenToimipaikkaTiedot") or {}).get("toimintamuoto") == DAYCARE_CENTRE]
    units += [_unit(o, "daycare") for o in centres]
    logger.info("Daycare centres: %d of %d active Varda units", len(centres), len(vaka))
    return units


def place(units: list[dict], polygons) -> list[dict]:
    """Set unit['pno'] and unit['placed_via']; returns the units left unplaced.

    *polygons* is (STRtree, geometries, postal codes) over the postal areas.
    """
    from shapely.geometry import Point

    tree, geoms, pnos = polygons
    postal_areas = set(pnos)

    def pno_at(x: float, y: float) -> str | None:
        pt = Point(x, y)
        for ci in tree.query(pt):
            if geoms[ci].contains(pt):  # first containing polygon wins, as in prepare_data
                return pnos[ci]
        return None

    pending = []
    for u in units:
        u["pno"], u["placed_via"] = None, None
        if u["municipality"] == ABROAD:
            u["placed_via"] = "abroad"
        elif u["layer"] == "daycare" and u["municipality"] in ALAND_MUNICIPALITIES:
            u["placed_via"] = "aland_not_in_varda"
        else:
            pending.append(u)

    # 1. The national address register: street + number -> point -> polygon. An
    #    address with several entrances can straddle a border; the majority wins.
    #    A point the generalised polygons miss (the shoreline at Kauppatori holds
    #    Aleksanterinkatu 1) takes that address's own postal code from the same
    #    register, as does an address placed by its street alone.
    hits = _address_hits(pending)
    still = []
    for u in pending:
        hit = hits.get(u["oid"])
        if not hit:
            still.append(u)
            continue
        votes = Counter(p for p in (pno_at(x, y) for x, y in hit["points"]) if p)
        codes = Counter(pc for pc in hit["postal_codes"] if pc in postal_areas)
        if votes:
            u["pno"], u["placed_via"] = votes.most_common(1)[0][0], "address_register"
        elif codes:
            u["pno"] = codes.most_common(1)[0][0]
            u["placed_via"] = "address_register_street" if hit["street_only"] else "address_register_postal_code"
        else:
            still.append(u)
    pending = still
    logger.info("Placed via the address register: %d; needing a fallback: %d",
                sum((u["placed_via"] or "").startswith("address_register") for u in units), len(pending))

    # 2. The register's own visiting-address postal code, when it is a real area.
    still = []
    for u in pending:
        if u["visiting_postal"] in postal_areas:
            u["pno"], u["placed_via"] = u["visiting_postal"], "register_postal_code"
        else:
            still.append(u)
    pending = still

    # 3. PTV: a service location with the same name in the same municipality.
    if pending:
        names: dict = {}
        page = 1
        while True:
            d = _request("GET", f"{PTV_API}/ServiceChannel/type/ServiceLocation", params={"page": page})
            for it in d.get("itemList") or []:
                names.setdefault(_norm(it.get("name")), []).append(it["id"])
            if page >= d["pageCount"]:
                break
            page += 1
        wanted = {}
        for u in pending:
            for n in (_norm(u["name"]), _norm(u["name_sv"])):
                for gid in names.get(n, []):
                    wanted.setdefault(gid, []).append(u)
        ids = sorted(wanted)
        channels = {}
        for i in range(0, len(ids), 100):
            for c in _request("GET", f"{PTV_API}/ServiceChannel/list", params={"guids": ",".join(ids[i:i + 100])}):
                channels[c["id"]] = c
        for gid, us in wanted.items():
            for a in (channels.get(gid) or {}).get("addresses") or []:
                sa = a.get("streetAddress") or {}
                z, muni = sa.get("postalCode"), (sa.get("municipality") or {}).get("code")
                for u in us:
                    if u["pno"] is None and z in postal_areas and muni == u["municipality"]:
                        u["pno"], u["placed_via"] = z, "ptv_name"
        pending = [u for u in pending if u["pno"] is None]

    for u in pending:
        u["placed_via"] = "unplaced"
    return pending


def write_units(rows: list[dict], fetched: str) -> None:
    """One unit per line, so a quarterly refresh diffs as the units that changed."""
    head = json.dumps({"_comment": "Generated by scripts/fetch_education_registers.py — see its docstring.",
                       "fetched": fetched}, ensure_ascii=False)[:-1]
    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write(head + ', "units": [\n')
        f.write(",\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
        f.write("\n]}\n")


def counts(units: list[dict], layer: str) -> Counter:
    return Counter(u["pno"] for u in units if u["layer"] == layer and u["pno"])


def apply_geojson(units: list[dict]) -> None:
    """Write school/daycare counts and densities into the committed GeoJSON."""
    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)
    by_layer = {layer: counts(units, layer) for layer in ("school", "daycare")}
    for feat in data["features"]:
        p = feat["properties"]
        area = p.get("pinta_ala")
        km2 = area / 1_000_000 if isinstance(area, (int, float)) and area > 0 else None
        for layer in ("school", "daycare"):
            n = by_layer[layer].get(p.get("pno"), 0)
            if km2 is None or (layer == "daycare" and p.get("kunta") in ALAND_MUNICIPALITIES):
                p[f"{layer}_count"], p[f"{layer}_density"] = None, None
            else:
                p[f"{layer}_count"] = n
                p[f"{layer}_density"] = round(n / km2, DENSITY_DECIMALS)
    # Python's default json.dump: byte-identical to the committed file on a no-op
    # round trip, so the diff stays value-only.
    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)
    logger.info("Wrote school/daycare counts into %s", GEOJSON.name)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply-geojson", action="store_true",
                    help="also write the counts into the committed GeoJSON")
    args = ap.parse_args()

    from shapely.geometry import shape
    from shapely.strtree import STRtree

    with open(GEOJSON, encoding="utf-8") as f:
        feats = [feat for feat in json.load(f)["features"] if feat.get("geometry")]
    geoms = [shape(feat["geometry"]) for feat in feats]
    polygons = (STRtree(geoms), geoms, [feat["properties"]["pno"] for feat in feats])

    units = fetch_units()
    unplaced = place(units, polygons)
    for layer in ("school", "daycare"):
        total = [u for u in units if u["layer"] == layer
                 and u["placed_via"] not in ("abroad", "aland_not_in_varda")]
        lost = [u for u in unplaced if u["layer"] == layer]
        vias = Counter(u["placed_via"] for u in units if u["layer"] == layer)
        logger.info("%s: %d placed in %d areas, %s", layer, sum(counts(units, layer).values()),
                    len(counts(units, layer)), dict(vias))
        if len(lost) > MAX_UNPLACED_SHARE * len(total):
            raise RuntimeError(f"{len(lost)} of {len(total)} {layer} units could not be placed "
                               f"in a postal area — the register's address data changed shape")
        for u in lost:
            logger.warning("  unplaced %s: %s (%s, kunta %s)", layer, u["name"], u["street"], u["municipality"])

    rows = sorted(({k: u[k] for k in ("layer", "oid", "code", "name", "type", "municipality",
                                      "pno", "placed_via")} for u in units),
                  key=lambda r: (r["layer"], r["oid"]))
    write_units(rows, datetime.date.today().isoformat())
    logger.info("Wrote %s (%d units)", OUTPUT.name, len(rows))

    if args.apply_geojson:
        apply_geojson(units)
    return 0


if __name__ == "__main__":
    sys.exit(main())
