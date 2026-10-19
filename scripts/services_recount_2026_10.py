#!/usr/bin/env python3
"""Recount the five OSM service layers with every OSM element type.

Same shape and conventions as scripts/services_honesty_2026_08.py: a one-time,
deterministic correction of already-committed source data. `npm run build:data`
only ever reads the committed GeoJSON, so this script is not part of it and does
not affect the build:data idempotency gate.

THE DEFECT

prepare_data.py's Overpass queries asked for `node` and `way` only, and for two
layers less than that:

    school, daycare, healthcare   node + way          (relations dropped)
    grocery                       node, + way for shop=supermarket only
    restaurant                    node only           (`out;`, no centres)

A facility whose grounds are drawn as a multipolygon is a *relation*, so it
never reached the count. 02620 Karakallio (8,783 residents) shipped "0 schools":
Rastaalan koulu is relation 20290074, and the cities' own service register
(TPR / palvelukartta) lists it at 02620 alongside Karakallion koulu. Restaurants
and cafés drawn as a building outline, and every convenience store drawn as one,
were invisible the same way.

THE CORRECTION

Every element type is counted (`nwr`, which prepare_data now asks for too), with
Overpass `out center` semantics: a node's position, or the centre of a way's or
relation's bounding box. The point is assigned with the pipeline's containment
rule — strict `contains`, first containing polygon wins — and `*_count` plus a
4-decimal `*_density` are rewritten for the five layers. cycling_density is not
touched (see services_honesty_2026_08.py for why it has no count).

The source is a full Finland extract rather than Overpass, because a national
`nwr` set is one file instead of 345 region queries; the element set is the same
OSM data the corrected queries return. The committed run used
download.openstreetmap.fr/extracts/europe/finland-latest.osm.pbf, replication
timestamp 2026-10-19T02:06:57Z (24,167 elements: 16,039 nodes, 7,943 ways,
185 relations). National totals, before -> after:

    grocery       2,487 ->  2,923    177 areas (293,616 residents) leave a false 0
    school        3,416 ->  3,443     17 areas  (48,876)
    daycare       2,805 ->  2,879     17 areas  (42,430)
    healthcare    2,761 ->  2,853      8 areas  (30,748)
    restaurant   10,343 -> 11,804    153 areas (199,394)

"Before" was also an older snapshot, so part of each change is OSM's own edits
since; the element-type share alone, measured on this extract, is +56 / +39 /
+31 relations for school / daycare / healthcare and +1,382 restaurants and +455
groceries that are ways or relations.

MEASURED, NOT CORRECTED

A facility drawn twice — a named pin inside its own outline — is counted twice,
as it always was. On this extract that is ~1-2 % per layer (a same-category node
inside a same-category outline whose names match, contain one another, or where
one side is unnamed). Most nodes inside another facility's outline are genuinely
separate — a lukio on a yhteiskoulu campus, a pharmacy inside a health station —
so a geometric de-duplication would remove real facilities, and a name-matching
one is too fragile to be worth its code.

amenity=school also carries OSM's own scope: vocational colleges and adult
education centres are often tagged with it (~13 % of the capital region's), and
a school with several buildings is sometimes mapped as several schools. Against
the cities' own service register (TPR) for Helsinki/Espoo/Vantaa/Kauniainen the
mean per-area error for schools falls from 1.09 to 0.88 with this pass.

WHAT THIS DOES NOT FIX

OSM tagging errors stay errors: way 458962978 "Karakallion koulu" (a grades 7–9
school per the city register) has been tagged amenity=kindergarten since an edit
on 2024-12-09, so it is counted as a daycare and not as a school until someone
corrects the tag in OSM. On this extract the report below lists 18 candidates,
17 of them schools by name, grades and edit history, mostly in Espoo and Tampere. This script reports such candidates
rather than overriding them — every value must trace back to the source.

Requires `pip install osmium` (pyosmium) in addition to requirements.txt.

The GeoJSON is rewritten with json.dump(data, f) — Python's DEFAULT
serialization — which is byte-identical to the committed file on a no-op round
trip, so `git diff` stays value-only.

Run `npm run build:data` afterwards to propagate into src/data.

Usage:
  python scripts/services_recount_2026_10.py --pbf finland-latest.osm.pbf [--dry-run]
"""

