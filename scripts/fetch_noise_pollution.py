#!/usr/bin/env python3
"""
Compute noise pollution (Lden dB) per postal code area from open traffic noise
contour data.

Sources:
  - Helsinki 2022: WFS at kartta.hel.fi (Meluselvitys 2022, road traffic Lden)
  - Metro area 2012: HRI shapefile pks_maantieet_Lden (covers Helsinki, Espoo,
    Vantaa, Kauniainen — used as fallback)
  - Väylävirasto 2022: National road/street noise contours (covers Turku, Tampere)
  - Tampere 2022: City WFS at geodata.tampere.fi (road noise Lden)

Method: area-weighted average of noise zone midpoint dB values per postal code.
Postal code areas outside any noise contour are assigned a background level of
40 dB (quiet residential baseline).

Output: scripts/noise_pollution.json — { postal_code: avg_Lden_dB }
"""

import io
import json
import logging
import math
import sys
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import shape
from shapely.validation import make_valid

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

OUTPUT_FILE = Path(__file__).parent / "noise_pollution.json"
GEOJSON_FILE = (
    Path(__file__).parent.parent / "public" / "data" / "metro_neighborhoods.geojson"
)

# Helsinki WFS endpoint for 2022 road traffic noise Lden
HELSINKI_WFS_URL = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs"
HELSINKI_LAYER = "avoindata:Meluselvitys_2022_Helsinki_kadut_ja_maantiet_Lden"
HELSINKI_CRS = "EPSG:3879"

# Metro-area shapefile (2012) covering Helsinki, Espoo, Vantaa, Kauniainen
METRO_NOISE_URL = (
    "https://www.hel.fi/hel2/tietokeskus/data/pks/liikenne/pks_liikennemelu.zip"
)
METRO_NOISE_SHAPEFILE = "pks_maantieet_Lden"

# Helsinki postal codes start with 00 (001xx-009xx)
HELSINKI_PREFIX = "00"

# Väylävirasto (Finnish Transport Infra Agency) WFS — nationwide road noise 2022
VAYLA_WFS_URL = "https://avoinapi.vaylapilvi.fi/vaylatiedot/ows"
VAYLA_LAYER = "tiestotiedot:melu_paiva_maankad_22"

# Tampere city WFS — road noise Lden 2022
TAMPERE_WFS_URL = "https://geodata.tampere.fi/geoserver/ows"
TAMPERE_LAYER = "ymparisto_ja_terveys:yv_melu_paiva_2022_keskiaani_gsview"

# Regional bounding boxes (minx, miny, maxx, maxy in EPSG:3067)
TURKU_BBOX_3067 = "198000,6690000,274000,6743000"
TAMPERE_BBOX_3067 = "294000,6792000,392000,6898000"

# Background noise level (dB) for areas outside any contour
BACKGROUND_DB = 40.0


def load_postal_codes():
    """Load postal code polygons from the project GeoJSON."""
    if not GEOJSON_FILE.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_FILE)
        sys.exit(1)

    logger.info("Loading postal code polygons from %s...", GEOJSON_FILE.name)
    with open(GEOJSON_FILE) as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    logger.info("  Loaded %d features", len(features))

    records = []
    for feat in features:
        props = feat.get("properties", {})
        pno = props.get("pno", "")
        geom = feat.get("geometry")
        if pno and geom:
            records.append({"pno": pno, "geometry": shape(geom)})

    gdf = gpd.GeoDataFrame(records, crs="EPSG:4326")
    logger.info("  Parsed %d postal code polygons", len(gdf))
    return gdf


def fetch_helsinki_noise():
    """Fetch Helsinki 2022 road traffic Lden noise contours from WFS."""
    logger.info("Fetching Helsinki 2022 Lden noise contours from WFS...")

    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": HELSINKI_LAYER,
        "outputFormat": "application/json",
    }

    resp = requests.get(HELSINKI_WFS_URL, params=params, timeout=120)
    resp.raise_for_status()
    data = resp.json()

    features = data.get("features", [])
    logger.info("  Received %d noise contour features", len(features))

    if not features:
        logger.warning("  No features returned from Helsinki WFS")
        return gpd.GeoDataFrame()

    gdf = gpd.GeoDataFrame.from_features(features, crs=HELSINKI_CRS)
    gdf.columns = [c.lower() for c in gdf.columns]
    logger.info(
        "  Helsinki noise: %d features, dB range: %.0f–%.0f",
        len(gdf),
        gdf["db_lo"].min(),
        gdf["db_hi"].max(),
    )
    return gdf


