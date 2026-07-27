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
# IN-3: independent provenance record of the ACTUAL fetched data vintage per metric.
# Cross-checked against data_sources.json so the public attribution can never silently
# diverge from what was really pulled. Update in lockstep when a fetch pulls a new period.
PROVENANCE_PATH = Path(__file__).resolve().parent / "provenance.json"
# Registry metrics intentionally absent from provenance.json: client-derived metrics
# that have no upstream fetch (and therefore no fetched vintage to cross-check).
EXEMPT_FROM_PROVENANCE = {
    "quality_index",  # composite of other layers, computed client-side (stored: false)
}

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
    "foreign_language_municipal_pct",
    "foreign_language_est_pct",
    "voter_turnout_pct",
    "tree_canopy_pct",
    "single_person_hh_pct",
    # IN-3: percentage layer that shipped after this list was last extended.
    "flood_risk_pct",
    # PLANNING — pre-registered, inert until the column lands (absent props skipped).
    "planned_area_pct",
]

RANGE_CHECKS = [
    # (property, min, max)
    *[(p, 0, 100) for p in PERCENTAGE_FIELDS],
    # Income (€/year) — 0 means suppressed data
    ("hr_mtu", 0, 200_000),
    ("hr_ktu", 0, 200_000),
    # QW-1: household disposable income (€/yr) + living space per person (m²).
    ("tr_mtu", 0, 200_000),
    ("te_as_valj", 0, 200),
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
    # Upper bound raised from 200 for 65130 Hietalahti (Vaasa): a 0.18 km2, zero-
    # resident postal area that is the central hospital campus, where OSM tags ~40
    # individual healthcare=* units -> 222.3 /km2. Real count, real ratio, extreme
    # only because the denominator is a hospital-sized polygon. It was invisible
    # until the missing Vaasa Overpass cache was fetched. The national colour scale
    # winsorizes at p2/p98, so the outlier does not flatten the layer.
    ("healthcare_density", 0, 400),
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
    # IN-3: layers that shipped after this list was last extended and were
    # bypassing all value-range validation. Bounds are generous (catch unit/scale
    # mistakes without flagging legitimate outliers); compare national_ranges.json.
    # Indoor radon (Bq/m³) — Finnish reference level 200–300 (max observed ≈303).
    ("radon", 0, 2_000),
    # THL/Kela morbidity index, 100 = national average (observed ≈81–133).
    ("health_index", 0, 300),
    # Rent (€/m²/month) (observed ≈10–23).
    ("rental_price_sqm", 1, 100),
    # CF-6: projected population change 2024→2040 (%). Diverging; declining and
    # growing municipalities span well within ±50 (observed ≈ -31..+26).
    ("population_projection_pct", -50, 50),
    # CF-11: construction activity — new dwellings 2020- per 1,000 residents
    # (municipal flow proxy). Sequential count rate (observed ≈ 0..81).
    ("construction_activity", 0, 100),
    # CF-5: planning & development activity — count of distinct kaavat & hankkeet
    # intersecting each postal polygon (real per-postal geometry, is_proxy:false,
    # NOT a distributed proxy). 0 is a valid real value (no nearby planning);
    # build_planning_data caps entries at 12 per pno (observed 0..12).
    ("active_plan_count", 0, 1_000),
    # IN-1: value-range coverage extended to the remaining stored postal metrics
    # (previously only ~half were checked). Bounds are generous — set outward of the
    # observed min/max so they catch unit/scale mistakes without flagging real
    # outliers. *_index metrics and *_change_pct metrics can legitimately be negative
    # or exceed 100; new_construction_pct exceeds 100 in fast-growing areas.
    ("walkability_index", 0, 100),
    ("water_proximity_m", 0, 50_000),
    # QW-1: low-income household share (%). job_self_sufficiency legitimately exceeds 100
    # (employment hubs) and reaches tens of thousands in a tiny residential postal code
    # hosting a large employer (max observed 76,193) — a generous upper bound, not an error.
    ("low_income_pct", 0, 100),
    ("job_self_sufficiency", 0, 100_000),
    ("avg_construction_year", 1800, 2035),
    ("avg_household_size", 0, 15),
    ("gender_ratio", 0, 10),
    ("ra_as_kpa", 0, 500),
    ("he_vakiy", 0, 200_000),
    ("school_quality_score", 0, 100),
    ("price_to_rent_ratio", 0, 100),
    ("new_construction_pct", 0, 10_000),
    ("traffic_accident_rate", 0, 1_000),
    ("cycling_density", 0, 2_000),
    ("sports_facility_density", 0, 1_000),
    ("ev_charging_density", 0, 1_000),
    ("broadband_coverage_pct", 0, 100),
    ("political_lean_index", 0, 100),
    # Employment / sector / demographic shares (%).
    ("employment_rate", 0, 100),
    ("elderly_ratio_pct", 0, 100),
    ("youth_ratio_pct", 0, 100),
    ("families_with_children_pct", 0, 100),
    ("single_parent_hh_pct", 0, 100),
    ("service_sector_jobs_pct", 0, 100),
    ("manufacturing_jobs_pct", 0, 100),
    ("healthcare_workers_pct", 0, 100),
    ("public_sector_jobs_pct", 0, 100),
    ("tech_sector_pct", 0, 100),
    ("party_vote_kok_pct", 0, 100),
    ("party_vote_sdp_pct", 0, 100),
    ("party_vote_ps_pct", 0, 100),
    ("party_vote_kesk_pct", 0, 100),
    ("party_vote_vihr_pct", 0, 100),
    ("party_vote_vas_pct", 0, 100),
    ("party_vote_rkp_pct", 0, 100),
    # Change metrics (%) — legitimately negative; large positives in tiny-base areas.
    ("crime_index_change_pct", -100, 2_000),
    ("income_change_pct", -100, 1_000),
    ("population_change_pct", -100, 5_000),
    ("property_price_change_pct", -100, 1_000),
    ("unemployment_change_pct", -100, 5_000),
    # PLANNING — planned_area_pct stays pre-registered until that column lands;
    # range-checked 0–100 via PERCENTAGE_FIELDS above (absent props skipped).
]

