#!/usr/bin/env python3
"""Propagate light_pollution.json and water_proximity.json into the GeoJSON.

Targeted update so we don't have to re-run the full prepare_data.py pipeline.
After this runs, ``npm run build:data`` rebuilds the TopoJSON the app loads.

Inputs:
    scripts/light_pollution.json  — { postal_code: mean VIIRS radiance, nW/cm^2/sr }
                                    (NASA Black Marble; written by aggregate_viirs_postal.py)
    scripts/water_proximity.json  — { postal_code: distance_m }

Output:
    public/data/metro_neighborhoods.geojson — features get
        light_pollution      (float | None)
        water_proximity_m    (float | None)
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
LIGHT_PATH = SCRIPT_DIR / "light_pollution.json"
WATER_PATH = SCRIPT_DIR / "water_proximity.json"


def _load_lookup(path: Path) -> dict[str, float]:
    if not path.exists():
        logger.error("Missing input: %s", path)
        raise SystemExit(1)
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    # Coerce values to float; drop anything that isn't a usable number.
    lookup: dict[str, float] = {}
    for k, v in raw.items():
        try:
            lookup[str(k)] = float(v)
        except (TypeError, ValueError):
            continue
    logger.info("  %s: %d entries", path.name, len(lookup))
    return lookup


def main():
    logger.info("Loading GeoJSON from %s", GEOJSON_PATH)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)
    features = geojson.get("features", [])
    logger.info("  %d features", len(features))

    logger.info("Loading metric inputs...")
    light = _load_lookup(LIGHT_PATH)
    water = _load_lookup(WATER_PATH)

    light_matched = 0
    water_matched = 0
    for feat in features:
        props = feat.setdefault("properties", {})
        pno = props.get("pno") or props.get("postinumeroalue") or ""
        pno = str(pno) if pno is not None else ""

        if pno in light:
            props["light_pollution"] = light[pno]
            light_matched += 1
        else:
            # Preserve None for genuine no-data (e.g. merged metro features).
            props.setdefault("light_pollution", None)

        if pno in water:
            props["water_proximity_m"] = water[pno]
            water_matched += 1
        else:
            props.setdefault("water_proximity_m", None)

    logger.info(
        "Matched light_pollution: %d/%d, water_proximity_m: %d/%d",
        light_matched, len(features), water_matched, len(features),
    )

    logger.info("Writing GeoJSON back to %s", GEOJSON_PATH)
    with open(GEOJSON_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)
    size_mb = GEOJSON_PATH.stat().st_size / 1024 / 1024
    logger.info("  %.1f MB", size_mb)


if __name__ == "__main__":
    main()
