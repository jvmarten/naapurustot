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
OPINTOPOLKU_URL = (
    "https://virkailija.opintopolku.fi/organisaatio-service/rest/organisaatio/v4/hae"
    "?aktiiviset=true&organisaatiotyyppi=organisaatiotyyppi_02"
    "&oppilaitostyyppi=oppilaitostyyppi_15%231"
)

# Helsinki metro municipality codes
METRO_MUNICIPALITY_CODES = {"091", "049", "092", "235"}

# Output file
OUTPUT_FILE = Path(__file__).parent / "school_quality.json"

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
    """Fetch and parse YTL CSV files. Returns list of (school_number, grades) tuples."""
    all_school_grades = defaultdict(list)  # school_nro -> list of mean grades

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
    return school_scores


# ---------------------------------------------------------------------------
# Step 2: Geocode schools to postal codes via Opintopolku
# ---------------------------------------------------------------------------

def fetch_school_postal_codes():
    """Fetch school registry from Opintopolku and extract postal codes.

    Uses a two-step approach:
    1. /hae to list all upper secondary schools (lukio) and get OIDs
    2. /findbyoids POST to fetch full details including addresses

    Returns dict: school_number -> postal_code (5-digit string)
    """
    logger.info("Fetching school registry from Opintopolku...")
    headers = {"Caller-Id": "naapurustot.fi"}

    try:
        r = _get_with_retry(OPINTOPOLKU_URL, "Opintopolku schools", headers=headers)
        data = r.json()
    except Exception as e:
        logger.error("Could not fetch school registry: %s", e)
        return {}

    organisations = data.get("organisaatiot", [])
    logger.info("  Found %d organisations", len(organisations))

    # Collect OIDs for bulk detail fetch
    oids = [org["oid"] for org in organisations if org.get("oid")]

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

    school_postcodes = {}
    for org in all_details:
        koodi = org.get("oppilaitosKoodi", "")
        if not koodi:
            continue

        # Extract postal code from address
        postal_code = None
        for addr_field in ["postiosoite", "kayntiosoite"]:
            addr = org.get(addr_field, {})
            if isinstance(addr, dict):
                pno_uri = addr.get("postinumeroUri", "")
                if pno_uri:
                    # Format: "posti_00100" -> "00100"
                    match = re.search(r"(\d{5})", pno_uri)
                    if match:
                        postal_code = match.group(1)
                        break

        if postal_code:
            # Map oppilaitosKoodi to YTL school number format:
            # YTL uses "1" + stripped leading zeros, e.g., "00093" -> "1093"
            ytl_nro = "1" + koodi.lstrip("0")
            school_postcodes[ytl_nro] = postal_code
            school_postcodes[koodi] = postal_code

    unique_count = len({v for v in school_postcodes.values()})
    logger.info("  Mapped %d schools to %d unique postal codes", len(school_postcodes) // 2, unique_count)
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
    school_scores = fetch_ytl_results()
    if not school_scores:
        logger.error("No school scores fetched, exiting")
        sys.exit(1)

    # Step 2: Geocode schools to postal codes
    school_postcodes = fetch_school_postal_codes()
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