# ── IN-1: value-level integrity gates ────────────────────────────────
# Statistics Finland (Paavo) uses -1 as a confidentiality/suppression sentinel
# across every source column with these prefixes (plus pinta_ala). Suppression
# must become null in the pipeline — a -1 that survives ships into the open-data
# CSV and /api/v1 as if it were a real count. Prefix-scoped so the derived
# *_change_pct metrics, which legitimately hold real -1.0 % values, are exempt.
SUPPRESSION_PREFIXES = ("he_", "ko_", "hr_", "tr_", "te_", "ra_", "pt_", "tp_")

# Distinctness: fail a postal metric whose distribution is dominated by a single
# value (the signature of the fabricated 40.0 dB noise floor that covered 74 % of
# the country). Exempt metrics whose dominant value is a genuine measurement.
DISTINCTNESS_THRESHOLD = 0.50

# grocery_density's zeros are real, so it sits on DISTINCTNESS_EXEMPT below - which
# means check_dense_urban_zero, not distinctness, is what guards it against a failed
# Overpass region fetch. Calibrated so that no area passes today while the centre of
# Tampere (18,057 residents in 4.3 km2, shipped as 0) would have been caught.
DENSE_URBAN_MIN_POP = 8000
DENSE_URBAN_MAX_AREA_M2 = 15_000_000

