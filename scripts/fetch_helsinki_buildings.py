#!/usr/bin/env python3
"""
Fetch building footprints and MEASURED heights for the /live/ shadow layer.

Source: the City of Helsinki 3D city model, served as CityGML through the
3DCityDB WFS at kartta.hel.fi. Open data, CC BY 4.0, no API key.

  https://kartta.hel.fi/3d/citydb-wfs/wfs

WHY THIS SOURCE. The shadow layer needs a height per building, and the three
candidates for the Helsinki region are not close. Measured, not assumed:

  HSY building register (`kerrosten_lkm`)   472 / 3,000  = 15.7 %
  OpenStreetMap, Helsinki centre            1,413 / 2,283 = 61.9 %
  This source (`bldg:measuredHeight`)       400 / 400     = 100 %

and only this one is a *measurement* — the other two are storey counts multiplied
by an assumed floor height. ShadeMap's free tier uses the OSM storey counts;
their LiDAR-derived heights are the paid tier. Helsinki gives that quality away.

WHY A BUILD-TIME PIPELINE rather than a runtime query like the OSM fallback:
CityGML is enormous. A downtown building serialises to ~57 kB of LOD2 wall and
roof surfaces, so a single screenful of Kamppi is several megabytes — fine to
fetch once in CI, impossible to fetch per map pan. This script keeps only what a
2D shadow needs (the ground-surface outer ring plus one height number), which is
~150 bytes per building, and writes GeoJSON for the TopoJSON build step.

Output: public/data/buildings_helsinki.geojson
        Feature per building; properties: {"h": <metres>}

Usage:
    python scripts/fetch_helsinki_buildings.py            # full configured extent
    python scripts/fetch_helsinki_buildings.py --bbox 25496000,6672000,25499000,6675000
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Polygon

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

WFS_URL = "https://kartta.hel.fi/3d/citydb-wfs/wfs"

# The city model publishes geometry in GK25FIN (Helsinki's local plane); the app
# needs WGS84. Always ETRS-TM35FIN-family axis order east/north, so xy=True.
SOURCE_CRS = "EPSG:3879"
TRANSFORMER = Transformer.from_crs(SOURCE_CRS, "EPSG:4326", always_xy=True)

NS = {
    "wfs": "http://www.opengis.net/wfs/2.0",
    "gml": "http://www.opengis.net/gml",
    "bldg": "http://www.opengis.net/citygml/building/2.0",
}

# Server-side page size. The WFS caps what it will return per request; paging with
# STARTINDEX against numberMatched is the documented way through a large extent.
PAGE_SIZE = 200

# Tile the extent so no single request has to enumerate the whole city. 1 km in
# GK25FIN units (metres) keeps a downtown tile's response to a few tens of MB.
TILE_METRES = 1000

# Central Helsinki in EPSG:3879 — the extent that is actually SHIPPED, so a
# scheduled refresh reproduces the committed shard instead of silently changing
# what the app serves.
#
# Deliberately not the city's full extent. That is roughly 420 tiles against a
# public WFS at tens of seconds each — hours of CI for an artifact an order of
# magnitude larger, to cover suburbs where the shadow layer is far less useful
# and OSM already fills in. This 6x6 km box yields 9,146 buildings / 1.5 MB
# TopoJSON (399 kB gzipped) and covers the dense core where shadows matter.
#
# Widening it is a real decision with a real payload cost, so make it here rather
# than by passing --bbox in CI: the committed default and the shipped data must
# not be able to disagree.
DEFAULT_BBOX = (25494000, 6671000, 25500000, 6677000)

# Only what a 2D shadow needs. Cuts the response ~45 % versus the full feature by
# dropping the LOD2 wall/roof surfaces we never read.
PROPERTY_NAME = "bldg:measuredHeight,bldg:boundedBy"

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT / "public" / "data" / "buildings_helsinki.geojson"

# Coordinate precision. 6 decimal places is ~0.1 m at this latitude — far finer
# than the model's own accuracy, and it halves the file versus full float repr.
COORD_PRECISION = 6

# Douglas-Peucker tolerance in METRES, applied in the source projection before
# reprojecting. LOD2 ground surfaces carry every architectural jog — rings run to
# 600+ vertices — but a cast shadow is a silhouette, and half a metre of outline
# detail is far below one screen pixel at the zooms this layer draws at. This is
# purely a payload measure and does not change what the shadow looks like.
SIMPLIFY_METRES = 0.5

REQUEST_TIMEOUT = 300
RETRIES = 4


def _get(url: str) -> bytes:
    """GET with retries. The WFS is a public service and does time out under load."""
    last_error: Exception | None = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001 - retry on anything transient
            last_error = exc
            wait = 2 ** attempt
            logger.warning("request failed (%s), retrying in %ds", exc, wait)
            time.sleep(wait)
    raise RuntimeError(f"WFS request failed after {RETRIES} attempts: {last_error}")


def _feature_url(bbox: tuple[float, float, float, float], start_index: int) -> str:
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": "bldg:Building",
        "COUNT": str(PAGE_SIZE),
        "STARTINDEX": str(start_index),
        "PROPERTYNAME": PROPERTY_NAME,
        "BBOX": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},urn:ogc:def:crs:EPSG::{SOURCE_CRS.split(':')[1]}",
    }
    return f"{WFS_URL}?{urllib.parse.urlencode(params)}"


def _ground_ring(building: ET.Element) -> list[tuple[float, float]] | None:
    """
    The building's ground-surface outer ring, in source coordinates.

    CityGML posLists here are 3D (easting, northing, z) and the z is the ground
    elevation, which a flat shadow does not use — so it is dropped rather than
    carried into the output. Returns None when the feature has no ground surface,
    which happens for a small number of records and is why the caller counts
    skips instead of assuming every building yields geometry.
    """
    for ground in building.iter(f"{{{NS['bldg']}}}GroundSurface"):
        for pos_list in ground.iter(f"{{{NS['gml']}}}posList"):
            if not pos_list.text:
                continue
            values = [float(v) for v in pos_list.text.split()]
            if len(values) < 12:  # fewer than 4 3D points cannot close a ring
                continue
            return [(values[i], values[i + 1]) for i in range(0, len(values), 3)]
    return None


def _measured_height(building: ET.Element) -> float | None:
    node = building.find(f"{{{NS['bldg']}}}measuredHeight")
    if node is None or not node.text:
        return None
    try:
        height = float(node.text)
    except ValueError:
        return None
    # A zero or negative height casts no shadow but would still be counted as
    # "has height data", overstating coverage. Reject it the same way the OSM
    # parser rejects a junk `height` tag.
    return height if height > 0 else None


def fetch_tile(bbox: tuple[float, float, float, float]) -> list[dict]:
    """Every building in one tile, paged to exhaustion."""
    features: list[dict] = []
    start_index = 0
    matched: int | None = None
    skipped_no_geom = 0
    skipped_no_height = 0

    while True:
        raw = _get(_feature_url(bbox, start_index))
        root = ET.fromstring(raw)

        if matched is None:
            matched = int(root.attrib.get("numberMatched", 0) or 0)
        returned = int(root.attrib.get("numberReturned", 0) or 0)
        if returned == 0:
            break

        for building in root.iter(f"{{{NS['bldg']}}}Building"):
            height = _measured_height(building)
            if height is None:
                skipped_no_height += 1
                continue
            ring = _ground_ring(building)
            if ring is None:
                skipped_no_geom += 1
                continue

            # Simplify in metres, before reprojection — a degree tolerance would
            # be anisotropic (a degree of longitude is half a degree of latitude
            # at this latitude) and would distort east-west outlines.
            simplified = ring
            if len(ring) > 5:
                polygon = Polygon(ring)
                if polygon.is_valid:
                    reduced = polygon.simplify(SIMPLIFY_METRES, preserve_topology=True)
                    if not reduced.is_empty and reduced.exterior is not None:
                        candidate = list(reduced.exterior.coords)
                        # Simplification can collapse a thin building to a sliver;
                        # keep the original rather than emit a degenerate ring.
                        if len(candidate) >= 4:
                            simplified = candidate

            lon_lat = [TRANSFORMER.transform(x, y) for x, y in simplified]
            coords = [
                [round(lon, COORD_PRECISION), round(lat, COORD_PRECISION)]
                for lon, lat in lon_lat
            ]
            # Close the ring explicitly — GeoJSON requires it and the shadow
            # sweep needs the final edge.
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            if len(coords) < 4:
                skipped_no_geom += 1
                continue

            features.append(
                {
                    "type": "Feature",
                    "properties": {"h": round(height, 1)},
                    "geometry": {"type": "Polygon", "coordinates": [coords]},
                }
            )

        start_index += returned
        if matched and start_index >= matched:
            break

    if skipped_no_geom or skipped_no_height:
        logger.info(
            "  tile skipped %d without ground geometry, %d without a usable height",
            skipped_no_geom,
            skipped_no_height,
        )
    return features


def tiles(bbox: tuple[float, float, float, float]) -> list[tuple[float, float, float, float]]:
    min_x, min_y, max_x, max_y = bbox
    out = []
    x = min_x
    while x < max_x:
        y = min_y
        while y < max_y:
            out.append((x, y, min(x + TILE_METRES, max_x), min(y + TILE_METRES, max_y)))
            y += TILE_METRES
        x += TILE_METRES
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bbox",
        help="Extent in EPSG:3879 as minx,miny,maxx,maxy. Defaults to the whole city.",
    )
    parser.add_argument(
        "--output",
        help="Output path. Defaults to public/data/buildings_helsinki.geojson.",
    )
    args = parser.parse_args()

    bbox = DEFAULT_BBOX
    if args.bbox:
        parts = [float(v) for v in args.bbox.split(",")]
        if len(parts) != 4:
            parser.error("--bbox needs four comma-separated numbers")
        bbox = (parts[0], parts[1], parts[2], parts[3])

    output = Path(args.output) if args.output else OUTPUT_FILE

    tile_list = tiles(bbox)
    logger.info("Fetching %d tiles covering %s", len(tile_list), bbox)

    features: list[dict] = []
    for index, tile in enumerate(tile_list, 1):
        logger.info("[%d/%d] tile %s", index, len(tile_list), tile)
        try:
            features.extend(fetch_tile(tile))
        except Exception as exc:  # noqa: BLE001
            # One unreachable tile must not discard the whole run; the missing
            # area simply falls back to OSM at runtime, which is exactly what the
            # fallback exists for. Fail loudly in the log so it is not silent.
            logger.error("tile %s failed, leaving it to the OSM fallback: %s", tile, exc)

    if not features:
        logger.error("No buildings fetched — refusing to write an empty dataset.")
        return 1

    collection = {
        "type": "FeatureCollection",
        "features": features,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    # Compact separators: this file is machine-read only and the whitespace would
    # be a meaningful fraction of it.
    output.write_text(
        json.dumps(collection, separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    heights = sorted(f["properties"]["h"] for f in features)
    logger.info(
        "Wrote %d buildings to %s (%.1f MB); heights %.1f / %.1f / %.1f m (min/median/max)",
        len(features),
        output,
        output.stat().st_size / 1_048_576,
        heights[0],
        heights[len(heights) // 2],
        heights[-1],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
