#!/usr/bin/env python3
"""
Fetch tree canopy coverage data for all metro regions.

Data sources:
  - Helsinki metro: HSY — Pääkaupunkiseudun maanpeiteaineisto (LiDAR-derived)
    WFS: kartta.hsy.fi/geoserver/wfs
    Layer: asuminen_ja_maankaytto:puusto
  - Tampere: geodata.tampere.fi WFS — LiDAR tree canopy by height class (2022)
    Layers: maanpeite:maanpeite_2022_puusto_*
  - Turku: OSM forest/wood landuse as proxy (from green_space_pct pipeline)

Method: Download tree coverage polygons via WFS, intersect with postal code
        boundaries, compute tree canopy % per postal code.

Output: tree_canopy.json
Format: {"00100": 15.3, "00120": 42.1, ...}  (% of area covered by trees)
"""

import json
import logging
import sys
from pathlib import Path

import geopandas as gpd
import requests
from shapely import STRtree
from shapely.ops import unary_union
from shapely.validation import make_valid

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent
GEOJSON_PATH = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"

# HSY (Helsinki metro)
HSY_WFS_URL = "https://kartta.hsy.fi/geoserver/wfs"
PUUSTO_LAYER = "asuminen_ja_maankaytto:puusto"

# Tampere city WFS — tree canopy height classes
TAMPERE_WFS_URL = "https://geodata.tampere.fi/geoserver/ows"
TAMPERE_TREE_LAYERS = [
    "maanpeite:maanpeite_2022_puusto_2-4m_2d",
    "maanpeite:maanpeite_2022_puusto_4-10m_2d",
    "maanpeite:maanpeite_2022_puusto_10-15m_2d",
    "maanpeite:maanpeite_2022_puusto_15-20m_2d",
    "maanpeite:maanpeite_2022_puusto_yli_20m_2d",
]

# Turku: use OSM forest data from Overpass API
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
TURKU_BBOX = "60.25,21.50,60.75,22.90"


def compute_tree_pct(postal_proj, tree_gdf, label=""):
    """Compute tree canopy % for each postal code using spatial index.

    Only postal codes that overlap the tree data coverage area get a value.
    Postal codes outside the coverage area are excluded (not set to 0.0)
    so they appear as null/no-data rather than falsely showing 0% canopy.
    """
    if tree_gdf.empty:
        return {}

    tree_geoms = list(tree_gdf.geometry)
    tree = STRtree(tree_geoms)

    # Build a convex hull of all tree data to determine coverage area
    coverage_area = unary_union(tree_geoms).convex_hull
    # Buffer by 500m to include nearby postal codes at the edges
    coverage_area = coverage_area.buffer(500)

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

        # Skip postal codes outside the tree data coverage area
        if not geom.intersects(coverage_area):
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


def fetch_tampere_trees(postal_proj):
    """Fetch tree canopy from Tampere city WFS."""
    logger.info("Downloading Tampere tree coverage layers...")

    all_features = []
    for layer in TAMPERE_TREE_LAYERS:
        logger.info("  Fetching %s...", layer)
        params = {
            "service": "WFS",
            "version": "1.0.0",
            "request": "GetFeature",
            "typeName": layer,
            "outputFormat": "application/json",
            "maxFeatures": "50000",
        }
        try:
            resp = requests.get(TAMPERE_WFS_URL, params=params, timeout=300)
            resp.raise_for_status()
            data = resp.json()
            features = data.get("features", [])
            all_features.extend(features)
            logger.info("    %d features", len(features))
        except Exception as e:
            logger.warning("    Failed: %s", e)

    if not all_features:
        logger.warning("  No Tampere tree data fetched")
        return {}

    tree_gdf = gpd.GeoDataFrame.from_features(all_features, crs="EPSG:3878")
    tree_gdf = tree_gdf.to_crs("EPSG:3067")
    tree_gdf["geometry"] = tree_gdf.geometry.apply(make_valid)
    logger.info("  Total Tampere tree polygons: %d", len(tree_gdf))

    tampere_postal = postal_proj[
        postal_proj["pno"].str.startswith("33")
        | postal_proj["pno"].str.startswith("34")
        | postal_proj["pno"].str.startswith("35")
        | postal_proj["pno"].str.startswith("36")
        | postal_proj["pno"].str.startswith("37")
        | postal_proj["pno"].str.startswith("38")
        | postal_proj["pno"].str.startswith("39")
    ].copy()

    return compute_tree_pct(tampere_postal, tree_gdf, "Tampere")


def fetch_turku_trees(postal_proj):
    """Fetch forest/wood coverage from OSM for Turku as proxy for tree canopy."""
    logger.info("Fetching Turku forest data from OSM Overpass...")

    query = f"""
    [out:json][timeout:120];
    (
      way["natural"="wood"]({TURKU_BBOX});
      way["landuse"="forest"]({TURKU_BBOX});
      relation["natural"="wood"]({TURKU_BBOX});
      relation["landuse"="forest"]({TURKU_BBOX});
    );
    out body;
    >;
    out skel qt;
    """

    try:
        resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=180)
        resp.raise_for_status()
        data = resp.json()
        elements = data.get("elements", [])
        logger.info("  Fetched %d OSM elements for Turku forests", len(elements))
    except Exception as e:
        logger.warning("  Could not fetch Turku forest data: %s", e)
        return {}

    # Parse OSM elements into polygons
    from shapely.geometry import Polygon

    nodes = {}
    ways = {}
    for el in elements:
        if el["type"] == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])
        elif el["type"] == "way":
            ways[el["id"]] = el.get("nodes", [])

    polys = []
    for way_id, node_ids in ways.items():
        coords = [nodes[nid] for nid in node_ids if nid in nodes]
        if len(coords) >= 4 and coords[0] == coords[-1]:
            try:
                polys.append(Polygon(coords))
            except Exception:
                pass

    if not polys:
        logger.warning("  No valid forest polygons for Turku")
        return {}

    tree_gdf = gpd.GeoDataFrame(geometry=polys, crs="EPSG:4326")
    tree_gdf = tree_gdf.to_crs("EPSG:3067")
    tree_gdf["geometry"] = tree_gdf.geometry.apply(make_valid)
    logger.info("  Parsed %d forest polygons for Turku", len(tree_gdf))

    turku_postal = postal_proj[
        postal_proj["pno"].str.startswith("20")
        | postal_proj["pno"].str.startswith("21")
        | postal_proj["pno"].str.startswith("23")
        | postal_proj["pno"].str.startswith("27")
    ].copy()

    return compute_tree_pct(turku_postal, tree_gdf, "Turku")


def main():
    postal = gpd.read_file(GEOJSON_PATH)
    postal_proj = postal.to_crs(epsg=3067)
    postal_proj["geometry"] = postal_proj.geometry.apply(make_valid)

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

    # Tampere (city WFS)
    try:
        tampere_result = fetch_tampere_trees(postal_proj)
        result.update(tampere_result)
        logger.info("Tampere: %d postal codes", len(tampere_result))
    except Exception as e:
        logger.error("Tampere tree canopy failed: %s", e)

    # Turku (OSM forest proxy)
    try:
        turku_result = fetch_turku_trees(postal_proj)
        result.update(turku_result)
        logger.info("Turku: %d postal codes", len(turku_result))
    except Exception as e:
        logger.error("Turku tree canopy failed: %s", e)

    logger.info("Total tree canopy data: %d postal codes", len(result))

    with open(OUT_DIR / "tree_canopy.json", "w") as f:
        json.dump(result, f, indent=2)
    logger.info("Done. Wrote tree_canopy.json")


if __name__ == "__main__":
    main()
