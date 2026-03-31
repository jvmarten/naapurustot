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
        and Turku, supplement with Copernicus TCD point sampling to fill gaps
        in OSM coverage (rural areas where forests are unmapped).

Output: tree_canopy.json
Format: {"00100": 15.3, "00120": 42.1, ...}  (% of area covered by trees)
"""

import json
import logging
import math
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests
from shapely import STRtree
from shapely.geometry import Point, Polygon
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
COPERNICUS_TCD_URL = (
    "https://image.discomap.eea.europa.eu/arcgis/rest/services/"
    "GioLandPublic/HRL_TreeCoverDensity_2018/ImageServer/identify"
)


# ---------------------------------------------------------------------------
# Copernicus TCD helpers
# ---------------------------------------------------------------------------

def _lonlat_to_webmercator(lon, lat):
    """Convert WGS-84 lon/lat to Web Mercator (EPSG:3857)."""
    x = lon * 20037508.34 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * 20037508.34 / math.pi
    return x, y


def _query_tcd_point(session, lon, lat):
    """Return tree cover density (0-100) at a single point, or None."""
    x, y = _lonlat_to_webmercator(lon, lat)
    params = {
        "geometry": json.dumps({"x": x, "y": y}),
        "geometryType": "esriGeometryPoint",
        "sr": 3857,
        "returnGeometry": False,
        "returnCatalogItems": False,
        "f": "json",
    }
    try:
        resp = session.get(COPERNICUS_TCD_URL, params=params, timeout=15)
        if resp.status_code == 200:
            val = resp.json().get("value", "")
            if val and val != "NoData":
                return int(val)
    except Exception:
        pass
    return None


def sample_tcd_for_postal_codes(postal_4326):
    """Sample Copernicus TCD for each postal code via random point sampling.

    Returns a dict of {postal_code: mean_tcd_percent}.
    """
    logger.info("Sampling Copernicus Tree Cover Density for %d postal codes...", len(postal_4326))
    postal_proj = postal_4326.to_crs(epsg=3067)

    session = requests.Session()
    np.random.seed(42)
    result = {}

    for i, (idx, row) in enumerate(postal_4326.iterrows()):
        pno = row["pno"]
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        # Scale sample count with area (km²)
        proj_row = postal_proj.loc[idx]
        area_km2 = proj_row.geometry.area / 1e6
        n_samples = min(max(int(area_km2 / 5), 10), 40)

        bounds = geom.bounds  # minx, miny, maxx, maxy
        values = []
        attempts = 0
        while len(values) < n_samples and attempts < n_samples * 5:
            attempts += 1
            lon = np.random.uniform(bounds[0], bounds[2])
            lat = np.random.uniform(bounds[1], bounds[3])
            if not geom.contains(Point(lon, lat)):
                continue
            val = _query_tcd_point(session, lon, lat)
            if val is not None:
                values.append(val)

        if values:
            result[pno] = round(float(np.mean(values)), 1)

        if (i + 1) % 20 == 0:
            logger.info("  TCD: %d/%d postal codes", i + 1, len(postal_4326))

    logger.info("  Sampled TCD for %d postal codes", len(result))
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
        resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=300)
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
    rural areas and noisy TCD sampling in small urban areas.
    """
    # OSM forest polygons
    tree_gdf = fetch_osm_forest(bbox, label)
    filtered_proj = postal_proj[
        postal_proj["pno"].str[:2].isin(prefix_filter)
    ].copy()
    osm_result = compute_tree_pct(filtered_proj, tree_gdf, label) if not tree_gdf.empty else {}

    # Copernicus TCD sampling
    filtered_4326 = postal_4326[
        postal_4326["pno"].str[:2].isin(prefix_filter)
    ].copy()
    tcd_result = sample_tcd_for_postal_codes(filtered_4326)

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
        with open(existing_file) as f:
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

    logger.info("Total tree canopy data: %d postal codes", len(result))

    with open(OUT_DIR / "tree_canopy.json", "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    logger.info("Done. Wrote tree_canopy.json")


if __name__ == "__main__":
    main()