DISTINCTNESS_EXEMPT = {
    # Real-zero OSM/count metrics: a 0 means "none within this area" — an honest
    # measurement, not a placeholder — so a high share of identical 0s is expected.
    "daycare_density", "ev_charging_density", "grocery_density",
    "healthcare_density", "restaurant_density", "school_density",
    "public_sector_jobs_pct", "tech_sector_pct",
    # Known-degenerate, IN-1 follow-up: water_proximity_m is measured from the
    # polygon edge, so any area touching a stream scores 0 (2,789/3,018). Real but
    # near-useless; fixing the measurement is separate work.
    "water_proximity_m",
    # Modeled quiet-baseline: measured traffic-noise contours cover ~26 % of areas;
    # the rest are shown at the 40 dB quiet residential baseline (no major road/rail
    # nearby), which the layer note states explicitly. This is an intentional modeled
    # default, not fabricated measurement. FOLLOW-UP: replace the flat baseline with a
    # distance-to-major-road/rail attenuation model so uncovered areas get a real
    # gradient (which will also make this exemption unnecessary).
    "noise_pollution",
}

# A metric derived entirely from a proxy metric inherits the proxy's honesty
# status — it is no more direct than the series it is computed from. child -> parent.
DERIVED_PROXY_CHILDREN = {
    "crime_index_change_pct": "crime_index",
}


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
    skip = {"income_history", "population_history", "unemployment_history",
            "foreign_language_history"}
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


def check_no_suppression_sentinels(features: list) -> list[str]:
    """IN-1: no Paavo -1 suppression sentinel may ship as a value. It must be nulled
    in the pipeline; a survivor leaks into the public open-data CSV and the frozen
    /api/v1 JSON as if it were a real count. Prefix-scoped to the Paavo source columns
    so the derived *_change_pct metrics (which hold real -1.0 % values) are not flagged."""
    counts: dict[str, int] = {}
    for f in features:
        for k, v in (f.get("properties") or {}).items():
            if (v == -1 or v == -1.0) and (
                k.startswith(SUPPRESSION_PREFIXES) or k == "pinta_ala"
            ):
                counts[k] = counts.get(k, 0) + 1
    return [
        f"Property '{k}' has {n} unsuppressed -1 sentinel(s) - Paavo suppression must become null"
        for k, n in sorted(counts.items())
    ]


def _registry_postal_props() -> list[str]:
    """Registry metrics stored in the GeoJSON at postal granularity."""
    if not REGISTRY_PATH.exists():
        return []
    try:
        reg = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [
        p
        for p, e in reg.get("metrics", {}).items()
        if e.get("stored", True) is not False and e.get("granularity") == "postal"
    ]


def check_value_distinctness(features: list) -> list[str]:
    """IN-1: catch a fabricated or degenerate postal metric at build time - one where
    a single value dominates the distribution (the 40.0 dB noise floor covering 74 %
    of the country was exactly this). Fail when more than DISTINCTNESS_THRESHOLD of a
    postal metric's non-null values are identical, except metrics on DISTINCTNESS_EXEMPT
    whose dominant value is a genuine measurement (real-zero OSM counts) or a documented
    known-degenerate follow-up."""
    errors: list[str] = []
    for prop in _registry_postal_props():
        if prop in DISTINCTNESS_EXEMPT:
            continue
        counts: dict = {}
        total = 0
        for f in features:
            v = f["properties"].get(prop)
            if v is None or isinstance(v, bool) or not isinstance(v, (int, float, str)):
                continue
            if isinstance(v, str) and v.strip() == "":
                continue
            counts[v] = counts.get(v, 0) + 1
            total += 1
        if total < 20:
            continue
        mode_val, mode_count = max(counts.items(), key=lambda kv: kv[1])
        share = mode_count / total
        if share > DISTINCTNESS_THRESHOLD:
            errors.append(
                f"Property '{prop}': {round(share * 100)}% of non-null values are identical "
                f"({mode_val!r} x{mode_count}/{total}) - fabricated or degenerate? Add to "
                f"DISTINCTNESS_EXEMPT only if that value is a genuine measurement."
            )
    return errors


