#!/usr/bin/env python3
"""
CF-5: Fetch Statistics Finland 250m grid data for heatmap visualization.
Outputs: public/data/grid_250m.geojson

Data source: Statistics Finland open data (Paavo grid)
Grid cells contain: population, median income, education level
"""

import json
import sys

# This script is a placeholder for fetching 250m grid data from Statistics Finland.
# The actual implementation requires downloading from:
# https://pxdata.stat.fi/PxWeb/pxweb/en/StatFin/
#
# To use:
# 1. Download 250m grid population data from Statistics Finland
# 2. Convert to GeoJSON with WGS84 coordinates (from ETRS-TM35FIN)
# 3. Output to public/data/grid_250m.geojson


def main():
    print("CF-5: Grid data fetch script")
    print("This script requires manual download from Statistics Finland.")
    print("")
    print("Steps:")
    print("1. Download 250m grid data from pxdata.stat.fi")
    print("2. Convert coordinates from ETRS-TM35FIN (EPSG:3067) to WGS84 (EPSG:4326)")
    print("3. Output as GeoJSON to public/data/grid_250m.geojson")
    print("")
    print("Expected GeoJSON format:")
    print('  { "type": "FeatureCollection", "features": [')
    print('    { "type": "Feature",')
    print('      "geometry": { "type": "Point", "coordinates": [lng, lat] },')
    print('      "properties": { "population": N, "income": N, "education": N }')
    print("    }, ...")
    print("  ]}")
    sys.exit(0)


if __name__ == "__main__":
    main()
