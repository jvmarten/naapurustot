#!/usr/bin/env python3
"""
Fetch tree canopy coverage data for all metro regions.

Data sources:
  - Helsinki metro: HSY — Pääkaupunkiseudun maanpeiteaineisto (LiDAR-derived)
    WFS: kartta.hsy.fi/geoserver/wfs
    Layer: asuminen_ja_maankaytto:puusto
  - Tampere & Turku metro: OSM forest/wood landuse + Copernicus Tree Cover
    Density (2018) as supplementary satellite-based source
  - Copernicus HRL Tree Cover Density 2018 — 10 m resolution pan-European
    satellite raster, queried via EEA ImageServer

Method: Download tree coverage polygons via WFS or OSM, intersect with postal
        code boundaries, compute tree canopy % per postal code.  For Tampere
        and Turku, supplement with Copernicus TCD as a satellite-based source.
        TCD values are computed exactly via the ImageServer computeHistograms
        endpoint, which analyses every 10 m pixel inside each polygon — no
        random sampling, no estimation.

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

# OSM Overpass API for forest/wood coverage
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Bounding boxes for OSM queries (south,west,north,east)
TAMPERE_BBOX = "61.15,23.05,62.25,25.05"
TURKU_BBOX = "60.22,21.42,60.79,22.97"

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


def fetch_osm_forest(bbox, label):
    """Fetch forest/wood polygons from OSM Overpass API for a bounding box.

    Uses ``out geom`` to get inline coordinates for both ways and relation
    members, so multipolygon relations (which make up the vast majority of
    forest area in rural Finland) are properly captured.

    Returns a GeoDataFrame in EPSG:3067 with forest polygons, or an empty
    GeoDataFrame if the fetch fails.
    """
    logger.info("Fetching %s forest data from OSM Overpass...", label)

    query = f"""
    [out:json][timeout:180];
    (
      way["natural"="wood"]({bbox});
      way["landuse"="forest"]({bbox});
      relation["natural"="wood"]({bbox});
      relation["landuse"="forest"]({bbox});
    );
    out geom;
    """

    try:
        resp = requests.post(
            OVERPASS_URL, data={"data": query}, timeout=300,
            headers={"User-Agent": "naapurustot.fi data pipeline (+https://naapurustot.fi)"},
        )
        resp.raise_for_status()
        data = resp.json()
        elements = data.get("elements", [])
        logger.info("  Fetched %d OSM elements for %s forests", len(elements), label)
    except Exception as e:
        logger.warning("  Could not fetch %s forest data: %s", label, e)
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:3067")

    polys = []

    for el in elements:
        if el["type"] == "way" and "geometry" in el:
            coords = [(p["lon"], p["lat"]) for p in el["geometry"]]
            if len(coords) >= 4 and coords[0] == coords[-1]:
                try:
                    polys.append(Polygon(coords))
                except Exception:
                    pass
        elif el["type"] == "relation":
            # Assemble outer rings from multipolygon relation members
            for member in el.get("members", []):
                if member["type"] == "way" and "geometry" in member:
                    role = member.get("role", "outer")
                    if role != "outer":
                        continue
                    coords = [(p["lon"], p["lat"]) for p in member["geometry"]]
                    if len(coords) >= 4:
                        if coords[0] != coords[-1]:
                            coords.append(coords[0])
                        try:
                            polys.append(Polygon(coords))
                        except Exception:
                            pass

    if not polys:
        logger.warning("  No valid forest polygons for %s", label)
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:3067")

    tree_gdf = gpd.GeoDataFrame(geometry=polys, crs="EPSG:4326")
    tree_gdf = tree_gdf.to_crs("EPSG:3067")
    tree_gdf["geometry"] = tree_gdf.geometry.apply(make_valid)
    logger.info("  Parsed %d forest polygons for %s", len(tree_gdf), label)

    return tree_gdf


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


def _fetch_osm_with_tcd_supplement(postal_proj, postal_4326, bbox, label, prefix_filter):
    """Fetch OSM forest data and supplement with Copernicus TCD.

    For each postal code, the final value is the maximum of the OSM-based
    and Copernicus TCD values, compensating for incomplete OSM mapping in
    rural areas.
    """
    # OSM forest polygons
    tree_gdf = fetch_osm_forest(bbox, label)
    filtered_proj = postal_proj[
        postal_proj["pno"].str[:2].isin(prefix_filter)
    ].copy()
    osm_result = compute_tree_pct(filtered_proj, tree_gdf, label) if not tree_gdf.empty else {}

    # Copernicus TCD — exact mean over every 10 m pixel in each polygon.
    filtered_4326 = postal_4326[
        postal_4326["pno"].str[:2].isin(prefix_filter)
    ].copy()
    tcd_result = compute_tcd_for_postal_codes(filtered_4326, label=f"{label} TCD")

    # Combine: take max of OSM and TCD for each postal code
    all_pnos = set(osm_result) | set(tcd_result)
    combined = {}
    for pno in all_pnos:
        osm_val = osm_result.get(pno, 0.0)
        tcd_val = tcd_result.get(pno, 0.0)
        combined[pno] = max(osm_val, tcd_val)

    osm_wins = sum(1 for p in all_pnos if osm_result.get(p, 0) >= tcd_result.get(p, 0))
    tcd_wins = len(all_pnos) - osm_wins
    logger.info("  %s combined: %d OSM-dominant, %d TCD-dominant", label, osm_wins, tcd_wins)

    return combined


def fetch_tampere_trees(postal_proj, postal_4326):
    """Fetch forest coverage for the entire Tampere metro area."""
    return _fetch_osm_with_tcd_supplement(
        postal_proj, postal_4326, TAMPERE_BBOX, "Tampere",
        {"33", "34", "35", "36", "37", "38", "39"},
    )


def fetch_turku_trees(postal_proj, postal_4326):
    """Fetch forest coverage for the Turku metro area."""
    return _fetch_osm_with_tcd_supplement(
        postal_proj, postal_4326, TURKU_BBOX, "Turku",
        {"20", "21", "23", "27"},
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

    # Tampere (OSM + Copernicus TCD)
    try:
        tampere_result = fetch_tampere_trees(postal_proj, postal_4326)
        result.update(tampere_result)
        logger.info("Tampere: %d postal codes", len(tampere_result))
    except Exception as e:
        logger.error("Tampere tree canopy failed: %s", e)

    # Turku (OSM + Copernicus TCD)
    try:
        turku_result = fetch_turku_trees(postal_proj, postal_4326)
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
