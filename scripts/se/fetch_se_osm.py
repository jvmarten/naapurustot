#!/usr/bin/env python3
"""Count OpenStreetMap services per Swedish DeSO area -> scripts/se/osm_deso.json.

The same tag sets prepare_data.py asks Overpass for in Finland, read here from a whole
Sweden extract instead (Overpass is not reachable from every machine this runs on, and
one national file cannot come back partial the way 69 bbox queries can):

  healthcare   nwr amenity=hospital|clinic|doctors, or any healthcare=*
  grocery      nwr shop=supermarket|convenience|grocery
  restaurant   nwr amenity=restaurant|cafe|bar|fast_food
  cycling      way highway=cycleway, cycleway=lane|track, bicycle=designated
  transit      node highway=bus_stop, railway=station|halt|tram_stop

A way is placed by the centre of its bounding box and a multipolygon relation by the
centre of its area's bounding box, which is what Overpass's `out center` returns. The
cycling figure counts way RECORDS, as in Finland, so like Finland's it has no count
column (see `_assign_poi_density`). Transit is OSM's stop register, not a national one:
Sweden's (Trafiklab's GTFS Sverige) needs an API key, and Finland's Digiroad has no
Swedish counterpart. A stop mapped once per direction counts twice, as in Digiroad.

Every DeSO is covered by the one extract, so an area missing from a category's counts
holds zero of that thing: the output lists only non-zero areas, and build_se_geojson.py
writes the zeros. The snapshot date is the extract's own replication timestamp.

Usage: python scripts/se/fetch_se_osm.py <sweden-latest.osm.pbf>
       (download.openstreetmap.fr/extracts/europe/sweden-latest.osm.pbf, ODbL)
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import osmium
from shapely import STRtree, points
from shapely.geometry import shape

HERE = Path(__file__).resolve().parent
RAW = HERE / "cache" / "deso_2025_raw.geojson"
OUT = HERE / "osm_deso.json"

HEALTHCARE_AMENITY = {"hospital", "clinic", "doctors"}
GROCERY_SHOP = {"supermarket", "convenience", "grocery"}
RESTAURANT_AMENITY = {"restaurant", "cafe", "bar", "fast_food"}
TRANSIT_RAILWAY = {"station", "halt", "tram_stop"}


def poi_categories(tags) -> list[str]:
    cats = []
    amenity = tags.get("amenity")
    if amenity in HEALTHCARE_AMENITY or "healthcare" in tags:
        cats.append("healthcare")
    if tags.get("shop") in GROCERY_SHOP:
        cats.append("grocery")
    if amenity in RESTAURANT_AMENITY:
        cats.append("restaurant")
    return cats


def is_cycling(tags) -> bool:
    return (tags.get("highway") == "cycleway" or tags.get("cycleway") in ("lane", "track")
            or tags.get("bicycle") == "designated")


def is_transit(tags) -> bool:
    return tags.get("highway") == "bus_stop" or tags.get("railway") in TRANSIT_RAILWAY


def bbox_centre(locations) -> tuple[float, float] | None:
    xs, ys = [], []
    for loc in locations:
        if loc.valid():
            xs.append(loc.lon)
            ys.append(loc.lat)
    if not xs:
        return None
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def collect(pbf: str) -> dict[str, list[tuple[float, float]]]:
    """Point per tagged element, per category. Each OSM object is counted once per category."""
    pts: dict[str, list[tuple[float, float]]] = defaultdict(list)
    fp = osmium.FileProcessor(pbf).with_locations().with_areas()
    for obj in fp:
        tags = obj.tags
        if not len(tags):
            continue
        if isinstance(obj, osmium.osm.Node):
            cats = poi_categories(tags)
            if is_transit(tags):
                cats.append("transit")
            if cats and obj.location.valid():
                for c in cats:
                    pts[c].append((obj.location.lon, obj.location.lat))
        elif isinstance(obj, osmium.osm.Way):
            cats = poi_categories(tags)
            if is_cycling(tags):
                cats.append("cycling")
            if cats:
                c = bbox_centre(n.location for n in obj.nodes)
                if c:
                    for cat in cats:
                        pts[cat].append(c)
        elif isinstance(obj, osmium.osm.Area) and not obj.from_way():
            # Areas assembled from multipolygon relations; closed ways are counted above.
            cats = poi_categories(tags)
            if cats:
                c = bbox_centre(n.location for ring in obj.outer_rings() for n in ring)
                if c:
                    for cat in cats:
                        pts[cat].append(c)
    return pts


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    pbf = sys.argv[1]
    if not RAW.exists():
        raise SystemExit(f"{RAW} missing — run scripts/se/fetch_se_boundaries.py first")

    reader = osmium.io.Reader(pbf, osmium.osm.osm_entity_bits.NOTHING)
    snapshot = reader.header().get("osmosis_replication_timestamp")
    reader.close()
    if not snapshot:
        raise SystemExit("extract has no replication timestamp; refusing to write an undated snapshot")

    fc = json.loads(RAW.read_text())
    codes = [f["properties"]["deso"] for f in fc["features"]]
    geoms = [shape(f["geometry"]) for f in fc["features"]]
    tree = STRtree(geoms)

    pts = collect(pbf)
    counts: dict[str, dict[str, int]] = {}
    for cat in ("healthcare", "grocery", "restaurant", "cycling", "transit"):
        xy = pts.get(cat, [])
        if not xy:
            raise SystemExit(f"no {cat} elements in the extract — refusing to write all-zero counts")
        # predicate='within' pairs each point with the polygon containing it; a point on a
        # shared edge can match two, so keep the first per point.
        pi, gi = tree.query(points(xy), predicate="within")
        placed: dict[int, int] = {}
        for p, g in zip(pi.tolist(), gi.tolist()):
            placed.setdefault(p, g)
        c: dict[str, int] = defaultdict(int)
        for g in placed.values():
            c[codes[g]] += 1
        counts[cat] = dict(sorted(c.items()))
        print(f"{cat}: {len(xy)} elements, {len(placed)} inside a DeSO, {len(c)} areas", file=sys.stderr)

    OUT.write_text(json.dumps({
        "source": "OpenStreetMap contributors (ODbL), Sweden extract",
        "snapshot": snapshot,
        "counts": counts,
    }, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"wrote {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
