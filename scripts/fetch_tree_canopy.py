#!/usr/bin/env python3
"""
Fetch tree canopy coverage data for all metro regions.

Data sources:
  - Helsinki metro: HSY — Pääkaupunkiseudun maanpeiteaineisto (LiDAR-derived,
    sub-metre per-tree detection — substantially higher quality than 10 m
    satellite, worth keeping as a special case for the dense urban core).
    WFS: kartta.hsy.fi/geoserver/wfs
    Layer: asuminen_ja_maankaytto:puusto
  - Everywhere else: Copernicus HRL Tree Cover Density 2018 (10 m, pan-European),
    queried via EEA ImageServer. computeHistograms returns the exact pixel
    distribution per polygon — no random sampling, no estimation.

Tampere and Turku previously combined OSM forest landuse with Copernicus via
max(); OSM was dropped because (a) it inflated values where parks/private
yards were tagged as forest, (b) under-mapping caused arbitrary regional
variation, and (c) using one methodology nationwide makes regions comparable.

Output: tree_canopy.json
Format: {"00100": 15.3, "00120": 42.1, ...}  (% of area covered by trees)
"""

import json
import logging
import math
from pathlib import Path

import geopandas as gpd
import requests
from shapely import STRtree
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely.validation import make_valid

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent
GEOJSON_PATH = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"

# HSY (Helsinki metro)
HSY_WFS_URL = "https://kartta.hsy.fi/geoserver/wfs"
PUUSTO_LAYER = "asuminen_ja_maankaytto:puusto"

# Copernicus High Resolution Layer — Tree Cover Density 2018 (10 m)
COPERNICUS_TCD_IMAGESERVER = (
    "https://image.discomap.eea.europa.eu/arcgis/rest/services/"
    "GioLandPublic/HRL_TreeCoverDensity_2018/ImageServer"
)
COPERNICUS_TCD_HISTOGRAMS_URL = COPERNICUS_TCD_IMAGESERVER + "/computeHistograms"


# ---------------------------------------------------------------------------
# Copernicus TCD helpers
# ---------------------------------------------------------------------------

def _lonlat_to_webmercator(lon, lat):
    """Convert WGS-84 lon/lat to Web Mercator (EPSG:3857)."""
    x = lon * 20037508.34 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * 20037508.34 / math.pi
    return x, y


def _geom_to_esri_rings(geom):
    """Convert a Shapely (Multi)Polygon in WGS-84 to ESRI ring coords (Web Mercator)."""
    if geom.geom_type == "Polygon":
        polys = [geom]
    elif geom.geom_type == "MultiPolygon":
        polys = list(geom.geoms)
    else:
        return None

    rings = []
    for p in polys:
        exterior = [list(_lonlat_to_webmercator(lon, lat)) for lon, lat in p.exterior.coords]
        if len(exterior) >= 4:
            rings.append(exterior)
        for interior in p.interiors:
            ring = [list(_lonlat_to_webmercator(lon, lat)) for lon, lat in interior.coords]
            if len(ring) >= 4:
                rings.append(ring)
    return rings if rings else None


def _histograms_for_geometry(session, geom_4326):
    """POST a Shapely polygon to computeHistograms; return the counts list or None."""
    rings = _geom_to_esri_rings(geom_4326)
    if rings is None:
        return None

    payload = {
        "geometry": json.dumps({
            "rings": rings,
            "spatialReference": {"wkid": 102100},
        }),
        "geometryType": "esriGeometryPolygon",
        "f": "json",
    }

    try:
        resp = session.post(COPERNICUS_TCD_HISTOGRAMS_URL, data=payload, timeout=120)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning("    computeHistograms request failed: %s", e)
        return None

    if isinstance(data, dict) and "error" in data:
        return ("error", data["error"])
    histograms = data.get("histograms") or []
    if not histograms:
        return None
    return histograms[0].get("counts") or []


def _compute_tcd_mean(session, geom_4326, max_depth=3):
    """Compute mean Tree Cover Density (0-100) for a polygon via computeHistograms.

    Analyses every 10 m pixel inside the polygon — no sampling.  When the
    polygon is too large for a single ImageServer call (the EEA service caps
    raster size per request), the polygon is recursively split along its
    longer bbox axis and the histograms are aggregated; the result is still
    exact because every pixel is counted exactly once.

    Returns ``None`` if every request fails or no pixels are returned.
    """
    counts = _aggregate_histogram_counts(session, geom_4326, max_depth=max_depth)
    if not counts:
        return None
    total = sum(counts)
    if total == 0:
        return None
    # Bins are integer TCD values 0..100; mean = sum(value * count) / total.
    weighted = sum(i * c for i, c in enumerate(counts))
    return weighted / total


