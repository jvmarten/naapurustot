#!/usr/bin/env python3
"""Validate metro_neighborhoods.geojson after data pipeline runs.

Checks:
  1. Expected number of features (~160)
  2. No all-null properties
  3. Value ranges are plausible
  4. All required properties present
  5. Valid geometries (no self-intersections)

Exit code 0 = pass, 1 = failures found.
"""

import json
import sys
from pathlib import Path

GEOJSON_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "metro_neighborhoods.geojson"
# IN-2: single source-of-truth data-source registry.
REGISTRY_PATH = Path(__file__).resolve().parent.parent / "src" / "data" / "data_sources.json"
# IN-3: committed per-metric coverage baseline for regression detection.
BASELINE_PATH = Path(__file__).resolve().parent.parent / "src" / "data" / "data_baseline.json"
# Fail if a metric's non-null coverage drops by more than this fraction vs the baseline.
COVERAGE_DROP_TOLERANCE = 0.25

# ── Feature count bounds ─────────────────────────────────────────────
# All 69 Finnish seutukunnat: ~3000 postal codes in total. Range allows
# for Posti additions/removals across refreshes.
MIN_FEATURES = 2500
MAX_FEATURES = 3500

# ── Required properties (must exist on every feature) ────────────────
REQUIRED_PROPERTIES = [
    # Identifiers
    "pno", "nimi",
    # Core Paavo population
    "he_vakiy", "he_naiset", "he_miehet", "he_kika",
    # Income
    "hr_mtu", "hr_ktu",
    # Education
    "ko_ika18y",
    # Economic activity
    "pt_tyoll", "pt_tyott", "pt_vakiy",
    # Housing
    "ra_asunn", "ra_as_kpa", "pinta_ala",
    # Households
    "te_taly",
    # Computed rates
    "unemployment_rate", "higher_education_rate", "ownership_rate",
    "rental_rate", "population_density",
    # Coordinates
    "euref_x", "euref_y",
]

# ── Value range checks ───────────────────────────────────────────────
# (property, min, max) — nulls are allowed and skipped
PERCENTAGE_FIELDS = [
    "unemployment_rate",
    "higher_education_rate",
    "pensioner_share",
    "ownership_rate",
    "rental_rate",
    "child_ratio",
    "student_share",
    "detached_house_share",
    "foreign_language_pct",
    "voter_turnout_pct",
    "tree_canopy_pct",
    "single_person_hh_pct",
    "seniors_alone_pct",
]

RANGE_CHECKS = [
    # (property, min, max)
    *[(p, 0, 100) for p in PERCENTAGE_FIELDS],
    # green_space_pct can exceed 100 (green area / built area ratio)
    ("green_space_pct", 0, 1_000),
    # Income (€/year) — 0 means suppressed data
    ("hr_mtu", 0, 200_000),
    ("hr_ktu", 0, 200_000),
    # Average age — 0 means suppressed data
    ("he_kika", 0, 80),
    # Population density (persons/km²)
    ("population_density", 0, 100_000),
    # Property prices (€/m²)
    ("property_price_sqm", 100, 30_000),
    # Densities (per km²) — generous upper bounds
    ("transit_stop_density", 0, 1_000),
    ("daycare_density", 0, 200),
    ("school_density", 0, 200),
    ("healthcare_density", 0, 200),
    ("restaurant_density", 0, 1_000),
    ("grocery_density", 0, 500),
    # Indices
    ("transit_reachability_score", 0, 100),
    ("party_diversity_index", 0, 5),
    ("crime_index", 0, 500),
    ("air_quality_index", 0, 500),
    # Noise / light
    ("noise_pollution", 0, 120),
    ("light_pollution", 0, 2000),
]


