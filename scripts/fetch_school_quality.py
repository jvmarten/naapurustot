#!/usr/bin/env python3
"""
Fetch school quality data from YTL matriculation exam results and geocode
schools to postal codes via the Opintopolku organization API.

Output: scripts/school_quality.json — { postal_code: average_score (0-100) }

Data sources:
- YTL exam results: https://tiedostot.ylioppilastutkinto.fi/ext/data/
- School registry: https://virkailija.opintopolku.fi/organisaatio-service/
"""

import csv
import io
import json
import logging
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# YTL exam data URL pattern: FT{year}{K=spring|S=autumn}D4001.csv
YTL_BASE_URL = "https://tiedostot.ylioppilastutkinto.fi/ext/data"
# Fetch last 3 years of spring exams (largest cohorts)
EXAM_PERIODS = ["2025K", "2024K", "2023K"]

# Opintopolku organization API for school addresses
# Search all educational institutions (not just lukio type) to also catch
# yhteiskoulu, normaalikoulu, and other schools with lukio divisions
OPINTOPOLKU_URLS = [
    # All educational institutions (no oppilaitostyyppi filter).
    # This catches lukio, yhteiskoulu, normaalikoulu, and others that may
    # have lukio divisions but are registered under different types.
    (
        "https://virkailija.opintopolku.fi/organisaatio-service/rest/organisaatio/v4/hae"
        "?aktiiviset=true&organisaatiotyyppi=organisaatiotyyppi_02"
    ),
]

# Helsinki metro municipality codes
METRO_MUNICIPALITY_CODES = {"091", "049", "092", "235"}

# Output file
OUTPUT_FILE = Path(__file__).parent / "school_quality.json"

# Manual postal code overrides for schools not found in Opintopolku
# (closed, merged, or renamed schools that still appear in recent YTL data)
MANUAL_POSTAL_CODES = {
    "1095": "00800",   # Herttoniemen yhteiskoulun lukio (Herttoniemi)
    "1513": "00330",   # Munkkiniemen yhteiskoulun lukio (Munkkiniemi)
    "1844": "00260",   # Töölön yhteiskoulun lukio (Töölö)
    "1090": "00350",   # Helsingin Uuden yhteiskoulun lukio (Munkkivuori)
    "1916": "02230",   # Kaitaan lukio (renamed to Matinkylän lukio, Espoo)
    "1854": "02100",   # Espoon aikuislukio (Tapiola)
    "1791": "01300",   # Vantaan aikuislukio (Tikkurila)
    "1994": "80100",   # Itä-Suomen suomalais-venäläisen koulun lukio (Joensuu)
    "1831": "90500",   # Merikosken lukio (Oulu, merged into Oulun lyseo)
}

# Grade scale: YTL grades are 0-7 (0=improbatur, 2=approbatur, ..., 7=laudatur)
# We normalize to 0-100 by: (mean_grade / 7) * 100
MAX_GRADE = 7


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------

def _get_with_retry(url, label, retries=3, **kwargs):
    kwargs.setdefault("timeout", 60)
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, **kwargs)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            if attempt < retries:
                wait = 2 ** attempt
                logger.warning("Retry %d/%d for %s in %ds (%s)", attempt, retries, label, wait, e)
                time.sleep(wait)
            else:
                raise
    raise RuntimeError(f"Failed to fetch {label}")


# ---------------------------------------------------------------------------
# Step 1: Fetch YTL exam results
# ---------------------------------------------------------------------------

def fetch_ytl_results():
    """Fetch and parse YTL CSV files.

    Returns:
        school_scores: dict of {school_nro: normalized_score (0-100)}
        school_names: dict of {school_nro: school_name}
    """
    all_school_grades = defaultdict(list)  # school_nro -> list of mean grades
    school_names = {}  # school_nro -> school_name

    for period in EXAM_PERIODS:
        url = f"{YTL_BASE_URL}/FT{period}D4001.csv"
        logger.info("Fetching YTL data for %s...", period)

        try:
            r = _get_with_retry(url, f"YTL {period}")
        except Exception as e:
            logger.warning("Could not fetch %s: %s", period, e)
            continue

        # Parse CSV (semicolon-delimited, UTF-8-BOM)
        text = r.content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text), delimiter=";")

        # Subject columns are everything that looks like a grade (uppercase 1-3 letter codes)
        subject_cols = None
        count = 0

        for row in reader:
            if subject_cols is None:
                # Detect subject columns (values should be 0-7 or empty)
                subject_cols = []
                for col in row.keys():
                    if col and re.match(r"^[A-Z]{1,3}$", col):
                        subject_cols.append(col)

            school_nro = row.get("koulun_nro", "").strip()
            if not school_nro:
                continue

            # Track school names for name-based matching
            school_name = row.get("koulun_nimi", "").strip()
            if school_name:
                school_names[school_nro] = school_name

            # Collect grades for this candidate
            grades = []
            for col in subject_cols:
                val = row.get(col, "").strip()
                if val and val != "":
                    try:
                        grade = int(val)
                        if 0 <= grade <= MAX_GRADE:
                            grades.append(grade)
                    except ValueError:
                        pass

            if grades:
                mean_grade = sum(grades) / len(grades)
                all_school_grades[school_nro].append(mean_grade)
                count += 1

        logger.info("  Parsed %d candidates for %s", count, period)

    # Compute per-school average (across all candidates and years)
    school_scores = {}
    for school_nro, grade_list in all_school_grades.items():
        if grade_list:
            avg = sum(grade_list) / len(grade_list)
            # Normalize to 0-100 scale
            school_scores[school_nro] = round(avg / MAX_GRADE * 100, 1)

    logger.info("Computed quality scores for %d schools", len(school_scores))
    return school_scores, school_names


