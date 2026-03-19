#!/usr/bin/env python3
"""
CF-3: Fetch Points of Interest from OpenStreetMap via Overpass API.
Outputs: public/data/pois.geojson

Categories:
  - school: amenity=school
  - daycare: amenity=kindergarten
  - grocery: shop=supermarket|convenience
  - healthcare: amenity=hospital|clinic|doctors|pharmacy
  - transit: highway=bus_stop OR railway=station|tram_stop
"""

import json
import requests
import sys

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Helsinki metro bounding box
BBOX = "60.1,24.5,60.5,25.3"

QUERIES = {
    "school": f'[out:json];node["amenity"="school"]({BBOX});out center;way["amenity"="school"]({BBOX});out center;',
    "daycare": f'[out:json];node["amenity"="kindergarten"]({BBOX});out center;way["amenity"="kindergarten"]({BBOX});out center;',
    "grocery": f'[out:json];node["shop"~"supermarket|convenience"]({BBOX});out center;way["shop"~"supermarket|convenience"]({BBOX});out center;',
    "healthcare": f'[out:json];node["amenity"~"hospital|clinic|doctors|pharmacy"]({BBOX});out center;way["amenity"~"hospital|clinic|doctors|pharmacy"]({BBOX});out center;',
    "transit": f'[out:json];node["highway"="bus_stop"]({BBOX});out;node["railway"~"station|tram_stop"]({BBOX});out;',
}


def fetch_category(category: str, query: str) -> list:
    """Fetch POIs for a single category."""
    print(f"Fetching {category}...")
    resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=120)
    resp.raise_for_status()
    data = resp.json()

    features = []
    for elem in data.get("elements", []):
        lat = elem.get("lat") or elem.get("center", {}).get("lat")
        lon = elem.get("lon") or elem.get("center", {}).get("lon")
        if lat is None or lon is None:
            continue
        name = elem.get("tags", {}).get("name", "")
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "category": category,
                "name": name,
                "id": elem["id"],
            },
        })
    print(f"  Found {len(features)} {category} POIs")
    return features


def main():
    all_features = []
    for category, query in QUERIES.items():
        try:
            features = fetch_category(category, query)
            all_features.extend(features)
        except Exception as e:
            print(f"  Error fetching {category}: {e}", file=sys.stderr)

    geojson = {
        "type": "FeatureCollection",
        "features": all_features,
    }

    output_path = "public/data/pois.geojson"
    with open(output_path, "w") as f:
        json.dump(geojson, f)
    print(f"\nWrote {len(all_features)} POIs to {output_path}")


if __name__ == "__main__":
    main()
