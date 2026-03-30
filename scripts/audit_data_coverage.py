"""
Audit script for metro_neighborhoods.geojson data coverage.

Checks all external and derived data layers for missing/null values,
broken down by city and listing specific postal codes with gaps.

Usage:
    python scripts/audit_data_coverage.py
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

GEOJSON_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "metro_neighborhoods.geojson"

EXTERNAL_LAYERS = [
    "property_price_sqm",
    "rental_price_sqm",
    "property_price_change_pct",
    "price_to_rent_ratio",
    "transit_stop_density",
    "air_quality_index",
    "crime_index",
    "traffic_accident_rate",
    "school_quality_score",
    "light_pollution",
    "noise_pollution",
    "voter_turnout_pct",
    "party_diversity_index",
    "broadband_coverage_pct",
    "ev_charging_density",
    "tree_canopy_pct",
    "transit_reachability_score",
    "sports_facility_density",
    "water_proximity_m",
    "avg_construction_year",
    "foreign_language_pct",
    "green_space_pct",
    "daycare_density",
    "school_density",
    "healthcare_density",
    "restaurant_density",
    "grocery_density",
    "cycling_density",
    "walkability_index",
]

DERIVED_LAYERS = [
    "unemployment_rate",
    "higher_education_rate",
    "pensioner_share",
    "ownership_rate",
    "rental_rate",
    "population_density",
    "child_ratio",
    "student_share",
    "detached_house_share",
    "youth_ratio_pct",
    "gender_ratio",
    "single_parent_hh_pct",
    "families_with_children_pct",
    "tech_sector_pct",
    "healthcare_workers_pct",
    "employment_rate",
    "elderly_ratio_pct",
    "avg_household_size",
    "manufacturing_jobs_pct",
    "public_sector_jobs_pct",
    "service_sector_jobs_pct",
    "new_construction_pct",
    "single_person_hh_pct",
    "income_change_pct",
    "population_change_pct",
    "unemployment_change_pct",
]

ALL_LAYERS = EXTERNAL_LAYERS + DERIVED_LAYERS


def is_missing(value):
    """Check if a value should be considered missing."""
    return value is None


def audit(geojson_path: Path):
    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data["features"]
    total = len(features)

    # Gather city counts
    city_totals = defaultdict(int)
    for feat in features:
        city = feat["properties"].get("city", "UNKNOWN")
        city_totals[city] += 1

    cities_sorted = sorted(city_totals.keys())

    print("=" * 80)
    print("GEOJSON DATA COVERAGE AUDIT")
    print("=" * 80)
    print(f"\nFile: {geojson_path}")
    print(f"Total features: {total}")
    print("\nFeatures by city:")
    for city in cities_sorted:
        print(f"  {city}: {city_totals[city]}")

    # Check which requested layers are entirely absent from the data
    sample_keys = set(features[0]["properties"].keys()) if features else set()
    absent_layers = [layer for layer in ALL_LAYERS if layer not in sample_keys]
    if absent_layers:
        print(f"\n{'!' * 80}")
        print("LAYERS ENTIRELY ABSENT FROM GEOJSON (property key does not exist):")
        for layer in absent_layers:
            category = "external" if layer in EXTERNAL_LAYERS else "derived"
            print(f"  - {layer}  [{category}]")
        print(f"{'!' * 80}")

    # Audit each layer
    layers_with_gaps = []
    layers_complete = []

    for layer in ALL_LAYERS:
        if layer in absent_layers:
            layers_with_gaps.append((layer, total, {c: city_totals[c] for c in cities_sorted}, None))
            continue

        missing_total = 0
        missing_by_city = defaultdict(list)  # city -> list of (pno, nimi)

        for feat in features:
            props = feat["properties"]
            value = props.get(layer)
            if is_missing(value):
                missing_total += 1
                city = props.get("city", "UNKNOWN")
                pno = props.get("pno", "?")
                nimi = props.get("nimi", "?")
                missing_by_city[city].append((pno, nimi))

        if missing_total == 0:
            layers_complete.append(layer)
        else:
            missing_counts = {c: len(missing_by_city[c]) for c in cities_sorted}
            layers_with_gaps.append((layer, missing_total, missing_counts, missing_by_city))

    # --- Report: Layers with complete coverage ---
    print(f"\n{'=' * 80}")
    print(f"LAYERS WITH COMPLETE COVERAGE ({len(layers_complete)} / {len(ALL_LAYERS)})")
    print("=" * 80)
    for layer in layers_complete:
        category = "external" if layer in EXTERNAL_LAYERS else "derived"
        print(f"  [OK] {layer}  [{category}]")

    # --- Report: Layers with gaps ---
    print(f"\n{'=' * 80}")
    print(f"LAYERS WITH MISSING DATA ({len(layers_with_gaps)} / {len(ALL_LAYERS)})")
    print("=" * 80)

    # Sort by severity (most missing first)
    layers_with_gaps.sort(key=lambda x: x[1], reverse=True)

    for layer, missing_total, missing_counts, missing_by_city in layers_with_gaps:
        category = "external" if layer in EXTERNAL_LAYERS else "derived"
        pct_missing = (missing_total / total) * 100
        absent = layer in absent_layers

        print(f"\n--- {layer} [{category}] ---")
        if absent:
            print(f"  ** ENTIRELY ABSENT: property key does not exist in GeoJSON **")
        print(f"  Missing: {missing_total} / {total}  ({pct_missing:.1f}%)")
        print(f"  Present: {total - missing_total} / {total}  ({100 - pct_missing:.1f}%)")

        print(f"  Breakdown by city:")
        for city in cities_sorted:
            city_missing = missing_counts.get(city, 0)
            city_total = city_totals[city]
            city_pct = (city_missing / city_total * 100) if city_total > 0 else 0
            status = "COMPLETE" if city_missing == 0 else f"{city_missing}/{city_total} missing ({city_pct:.0f}%)"
            print(f"    {city:20s}: {status}")

        # List specific missing areas (skip if layer is entirely absent)
        if missing_by_city is not None and missing_total <= 100:
            for city in cities_sorted:
                areas = missing_by_city.get(city, [])
                if areas:
                    print(f"  Missing in {city}:")
                    for pno, nimi in sorted(areas):
                        print(f"    {pno}  {nimi}")
        elif missing_by_city is not None and missing_total > 100:
            print(f"  (Too many missing entries to list individually; showing first 10 per city)")
            for city in cities_sorted:
                areas = missing_by_city.get(city, [])
                if areas:
                    print(f"  Missing in {city} ({len(areas)} total):")
                    for pno, nimi in sorted(areas)[:10]:
                        print(f"    {pno}  {nimi}")
                    if len(areas) > 10:
                        print(f"    ... and {len(areas) - 10} more")

    # --- Summary table ---
    print(f"\n{'=' * 80}")
    print("SUMMARY TABLE")
    print("=" * 80)
    header = f"{'Layer':<35s} {'Category':<10s} {'Missing':>8s} {'Total':>6s} {'%Missing':>9s} | {'Helsinki':>10s} {'Tampere':>10s} {'Turku':>10s}"
    print(header)
    print("-" * len(header))

    all_items = []
    for layer in ALL_LAYERS:
        category = "ext" if layer in EXTERNAL_LAYERS else "derived"
        if layer in [item[0] for item in layers_with_gaps]:
            match = next(item for item in layers_with_gaps if item[0] == layer)
            missing_total = match[1]
            missing_counts = match[2]
        else:
            missing_total = 0
            missing_counts = {c: 0 for c in cities_sorted}

        pct = (missing_total / total) * 100
        all_items.append((layer, category, missing_total, pct, missing_counts))

    # Sort: most missing first
    all_items.sort(key=lambda x: x[2], reverse=True)

    for layer, category, missing_total, pct, missing_counts in all_items:
        hel = missing_counts.get("helsinki_metro", 0)
        tam = missing_counts.get("tampere", 0)
        tur = missing_counts.get("turku", 0)

        hel_str = f"{hel}/{city_totals['helsinki_metro']}" if hel > 0 else "OK"
        tam_str = f"{tam}/{city_totals['tampere']}" if tam > 0 else "OK"
        tur_str = f"{tur}/{city_totals['turku']}" if tur > 0 else "OK"

        marker = " ***" if missing_total == total else (" **" if pct > 50 else (" *" if missing_total > 0 else ""))
        print(f"{layer:<35s} {category:<10s} {missing_total:>8d} {total:>6d} {pct:>8.1f}% | {hel_str:>10s} {tam_str:>10s} {tur_str:>10s}{marker}")

    print()
    print("Legend: *** = 100% missing, ** = >50% missing, * = some missing, (blank) = complete")
    print()

    # Return exit code: 0 if no gaps, 1 if any gaps found
    return 1 if layers_with_gaps else 0


if __name__ == "__main__":
    if not GEOJSON_PATH.exists():
        print(f"ERROR: GeoJSON file not found at {GEOJSON_PATH}", file=sys.stderr)
        sys.exit(2)
    sys.exit(audit(GEOJSON_PATH))
