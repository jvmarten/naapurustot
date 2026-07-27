#!/usr/bin/env python3
"""Fetch the Overpass region caches that a previous pipeline run failed to write.

``_overpass_query`` (prepare_data.py) swallows a failed request, falls back to
the cache, and returns ``[]`` when there is no cache. ``_overpass_query_all_regions``
then extends the national list with that empty result and no guard notices, so a
region that failed to download becomes a region with no POIs — and
``join_groceries`` writes a measured-looking ``0.0`` for every postal code in it.

Five of the 69 seutukunta bboxes had no cached grocery response, so 237 postal
codes covering ~536,000 residents shipped ``grocery_density: 0``, including the
centre of Tampere. This script downloads only the missing caches, using the same
query and the same cache key as the pipeline, so a later run picks them up.

Usage:
  python scripts/refetch_missing_overpass.py --layer groceries
  python scripts/refetch_missing_overpass.py --layer groceries --dry-run
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import requests

from regions_config import REGION_BBOXES

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent
CACHE_DIR = SCRIPT_DIR / "cache"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Label and query must match prepare_data.py exactly, or the cache key differs
# and the pipeline will not find what we downloaded.
LAYERS = {
    "groceries": {
        "label": "OSM groceries",
        "query": """
    [out:json][timeout:60];
    (
      node["shop"="supermarket"]({BBOX});
      way["shop"="supermarket"]({BBOX});
      node["shop"="convenience"]({BBOX});
      node["shop"="grocery"]({BBOX});
    );
    out center;
    """,
    },
    "daycares": {
        "label": "OSM daycares",
        "query": """
    [out:json][timeout:60];
    (
      node["amenity"="kindergarten"]({BBOX});
      way["amenity"="kindergarten"]({BBOX});
      node["amenity"="childcare"]({BBOX});
      way["amenity"="childcare"]({BBOX});
    );
    out center;
    """,
    },
    "schools": {
        "label": "OSM schools",
        "query": """
    [out:json][timeout:60];
    (
      node["amenity"="school"]({BBOX});
      way["amenity"="school"]({BBOX});
    );
    out center;
    """,
    },
    "healthcare": {
        "label": "OSM healthcare",
        "query": """
    [out:json][timeout:60];
    (
      node["amenity"="hospital"]({BBOX});
      way["amenity"="hospital"]({BBOX});
      node["amenity"="clinic"]({BBOX});
      way["amenity"="clinic"]({BBOX});
      node["amenity"="doctors"]({BBOX});
      way["amenity"="doctors"]({BBOX});
      node["healthcare"]({BBOX});
      way["healthcare"]({BBOX});
    );
    out center;
    """,
    },
    "restaurants": {
        "label": "OSM restaurants",
        "query": """
    [out:json][timeout:60];
    (
      node["amenity"="restaurant"]({BBOX});
      node["amenity"="cafe"]({BBOX});
      node["amenity"="bar"]({BBOX});
      node["amenity"="fast_food"]({BBOX});
    );
    out;
    """,
    },
    "cycling": {
        "label": "OSM cycling",
        "query": """
    [out:json][timeout:90];
    (
      way["highway"="cycleway"]({BBOX});
      way["cycleway"="lane"]({BBOX});
      way["cycleway"="track"]({BBOX});
      way["bicycle"="designated"]({BBOX});
    );
    out center;
    """,
    },
}

RATE_LIMIT_DELAY = 5.0
MAX_RETRIES = 3


def cache_key(label: str, bbox: str) -> str:
    """Reproduce prepare_data._overpass_query's cache key for one region."""
    return "overpass_" + (
        f"{label} ({bbox})"
        .replace(" ", "_").replace("(", "").replace(")", "").replace(",", "")
    )


def cache_path(key: str) -> Path:
    safe = key.replace("/", "_").replace(":", "_").replace("?", "_").replace("&", "_")
    return CACHE_DIR / f"{safe}.json"


def missing_regions(label: str) -> list[tuple[str, str]]:
    out = []
    for name, bbox in REGION_BBOXES.items():
        if not cache_path(cache_key(label, bbox)).exists():
            out.append((name, bbox))
    return out


def fetch_bbox(query_template: str, bbox: str, label: str) -> list:
    query = query_template.replace("{BBOX}", bbox)
    last = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.post(
                OVERPASS_URL, data={"data": query},
                headers={"User-Agent": "naapurustot-data-pipeline/1.0"},
                timeout=180,
            )
            r.raise_for_status()
            return r.json().get("elements", [])
        except Exception as exc:  # noqa: BLE001 - report and retry
            last = exc
            logger.warning("  attempt %d/%d failed for %s: %s",
                           attempt, MAX_RETRIES, label, exc)
            if attempt < MAX_RETRIES:
                time.sleep(10 * attempt)
    raise RuntimeError(f"Overpass failed for {bbox}: {last}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--layer", default="all", choices=["all", *sorted(LAYERS)])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.layer == "all":
        rc = 0
        for name in sorted(LAYERS):
            logger.info("=" * 60)
            logger.info("Layer: %s", name)
            rc |= run_layer(name, args.dry_run)
        return rc
    return run_layer(args.layer, args.dry_run)


def run_layer(layer: str, dry_run: bool) -> int:
    spec = LAYERS[layer]
    label = spec["label"]

    missing = missing_regions(label)
    if not missing:
        logger.info("No missing %s caches — nothing to do.", layer)
        return 0

    logger.info("%d of %d regions have no cached %s response:",
                len(missing), len(REGION_BBOXES), label)
    for name, bbox in missing:
        logger.info("  %-22s %s", name, bbox)

    if dry_run:
        return 0

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    failed = []
    for i, (name, bbox) in enumerate(missing, 1):
        logger.info("[%d/%d] %s", i, len(missing), name)
        try:
            elements = fetch_bbox(spec["query"], bbox, name)
        except RuntimeError as exc:
            # Never write an empty cache on failure — that is the exact
            # behaviour that produced the fabricated zeros in the first place.
            logger.error("  %s", exc)
            failed.append(name)
            continue
        if not elements:
            logger.error("  %s returned 0 elements — refusing to cache an empty "
                         "result for a populated region", name)
            failed.append(name)
            continue
        path = cache_path(cache_key(label, bbox))
        tmp = path.with_suffix(path.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(elements, f, ensure_ascii=False)
        tmp.replace(path)
        logger.info("  %d elements -> %s", len(elements), path.name)
        if i < len(missing):
            time.sleep(RATE_LIMIT_DELAY)

    if failed:
        logger.error("Failed regions: %s", ", ".join(failed))
        return 1
    logger.info("All %d missing %s caches fetched.", len(missing), layer)
    return 0


if __name__ == "__main__":
    sys.exit(main())