import argparse
import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
GEOJSON = ROOT / "public" / "data" / "metro_neighborhoods.geojson"

# layer -> (density property, count property)
LAYERS = {
    "grocery": ("grocery_density", "grocery_count"),
    "school": ("school_density", "school_count"),
    "daycare": ("daycare_density", "daycare_count"),
    "healthcare": ("healthcare_density", "healthcare_count"),
    "restaurant": ("restaurant_density", "restaurant_count"),
}

# Same as prepare_data.POI_DENSITY_DECIMALS (see the derivation there).
DENSITY_DECIMALS = 4


def layers_of(tags) -> list[str]:
    """The tag predicates of prepare_data's fetch_osm_* queries, one per layer."""
    amenity, shop = tags.get("amenity"), tags.get("shop")
    out = []
    if shop in ("supermarket", "convenience", "grocery"):
        out.append("grocery")
    if amenity == "school":
        out.append("school")
    if amenity in ("kindergarten", "childcare"):
        out.append("daycare")
    if amenity in ("hospital", "clinic", "doctors") or "healthcare" in tags:
        out.append("healthcare")
    if amenity in ("restaurant", "cafe", "bar", "fast_food"):
        out.append("restaurant")
    return out


def extract(pbf: str) -> list[dict]:
    """Every matching node, way and relation as {type, id, lon, lat, layers, name}.

    lon/lat follow Overpass `out center`: the node itself, or the centre of the
    element's bounding box. Relations are read first (they sit at the end of a
    sorted PBF) so the second pass knows which member ways and nodes to keep.
    """
    import osmium

    rels: dict[int, tuple[list[str], str | None, list[tuple[str, int]]]] = {}
    need = {"n": set(), "w": set()}
    for o in osmium.FileProcessor(pbf, osmium.osm.RELATION):
        tags = dict(o.tags)
        lay = layers_of(tags)
        if lay:
            members = [(m.type, m.ref) for m in o.members if m.type in ("n", "w")]
            rels[o.id] = (lay, tags.get("name"), members)
            for t, ref in members:
                need[t].add(ref)

    out: list[dict] = []
    member_bbox: dict[tuple[str, int], tuple[float, float, float, float]] = {}
    for o in osmium.FileProcessor(pbf).with_locations():
        if o.is_node():
            if not o.location.valid():
                continue
            x, y = o.location.lon, o.location.lat
            if o.id in need["n"]:
                member_bbox[("n", o.id)] = (x, y, x, y)
            lay = layers_of(o.tags)
            if lay:
                out.append({"type": "node", "id": o.id, "lon": x, "lat": y,
                            "layers": lay, "name": o.tags.get("name")})
        elif o.is_way():
            lay = layers_of(o.tags)
            if not lay and o.id not in need["w"]:
                continue
            pts = [(n.lon, n.lat) for n in o.nodes if n.location.valid()]
            if not pts:
                continue
            xs, ys = zip(*pts)
            bb = (min(xs), min(ys), max(xs), max(ys))
            if o.id in need["w"]:
                member_bbox[("w", o.id)] = bb
            if lay:
                out.append({"type": "way", "id": o.id, "lon": (bb[0] + bb[2]) / 2,
                            "lat": (bb[1] + bb[3]) / 2, "layers": lay,
                            "name": o.tags.get("name")})
        elif o.is_relation():
            break

    for rid, (lay, name, members) in rels.items():
        bbs = [member_bbox[m] for m in members if m in member_bbox]
        if not bbs:
            continue
        x0 = min(b[0] for b in bbs); y0 = min(b[1] for b in bbs)
        x1 = max(b[2] for b in bbs); y1 = max(b[3] for b in bbs)
        out.append({"type": "relation", "id": rid, "lon": (x0 + x1) / 2,
                    "lat": (y0 + y1) / 2, "layers": lay, "name": name})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", required=True, help="Finland OSM extract (.osm.pbf)")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change without writing")
    args = ap.parse_args()

    import osmium
    from shapely.geometry import Point, box, shape
    from shapely.strtree import STRtree

    header = osmium.io.Reader(args.pbf, osmium.osm.osm_entity_bits.NOTHING).header()
    print(f"PBF replication timestamp: "
          f"{header.get('osmosis_replication_timestamp', '(not recorded)')}")

    print("Extracting service POIs (nodes, ways and relations)...")
    pois = extract(args.pbf)
    by_type: dict[str, int] = {}
    for p in pois:
        by_type[p["type"]] = by_type.get(p["type"], 0) + 1
    print(f"  {len(pois)} elements: {by_type}")

    print(f"Reading {GEOJSON.name}...")
    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)
    features = data["features"]

    # The pipeline's containment rule (prepare_data._point_to_pno): strict
    # `contains`, first containing polygon wins.
    geoms, pnos = [], []
    for feat in features:
        geom = feat.get("geometry")
        if geom:
            g = shape(geom)
            if not g.is_empty:
                geoms.append(g)
                pnos.append(feat["properties"].get("pno", ""))
    tree = STRtree(geoms)

    counts: dict[str, dict[str, int]] = {layer: {} for layer in LAYERS}
    for p in pois:
        pt = Point(p["lon"], p["lat"])
        for ci in tree.query(pt):
            if geoms[ci].contains(pt):
                for layer in p["layers"]:
                    c = counts[layer]
                    c[pnos[ci]] = c.get(pnos[ci], 0) + 1
                break

    rescued = {layer: 0 for layer in LAYERS}
    rescued_pop = {layer: 0 for layer in LAYERS}
    changed = {layer: 0 for layer in LAYERS}
    before_total = {layer: 0 for layer in LAYERS}
    after_total = {layer: 0 for layer in LAYERS}

    for feat in features:
        props = feat["properties"]
        pno = props.get("pno", "")
        area_m2 = props.get("pinta_ala")
        area_km2 = (area_m2 / 1_000_000) if isinstance(area_m2, (int, float)) and area_m2 > 0 else None
        for layer, (density_key, count_key) in LAYERS.items():
            before = props.get(count_key)
            count = counts[layer].get(pno, 0) if area_km2 is not None else None
            before_total[layer] += before or 0
            after_total[layer] += count or 0
            if before == 0 and count:
                rescued[layer] += 1
                rescued_pop[layer] += props.get("he_vakiy") or 0
            if before != count:
                changed[layer] += 1
            props[count_key] = count
            props[density_key] = (round(count / area_km2, DENSITY_DECIMALS)
                                  if area_km2 is not None else None)

    print(f"\n{'layer':<12}{'before':>8}{'after':>8}{'changed':>9}   was 0, now >=1")
    for layer in LAYERS:
        print(f"{layer:<12}{before_total[layer]:>8}{after_total[layer]:>8}{changed[layer]:>9}"
              f"   {rescued[layer]:>4} areas, {rescued_pop[layer]:>9,} residents")

    # Tagging that contradicts the name — reported, never overridden. A daycare
    # named *koulu with no school element within 250 m is a school missing from
    # school_count (and counted as a daycare); a Montessori "leikkikoulu" or an
    # "esiopetus" group is a real daycare and is left out of the report.
    school_pts = [Point(p["lon"], p["lat"]) for p in pois if "school" in p["layers"]]
    school_tree = STRtree(school_pts)
    suspects = []
    for p in pois:
        name = (p["name"] or "").lower()
        if ("daycare" not in p["layers"] or "school" in p["layers"] or "koulu" not in name
                or any(k in name for k in ("päiväkoti", "esikoulu", "leikkikoulu", "esiopetus", "kerho"))):
            continue
        # ±250 m: 0.00225° of latitude, 0.0045° of longitude at ~60°N
        near = school_tree.query(box(p["lon"] - 0.0045, p["lat"] - 0.00225,
                                     p["lon"] + 0.0045, p["lat"] + 0.00225))
        if not len(near):
            suspects.append(p)
    if suspects:
        print(f"\n{len(suspects)} OSM elements named *koulu are tagged as daycares with no "
              f"amenity=school within ~250 m — check the tag in OSM:")
        for p in sorted(suspects, key=lambda p: (p["type"], p["id"])):
            print(f"  {p['type']}/{p['id']}  {p['name']}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"\nWrote {GEOJSON}")
    print("Next: npm run build:data")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