def _aggregate_histogram_counts(session, geom_4326, max_depth):
    """Get histogram counts for a polygon, splitting it if the server rejects it."""
    result = _histograms_for_geometry(session, geom_4326)
    if result is None:
        return None
    if isinstance(result, tuple) and result[0] == "error":
        err = result[1]
        details = " ".join(err.get("details") or []) if isinstance(err, dict) else str(err)
        if "size limit" in details.lower() and max_depth > 0:
            # Polygon raster too big — split bbox along the longer axis and recurse.
            minx, miny, maxx, maxy = geom_4326.bounds
            if (maxx - minx) >= (maxy - miny):
                midx = (minx + maxx) / 2
                left = _clip_box(geom_4326, minx, miny, midx, maxy)
                right = _clip_box(geom_4326, midx, miny, maxx, maxy)
            else:
                midy = (miny + maxy) / 2
                left = _clip_box(geom_4326, minx, miny, maxx, midy)
                right = _clip_box(geom_4326, minx, midy, maxx, maxy)

            merged = [0] * 101
            for part in (left, right):
                if part is None or part.is_empty:
                    continue
                sub = _aggregate_histogram_counts(session, part, max_depth - 1)
                if sub is None:
                    return None
                for i, c in enumerate(sub[:101]):
                    merged[i] += c
            return merged
        logger.warning("    computeHistograms error: %s", err)
        return None
    return result


def _clip_box(geom, minx, miny, maxx, maxy):
    """Intersect geom with the given bbox, returning a valid (Multi)Polygon or None."""
    try:
        clipped = geom.intersection(box(minx, miny, maxx, maxy))
    except Exception:
        return None
    if clipped.is_empty:
        return None
    clipped = make_valid(clipped)
    # Drop non-areal parts that intersection can produce on polygon edges.
    if clipped.geom_type == "GeometryCollection":
        polys = [g for g in clipped.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        if not polys:
            return None
        clipped = unary_union(polys)
    if clipped.geom_type not in ("Polygon", "MultiPolygon"):
        return None
    return clipped


def compute_tcd_for_postal_codes(postal_4326, label="TCD"):
    """Compute mean Copernicus TCD per postal code via computeHistograms.

    For each postal code, every 10 m TCD pixel inside the polygon is counted
    and the mean tree cover density is returned.  This is the true canopy
    density measurement (no sampling, no point estimation).

    Returns {postal_code: mean_tcd_percent}.
    """
    logger.info("Computing Copernicus TCD for %d postal codes via histogram...", len(postal_4326))
    session = requests.Session()
    result = {}
    total = len(postal_4326)

    for i, (_, row) in enumerate(postal_4326.iterrows()):
        pno = row["pno"]
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        mean_tcd = _compute_tcd_mean(session, geom)
        if mean_tcd is not None:
            result[pno] = round(float(mean_tcd), 1)

        if (i + 1) % 50 == 0 or i + 1 == total:
            logger.info("  %s: %d/%d postal codes (%d with values)", label, i + 1, total, len(result))

    logger.info("  %s: computed for %d postal codes", label, len(result))
    return result


# ---------------------------------------------------------------------------
# OSM forest helpers
# ---------------------------------------------------------------------------

def compute_tree_pct(postal_proj, tree_gdf, label=""):
    """Compute tree canopy % for each postal code using spatial index."""
    if tree_gdf.empty:
        return {}

    tree_geoms = list(tree_gdf.geometry)
    tree = STRtree(tree_geoms)

    result = {}
    total = len(postal_proj)
    for i, (idx, row) in enumerate(postal_proj.iterrows()):
        pno = row["pno"]
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        postal_area = geom.area
        if postal_area <= 0:
            continue

        candidates = tree.query(geom)
        if len(candidates) == 0:
            result[pno] = 0.0
            continue

        candidate_geoms = [tree_geoms[c] for c in candidates]
        local_union = unary_union(candidate_geoms)
        intersection = geom.intersection(local_union)
        if intersection.is_empty:
            result[pno] = 0.0
        else:
            pct = min(round(intersection.area / postal_area * 100, 1), 100.0)
            result[pno] = pct

        if (i + 1) % 20 == 0:
            logger.info("  %s: %d/%d postal codes", label, i + 1, total)

    return result


# ---------------------------------------------------------------------------
# Per-metro fetch functions
# ---------------------------------------------------------------------------

def fetch_hsy_trees(postal_proj):
    """Fetch tree canopy from HSY for Helsinki metro."""
    logger.info("Downloading HSY tree coverage layer...")
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": PUUSTO_LAYER,
        "outputFormat": "application/json",
        "srsName": "EPSG:3067",
    }
    resp = requests.get(HSY_WFS_URL, params=params, timeout=300)
    resp.raise_for_status()
    puusto = gpd.GeoDataFrame.from_features(resp.json()["features"], crs="EPSG:3067")
    puusto["geometry"] = puusto.geometry.apply(make_valid)
    logger.info("  Downloaded %d HSY tree polygons", len(puusto))

    hki_postal = postal_proj[
        postal_proj["pno"].str.startswith("00")
        | postal_proj["pno"].str.startswith("01")
        | postal_proj["pno"].str.startswith("02")
    ].copy()

    return compute_tree_pct(hki_postal, puusto, "Helsinki")