def fetch_metro_noise():
    """Download metro-area 2012 Lden noise shapefile."""
    logger.info("Downloading metro-area noise shapefile...")

    resp = requests.get(METRO_NOISE_URL, timeout=120)
    resp.raise_for_status()
    logger.info("  Downloaded %.1f MB", len(resp.content) / 1024 / 1024)

    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            for name in zf.namelist():
                if name.startswith(METRO_NOISE_SHAPEFILE):
                    zf.extract(name, tmpdir)

        shp_path = Path(tmpdir) / f"{METRO_NOISE_SHAPEFILE}.shp"
        if not shp_path.exists():
            logger.error("  Shapefile not found in archive")
            return gpd.GeoDataFrame()

        gdf = gpd.read_file(shp_path)

    gdf.columns = [c.lower() for c in gdf.columns]
    logger.info(
        "  Metro noise: %d features, dB range: %.0f–%.0f",
        len(gdf),
        gdf["db_lo"].min(),
        gdf["db_hi"].max(),
    )
    return gdf


def _parse_db_range(text: str) -> tuple[float, float] | None:
    """Parse dB range from strings like '45-50 dB', 'yli 75 dB'."""
    import re
    text = text.strip().lower()
    # "45-50 dB" or "45-50"
    m = re.match(r"(\d+)\s*[-–]\s*(\d+)", text)
    if m:
        return float(m.group(1)), float(m.group(2))
    # "yli 75 dB" (over 75)
    m = re.match(r"yli\s+(\d+)", text)
    if m:
        lo = float(m.group(1))
        return lo, lo + 5
    # "alle 45 dB" (under 45)
    m = re.match(r"alle\s+(\d+)", text)
    if m:
        hi = float(m.group(1))
        return hi - 5, hi
    return None


