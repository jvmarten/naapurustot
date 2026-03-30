#!/usr/bin/env python3
"""Extend school quality scores to postal codes that lack a lukio.

For each postal code without a direct school quality score, assigns a
distance-weighted average of the 2-3 nearest postal codes that DO have
scores, as long as they fall within a 10 km radius.  This models the
schools that residents of that postal code would realistically attend.

Original scores for postal codes that already have a lukio are preserved
unchanged.

Spatial workflow:
  1. Load postal code polygons from the GeoJSON (EPSG:4326).
  2. Reproject to EPSG:3067 (Finnish national CRS) for metric distances.
  3. Compute centroids of every postal code polygon.
  4. For postal codes missing a score, find the nearest scored centroids
     and compute an inverse-distance-weighted average (up to 3 neighbours
     within 10 km).

Usage:
    python scripts/fetch_school_quality_extended.py

Output: scripts/school_quality.json  (overwrites in place)
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import Point
from shapely import STRtree

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
SCHOOL_JSON = SCRIPT_DIR / "school_quality.json"
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"

# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------
MAX_DISTANCE_M = 10_000  # 10 km radius
MAX_NEIGHBOURS = 3       # average up to 3 nearest schools
MIN_NEIGHBOURS = 2       # need at least 2 neighbours for a robust average


def main() -> None:
    # ------------------------------------------------------------------
    # 1. Load existing school quality scores
    # ------------------------------------------------------------------
    if not SCHOOL_JSON.exists():
        log.error("School quality file not found: %s", SCHOOL_JSON)
        sys.exit(1)

    with open(SCHOOL_JSON, encoding="utf-8") as f:
        raw_scores: dict[str, float] = json.load(f)

    log.info("Loaded %d existing school quality scores", len(raw_scores))

    # ------------------------------------------------------------------
    # 2. Load postal code boundaries
    # ------------------------------------------------------------------
    if not GEOJSON_PATH.exists():
        log.error("GeoJSON not found: %s", GEOJSON_PATH)
        sys.exit(1)

    gdf = gpd.read_file(GEOJSON_PATH)
    log.info("Loaded %d postal code areas from GeoJSON", len(gdf))

    # postal code field
    if "postinumeroalue" not in gdf.columns:
        log.error("Expected column 'postinumeroalue' in GeoJSON")
        sys.exit(1)

    # ------------------------------------------------------------------
    # 3. Reproject to EPSG:3067 for accurate distance calculations
    # ------------------------------------------------------------------
    gdf = gdf.to_crs(epsg=3067)
    gdf["centroid"] = gdf.geometry.centroid
    log.info("Reprojected to EPSG:3067 and computed centroids")

    # Build lookup: postal_code -> centroid (in EPSG:3067)
    pc_centroid: dict[str, Point] = {}
    for _, row in gdf.iterrows():
        pc = str(row["postinumeroalue"])
        pc_centroid[pc] = row["centroid"]

    # ------------------------------------------------------------------
    # 4. Identify scored vs unscored postal codes (within GeoJSON set)
    # ------------------------------------------------------------------
    geo_postcodes = set(pc_centroid.keys())
    scored_pcs = {pc for pc in geo_postcodes if pc in raw_scores}
    unscored_pcs = geo_postcodes - scored_pcs

    log.info(
        "GeoJSON postal codes: %d | already scored: %d | need interpolation: %d",
        len(geo_postcodes),
        len(scored_pcs),
        len(unscored_pcs),
    )

    if not scored_pcs:
        log.error("No overlap between school scores and GeoJSON postal codes")
        sys.exit(1)

    # ------------------------------------------------------------------
    # 5. Build spatial index of scored postal code centroids
    # ------------------------------------------------------------------
    scored_list = sorted(scored_pcs)  # deterministic ordering
    scored_points = [pc_centroid[pc] for pc in scored_list]
    scored_values = np.array([raw_scores[pc] for pc in scored_list])

    tree = STRtree(scored_points)
    log.info("Built STRtree with %d scored centroids", len(scored_list))

    # ------------------------------------------------------------------
    # 6. For each unscored postal code, find nearest scored neighbours
    # ------------------------------------------------------------------
    extended_scores: dict[str, float] = {}
    skipped = 0

    for pc in sorted(unscored_pcs):
        centroid = pc_centroid[pc]

        # Query all scored centroids within MAX_DISTANCE_M
        indices = tree.query(centroid.buffer(MAX_DISTANCE_M))

        if len(indices) < MIN_NEIGHBOURS:
            skipped += 1
            continue

        # Compute actual distances to each candidate
        distances = np.array([centroid.distance(scored_points[i]) for i in indices])

        # Sort by distance and take up to MAX_NEIGHBOURS closest
        order = np.argsort(distances)
        top_indices = order[:MAX_NEIGHBOURS]
        top_distances = distances[top_indices]
        top_scores = scored_values[indices[top_indices]]

        # All candidates must be within MAX_DISTANCE_M (buffer query
        # is an envelope check, so verify actual distance)
        mask = top_distances <= MAX_DISTANCE_M
        if mask.sum() < MIN_NEIGHBOURS:
            skipped += 1
            continue

        top_distances = top_distances[mask]
        top_scores = top_scores[mask]

        # Inverse-distance weighting
        # Avoid division by zero (if centroid coincides with a scored centroid)
        weights = 1.0 / np.maximum(top_distances, 1.0)
        weighted_avg = float(np.average(top_scores, weights=weights))

        # Round to one decimal place, consistent with original data
        extended_scores[pc] = round(weighted_avg, 1)

    log.info(
        "Interpolated scores for %d postal codes (%d skipped, no neighbours within %d m)",
        len(extended_scores),
        skipped,
        MAX_DISTANCE_M,
    )

    # ------------------------------------------------------------------
    # 7. Merge: original scores take priority, then extended scores
    # ------------------------------------------------------------------
    # Start with only postal codes that exist in the GeoJSON
    final: dict[str, float] = {}

    # Original scores for postal codes present in GeoJSON
    for pc in sorted(scored_pcs):
        final[pc] = raw_scores[pc]

    # Extended scores for unscored postal codes
    for pc in sorted(extended_scores.keys()):
        final[pc] = extended_scores[pc]

    log.info(
        "Final output: %d postal codes scored out of %d total (%d original + %d interpolated)",
        len(final),
        len(geo_postcodes),
        len(scored_pcs),
        len(extended_scores),
    )

    # ------------------------------------------------------------------
    # 8. Save
    # ------------------------------------------------------------------
    # Sort by postal code for readability
    sorted_final = dict(sorted(final.items()))

    with open(SCHOOL_JSON, "w", encoding="utf-8") as f:
        json.dump(sorted_final, f, indent=2, ensure_ascii=False)
        f.write("\n")

    log.info("Saved to %s", SCHOOL_JSON)


if __name__ == "__main__":
    main()
