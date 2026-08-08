#!/usr/bin/env python3
"""
Fetch a terrain elevation pyramid for the /live/ shadow layer.

Source: Terrain Tiles on AWS Open Data (the Mapzen "terrarium" tileset), an
aggregate of national and global public DEMs. Open, no API key.

  https://registry.opendata.aws/terrain-tiles/

WHY WE MIRROR IT INSTEAD OF FETCHING AT RUNTIME. Not a preference — a hard
constraint. No free DEM tile endpoint sends `Access-Control-Allow-Origin`:
s3.amazonaws.com/elevation-tiles-prod, its dualstack and /v2/ paths all answer
200 with no CORS header. A browser can therefore never read their pixels: drawing
one to a canvas taints it and `getImageData` throws, and a bare `fetch` is
blocked outright. That applies no matter who issues the request, MapLibre's own
raster-dem source included. Serving the tiles from our own origin is the only way
the shadow pass can see elevations at all.

WHY NOT NLS. Maanmittauslaitos is the authoritative Finnish source and our key
reaches it, but its elevation products are 2 m and 10 m map sheets with no
downsampling endpoint — assembling a ~300 m national grid from them means pulling
several hundred GB to throw almost all of it away. This tileset is already
pyramided at the resolutions the shadow pass actually consumes.

ENCODING. Terrarium packs elevation as (R*256 + G + B/256) - 32768 metres, which
carries sub-millimetre precision in B. That precision is noise at these cell
sizes and it is expensive: the B channel is incompressible, and it is why an
untouched sea tile costs 98 kB. We re-encode to

    stored = round(max(elevation, 0) / ELEVATION_QUANT)
    R = stored >> 8,  G = stored & 255,  B = 0

which is 0.5 m precision over 0..32 km, and drops the mean tile from 57 kB to
22 kB. Two deliberate choices in that line:

  * `max(elevation, 0)` discards bathymetry. Water casts no shadow, and leaving
    the sea floor in costs more than all the land put together — a Baltic tile
    goes 98 kB -> 10 kB once it is flat.
  * 0.5 m rather than 1 m. A quantisation step reads as a terrace to the shadow
    sweep, and at a 287 m cell a 1 m step is a 0.2 degree slope — the same order
    as the sun's altitude just before it sets, which is exactly when the layer is
    being looked at. Halving the step costs about 5 % of the payload.

PYRAMID. z6/z7/z8 over Finland, ~265 tiles and ~5.5 MB total. The runtime picks a
zoom from the camera (see src/live/terrain.ts) and fetches only the handful of
tiles the viewport covers, so a city view costs a few hundred kB, not the pyramid.
z8 is ~287 m/px at 62 N, which is the resolution the shadow pass needs by the time
individual buildings take over at DETAIL_MIN_ZOOM.

NOT PART OF `npm run build:data`, AND NOT ON THE MONTHLY REFRESH. It reaches the
network, so re-running it cannot be byte-reproducible and it would break the
build:data idempotency gate. Unlike the building and canopy fetches it is also
not worth scheduling: bedrock does not move, and re-pulling 265 tiles a month to
get the same bytes back would only add a way for the committed pyramid to drift.
Run it by hand if the upstream tileset is ever reissued.

Usage:
    python scripts/fetch_terrain_dem.py
    python scripts/fetch_terrain_dem.py --zooms 8      # refresh one level
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import math
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

# Finland plus enough margin that a viewport on the border still has terrain on
# both sides of it. Shadows cross borders.
BBOX = (19.0, 59.5, 31.6, 70.1)

ZOOMS = (6, 7, 8)
TILE_SIZE = 256

# Metres per stored unit — see the ENCODING note above.
ELEVATION_QUANT = 0.5

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "terrain"
MANIFEST = ROOT / "src" / "data" / "terrain_manifest.json"

REQUEST_TIMEOUT = 120
RETRIES = 4
WORKERS = 12


def deg2tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def _get(url: str) -> bytes | None:
    """GET with retries. Returns None for a genuine 404 (tile outside coverage)."""
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            last = exc
        except Exception as exc:  # noqa: BLE001 - retry anything transient
            last = exc
        time.sleep(2**attempt)
    raise RuntimeError(f"tile fetch failed after {RETRIES} attempts: {url}: {last}")


def encode_tile(raw: bytes) -> bytes:
    """Terrarium RGB -> our quantised R/G encoding. See the module docstring."""
    src = np.array(Image.open(io.BytesIO(raw)).convert("RGB")).astype(np.float64)
    elevation = (src[:, :, 0] * 256.0 + src[:, :, 1] + src[:, :, 2] / 256.0) - 32768.0
    # Clamp below at zero: bathymetry is discarded, and the clip also removes the
    # terrarium no-data sentinel, which sits far below any real sea floor.
    stored = np.clip(np.round(np.maximum(elevation, 0.0) / ELEVATION_QUANT), 0, 65535).astype(
        np.uint32
    )
    out = np.zeros((src.shape[0], src.shape[1], 3), dtype=np.uint8)
    out[:, :, 0] = (stored >> 8) & 255
    out[:, :, 1] = stored & 255
    buf = io.BytesIO()
    # optimize + max compression: this runs once in CI and the bytes ship forever.
    Image.fromarray(out).save(buf, format="PNG", optimize=True, compress_level=9)
    return buf.getvalue()


def fetch_zoom(z: int) -> dict:
    x0, y0 = deg2tile(BBOX[0], BBOX[3], z)
    x1, y1 = deg2tile(BBOX[2], BBOX[1], z)
    coords = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    logger.info("z%d: %d tiles (x %d..%d, y %d..%d)", z, len(coords), x0, x1, y0, y1)

    written = 0
    total_bytes = 0
    missing: list[tuple[int, int]] = []

    def one(coord: tuple[int, int]) -> tuple[tuple[int, int], int | None]:
        x, y = coord
        raw = _get(TILE_URL.format(z=z, x=x, y=y))
        if raw is None:
            return coord, None
        data = encode_tile(raw)
        path = OUT_DIR / str(z) / str(x) / f"{y}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return coord, len(data)

    with ThreadPoolExecutor(WORKERS) as pool:
        for coord, size in pool.map(one, coords):
            if size is None:
                missing.append(coord)
            else:
                written += 1
                total_bytes += size

    if missing:
        logger.warning("z%d: %d tiles absent upstream (outside coverage)", z, len(missing))
    # A whole level coming back empty means the endpoint moved or the bbox is
    # wrong. Writing that manifest would ship a terrain layer that renders
    # nothing, which on this map is indistinguishable from flat ground.
    if written == 0:
        raise RuntimeError(f"z{z}: no tiles fetched — refusing to write an empty level")

    logger.info("z%d: wrote %d tiles, %.2f MB", z, written, total_bytes / 1_048_576)
    return {
        "minX": x0,
        "maxX": x1,
        "minY": y0,
        "maxY": y1,
        "tiles": written,
        "bytes": total_bytes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--zooms",
        help=f"Comma-separated zoom levels. Defaults to {','.join(map(str, ZOOMS))}.",
    )
    args = parser.parse_args()

    zooms = [int(v) for v in args.zooms.split(",")] if args.zooms else list(ZOOMS)

    manifest = {
        "_comment": (
            "Terrain elevation pyramid for the /live/ shadow layer. Written by "
            "scripts/fetch_terrain_dem.py. Elevation metres = (R * 256 + G) * quant; "
            "bathymetry is clamped to 0. Source: Terrain Tiles on AWS Open Data "
            "(Mapzen terrarium), mirrored because no free DEM endpoint sends CORS."
        ),
        "path": "data/terrain/{z}/{x}/{y}.png",
        "tileSize": TILE_SIZE,
        "quant": ELEVATION_QUANT,
        "bbox": list(BBOX),
        "zooms": {},
    }
    if MANIFEST.exists():
        try:
            existing = json.loads(MANIFEST.read_text(encoding="utf-8"))
            manifest["zooms"] = existing.get("zooms", {})
        except json.JSONDecodeError:
            pass

    for z in zooms:
        manifest["zooms"][str(z)] = fetch_zoom(z)

    manifest["zooms"] = dict(sorted(manifest["zooms"].items(), key=lambda kv: int(kv[0])))

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    total = sum(v["bytes"] for v in manifest["zooms"].values())
    tiles = sum(v["tiles"] for v in manifest["zooms"].values())
    logger.info("Wrote %s — %d tiles, %.2f MB total", MANIFEST, tiles, total / 1_048_576)
    return 0


if __name__ == "__main__":
    sys.exit(main())