def _fetch_tcd_for_prefixes(postal_4326, prefix_filter, label):
    """Compute Copernicus TCD for postal codes whose first 2 chars match a prefix set."""
    filtered = postal_4326[postal_4326["pno"].str[:2].isin(prefix_filter)].copy()
    return compute_tcd_for_postal_codes(filtered, label=f"{label} TCD")


def fetch_tampere_trees(postal_4326):
    """Copernicus TCD for the Tampere metro postal codes."""
    return _fetch_tcd_for_prefixes(
        postal_4326, {"33", "34", "35", "36", "37", "38", "39"}, "Tampere",
    )


def fetch_turku_trees(postal_4326):
    """Copernicus TCD for the Turku metro postal codes."""
    return _fetch_tcd_for_prefixes(
        postal_4326, {"20", "21", "23", "27"}, "Turku",
    )


def main():
    postal = gpd.read_file(GEOJSON_PATH)
    postal_proj = postal.to_crs(epsg=3067)
    postal_proj["geometry"] = postal_proj.geometry.apply(make_valid)
    postal_4326 = postal.to_crs(epsg=4326)
    postal_4326["geometry"] = postal_4326.geometry.apply(make_valid)

    # Load existing data (Helsinki already has data from HSY)
    existing_file = OUT_DIR / "tree_canopy.json"
    result = {}
    if existing_file.exists():
        with open(existing_file, encoding="utf-8") as f:
            result = json.load(f)
        logger.info("Loaded %d existing entries from %s", len(result), existing_file.name)

    # Only fetch HSY if we don't already have Helsinki data
    hki_count = sum(1 for k in result if k.startswith("00") or k.startswith("01") or k.startswith("02"))
    if hki_count < 50:
        try:
            hsy_result = fetch_hsy_trees(postal_proj)
            result.update(hsy_result)
            logger.info("Helsinki: %d postal codes", len(hsy_result))
        except Exception as e:
            logger.error("HSY tree canopy failed: %s", e)
    else:
        logger.info("Skipping HSY fetch (already have %d Helsinki entries)", hki_count)

    # Tampere (Copernicus TCD — was OSM+TCD until we dropped OSM for consistency)
    try:
        tampere_result = fetch_tampere_trees(postal_4326)
        result.update(tampere_result)
        logger.info("Tampere: %d postal codes", len(tampere_result))
    except Exception as e:
        logger.error("Tampere tree canopy failed: %s", e)

    # Turku (Copernicus TCD — was OSM+TCD until we dropped OSM for consistency)
    try:
        turku_result = fetch_turku_trees(postal_4326)
        result.update(turku_result)
        logger.info("Turku: %d postal codes", len(turku_result))
    except Exception as e:
        logger.error("Turku tree canopy failed: %s", e)

    # Nationwide fill-in via Copernicus TCD computeHistograms (exact, no sampling).
    # Also re-computes any postal codes where the existing value is 0.0 — those
    # are almost always artefacts of the previous random-sampling approach (5-20
    # random points missing every tree pixel by chance) rather than a genuine
    # absence of trees.  Truly tree-free postal codes are extremely rare in
    # Finland; if computeHistograms confirms 0.0 we keep it, otherwise we
    # replace the bogus value with the true mean.
    suspicious_zeros = {pno for pno, val in result.items() if val == 0.0}
    needs_fetch = ~postal_4326["pno"].isin(result) | postal_4326["pno"].isin(suspicious_zeros)
    remaining_4326 = postal_4326[needs_fetch].copy()
    if not remaining_4326.empty:
        logger.info(
            "Nationwide TCD: %d postal codes to (re-)compute (%d uncovered, %d zero-valued)",
            len(remaining_4326),
            len(remaining_4326) - len(suspicious_zeros & set(remaining_4326["pno"])),
            len(suspicious_zeros & set(remaining_4326["pno"])),
        )
        try:
            nationwide_result = compute_tcd_for_postal_codes(
                remaining_4326, label="Nationwide TCD"
            )
            added = 0
            replaced_zeros = 0
            for pno, val in nationwide_result.items():
                if pno in suspicious_zeros:
                    if val > 0:
                        result[pno] = val
                        replaced_zeros += 1
                elif pno not in result:
                    result[pno] = val
                    added += 1
            logger.info(
                "Nationwide TCD: filled %d new postal codes, replaced %d zero values",
                added, replaced_zeros,
            )
        except Exception as e:
            logger.warning("Nationwide TCD fill failed: %s", e)

    logger.info("Total tree canopy data: %d postal codes", len(result))

    with open(OUT_DIR / "tree_canopy.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    logger.info("Done. Wrote tree_canopy.json")


if __name__ == "__main__":
    main()