def check_dense_urban_zero(features: list) -> list[str]:
    """Catch an Overpass region fetch that failed and shipped as measured zeros.

    grocery_density is on DISTINCTNESS_EXEMPT because 0 genuinely means "no shop
    inside this postal area", which is the common case: 85 % of Finnish postal
    areas have none. That exemption also blinds the distinctness check to the one
    failure mode this metric actually has. When an Overpass region download fails,
    join_groceries writes 0 for every postal code in it and nothing notices - five
    of the 69 seutukunta bboxes had no cached response, so 237 areas covering
    ~536,000 residents shipped a measured-looking 0, the centre of Tampere (18,057
    residents in 4.3 km2) among them.

    Testing a whole seutukunta for all-zero does not work: density is stores per
    km2 rounded to one decimal, so a genuine shop in a 5,000 km2 Lapland postal
    area still rounds to 0.0. Test the opposite end instead - a densely populated,
    physically small area with no grocery shop at all is not a measurement."""
    errors: list[str] = []
    for f in features:
        p = f["properties"]
        pop = p.get("he_vakiy")
        area = p.get("pinta_ala")
        density = p.get("grocery_density")
        if density != 0 or not isinstance(pop, (int, float)) or not isinstance(area, (int, float)):
            continue
        if pop >= DENSE_URBAN_MIN_POP and 0 < area <= DENSE_URBAN_MAX_AREA_M2:
            errors.append(
                f"Postal area {p.get('pno')} has grocery_density 0 with "
                f"{int(pop):,} residents in {area / 1e6:.1f} km2 - implausible; "
                f"almost certainly a failed Overpass region fetch shipping as a "
                f"measured zero. Run `python scripts/refetch_missing_overpass.py`, "
                f"re-run the grocery surgery and rebuild."
            )
    return errors


def check_derived_proxy_inheritance(features: list) -> list[str]:
    """IN-1: a metric derived entirely from a proxy (e.g. a *_change_pct of a
    municipality-distributed index) must itself be is_proxy:true, or the proxy badge
    silently disappears for the derived layer. Self-contained - reads only the registry."""
    if not REGISTRY_PATH.exists():
        return [f"data-source registry not found: {REGISTRY_PATH}"]
    try:
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"data_sources.json is not valid JSON: {exc}"]
    metrics = registry.get("metrics", {})
    errors: list[str] = []
    for child, parent in DERIVED_PROXY_CHILDREN.items():
        ce, pe = metrics.get(child), metrics.get(parent)
        if ce is None:
            errors.append(f"Derived metric '{child}' missing from the registry")
            continue
        if pe is None:
            errors.append(f"Parent metric '{parent}' of '{child}' missing from the registry")
            continue
        if pe.get("is_proxy") is True and ce.get("is_proxy") is not True:
            errors.append(
                f"Metric '{child}' derives from proxy '{parent}' but is not flagged is_proxy:true"
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


def check_registry_vintage(features: list) -> list[str]:
    """IN-3b: every registry metric must declare a plausible vintage — a 4-digit
    year, or a "YYYY-YYYY" / "YYYY–YYYY" range — within a sane window. This stops
    the source attribution from silently rotting to a missing, mistyped, or
    future-dated vintage as the registry evolves, complementing the build-time
    provenance manifest (build_metadata.json) emitted by build_region_data.mjs."""
    errors: list[str] = []
    if not REGISTRY_PATH.exists():
        return [f"data-source registry not found: {REGISTRY_PATH}"]
    try:
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"data_sources.json is not valid JSON: {exc}"]

    min_year, max_year = 2000, 2035

    def valid_year(y: int) -> bool:
        return min_year <= y <= max_year

    for prop, entry in registry.get("metrics", {}).items():
        v = entry.get("vintage")
        if v is None:
            errors.append(f"Metric '{prop}' has no vintage in the registry")
        elif isinstance(v, bool):  # bool is an int subclass — reject explicitly
            errors.append(f"Metric '{prop}' vintage must be a year, not a boolean")
        elif isinstance(v, int):
            if not valid_year(v):
                errors.append(f"Metric '{prop}' vintage {v} is outside [{min_year}, {max_year}]")
        elif isinstance(v, str):
            parts = [p.strip() for p in v.replace("–", "-").replace("—", "-").split("-")]
            if not parts or not all(p.isdigit() and len(p) == 4 for p in parts) \
                    or not all(valid_year(int(p)) for p in parts):
                errors.append(f"Metric '{prop}' vintage '{v}' is not a valid year or year range")
        else:
            errors.append(f"Metric '{prop}' vintage has unexpected type: {type(v).__name__}")
    return errors