def load_geojson(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check_feature_count(features: list) -> list[str]:
    n = len(features)
    errors = []
    if n < MIN_FEATURES:
        errors.append(f"Too few features: {n} (expected >= {MIN_FEATURES})")
    if n > MAX_FEATURES:
        errors.append(f"Too many features: {n} (expected <= {MAX_FEATURES})")
    return errors


def check_required_properties(features: list) -> list[str]:
    errors = []
    for prop in REQUIRED_PROPERTIES:
        missing = [
            f["properties"].get("pno", "?")
            for f in features
            if prop not in f.get("properties", {})
        ]
        if missing:
            if len(missing) <= 5:
                errors.append(f"Property '{prop}' missing from features: {missing}")
            else:
                errors.append(f"Property '{prop}' missing from {len(missing)} features")
    return errors


def check_no_all_null_properties(features: list) -> list[str]:
    """Flag any property where every single feature has null."""
    if not features:
        return []

    all_props = set()
    for f in features:
        all_props.update(f.get("properties", {}).keys())

    errors = []
    # Exclude string/JSON-array fields from this check — they may legitimately be absent
    skip = {"income_history", "population_history", "unemployment_history"}
    for prop in sorted(all_props - skip):
        values = [f["properties"].get(prop) for f in features]
        non_null = [v for v in values if v is not None]
        if len(non_null) == 0:
            errors.append(f"Property '{prop}' is null for ALL {len(features)} features")
    return errors


def check_value_ranges(features: list) -> list[str]:
    errors = []
    for prop, lo, hi in RANGE_CHECKS:
        violations = []
        for f in features:
            val = f["properties"].get(prop)
            if val is None:
                continue
            try:
                num = float(val)
            except (TypeError, ValueError):
                violations.append((f["properties"].get("pno", "?"), val, "not numeric"))
                continue
            if num < lo or num > hi:
                violations.append((f["properties"].get("pno", "?"), num))
        if violations:
            sample = violations[:5]
            details = ", ".join(f"{pno}={v}" for pno, *v in sample)
            suffix = f" (+{len(violations) - 5} more)" if len(violations) > 5 else ""
            errors.append(
                f"Property '{prop}' out of range [{lo}, {hi}]: {details}{suffix}"
            )
    return errors


def check_geometries(features: list) -> list[str]:
    """Check geometry validity using Shapely if available, else basic checks."""
    errors = []

    # Basic: every feature must have a geometry with coordinates
    for f in features:
        pno = f.get("properties", {}).get("pno", "?")
        geom = f.get("geometry")
        if geom is None:
            errors.append(f"Feature {pno}: geometry is null")
            continue
        if geom.get("type") not in ("Polygon", "MultiPolygon"):
            errors.append(f"Feature {pno}: unexpected geometry type '{geom.get('type')}'")
            continue
        coords = geom.get("coordinates")
        if not coords:
            errors.append(f"Feature {pno}: geometry has no coordinates")

    # Shapely validation (self-intersections, etc.)
    try:
        from shapely.geometry import shape

        for f in features:
            pno = f.get("properties", {}).get("pno", "?")
            geom = f.get("geometry")
            if geom is None:
                continue
            try:
                s = shape(geom)
                if not s.is_valid:
                    errors.append(f"Feature {pno}: invalid geometry — {s.is_valid}")
            except Exception as exc:
                errors.append(f"Feature {pno}: geometry parse error — {exc}")
    except ImportError:
        print("  [info] shapely not installed — skipping self-intersection checks")

    return errors


def check_data_source_registry(features: list) -> list[str]:
    """IN-2: every layer that the data-source registry marks as stored in the
    GeoJSON must actually be present (non-null on >= 1 feature), so a registry row
    can never silently point at a dropped data column. Metrics computed purely
    client-side (the quality index) are flagged `stored: false` and skipped.
    Also verifies every metric's publisher reference resolves."""
    errors: list[str] = []
    if not REGISTRY_PATH.exists():
        return [f"data-source registry not found: {REGISTRY_PATH}"]
    try:
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"data_sources.json is not valid JSON: {exc}"]

    publishers = registry.get("publishers", {})
    metrics = registry.get("metrics", {})
    if not metrics:
        return ["data_sources.json has no 'metrics' section"]

    for prop, entry in metrics.items():
        pub = entry.get("publisher")
        if pub not in publishers:
            errors.append(f"Metric '{prop}' references unknown publisher '{pub}'")

    # Properties present (non-null) on at least one feature.
    present: set[str] = set()
    for f in features:
        for key, val in (f.get("properties") or {}).items():
            if val is not None:
                present.add(key)

    for prop, entry in metrics.items():
        if entry.get("stored", True) is False:
            continue
        if prop not in present:
            errors.append(
                f"Registry metric '{prop}' is marked stored but is missing/all-null in the GeoJSON"
            )
    return errors