# ---------------------------------------------------------------------------
# Step 2: Geocode schools to postal codes via Opintopolku
# ---------------------------------------------------------------------------

def _normalize_name(name):
    """Normalize school name for fuzzy matching."""
    n = name.lower().strip()
    # Normalize separators: "ja" and "-" and "–" between parts
    n = re.sub(r"\s*[-–]\s*", " ", n)
    n = re.sub(r"\s+ja\s+", " ", n)
    # Remove punctuation
    n = re.sub(r"[,.]", "", n)
    # Normalize whitespace
    n = re.sub(r"\s+", " ", n)
    return n


def fetch_school_postal_codes(ytl_school_names):
    """Fetch school registry from Opintopolku and match to YTL schools by name.

    Uses a two-step approach:
    1. /hae to list educational institutions and get OIDs
    2. /findbyoids POST to fetch full details including addresses
    3. Match Opintopolku schools to YTL schools by normalized name

    Args:
        ytl_school_names: dict of {school_nro: school_name} from YTL CSV data

    Returns dict: ytl_school_number -> postal_code (5-digit string)
    """
    logger.info("Fetching school registry from Opintopolku...")
    headers = {"Caller-Id": "naapurustot.fi"}

    # Fetch from multiple school type APIs to catch yhteiskoulu, normaalikoulu, etc.
    all_organisations = []
    seen_oids = set()
    for api_url in OPINTOPOLKU_URLS:
        try:
            r = _get_with_retry(api_url, "Opintopolku schools", headers=headers)
            data = r.json()
            for org in data.get("organisaatiot", []):
                oid = org.get("oid")
                if oid and oid not in seen_oids:
                    seen_oids.add(oid)
                    all_organisations.append(org)
        except Exception as e:
            logger.warning("Could not fetch from %s: %s", api_url[:80], e)

    logger.info("  Found %d unique organisations", len(all_organisations))

    # Collect OIDs for bulk detail fetch
    oids = [org["oid"] for org in all_organisations if org.get("oid")]

    # Fetch full details in batches of 100 via findbyoids
    BATCH_SIZE = 100
    FINDBYOIDS_URL = (
        "https://virkailija.opintopolku.fi/organisaatio-service/"
        "rest/organisaatio/v4/findbyoids"
    )
    all_details = []
    for i in range(0, len(oids), BATCH_SIZE):
        batch = oids[i : i + BATCH_SIZE]
        logger.info("  Fetching details batch %d-%d...", i + 1, i + len(batch))
        try:
            r = requests.post(
                FINDBYOIDS_URL,
                headers={**headers, "Content-Type": "application/json"},
                json=batch,
                timeout=60,
            )
            r.raise_for_status()
            all_details.extend(r.json())
        except Exception as e:
            logger.warning("  Batch %d failed: %s", i, e)
            time.sleep(2)

    logger.info("  Fetched details for %d organisations", len(all_details))

    # Build name -> postal_code lookup from Opintopolku data
    op_name_to_postal = {}
    for org in all_details:
        # Extract postal code from address
        postal_code = None
        for addr_field in ["postiosoite", "kayntiosoite"]:
            addr = org.get(addr_field, {})
            if isinstance(addr, dict):
                pno_uri = addr.get("postinumeroUri", "")
                if pno_uri:
                    match = re.search(r"(\d{5})", pno_uri)
                    if match:
                        postal_code = match.group(1)
                        break

        if not postal_code:
            continue

        # Store under all name variants (fi, sv, en)
        names = org.get("nimi", {})
        for lang_name in names.values():
            if lang_name:
                op_name_to_postal[_normalize_name(lang_name)] = postal_code

    # Match YTL schools to Opintopolku by normalized name
    school_postcodes = {}
    matched = 0
    unmatched = []
    for ytl_nro, ytl_name in ytl_school_names.items():
        norm_name = _normalize_name(ytl_name)
        postal_code = op_name_to_postal.get(norm_name)
        if postal_code:
            school_postcodes[ytl_nro] = postal_code
            matched += 1
        else:
            unmatched.append((ytl_nro, ytl_name))

    logger.info("  Matched %d/%d YTL schools to postal codes by name",
                matched, len(ytl_school_names))

    # Fallback: search Opintopolku by name for unmatched schools
    if unmatched:
        logger.info("  Searching Opintopolku for %d unmatched schools...", len(unmatched))
        search_base = (
            "https://virkailija.opintopolku.fi/organisaatio-service/"
            "rest/organisaatio/v4/hae"
            "?aktiiviset=true&organisaatiotyyppi=organisaatiotyyppi_02"
        )
        fallback_matched = 0
        for ytl_nro, ytl_name in unmatched:
            # Use first 2-3 words as search term
            words = ytl_name.split()[:3]
            search_term = " ".join(words)
            try:
                search_url = f"{search_base}&searchStr={requests.utils.quote(search_term)}"
                r = requests.get(search_url, headers=headers, timeout=30)
                r.raise_for_status()
                results = r.json().get("organisaatiot", [])
                for org in results:
                    oid = org.get("oid")
                    if not oid:
                        continue
                    # Fetch details for this org
                    detail_url = (
                        "https://virkailija.opintopolku.fi/organisaatio-service/"
                        f"rest/organisaatio/v4/{oid}"
                    )
                    dr = requests.get(detail_url, headers=headers, timeout=30)
                    dr.raise_for_status()
                    detail = dr.json()
                    postal_code = None
                    for addr_field in ["postiosoite", "kayntiosoite"]:
                        addr = detail.get(addr_field, {})
                        if isinstance(addr, dict):
                            pno_uri = addr.get("postinumeroUri", "")
                            if pno_uri:
                                m = re.search(r"(\d{5})", pno_uri)
                                if m:
                                    postal_code = m.group(1)
                                    break
                    if postal_code:
                        school_postcodes[ytl_nro] = postal_code
                        fallback_matched += 1
                        logger.info("    Fallback match: %s -> %s", ytl_name, postal_code)
                        break
            except Exception as e:
                logger.debug("    Fallback search failed for %s: %s", ytl_name, e)

        logger.info("  Fallback matched %d additional schools", fallback_matched)

    # Apply manual postal code overrides for closed/renamed schools
    manual_applied = 0
    for ytl_nro, postal_code in MANUAL_POSTAL_CODES.items():
        if ytl_nro not in school_postcodes and ytl_nro in ytl_school_names:
            school_postcodes[ytl_nro] = postal_code
            manual_applied += 1
            logger.info("    Manual override: %s -> %s",
                        ytl_school_names[ytl_nro], postal_code)
    if manual_applied:
        logger.info("  Applied %d manual postal code overrides", manual_applied)

    still_unmatched = [
        (nro, name) for nro, name in ytl_school_names.items()
        if nro not in school_postcodes
    ]
    if still_unmatched:
        logger.info("  Still unmatched (%d): %s",
                    len(still_unmatched),
                    ", ".join(f"{n}({nro})" for nro, n in still_unmatched[:15]))

    return school_postcodes