# PO-5: metrics whose value is a municipality-level figure distributed/refined down
# to postal codes (a finer granularity than the source actually publishes). Each MUST
# be flagged is_proxy:true in the registry so the proxy badge / sources page never
# present a distributed estimate as a direct postal-level measurement. Keyed to the
# distribution logic in the named fetch script.
MUNICIPALITY_DISTRIBUTED_PROXIES = {
    # Not distributed — the municipality's own figure, applied unchanged to each
    # of its postal codes (fetch_crime_index.py assign_to_postal_codes). Still a
    # proxy: it is a municipal statistic shown on postal geography, never a
    # measurement of the postal area. Finland publishes no crime statistic below
    # municipality level, so there is nothing finer to move to.
    "crime_index": "fetch_crime_index.py assign_to_postal_codes() (municipal figure per postal code)",
    "avg_construction_year": "fetch_building_age.py refine_to_postal_codes()",
    "broadband_coverage_pct": "fetch_broadband_coverage.py (municipality coverage assigned to each postal code)",
    # 2023 parliamentary election (eduskuntavaalit): municipality result applied to
    # each postal code, refined to sub-municipal in cities that publish current
    # precinct geometry (build_submunicipal_election.py). No income proxy.
    "voter_turnout_pct": "fetch_election_results.py + apply_election_to_geojson.py (municipal result per postal code; sub-municipal in cities with precinct geometry)",
    "party_diversity_index": "fetch_election_results.py + apply_election_to_geojson.py (municipal result per postal code; sub-municipal in cities with precinct geometry)",
    "political_lean_index": "fetch_election_results.py + apply_election_to_geojson.py (municipal result per postal code; sub-municipal in cities with precinct geometry)",
    "party_vote_kok_pct": "fetch_election_results.py + apply_election_to_geojson.py (municipal result per postal code; sub-municipal in cities with precinct geometry)",
    "party_vote_sdp_pct": "fetch_election_results.py + apply_election_to_geojson.py (municipal result per postal code; sub-municipal in cities with precinct geometry)",
    "party_vote_ps_pct": "fetch_election_results.py + apply_election_to_geojson.py (municipal result per postal code; sub-municipal in cities with precinct geometry)",
    "party_vote_kesk_pct": "fetch_election_results.py + apply_election_to_geojson.py (municipal result per postal code; sub-municipal in cities with precinct geometry)",
    "party_vote_vihr_pct": "fetch_election_results.py + apply_election_to_geojson.py (municipal result per postal code; sub-municipal in cities with precinct geometry)",
    "party_vote_vas_pct": "fetch_election_results.py + apply_election_to_geojson.py (municipal result per postal code; sub-municipal in cities with precinct geometry)",
    "party_vote_rkp_pct": "fetch_election_results.py + apply_election_to_geojson.py (municipal result per postal code; sub-municipal in cities with precinct geometry)",
    # CF-21: THL/Kela morbidity index — a municipality figure assigned to each of its
    # postal codes (Sotkanet publishes at municipality granularity only).
    "health_index": "fetch_health_index.py assign_to_postal_codes() (municipality value per postal code)",
    # CF-6: StatFin Väestöennuste 2024 (vaenn 14wx) publishes the projection at
    # municipality granularity only; each postal code inherits its municipality's
    # projected 2024→2040 change %.
    "population_projection_pct": "fetch_population_projection.py assign_to_postal_codes() (municipality value per postal code)",
    # CF-11: StatFin Rakennus- ja asuntotuotanto (raku 15f6) publishes new-dwelling
    # counts at municipality granularity only; each postal code inherits its
    # municipality's new-dwellings-per-1,000-residents rate.
    "construction_activity": "fetch_construction_permits.py assign_to_postal_codes() (municipality value per postal code)",
    # StatFin Väestörakenne (vaerak 159t) publishes the share of foreign-language
    # speakers at municipality granularity only; each postal code inherits its
    # municipality's latest-year share (flat). Current companion to the 2020 postal layer.
    "foreign_language_municipal_pct": "fetch_foreign_language_municipal.py + apply_foreign_language_municipal_to_geojson.py (latest municipal share per postal code)",
    # Foreign-language estimate after 2020: StatFin publishes postal-code language data
    # only for 2020 (foreign_language_pct), so later years are estimated by scaling the
    # real 2020 postal distribution by each municipality's vaerak 159t share change. The
    # scalar is the latest year; foreign_language_history carries the [[year, value], ...]
    # series. 2020 itself is real (the is_proxy:false foreign_language_pct layer).
    "foreign_language_est_pct": "fetch_foreign_language_municipal.py + apply_foreign_language_municipal_to_geojson.py (2020 postal distribution scaled by municipal share change)",
    # CF-15: asvu 15fa publishes rents at city/maakunta level; distributed to postal
    # codes by replaying the 2022 intra-city ratios. price_to_rent_ratio inherits it.
    "rental_price_sqm": "fetch_rental_prices_municipality.py (city mean × 2022 intra-city ratio per postal code)",
    "price_to_rent_ratio": "derived from the (proxy) rental_price_sqm and property_price_sqm",
}


