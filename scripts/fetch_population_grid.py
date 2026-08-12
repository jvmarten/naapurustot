#!/usr/bin/env python3
"""Fetch Statistics Finland's 1 km population grid (väestöruutuaineisto).

Data source: Tilastokeskus, "Väestöruutuaineisto 1 km x 1 km", served from the
open WFS at geo.stat.fi (CC BY 4.0, attribution "Lähde: Tilastokeskus"):

  https://geo.stat.fi/geoserver/vaestoruutu/wfs

Layer used: ``vaestoruutu:vaki{YEAR}_1km_kp`` — the *keskipiste* (centre-point)
variant, one Point per populated 1 km cell, already published in EPSG:3067 so
no reprojection is needed downstream.

Only cells with inhabitants are published, so the layer is the national
settlement pattern rather than a full grid: ~97k points against the ~390k 1 km
cells that would tile Finland's land area.

Why 1 km and not 250 m: the 250 m grid is not part of the open WFS product.
Its 51 layers cover 1 km and 5 km only (verified against GetCapabilities), so
1 km is the finest openly published national population raster.

Fields kept: ``vaesto`` (inhabitants) plus the cell centre coordinates. The
age/sex breakdown columns are deliberately NOT kept — Statistics Finland
suppresses them on small cells with a ``-1`` sentinel, and this repository
must never carry those (see CLAUDE.md). ``vaesto`` itself is never suppressed.

Honesty guards (a partial national fetch must never be written):
  * The feature count is read from the server up front (``resultType=hits``)
    and the paged download must deliver exactly that many features.
  * The summed population must land in a plausible national range, otherwise
    the run aborts rather than writing a truncated grid.

Output: scripts/cache/population_grid_1km.json
    {"year": 2025, "crs": "EPSG:3067", "layer": ..., "cells": [[x, y, vaesto], ...]}

Usage:
    python scripts/fetch_population_grid.py [--year 2025]
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent
OUTPUT_PATH = SCRIPT_DIR / "cache" / "population_grid_1km.json"

WFS_BASE = "https://geo.stat.fi/geoserver/vaestoruutu/wfs"
DEFAULT_YEAR = 2025
PAGE_SIZE = 10_000
MAX_RETRIES = 5
RETRY_BACKOFF_BASE = 3  # seconds; exponential: 3, 9, 27, 81

# Finland's population is ~5.6 M. The grid omits nobody — every inhabitant is
# registered to a cell — so a total outside this band means a truncated fetch,
# not demographic change.
MIN_PLAUSIBLE_TOTAL = 5_000_000
MAX_PLAUSIBLE_TOTAL = 6_500_000


def _request_with_retry(params: dict, label: str) -> requests.Response:
    """GET the WFS with exponential backoff. Raises if every attempt fails."""
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(WFS_BASE, params=params, timeout=120)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001 — retry on anything transient
            last_exc = e
            if attempt < MAX_RETRIES - 1:
                wait = RETRY_BACKOFF_BASE ** (attempt + 1)
                logger.warning(
                    "  Retry %d/%d for %s in %ds (%s)",
                    attempt + 1, MAX_RETRIES, label, wait, e,
                )
                time.sleep(wait)
    raise RuntimeError(f"WFS request failed for {label}: {last_exc}")


def fetch_hits(layer: str) -> int:
    """Ask the server how many features the layer holds."""
    r = _request_with_retry(
        {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeName": layer,
            "resultType": "hits",
        },
        f"{layer} hits",
    )
    marker = 'numberMatched="'
    text = r.text
    i = text.find(marker)
    if i < 0:
        raise RuntimeError(f"No numberMatched in hits response for {layer}")
    j = text.find('"', i + len(marker))
    return int(text[i + len(marker):j])


def fetch_cells(layer: str, expected: int) -> list[list[int]]:
    """Page through the layer and return [[x, y, vaesto], ...] in EPSG:3067."""
    cells: list[list[int]] = []
    start = 0
    while start < expected:
        r = _request_with_retry(
            {
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeName": layer,
                "outputFormat": "application/json",
                "srsName": "EPSG:3067",
                "count": PAGE_SIZE,
                "startIndex": start,
            },
            f"{layer} [{start}:{start + PAGE_SIZE}]",
        )
        payload = r.json()
        features = payload.get("features", [])
        if not features:
            raise RuntimeError(
                f"Empty page at startIndex={start} but only {len(cells)}/{expected} "
                "features retrieved — refusing to write a partial national grid"
            )
        for f in features:
            geom = f.get("geometry") or {}
            coords = geom.get("coordinates")
            props = f.get("properties") or {}
            pop = props.get("vaesto")
            if not coords or pop is None:
                continue
            # vaesto is a true count on every published cell; the -1 suppression
            # sentinel only ever appears on the age/sex columns we do not read.
            if pop < 0:
                continue
            cells.append([int(round(coords[0])), int(round(coords[1])), int(pop)])
        start += PAGE_SIZE
        logger.info("  %d/%d features", min(start, expected), expected)

    return cells


def main():
    parser = argparse.ArgumentParser(
        description="Fetch the Statistics Finland 1 km population grid centre points"
    )
    parser.add_argument(
        "--year", type=int, default=DEFAULT_YEAR,
        help=f"Grid vintage (default: {DEFAULT_YEAR})",
    )
    args = parser.parse_args()

    layer = f"vaestoruutu:vaki{args.year}_1km_kp"
    logger.info("=== Statistics Finland 1 km population grid ===")
    logger.info("Layer: %s", layer)

    expected = fetch_hits(layer)
    logger.info("  server reports %d populated cells", expected)

    cells = fetch_cells(layer, expected)
    logger.info("Retrieved %d cells", len(cells))

    if len(cells) != expected:
        raise SystemExit(
            f"Fetched {len(cells)} cells but the server advertised {expected}. "
            "Refusing to write a partial national grid."
        )

    total_pop = sum(c[2] for c in cells)
    logger.info("  total population across grid: %d", total_pop)
    if not (MIN_PLAUSIBLE_TOTAL <= total_pop <= MAX_PLAUSIBLE_TOTAL):
        raise SystemExit(
            f"Grid totals {total_pop} inhabitants, outside the plausible national "
            f"range {MIN_PLAUSIBLE_TOTAL}-{MAX_PLAUSIBLE_TOTAL}. Refusing to write."
        )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "year": args.year,
                "crs": "EPSG:3067",
                "layer": layer,
                "source": "Tilastokeskus, väestöruutuaineisto 1 km x 1 km (CC BY 4.0)",
                "cells": cells,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    logger.info(
        "Saved %d cells to %s (%.1f MB)",
        len(cells), OUTPUT_PATH, OUTPUT_PATH.stat().st_size / 1e6,
    )


if __name__ == "__main__":
    main()