# ---------------------------------------------------------------------------
# Step 3: Combine and aggregate to postal code level
# ---------------------------------------------------------------------------

def aggregate_to_postal_codes(school_scores, school_postcodes):
    """Map school quality scores to postal code areas.

    Returns dict: postal_code -> average_quality_score
    """
    postal_scores = defaultdict(list)

    matched = 0
    for school_nro, score in school_scores.items():
        postal_code = school_postcodes.get(school_nro)
        if postal_code:
            postal_scores[postal_code].append(score)
            matched += 1

    logger.info("Matched %d/%d schools to postal codes", matched, len(school_scores))

    # Average scores per postal code
    result = {}
    for pno, scores in postal_scores.items():
        result[pno] = round(sum(scores) / len(scores), 1)

    logger.info("School quality data for %d postal codes", len(result))
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Step 1: Fetch YTL exam results
    school_scores, school_names = fetch_ytl_results()
    if not school_scores:
        logger.error("No school scores fetched, exiting")
        sys.exit(1)

    # Step 2: Geocode schools to postal codes (using name-based matching)
    school_postcodes = fetch_school_postal_codes(school_names)
    if not school_postcodes:
        logger.error("No school postal codes fetched, exiting")
        sys.exit(1)

    # Step 3: Combine
    result = aggregate_to_postal_codes(school_scores, school_postcodes)

    # Write output
    OUTPUT_FILE.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    logger.info("Wrote %d postal codes to %s", len(result), OUTPUT_FILE.name)


if __name__ == "__main__":
    main()