def check_distributed_proxy_flags(features: list) -> list[str]:
    """PO-5: a metric whose declared granularity is finer than its source's real
    granularity (a municipality figure distributed/refined to postal codes) must be
    flagged is_proxy:true. Self-contained — reads only the registry. Catches an
    honest-attribution regression where such a metric is silently reset to
    is_proxy:false."""
    errors: list[str] = []
    if not REGISTRY_PATH.exists():
        return [f"data-source registry not found: {REGISTRY_PATH}"]
    try:
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"data_sources.json is not valid JSON: {exc}"]

    metrics = registry.get("metrics", {})
    for prop, derivation in MUNICIPALITY_DISTRIBUTED_PROXIES.items():
        entry = metrics.get(prop)
        if entry is None:
            errors.append(f"Metric '{prop}' missing from the registry (expected a distributed proxy)")
            continue
        if entry.get("is_proxy") is not True:
            errors.append(
                f"Metric '{prop}' is a municipality-distributed estimate ({derivation}) "
                f"but is not flagged is_proxy:true in data_sources.json"
            )
    return errors


def _normalize_vintage(v) -> str:
    """Canonical string form of a vintage so 2024 == '2024' and en/em dashes in
    'YYYY-YYYY' ranges compare equal regardless of which dash character was used."""
    s = str(v).strip()
    # Unify en-dash / em-dash with a plain hyphen and drop surrounding spaces.
    s = s.replace("–", "-").replace("—", "-")
    s = "-".join(part.strip() for part in s.split("-"))
    return s