def _add_db_columns(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Auto-detect and parse dB columns from various WFS formats."""
    gdf.columns = [c.lower() for c in gdf.columns]

    # Already has db_lo/db_hi
    if "db_lo" in gdf.columns and "db_hi" in gdf.columns:
        gdf["db_lo"] = gdf["db_lo"].astype(float)
        gdf["db_hi"] = gdf["db_hi"].astype(float)
        return gdf

    # Look for text-based dB columns: melu_db, vyohyke, etc.
    text_col = None
    for c in gdf.columns:
        if c in ("melu_db", "vyohyke", "db", "meluvyohyke", "noise_zone"):
            text_col = c
            break

    if text_col:
        db_lo_vals = []
        db_hi_vals = []
        for val in gdf[text_col]:
            parsed = _parse_db_range(str(val)) if val else None
            if parsed:
                db_lo_vals.append(parsed[0])
                db_hi_vals.append(parsed[1])
            else:
                db_lo_vals.append(float("nan"))
                db_hi_vals.append(float("nan"))
        gdf["db_lo"] = db_lo_vals
        gdf["db_hi"] = db_hi_vals
        # Drop rows where parsing failed
        gdf = gdf.dropna(subset=["db_lo", "db_hi"])
        return gdf

    logger.warning("  Could not find dB columns. Available: %s", list(gdf.columns))
    return gpd.GeoDataFrame()


def fetch_vayla_noise(bbox_3067: str, label: str):
    """Fetch road noise contours from Väylävirasto WFS for a region.

    Splits the bbox into sub-tiles to avoid empty responses from the server
    which truncates large result sets.
    """
    logger.info("Fetching Väylävirasto noise data for %s...", label)

    parts = bbox_3067.split(",")
    x0, y0, x1, y1 = float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])

    # Split into ~4 sub-tiles
    mx = (x0 + x1) / 2
    my = (y0 + y1) / 2
    sub_bboxes = [
        f"{x0:.0f},{y0:.0f},{mx:.0f},{my:.0f}",
        f"{mx:.0f},{y0:.0f},{x1:.0f},{my:.0f}",
        f"{x0:.0f},{my:.0f},{mx:.0f},{y1:.0f}",
        f"{mx:.0f},{my:.0f},{x1:.0f},{y1:.0f}",
    ]

    all_features = []
    for i, sub_bbox in enumerate(sub_bboxes):
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeName": VAYLA_LAYER,
            "outputFormat": "application/json",
            "srsName": "EPSG:3067",
            "bbox": f"{sub_bbox},EPSG:3067",
        }

        try:
            resp = requests.get(VAYLA_WFS_URL, params=params, timeout=300)
            resp.raise_for_status()
            if len(resp.text) == 0:
                logger.warning("  Sub-tile %d: empty response", i + 1)
                continue
            data = resp.json()
            features = data.get("features", [])
            logger.info("  Sub-tile %d: %d features", i + 1, len(features))
            all_features.extend(features)
        except Exception as e:
            logger.warning("  Sub-tile %d failed: %s", i + 1, e)

    logger.info("  Total %d noise features for %s", len(all_features), label)

    if not all_features:
        return gpd.GeoDataFrame()

    gdf = gpd.GeoDataFrame.from_features(all_features, crs="EPSG:3067")
    gdf = _add_db_columns(gdf)

    if gdf.empty:
        return gdf

    logger.info("  %s noise: %d features, dB range: %.0f–%.0f",
                label, len(gdf), gdf["db_lo"].min(), gdf["db_hi"].max())
    return gdf


def fetch_tampere_noise():
    """Fetch Tampere city road noise contours from WFS."""
    logger.info("Fetching Tampere city noise data...")

    params = {
        "service": "WFS",
        "version": "1.0.0",
        "request": "GetFeature",
        "typeName": TAMPERE_LAYER,
        "outputFormat": "application/json",
    }

    resp = requests.get(TAMPERE_WFS_URL, params=params, timeout=180)
    resp.raise_for_status()
    data = resp.json()

    features = data.get("features", [])
    logger.info("  Received %d noise contour features for Tampere", len(features))

    if not features:
        return gpd.GeoDataFrame()

    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:3878")
    gdf = _add_db_columns(gdf)

    if gdf.empty:
        return gdf

    # Reproject to EPSG:3067 for consistency
    gdf = gdf.to_crs("EPSG:3067")
    logger.info("  Tampere noise: %d features, dB range: %.0f–%.0f",
                len(gdf), gdf["db_lo"].min(), gdf["db_hi"].max())
    return gdf


def compute_noise_per_postal_code(postal_gdf, noise_gdf, label=""):
    """Compute area-weighted average Lden per postal code.

    For each postal code, intersect with noise contours and weight the
    midpoint dB of each band by the intersection area. Areas outside any
    contour get the background noise level.
    """
    if noise_gdf.empty:
        logger.warning("  No noise data for %s — skipping", label)
        return {}

    # Reproject postal codes to noise CRS for accurate area computation
    postal_proj = postal_gdf.to_crs(noise_gdf.crs)
    postal_proj["geometry"] = postal_proj["geometry"].apply(make_valid)
    noise_gdf = noise_gdf.copy()
    noise_gdf["geometry"] = noise_gdf["geometry"].apply(make_valid)
    noise_gdf["db_mid"] = (noise_gdf["db_lo"] + noise_gdf["db_hi"]) / 2.0

    noise_sindex = noise_gdf.sindex

    results = {}
    total = len(postal_proj)

    for i, (idx, row) in enumerate(postal_proj.iterrows()):
        pno = row["pno"]
        postal_geom = row["geometry"]
        postal_area = postal_geom.area

        if postal_area <= 0:
            continue

        candidates = list(noise_sindex.intersection(postal_geom.bounds))
        if not candidates:
            results[pno] = BACKGROUND_DB
            continue

        weighted_sum = 0.0
        covered_area = 0.0

        for cand_idx in candidates:
            noise_row = noise_gdf.iloc[cand_idx]
            noise_geom = noise_row["geometry"]

            try:
                if not postal_geom.intersects(noise_geom):
                    continue

                intersection = postal_geom.intersection(noise_geom)
                inter_area = intersection.area

                if inter_area > 0 and not math.isnan(inter_area):
                    db_mid = noise_row["db_mid"]
                    if not math.isnan(db_mid):
                        weighted_sum += inter_area * db_mid
                        covered_area += inter_area
            except Exception:
                # Skip problematic geometries
                continue

        # Clamp uncovered area to >= 0 (overlapping contours can exceed total)
        uncovered = max(0, postal_area - covered_area)
        total_area = max(covered_area, postal_area)

        if total_area > 0:
            avg_db = (weighted_sum + uncovered * BACKGROUND_DB) / total_area
            if not math.isnan(avg_db):
                results[pno] = round(avg_db, 1)

        if (i + 1) % 20 == 0 or (i + 1) == total:
            logger.info("  %s: processed %d/%d postal codes", label, i + 1, total)

    return results


def main():
    postal_gdf = load_postal_codes()

    hki_mask = postal_gdf["pno"].str.startswith(HELSINKI_PREFIX)
    hki_postal = postal_gdf[hki_mask].copy()
    other_hki_postal = postal_gdf[
        postal_gdf["pno"].str.startswith("01") | postal_gdf["pno"].str.startswith("02")
    ].copy()
    turku_postal = postal_gdf[
        postal_gdf["pno"].str.startswith("20") | postal_gdf["pno"].str.startswith("21")
        | postal_gdf["pno"].str.startswith("23") | postal_gdf["pno"].str.startswith("27")
    ].copy()
    tampere_postal = postal_gdf[
        postal_gdf["pno"].str.startswith("33") | postal_gdf["pno"].str.startswith("34")
        | postal_gdf["pno"].str.startswith("35") | postal_gdf["pno"].str.startswith("36")
        | postal_gdf["pno"].str.startswith("37") | postal_gdf["pno"].str.startswith("38")
        | postal_gdf["pno"].str.startswith("39")
    ].copy()

    logger.info(
        "Split: %d Helsinki, %d Espoo/Vantaa/Kauniainen, %d Turku, %d Tampere postal codes",
        len(hki_postal), len(other_hki_postal), len(turku_postal), len(tampere_postal),
    )

    results = {}

    # --- Helsinki metro ---
    hki_wfs_ok = False
    try:
        hki_noise = fetch_helsinki_noise()
        if not hki_noise.empty:
            hki_results = compute_noise_per_postal_code(
                hki_postal, hki_noise, label="Helsinki 2022"
            )
            if len(hki_results) > len(hki_postal) * 0.5:
                results.update(hki_results)
                hki_wfs_ok = True
                logger.info("Helsinki 2022 WFS: %d postal codes", len(hki_results))
    except Exception as e:
        logger.warning("Helsinki 2022 WFS failed: %s — falling back to metro", e)

    try:
        metro_noise = fetch_metro_noise()
        if not hki_wfs_ok:
            logger.info("Using metro shapefile for Helsinki (fallback)")
            hki_metro = compute_noise_per_postal_code(
                hki_postal, metro_noise, label="Helsinki metro"
            )
            results.update(hki_metro)
            logger.info("Helsinki (metro fallback): %d postal codes", len(hki_metro))

        other_results = compute_noise_per_postal_code(
            other_hki_postal, metro_noise, label="Espoo/Vantaa/Kauniainen"
        )
        results.update(other_results)
        logger.info("Espoo/Vantaa/Kauniainen: %d postal codes", len(other_results))
    except Exception as e:
        logger.error("Metro noise data failed: %s", e)

    # --- Turku: Väylävirasto nationwide WFS ---
    try:
        turku_noise = fetch_vayla_noise(TURKU_BBOX_3067, "Turku")
        if not turku_noise.empty:
            turku_results = compute_noise_per_postal_code(
                turku_postal, turku_noise, label="Turku (Väylävirasto)"
            )
            results.update(turku_results)
            logger.info("Turku: %d postal codes", len(turku_results))
    except Exception as e:
        logger.warning("Turku noise data failed: %s", e)

    # --- Tampere: Try city WFS first, fall back to Väylävirasto ---
    tampere_done = False
    try:
        tampere_noise = fetch_tampere_noise()
        if not tampere_noise.empty:
            tampere_results = compute_noise_per_postal_code(
                tampere_postal, tampere_noise, label="Tampere city"
            )
            if len(tampere_results) > len(tampere_postal) * 0.3:
                results.update(tampere_results)
                tampere_done = True
                logger.info("Tampere city: %d postal codes", len(tampere_results))
    except Exception as e:
        logger.warning("Tampere city noise failed: %s — trying Väylävirasto", e)

    if not tampere_done:
        try:
            tampere_vayla = fetch_vayla_noise(TAMPERE_BBOX_3067, "Tampere")
            if not tampere_vayla.empty:
                tampere_results = compute_noise_per_postal_code(
                    tampere_postal, tampere_vayla, label="Tampere (Väylävirasto)"
                )
                results.update(tampere_results)
                logger.info("Tampere (Väylävirasto): %d postal codes", len(tampere_results))
        except Exception as e:
            logger.warning("Tampere Väylävirasto noise failed: %s", e)

    if not results:
        logger.error("No noise data computed — aborting")
        sys.exit(1)

    # Write output
    with open(OUTPUT_FILE, "w") as f:
        json.dump(results, f, indent=2, sort_keys=True)
    logger.info("Wrote %d postal codes to %s", len(results), OUTPUT_FILE.name)


if __name__ == "__main__":
    main()
