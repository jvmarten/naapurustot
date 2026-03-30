#!/usr/bin/env python3
"""
Extend transit reachability scores to Tampere and Turku regions.

The Helsinki metro area already has transit reachability scores computed from
the Helsinki Region Travel Time Matrix (Zenodo, 250m grid, CC BY 4.0).

For Tampere and Turku, no equivalent travel time matrix exists. This script
estimates transit reachability scores using a statistical relationship between
transit_stop_density and transit_reachability_score observed in Helsinki data.

Method:
1. Load the GeoJSON with all neighborhood data.
2. For Helsinki postal codes that have both transit_stop_density and
   transit_reachability_score, fit a linear regression model.
3. Apply the model to Tampere and Turku postal codes (which have
   transit_stop_density but no reachability score).
4. Clamp predicted scores to [1.0, 100.0] and round to one decimal.
5. Merge with existing Helsinki scores (Helsinki originals are preserved).
6. Write the combined result to scripts/transit_reachability.json.

The linear model has R^2 ~ 0.58 on Helsinki data, which is reasonable for a
proxy metric. Transit stop density is the strongest single predictor available
in the dataset for transit reachability.

Output: transit_reachability.json
Format: {"00100": 61.4, "33100": 38.4, "20700": 40.8, ...}  (score 0-100)
"""

import json
import logging
import sys
from pathlib import Path

import numpy as np

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent
GEOJSON_PATH = SCRIPT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
EXISTING_REACHABILITY_PATH = SCRIPT_DIR / "transit_reachability.json"
OUTPUT_PATH = SCRIPT_DIR / "transit_reachability.json"


def load_geojson() -> dict:
    """Load the metro neighborhoods GeoJSON."""
    logger.info("Loading GeoJSON from %s", GEOJSON_PATH)
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        data = json.load(f)
    logger.info("  Loaded %d features", len(data["features"]))
    return data


def load_existing_reachability() -> dict:
    """Load existing transit reachability scores (Helsinki)."""
    if not EXISTING_REACHABILITY_PATH.exists():
        logger.warning("No existing transit_reachability.json found")
        return {}
    with open(EXISTING_REACHABILITY_PATH, encoding="utf-8") as f:
        data = json.load(f)
    logger.info("Loaded %d existing reachability scores", len(data))
    return data


def extract_training_data(geojson: dict) -> tuple:
    """
    Extract (density, reachability) pairs from Helsinki postal codes.

    Returns:
        densities: numpy array of transit_stop_density values
        reachabilities: numpy array of transit_reachability_score values
    """
    densities = []
    reachabilities = []

    for feat in geojson["features"]:
        props = feat["properties"]
        city = props.get("city", "")
        if city != "helsinki_metro":
            continue

        density = props.get("transit_stop_density")
        reachability = props.get("transit_reachability_score")

        if density is not None and reachability is not None:
            densities.append(density)
            reachabilities.append(reachability)

    logger.info(
        "  Found %d Helsinki postal codes with both density and reachability",
        len(densities),
    )
    return np.array(densities), np.array(reachabilities)


def fit_linear_model(
    densities: np.ndarray, reachabilities: np.ndarray
) -> tuple:
    """
    Fit a linear regression: reachability = slope * density + intercept.

    Returns:
        slope: float
        intercept: float
    """
    if len(densities) < 2:
        logger.error("Not enough data points to fit a model")
        sys.exit(1)

    coeffs = np.polyfit(densities, reachabilities, 1)
    slope, intercept = coeffs[0], coeffs[1]

    # Compute R-squared
    predictions = slope * densities + intercept
    ss_res = np.sum((reachabilities - predictions) ** 2)
    ss_tot = np.sum((reachabilities - np.mean(reachabilities)) ** 2)
    r_squared = 1.0 - ss_res / ss_tot

    # Compute RMSE
    rmse = np.sqrt(np.mean((reachabilities - predictions) ** 2))

    # Correlation
    corr = np.corrcoef(densities, reachabilities)[0, 1]

    logger.info("Linear regression model:")
    logger.info("  reachability = %.4f * density + %.4f", slope, intercept)
    logger.info("  R-squared: %.4f", r_squared)
    logger.info("  RMSE: %.2f", rmse)
    logger.info("  Pearson correlation: %.4f", corr)
    logger.info(
        "  Helsinki density range: %.1f - %.1f",
        np.min(densities),
        np.max(densities),
    )
    logger.info(
        "  Helsinki reachability range: %.1f - %.1f",
        np.min(reachabilities),
        np.max(reachabilities),
    )

    return slope, intercept


def predict_reachability(
    geojson: dict,
    slope: float,
    intercept: float,
    target_cities: list,
) -> dict:
    """
    Predict transit reachability scores for postal codes in target cities
    using the fitted linear model and their transit_stop_density.

    Returns:
        dict mapping postal code -> predicted score (rounded to 1 decimal)
    """
    predictions = {}

    for feat in geojson["features"]:
        props = feat["properties"]
        city = props.get("city", "")
        pno = props.get("pno", "")

        if city not in target_cities or not pno:
            continue

        density = props.get("transit_stop_density")
        if density is None:
            logger.warning("  %s (%s): no transit_stop_density, skipping", pno, city)
            continue

        predicted = slope * density + intercept
        # Clamp to valid range
        predicted = max(1.0, min(100.0, predicted))
        predictions[pno] = round(predicted, 1)

    return predictions


def main():
    # Step 1: Load data
    geojson = load_geojson()
    existing = load_existing_reachability()

    # Step 2: Extract Helsinki training data from GeoJSON
    logger.info("Extracting Helsinki training data...")
    densities, reachabilities = extract_training_data(geojson)

    if len(densities) == 0:
        logger.error("No Helsinki training data found in GeoJSON")
        sys.exit(1)

    # Step 3: Fit linear regression
    logger.info("Fitting linear model on Helsinki data...")
    slope, intercept = fit_linear_model(densities, reachabilities)

    # Step 4: Predict for Tampere and Turku
    logger.info("Predicting reachability for Tampere and Turku...")
    new_predictions = predict_reachability(
        geojson, slope, intercept, target_cities=["tampere", "turku"]
    )

    tampere_count = sum(1 for pno in new_predictions if pno.startswith("3"))
    turku_count = sum(1 for pno in new_predictions if pno.startswith("2"))
    logger.info("  Predicted %d Tampere scores", tampere_count)
    logger.info("  Predicted %d Turku scores", turku_count)

    # Step 5: Merge - keep existing Helsinki scores, add new predictions
    result = {}

    # Start with existing Helsinki scores (preserve originals)
    for pno, score in existing.items():
        result[pno] = score

    # Add Tampere and Turku predictions
    for pno, score in new_predictions.items():
        if pno in result:
            logger.warning(
                "  %s already has a score (%.1f), keeping original", pno, result[pno]
            )
        else:
            result[pno] = score

    # Log summary statistics for each region
    for city, prefix_check in [
        ("Helsinki metro", lambda p: p.startswith("0")),
        ("Tampere", lambda p: p.startswith("3")),
        ("Turku", lambda p: p.startswith("2")),
    ]:
        scores = [v for k, v in result.items() if prefix_check(k)]
        if scores:
            logger.info(
                "  %s: %d entries, range %.1f - %.1f, mean %.1f",
                city,
                len(scores),
                min(scores),
                max(scores),
                sum(scores) / len(scores),
            )

    # Step 6: Save
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    logger.info(
        "Wrote %s (%d total entries: %d Helsinki + %d new)",
        OUTPUT_PATH,
        len(result),
        len(existing),
        len(new_predictions),
    )


if __name__ == "__main__":
    main()