def check_provenance_vintage_match(features: list) -> list[str]:
    """IN-3: cross-check the data-source registry against an INDEPENDENT provenance
    record (scripts/provenance.json) of the vintage actually fetched per metric, and
    FAIL on any divergence. check_registry_vintage() only proves each registry vintage
    is a plausible year; this proves it equals what was really pulled. Rules:

      * every metric present in BOTH files must have an identical vintage;
      * every non-exempt registry metric MUST appear in provenance.json (a new metric
        added to the registry without recording its fetched vintage fails the build);
      * every provenance metric must still exist in the registry (catch stale entries).

    Client-derived metrics with no upstream fetch (EXEMPT_FROM_PROVENANCE) are skipped."""
    errors: list[str] = []
    if not REGISTRY_PATH.exists():
        return [f"data-source registry not found: {REGISTRY_PATH}"]
    if not PROVENANCE_PATH.exists():
        return [f"provenance record not found: {PROVENANCE_PATH}"]
    try:
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"data_sources.json is not valid JSON: {exc}"]
    try:
        provenance = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"provenance.json is not valid JSON: {exc}"]

    prov_vintages = provenance.get("vintages")
    if not isinstance(prov_vintages, dict):
        return ["provenance.json has no 'vintages' object"]

    reg_metrics = registry.get("metrics", {})

    # 1. Registry metrics that must be cross-checked but are missing from provenance.
    for prop, entry in reg_metrics.items():
        if prop in EXEMPT_FROM_PROVENANCE:
            continue
        if prop not in prov_vintages:
            errors.append(
                f"Metric '{prop}' is in data_sources.json but has no recorded vintage in "
                f"provenance.json — record the fetched vintage (or exempt it if client-derived)"
            )

    # 2. Provenance entries that no longer correspond to a registry metric.
    for prop in prov_vintages:
        if prop not in reg_metrics:
            errors.append(
                f"Metric '{prop}' is in provenance.json but absent from data_sources.json (stale entry?)"
            )

    # 3. Both present → vintages must be identical.
    for prop in sorted(set(reg_metrics) & set(prov_vintages)):
        reg_v = reg_metrics[prop].get("vintage")
        prov_v = prov_vintages[prop]
        if _normalize_vintage(reg_v) != _normalize_vintage(prov_v):
            errors.append(
                f"Metric '{prop}' vintage mismatch: data_sources.json={reg_v!r} "
                f"vs provenance.json={prov_v!r}"
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


def _run_checks(checks: list) -> int:
    """Print each check's result and return 1 if any produced errors, else 0."""
    all_errors: list[str] = []
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


def main() -> int:
    path = GEOJSON_PATH
    pos_args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if pos_args:
        path = Path(pos_args[0])

    # QW-4: files-only light mode for CI — runs only the registry/provenance
    # cross-checks (which read JSON files and ignore `features`), skipping the
    # 39 MB GeoJSON load so honesty drift is caught on every push, fast and
    # without the geodata present. No third-party deps (stdlib json/pathlib only).
    if "--files-only" in sys.argv:
        print("Validating data-source registry + provenance (files-only mode) ...")
        return _run_checks([
            ("Registry vintage", check_registry_vintage([])),
            ("Distributed proxy flags", check_distributed_proxy_flags([])),
            ("Derived proxy inheritance", check_derived_proxy_inheritance([])),
            ("Provenance vintage match", check_provenance_vintage_match([])),
        ])

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

    return _run_checks([
        ("Feature count", check_feature_count(features)),
        ("Required properties", check_required_properties(features)),
        ("All-null properties", check_no_all_null_properties(features)),
        ("Value ranges", check_value_ranges(features)),
        ("Suppression sentinels", check_no_suppression_sentinels(features)),
        ("Value distinctness", check_value_distinctness(features)),
        ("Dense urban zeros", check_dense_urban_zero(features)),
        ("Data-source registry", check_data_source_registry(features)),
        ("Distributed proxy flags", check_distributed_proxy_flags(features)),
        ("Derived proxy inheritance", check_derived_proxy_inheritance(features)),
        ("Registry vintage", check_registry_vintage(features)),
        ("Provenance vintage match", check_provenance_vintage_match(features)),
        ("Coverage regression", check_coverage_regression(features)),
        ("Geometries", check_geometries(features)),
        ("Postal code format", check_pno_format(features)),
    ])


if __name__ == "__main__":
    sys.exit(main())
