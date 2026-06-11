#!/usr/bin/env python3
"""Compute the share of each postal-code area's land inside the 1/100a flood hazard zone.

Data source: SYKE (Finnish Environment Institute) & ELY-keskukset flood hazard
maps, served via the Ymparisto ArcGIS REST MapServer (CC BY 4.0,
attribution "Lähde: Syke ja ELY-keskukset"):

  https://paikkatieto.ymparisto.fi/arcgis/rest/services/Tulva/
      Tulvariskiaineistot_perusskenaariot_toistuvuuksittain/MapServer

Layers used:
  * 3   = fluvial (vesistötulva) "kartoitetut alueet" — mapped-extent polygons (~110)
  * 56  = coastal (meritulva)    "kartoitetut alueet" — mapped-extent polygons (~9)
  * 22  = fluvial 1/100a (1 %) water-depth polygons
  * 75  = coastal 1/100a (1 %) water-depth polygons

Flood maps exist ONLY for the ~119 designated sites covered by layers 3 ∪ 56.
The depth-polygon layers (22/75) vectorise the whole grid INCLUDING dry cells;
the wet (flooded) zone is selected with ``where=SyvVyohLuokka>0`` (this excludes
"kuiva maa" / "vesistö").

Methodology (honesty-critical):
  * A postal polygon that does NOT intersect the mapped extent (3 ∪ 56)
    -> flood_risk_pct = NULL  (omitted from the output entirely; unmapped is
       NOT the same as zero risk).
  * A postal polygon intersecting the mapped extent but NOT the wet hazard zone
    -> flood_risk_pct = 0.0
  * A postal polygon intersecting the wet hazard zone
    -> flood_risk_pct = (intersection_area / postal_area) * 100

All area math is done in EPSG:3067 (TM35FIN), the standard Finnish metric CRS.

Output: scripts/flood_risk.json  {"postal_code": flood_risk_pct_float}

Usage:
    python scripts/fetch_flood_risk.py

The depth layers hold millions of polygons nationwide, so the per-candidate
queries use a SPATIAL filter (the postal polygon itself, lightly buffered) — only
local rows are scanned (un-filtered ~44 s/page vs spatially-filtered ~0.85 s/page).
A polygon filter is used rather than the postal bounding box: it fetches ~half
as much and stops large rural bboxes from pulling in a whole region's flood grid,
yet returns identical results because the exact clip is done client-side.
Candidates are processed across a small thread pool (the service parallelises
distinct spatial queries ~2.7x) and checkpointed to scripts/flood_risk.partial.json
so an interrupted run resumes where it stopped.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
OUTPUT_PATH = SCRIPT_DIR / "flood_risk.json"
PARTIAL_PATH = SCRIPT_DIR / "flood_risk.partial.json"

# ---------------------------------------------------------------------------
# Service config
# ---------------------------------------------------------------------------

BASE = (
    "https://paikkatieto.ymparisto.fi/arcgis/rest/services/Tulva/"
    "Tulvariskiaineistot_perusskenaariot_toistuvuuksittain/MapServer"
)
MAPPED_EXTENT_LAYERS = (3, 56)   # fluvial + coastal "kartoitetut alueet"
HAZARD_LAYERS = (22, 75)         # fluvial + coastal 1/100a depth polygons
WET_WHERE = "SyvVyohLuokka>0"    # excludes dry land / open water cells
PAGE_SIZE = 1000                 # = service maxRecordCount
METRIC_CRS = "EPSG:3067"         # TM35FIN — Finnish metric CRS for area math

MAX_RETRIES = 5
RETRY_BACKOFF_BASE = 3           # seconds; 3, 9, 27, 81
RATE_LIMIT_DELAY = 0.1           # polite pause between successive requests
GEOM_PRECISION = 1               # decimals of a metre returned by the server
MAX_WORKERS = 4                  # concurrent candidates (server parallelises ~2.7x); kept low to be polite

# Per-thread HTTP session (requests.Session is not safe to share across threads).
_thread_local = threading.local()


def _session() -> requests.Session:
    s = getattr(_thread_local, "session", None)
    if s is None:
        s = requests.Session()
        s.headers.update(
            {"User-Agent": "naapurustot.fi data pipeline (+https://naapurustot.fi)"}
        )
        _thread_local.session = s
    return s


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _request_with_retry(url, params, *, label, post=False, retries=MAX_RETRIES):
    """GET/POST with exponential-backoff retries; returns parsed JSON."""
    session = _session()
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            if post:
                r = session.post(url, data=params, timeout=180)
            else:
                r = session.get(url, params=params, timeout=180)
            r.raise_for_status()
            data = r.json()
            # ArcGIS reports query errors with HTTP 200 + an "error" object.
            if isinstance(data, dict) and "error" in data:
                raise requests.RequestException(f"ArcGIS error: {data['error']}")
            return data
        except (requests.RequestException, ValueError) as exc:
            last_exc = exc
            if attempt < retries:
                wait = RETRY_BACKOFF_BASE ** attempt
                logger.warning(
                    "Retry %d/%d for %s in %ds (%s)", attempt, retries, label, wait, exc
                )
                time.sleep(wait)
    raise last_exc  # type: ignore[misc]


def _esri_polygon(geom) -> str:
    """Serialise a shapely (EPSG:3067) geometry as an Esri polygon JSON string.

    The geometry is buffered out (50 m) then lightly simplified (20 m) so the
    spatial filter is always a *superset* of the true postal polygon — no wet
    polygon that intersects the postal area can be missed — while keeping the
    POST body small. Rings are oriented per the Esri convention (exterior
    clockwise, holes counter-clockwise) so the server interprets them correctly.
    Exact clipping is still done client-side against the unbuffered polygon.
    """
    g = geom.buffer(50).simplify(20, preserve_topology=True)
    rings: list = []
    polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
    for poly in polys:
        if poly.is_empty:
            continue
        poly = orient(poly, sign=-1.0)  # Esri: exterior CW, holes CCW
        rings.append([[round(x, 1), round(y, 1)] for x, y in poly.exterior.coords])
        for ring in poly.interiors:
            rings.append([[round(x, 1), round(y, 1)] for x, y in ring.coords])
    return json.dumps({"rings": rings, "spatialReference": {"wkid": 3067}})


def _query_paged(layer, *, where="1=1", geom_filter=None, envelope=None, label=""):
    """Yield GeoJSON features from a MapServer layer, paging through all results.

    A spatial filter (``geom_filter`` = Esri polygon JSON, or ``envelope`` =
    minx,miny,maxx,maxy in EPSG:3067) restricts the query so the server uses its
    spatial index instead of a full scan (un-filtered ~44 s/page vs ~0.85 s/page).
    A polygon filter is preferred over the bounding box: it avoids fetching wet
    polygons that fall in the bbox but outside the (often L-shaped / coastal)
    postal area, which roughly halves transfer and prevents large rural bboxes
    from pulling in a whole region's flood grid. Results are identical because
    the exact intersection is computed client-side either way.
    Geometry is returned in EPSG:3067 (no client-side reprojection needed).
    """
    url = f"{BASE}/{layer}/query"
    use_post = geom_filter is not None
    offset = 0
    while True:
        params = {
            "where": where,
            "outFields": "OBJECTID",
            "returnGeometry": "true",
            "outSR": "3067",
            "geometryPrecision": GEOM_PRECISION,
            "orderByFields": "OBJECTID",
            "resultRecordCount": PAGE_SIZE,
            "resultOffset": offset,
            "f": "geojson",
        }
        if geom_filter is not None:
            params.update(
                {
                    "geometry": geom_filter,
                    "geometryType": "esriGeometryPolygon",
                    "inSR": "3067",
                    "spatialRel": "esriSpatialRelIntersects",
                }
            )
        elif envelope is not None:
            params.update(
                {
                    "geometry": ",".join(f"{c:.2f}" for c in envelope),
                    "geometryType": "esriGeometryEnvelope",
                    "inSR": "3067",
                    "spatialRel": "esriSpatialRelIntersects",
                }
            )
        data = _request_with_retry(
            url, params, post=use_post, label=f"{label} L{layer} off={offset}"
        )
        feats = data.get("features", []) or []
        for f in feats:
            yield f
        exceeded = bool(
            data.get("exceededTransferLimit")
            or (data.get("properties") or {}).get("exceededTransferLimit")
        )
        time.sleep(RATE_LIMIT_DELAY)
        if len(feats) < PAGE_SIZE and not exceeded:
            break
        offset += PAGE_SIZE


def _features_to_geoms(features):
    """Parse GeoJSON features into a list of valid shapely geometries."""
    geoms = []
    for f in features:
        g = f.get("geometry")
        if not g:
            continue
        try:
            geom = shape(g)
        except Exception:
            continue
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
            if geom.is_empty or not geom.is_valid:
                continue
        geoms.append(geom)
    return geoms


# ---------------------------------------------------------------------------
# Checkpoint helpers
# ---------------------------------------------------------------------------


def _load_partial() -> dict[str, float]:
    if PARTIAL_PATH.exists():
        try:
            with open(PARTIAL_PATH, encoding="utf-8") as f:
                data = json.load(f)
            logger.info("Resuming: %d postal codes already computed", len(data))
            return {k: v for k, v in data.items()}
        except Exception as exc:
            logger.warning("Could not read partial file (%s); starting fresh", exc)
    return {}


def _save_partial(results: dict[str, float]):
    tmp = PARTIAL_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(results, f, sort_keys=True)
    tmp.replace(PARTIAL_PATH)


# ---------------------------------------------------------------------------
# Main computation
# ---------------------------------------------------------------------------


def _compute_one(pno: str, postal_geom) -> float | None:
    """Compute the 1/100a flood share (%) for one candidate postal polygon.

    Fetches the wet (SyvVyohLuokka>0) depth polygons from both hazard layers
    inside the (buffered) postal polygon, unions them (removing the heavy
    overlap between depth classes and between the fluvial/coastal layers), clips
    to the exact postal polygon, and returns intersection_area / postal_area %.
    Returns None only if the polygon is degenerate.
    """
    if postal_geom is None or postal_geom.is_empty:
        return None
    postal_area = postal_geom.area
    if postal_area <= 0:
        return None

    geom_filter = _esri_polygon(postal_geom)
    wet_geoms = []
    for layer in HAZARD_LAYERS:
        feats = list(
            _query_paged(layer, where=WET_WHERE, geom_filter=geom_filter, label=pno)
        )
        wet_geoms.extend(_features_to_geoms(feats))

    if not wet_geoms:
        return 0.0
    wet_union = unary_union(wet_geoms)
    try:
        inter = postal_geom.intersection(wet_union)
    except Exception:
        inter = postal_geom.buffer(0).intersection(wet_union.buffer(0))
    inter_area = inter.area if inter and not inter.is_empty else 0.0
    return round(max(0.0, min(100.0, inter_area / postal_area * 100.0)), 2)


def compute_flood_risk() -> dict[str, float]:
    # 1. Mapped extent (designated flood-map sites) — layers 3 ∪ 56.
    logger.info("Fetching mapped flood-extent polygons (layers %s)...", MAPPED_EXTENT_LAYERS)
    mapped_feats = []
    for layer in MAPPED_EXTENT_LAYERS:
        feats = list(_query_paged(layer, where="1=1", label="mapped-extent"))
        logger.info("  layer %d: %d mapped-extent polygons", layer, len(feats))
        mapped_feats.extend(feats)
    mapped_geoms = _features_to_geoms(mapped_feats)
    if not mapped_geoms:
        raise SystemExit("No mapped-extent polygons fetched — aborting.")
    mapped_area = unary_union(mapped_geoms)  # EPSG:3067
    logger.info(
        "  Mapped extent: %d polygons, total area %.1f km^2",
        len(mapped_geoms), mapped_area.area / 1e6,
    )

    # 2. Postal polygons (EPSG:3067).
    logger.info("Loading postal polygons from %s", GEOJSON_PATH)
    gdf = gpd.read_file(GEOJSON_PATH)
    pno_col = "pno" if "pno" in gdf.columns else "postinumeroalue"
    gdf = gdf[gdf.geometry.notnull()].to_crs(METRIC_CRS)
    logger.info("  %d postal polygons with geometry", len(gdf))

    # 3. Candidate postal codes = those intersecting the mapped extent.
    candidates = gdf[gdf.geometry.intersects(mapped_area)].copy()
    logger.info("  %d candidate postal codes intersect the mapped extent", len(candidates))

    # 4. Per-candidate flood share, computed across a small thread pool and
    #    checkpointed for resumability. The remote service parallelises distinct
    #    spatial queries (~2.7x with 4 workers); MAX_WORKERS is kept low to stay
    #    polite to a public government endpoint.
    results = _load_partial()
    todo = [
        (str(row[pno_col]), row.geometry)
        for _, row in candidates.iterrows()
        if str(row[pno_col]) not in results
    ]
    logger.info(
        "  %d candidates remaining to compute (%d workers)", len(todo), MAX_WORKERS
    )

    lock = threading.Lock()
    t_start = time.time()
    done = 0
    total = len(todo)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(_compute_one, pno, geom): pno for pno, geom in todo}
        for fut in as_completed(futures):
            pno = futures[fut]
            try:
                pct = fut.result()
            except Exception as exc:
                logger.warning("  %s failed (%s); will retry on next run", pno, exc)
                continue
            if pct is None:
                continue
            with lock:
                results[pno] = pct
                done += 1
                if done % 20 == 0 or done == total:
                    _save_partial(results)
                    elapsed = time.time() - t_start
                    rate = done / elapsed if elapsed else 0
                    eta = (total - done) / rate if rate else 0
                    logger.info(
                        "  [%d/%d] %s -> %.2f%%  (%.1f min elapsed, ~%.1f min left)",
                        done, total, pno, pct, elapsed / 60, eta / 60,
                    )
    _save_partial(results)
    return results


def main():
    logger.info("=== SYKE 1/100a flood-risk share calculator ===")
    if not GEOJSON_PATH.exists():
        logger.error("GeoJSON not found at %s", GEOJSON_PATH)
        raise SystemExit(1)

    results = compute_flood_risk()
    if not results:
        logger.error("No results computed")
        raise SystemExit(1)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)
    logger.info("Saved %d entries to %s", len(results), OUTPUT_PATH)

    # Summary stats.
    vals = list(results.values())
    pos = [v for v in vals if v > 0]
    logger.info("Total postal codes (mapped): %d", len(vals))
    logger.info("With flood risk > 0: %d", len(pos))
    if pos:
        logger.info(
            "  >0 range: min %.2f%%, max %.2f%%, mean %.2f%%",
            min(pos), max(pos), sum(pos) / len(pos),
        )
    for sample in ("28100", "28500", "96100", "96200", "20100", "00100"):
        if sample in results:
            logger.info("  sample %s -> %.2f%%", sample, results[sample])


if __name__ == "__main__":
    main()
