#!/usr/bin/env python3
"""
Fetch tree-canopy polygons with MEASURED heights, for the /live/ shadow layer.

Source: HSY's land-cover classification (maanpeite), derived from laser scanning,
served as WFS from kartta.hsy.fi. Open data, no API key. The same server this
repo already uses for air quality and tree-canopy coverage.

  https://kartta.hsy.fi/geoserver/wfs

WHY TREES AT ALL. Without them a park is drawn as fully sunlit when it is the
shadiest ground in the city, and a tree-lined street reads as open. ShadeMap
sells exactly this as its premium tier ("building, roof and TREE heights exact
to within 30 cm", from LiDAR); HSY gives the equivalent away for the Helsinki
region.

WHY THIS SOURCE AND NOT THE TREE REGISTER. Helsinki also publishes
`avoindata:Puurekisteri_piste` — 64,533 individual trees with species. It is
useless here: its size attribute (`kokoluokka`) is TRUNK DIAMETER, not height,
and it carries no crown radius, so casting a shadow from it would mean inventing
both. It also covers only city-maintained street and park trees. This layer
carries a real measured height instead.

WHICH HEIGHT. Each polygon has both a band (the layer it came from, e.g.
"puusto, 15 m - 20 m") and `korkeus_ka_m`, the MEAN canopy height. Sampled 400
polygons per band: `korkeus_ka_m` is populated on 100 % of them and tracks the
bands monotonically (medians 5.6 / 10.6 / 13.7 / 18.3 m) while sitting below each
band label, because the band is the dominant class and this is the mean. The
mean is the measured, per-polygon, complete value, so that is what is cast — it
understates the tallest individual trees inside a polygon rather than
overstating the whole polygon, which is the right way round to be wrong.

AXIS ORDER. This server wants BBOX as north,east (lat,lon) for EPSG:3879 — the
OPPOSITE of the Helsinki 3DCityDB WFS that fetch_helsinki_buildings.py talks to.
Getting it wrong returns HTTP 200 with zero features, which reads exactly like
"there are no trees here". Verified: the same tile returns 0 with east,north and
617 with north,east.

Output: public/data/canopy_helsinki.geojson
        Feature per canopy polygon; properties: {"h": <metres>}

Usage:
    python scripts/fetch_hsy_canopy.py
    python scripts/fetch_hsy_canopy.py --bbox 25496000,6672000,25497000,6673000
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Polygon

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

WFS_URL = "https://kartta.hsy.fi/geoserver/wfs"

SOURCE_CRS = "EPSG:3879"
TRANSFORMER = Transformer.from_crs(SOURCE_CRS, "EPSG:4326", always_xy=True)

# The four canopy height bands. All are fetched; the per-polygon measured mean is
# what actually gets cast, so the band only decides which requests are made.
#
# The 2-10 m band is included despite being the shortest: at a low sun a 6 m tree
# still throws a 30 m shadow, and excluding it would leave visible holes in the
# shade of exactly the low scrub and young street trees that line residential
# roads.
LAYERS = (
    "asuminen_ja_maankaytto:maanpeite_puusto_2_10m_2024",
    "asuminen_ja_maankaytto:maanpeite_puusto_10_15m_2024",
    "asuminen_ja_maankaytto:maanpeite_puusto_15_20m_2024",
    "asuminen_ja_maankaytto:maanpeite_puusto_yli20m_2024",
)

PAGE_SIZE = 1000
TILE_METRES = 1000

# The extent that is SHIPPED — identical to the building shard's, so the two
# cover the same ground. A viewport with buildings but no trees would read as a
# treeless city rather than as an edge of coverage.
DEFAULT_BBOX = (25494000, 6671000, 25500000, 6677000)

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT / "public" / "data" / "canopy_helsinki.geojson"

COORD_PRECISION = 6

# Coarser than the 0.5 m used for buildings. These outlines are raster-derived
# and jagged — a median of 41 vertices for a 49 m² patch — and unlike a building
# a crown has no true edge to preserve. 1.5 m is well inside the classification's
# own resolution.
SIMPLIFY_METRES = 1.5

# Below this a patch is a bush, not a shade-caster, and it costs the same to draw
# as a real tree. Measured: no polygons in the sample fall under 20 m², so this
# mainly guards against slivers left by simplification.
MIN_AREA_M2 = 10.0

REQUEST_TIMEOUT = 300
RETRIES = 4


def _get(url: str) -> bytes:
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001 - retry on anything transient
            last = exc
            wait = 2 ** attempt
            logger.warning("request failed (%s), retrying in %ds", exc, wait)
            time.sleep(wait)
    raise RuntimeError(f"WFS request failed after {RETRIES} attempts: {last}")


def _url(layer: str, bbox: tuple[float, float, float, float], start_index: int) -> str:
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": layer,
        "outputFormat": "application/json",
        "count": str(PAGE_SIZE),
        "startIndex": str(start_index),
        # north,east — see the module docstring. Silent zero-result trap.
        "BBOX": f"{bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]},urn:ogc:def:crs:EPSG::3879",
    }
    return f"{WFS_URL}?{urllib.parse.urlencode(params)}"


def _rings(geometry: dict) -> list[list[tuple[float, float]]]:
    """Exterior rings only — a hole in a canopy patch is below our shadow detail."""
    kind = geometry.get("type")
    if kind == "Polygon":
        return [[(x, y) for x, y, *_ in geometry["coordinates"][0]]]
    if kind == "MultiPolygon":
        return [[(x, y) for x, y, *_ in poly[0]] for poly in geometry["coordinates"]]
    return []


def fetch_tile(layer: str, bbox: tuple[float, float, float, float]) -> list[dict]:
    features: list[dict] = []
    start_index = 0
    skipped_no_height = 0
    skipped_small = 0

    while True:
        payload = json.loads(_get(_url(layer, bbox, start_index)))
        batch = payload.get("features", [])
        if not batch:
            break

        for feature in batch:
            height = feature.get("properties", {}).get("korkeus_ka_m")
            if not isinstance(height, (int, float)) or height <= 0:
                skipped_no_height += 1
                continue
            for ring in _rings(feature.get("geometry") or {}):
                if len(ring) < 4:
                    continue
                polygon = Polygon(ring)
                if not polygon.is_valid or polygon.area < MIN_AREA_M2:
                    skipped_small += 1
                    continue
                reduced = polygon.simplify(SIMPLIFY_METRES, preserve_topology=True)
                shape = reduced if (not reduced.is_empty and reduced.exterior is not None) else polygon
                coords_src = list(shape.exterior.coords)
                if len(coords_src) < 4:
                    coords_src = ring
                coords = [
                    [round(lon, COORD_PRECISION), round(lat, COORD_PRECISION)]
                    for lon, lat in (TRANSFORMER.transform(x, y) for x, y in coords_src)
                ]
                if coords[0] != coords[-1]:
                    coords.append(coords[0])
                if len(coords) < 4:
                    continue
                features.append(
                    {
                        "type": "Feature",
                        "properties": {"h": round(float(height), 1)},
                        "geometry": {"type": "Polygon", "coordinates": [coords]},
                    }
                )

        start_index += len(batch)
        if len(batch) < PAGE_SIZE:
            break

    if skipped_no_height or skipped_small:
        logger.info(
            "  %s: skipped %d without a height, %d below %.0f m2",
            layer.rsplit(":", 1)[-1],
            skipped_no_height,
            skipped_small,
            MIN_AREA_M2,
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
    parser.add_argument("--bbox", help="Extent in EPSG:3879 as minx,miny,maxx,maxy.")
    parser.add_argument("--output", help="Output path.")
    args = parser.parse_args()

    bbox = DEFAULT_BBOX
    if args.bbox:
        parts = [float(v) for v in args.bbox.split(",")]
        if len(parts) != 4:
            parser.error("--bbox needs four comma-separated numbers")
        bbox = (parts[0], parts[1], parts[2], parts[3])

    output = Path(args.output) if args.output else OUTPUT_FILE
    tile_list = tiles(bbox)
    logger.info("Fetching %d tiles x %d bands over %s", len(tile_list), len(LAYERS), bbox)

    features: list[dict] = []
    for index, tile in enumerate(tile_list, 1):
        logger.info("[%d/%d] tile %s", index, len(tile_list), tile)
        for layer in LAYERS:
            try:
                features.extend(fetch_tile(layer, tile))
            except Exception as exc:  # noqa: BLE001
                # One unreachable band must not discard the run; the gap simply
                # renders as unshaded ground, and the log says which.
                logger.error("tile %s band %s failed: %s", tile, layer, exc)

    if not features:
        logger.error("No canopy fetched — refusing to write an empty dataset.")
        return 1

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
        + "\n",
        encoding="utf-8",
    )

    heights = sorted(f["properties"]["h"] for f in features)
    logger.info(
        "Wrote %d canopy polygons to %s (%.1f MB); heights %.1f / %.1f / %.1f m (min/median/max)",
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