def _registry_stored_props() -> list[str]:
    """Registry metric properties that are stored in the GeoJSON (not client-derived)."""
    if not REGISTRY_PATH.exists():
        return []
    try:
        reg = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [p for p, e in reg.get("metrics", {}).items() if e.get("stored", True) is not False]


def compute_coverage(features: list) -> dict[str, int]:
    """Per registry metric, the number of features with a non-null, non-empty value."""
    props = _registry_stored_props()
    counts = {p: 0 for p in props}
    for f in features:
        fp = f.get("properties") or {}
        for p in props:
            v = fp.get(p)
            if v is not None and not (isinstance(v, str) and v.strip() == ""):
                counts[p] += 1
    return counts


def check_coverage_regression(features: list) -> list[str]:
    """IN-3: fail if a metric that was populated in the committed baseline becomes
    entirely null, or its coverage drops by more than COVERAGE_DROP_TOLERANCE — the
    signature of a silent upstream schema change that nulls a column. New metrics
    (absent from the baseline) are ignored; regenerate the baseline with
    `python scripts/validate_data.py --write-baseline` after an intentional change."""
    errors: list[str] = []
    if not BASELINE_PATH.exists():
        print("  [info] no data_baseline.json — skipping coverage-regression check (run --write-baseline to create)")
        return []
    try:
        baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8")).get("metrics", {})
    except json.JSONDecodeError as exc:
        return [f"data_baseline.json is not valid JSON: {exc}"]

    current = compute_coverage(features)
    for prop, base_count in baseline.items():
        if not isinstance(base_count, int) or base_count <= 0:
            continue
        cur = current.get(prop, 0)
        if cur == 0:
            errors.append(f"Metric '{prop}' was populated ({base_count}) in the baseline but is now entirely null")
        elif cur < base_count * (1 - COVERAGE_DROP_TOLERANCE):
            pct = round(100 * cur / base_count)
            errors.append(f"Metric '{prop}' coverage dropped to {cur} ({pct}% of baseline {base_count})")
    return errors


def write_baseline(features: list) -> None:
    """Write/refresh src/data/data_baseline.json from the current GeoJSON."""
    counts = compute_coverage(features)
    payload = {
        "_comment": (
            "IN-3 coverage baseline — per registry metric, the count of features with a "
            "non-null value. validate_data.py fails if a populated metric goes all-null or "
            "its coverage drops sharply (a silent upstream schema change). Regenerate after "
            "an intentional data change: python scripts/validate_data.py --write-baseline"
        ),
        "feature_count": len(features),
        "metrics": dict(sorted(counts.items())),
    }
    BASELINE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {BASELINE_PATH} ({len(counts)} metrics, {len(features)} features).")


def check_pno_format(features: list) -> list[str]:
    """Postal codes should be 5-digit strings."""
    errors = []
    for f in features:
        pno = f.get("properties", {}).get("pno")
        if pno is None:
            continue
        pno_str = str(pno)
        if len(pno_str) != 5 or not pno_str.isdigit():
            errors.append(f"Invalid postal code format: '{pno}'")
    return errors


def main() -> int:
    path = GEOJSON_PATH
    pos_args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if pos_args:
        path = Path(pos_args[0])

    print(f"Validating {path} ...")
    if not path.exists():
        print(f"FAIL: file not found: {path}")
        return 1

    data = load_geojson(path)
    features = data.get("features", [])
    print(f"  Features: {len(features)}")

    if "--write-baseline" in sys.argv:
        write_baseline(features)
        return 0

    all_errors: list[str] = []

    checks = [
        ("Feature count", check_feature_count(features)),
        ("Required properties", check_required_properties(features)),
        ("All-null properties", check_no_all_null_properties(features)),
        ("Value ranges", check_value_ranges(features)),
        ("Data-source registry", check_data_source_registry(features)),
        ("Coverage regression", check_coverage_regression(features)),
        ("Geometries", check_geometries(features)),
        ("Postal code format", check_pno_format(features)),
    ]

    for name, errs in checks:
        if errs:
            print(f"\n  FAIL: {name} ({len(errs)} issue(s))")
            for e in errs:
                print(f"    - {e}")
            all_errors.extend(errs)
        else:
            print(f"  OK: {name}")

    if all_errors:
        print(f"\nValidation FAILED with {len(all_errors)} error(s).")
        return 1

    print("\nValidation PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
