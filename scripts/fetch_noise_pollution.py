#!/usr/bin/env python3
"""
Compute noise pollution (Lden dB) per postal code area from open traffic noise
contour data.

Sources, by the municipality (`kunta`) each postal area belongs to:
  - Helsinki (091): Helsinki 2022 WFS at kartta.hel.fi (Meluselvitys 2022, streets
    and roads, Lden); the 2012 metro-area survey if that WFS fails
  - Espoo, Vantaa, Kauniainen (049, 092, 235): HRI shapefile pks_maantieet_Lden (2012)
  - Tampere (837): city WFS at geodata.tampere.fi (road noise 2022); Väylävirasto
    if it fails
  - everywhere else: Väylävirasto 2022 national road/street noise contours

A city survey maps every street of its own municipality, and only of it, so it is
used only there. (Until 2026-11 the Tampere survey was applied to every postal code
starting 33-39 and a Turku-only Väylävirasto box to every code starting 20/21/23/27,
so areas outside both got the background value without having been surveyed, and
the nationwide pass skipped them because they already had one: 54 of them sit on a
mapped main road and now have a value.)

Method: area-weighted average of noise zone midpoint dB values per postal code,
ground outside every contour counted at 40 dB. An area no contour reaches at all
is quieter than its survey's lowest zone, by an unknown amount: it keeps the 40 dB
value (so it scores as quiet) and records that zone's lower edge as its bound.

Output: scripts/noise_pollution.json — { postal_code: avg_Lden_dB }
        scripts/noise_floor.json     — { postal_code: lowest_zone_dB } for areas
                                       no contour reaches
"""

import io
import json
import logging
import math
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
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
FLOOR_FILE = Path(__file__).parent / "noise_floor.json"
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

# Municipality codes each city survey covers.
HELSINKI_KUNTA = {"091"}
METRO_KUNTA = {"049", "092", "235"}  # Espoo, Vantaa, Kauniainen
TAMPERE_KUNTA = {"837"}

# Väylävirasto (Finnish Transport Infra Agency) WFS — nationwide road noise 2022
VAYLA_WFS_URL = "https://avoinapi.vaylapilvi.fi/vaylatiedot/ows"
VAYLA_LAYER = "tiestotiedot:melu_paiva_maankad_22"

# Tampere city WFS — road noise Lden 2022
TAMPERE_WFS_URL = "https://geodata.tampere.fi/geoserver/ows"
TAMPERE_LAYER = "ymparisto_ja_terveys:yv_melu_paiva_2022_keskiaani_gsview"

# Nationwide bbox in EPSG:3067 covering all of mainland Finland + Ahvenanmaa.
FINLAND_BBOX_3067 = (50_000.0, 6_600_000.0, 750_000.0, 7_800_000.0)
# Tile grid for nationwide WFS queries (cols, rows). 24 tiles ~= 175x200 km each.
# The server returns a whole tile in one response (108,621 features / 355 MB for
# the densest southern tile on 2026-11-10); every response is checked against its
# numberMatched, so a capped one fails the run instead of thinning the map.
FINLAND_GRID_COLS = 4
FINLAND_GRID_ROWS = 6
TILE_ATTEMPTS = 3

# Value (dB) given to ground outside every contour
BACKGROUND_DB = 40.0


def load_postal_codes():
    """Load postal code polygons (with their municipality code) from the project GeoJSON."""
    if not GEOJSON_FILE.exists():
        logger.error("GeoJSON not found: %s", GEOJSON_FILE)
        sys.exit(1)

    logger.info("Loading postal code polygons from %s...", GEOJSON_FILE.name)
    with open(GEOJSON_FILE, encoding="utf-8") as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    logger.info("  Loaded %d features", len(features))

    records = []
    for feat in features:
        props = feat.get("properties", {})
        pno = props.get("pno", "")
        geom = feat.get("geometry")
        if pno and geom:
            kunta = props.get("kunta")
            if not kunta:
                raise SystemExit(f"{pno}: no kunta, cannot tell which survey covers it")
            records.append({"pno": pno, "kunta": str(kunta), "geometry": shape(geom)})

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
    matched = data.get("numberMatched")
    if isinstance(matched, int) and matched != len(features):
        raise RuntimeError(f"Helsinki WFS returned {len(features)} of {matched} features — capped response")

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

    resp = requests.get(METRO_NOISE_URL, timeout=600)
    resp.raise_for_status()
    logger.info("  Downloaded %.1f MB", len(resp.content) / 1024 / 1024)

    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            for name in zf.namelist():
                if name.startswith(METRO_NOISE_SHAPEFILE):
                    zf.extract(name, tmpdir)

        shp_path = Path(tmpdir) / f"{METRO_NOISE_SHAPEFILE}.shp"
        if not shp_path.exists():
            raise SystemExit("Metro noise shapefile not found in archive")

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


def fetch_vayla_nationwide():
    """Fetch Väylävirasto noise contours across all of Finland in a tile grid.

    Returns one GeoDataFrame, deduplicated by WFS feature id (features crossing a tile
    edge come back in both tiles). A tile that cannot be fetched whole raises: a
    missing tile would put every area in it outside every contour, i.e. "quiet".
    """
    logger.info(
        "Fetching Väylävirasto noise data nationwide (%dx%d tile grid)...",
        FINLAND_GRID_COLS, FINLAND_GRID_ROWS,
    )

    x0, y0, x1, y1 = FINLAND_BBOX_3067
    dx = (x1 - x0) / FINLAND_GRID_COLS
    dy = (y1 - y0) / FINLAND_GRID_ROWS

    parts = []
    n_tiles = FINLAND_GRID_COLS * FINLAND_GRID_ROWS
    tile_idx = 0

    for r in range(FINLAND_GRID_ROWS):
        for c in range(FINLAND_GRID_COLS):
            tile_idx += 1
            tx0 = x0 + c * dx
            ty0 = y0 + r * dy
            bbox = f"{tx0:.0f},{ty0:.0f},{tx0 + dx:.0f},{ty0 + dy:.0f}"
            params = {
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeName": VAYLA_LAYER,
                "outputFormat": "application/json",
                "srsName": "EPSG:3067",
                "bbox": f"{bbox},EPSG:3067",
            }

            data = None
            for attempt in range(1, TILE_ATTEMPTS + 1):
                try:
                    resp = requests.get(VAYLA_WFS_URL, params=params, timeout=900)
                    resp.raise_for_status()
                    data = resp.json()
                    break
                except Exception as e:
                    logger.warning("  Tile %d/%d attempt %d failed: %s", tile_idx, n_tiles, attempt, e)
                    if attempt == TILE_ATTEMPTS:
                        raise SystemExit(f"Väylävirasto tile {tile_idx} ({bbox}) unfetchable — not writing a partial map")
                    time.sleep(10 * attempt)

            feats = data.get("features", [])
            matched = data.get("numberMatched")
            if isinstance(matched, int) and matched != len(feats):
                raise SystemExit(
                    f"Väylävirasto tile {tile_idx}: {len(feats)} of {matched} features returned — capped response"
                )
            logger.info("  Tile %d/%d: %d features", tile_idx, n_tiles, len(feats))
            if feats:
                tile = gpd.GeoDataFrame.from_features(feats, crs="EPSG:3067")
                tile["fid"] = [f["id"] for f in feats]
                parts.append(tile[["fid", "melu_db", "geometry"]])
            del data, feats

    if not parts:
        raise SystemExit("Väylävirasto returned no features at all")

    gdf = pd.concat(parts, ignore_index=True)
    gdf = gpd.GeoDataFrame(gdf.drop_duplicates(subset="fid"), crs="EPSG:3067")
    logger.info("  Total %d unique noise features nationwide", len(gdf))
    gdf = _add_db_columns(gdf)
    if gdf.empty:
        raise SystemExit("Väylävirasto features carry no parseable dB band")

    logger.info(
        "  Nationwide noise: %d features, dB range: %.0f–%.0f",
        len(gdf), gdf["db_lo"].min(), gdf["db_hi"].max(),
    )
    return gdf


def compute_noise_per_postal_code(postal_gdf, noise_gdf, label=""):
    """Compute area-weighted average Lden per postal code.

    For each postal code, intersect with noise contours and weight the midpoint dB
    of each band by the intersection area; ground outside every contour counts at
    BACKGROUND_DB. Returns (values, floors): floors holds, for each area no contour
    reaches at all, the survey's lowest zone (its lower edge in dB) — what that
    area is known to be quieter than.
    """
    if noise_gdf.empty:
        logger.warning("  No noise data for %s — skipping", label)
        return {}, {}

    # Reproject postal codes to noise CRS for accurate area computation
    postal_proj = postal_gdf.to_crs(noise_gdf.crs)
    postal_proj["geometry"] = postal_proj["geometry"].apply(make_valid)
    noise_gdf = noise_gdf.copy()
    noise_gdf["geometry"] = noise_gdf["geometry"].apply(make_valid)
    noise_gdf["db_mid"] = (noise_gdf["db_lo"] + noise_gdf["db_hi"]) / 2.0
    lowest_zone = float(noise_gdf["db_lo"].min())

    noise_sindex = noise_gdf.sindex

    results = {}
    floors = {}
    total = len(postal_proj)

    for i, (idx, row) in enumerate(postal_proj.iterrows()):
        pno = row["pno"]
        postal_geom = row["geometry"]
        postal_area = postal_geom.area

        if postal_area <= 0:
            continue

        weighted_sum = 0.0
        covered_area = 0.0

        for cand_idx in noise_sindex.query(postal_geom, predicate="intersects"):
            noise_row = noise_gdf.iloc[cand_idx]
            try:
                inter_area = postal_geom.intersection(noise_row["geometry"]).area
            except Exception:
                # Skip problematic geometries
                continue
            db_mid = noise_row["db_mid"]
            if inter_area > 0 and not math.isnan(inter_area) and not math.isnan(db_mid):
                weighted_sum += inter_area * db_mid
                covered_area += inter_area

        if covered_area <= 0:
            results[pno] = BACKGROUND_DB
            floors[pno] = lowest_zone
            continue

        # Clamp uncovered area to >= 0 (overlapping contours can exceed total)
        uncovered = max(0, postal_area - covered_area)
        total_area = max(covered_area, postal_area)
        avg_db = (weighted_sum + uncovered * BACKGROUND_DB) / total_area
        if not math.isnan(avg_db):
            results[pno] = round(avg_db, 1)

        if (i + 1) % 100 == 0 or (i + 1) == total:
            logger.info("  %s: processed %d/%d postal codes", label, i + 1, total)

    logger.info("  %s: %d areas, %d outside every contour (lowest zone %.0f dB)",
                label, len(results), len(floors), lowest_zone)
    return results, floors


def main():
    postal_gdf = load_postal_codes()

    hki_postal = postal_gdf[postal_gdf["kunta"].isin(HELSINKI_KUNTA)].copy()
    metro_postal = postal_gdf[postal_gdf["kunta"].isin(METRO_KUNTA)].copy()
    tampere_postal = postal_gdf[postal_gdf["kunta"].isin(TAMPERE_KUNTA)].copy()
    logger.info(
        "Split: %d Helsinki, %d Espoo/Vantaa/Kauniainen, %d Tampere, %d elsewhere",
        len(hki_postal), len(metro_postal), len(tampere_postal),
        len(postal_gdf) - len(hki_postal) - len(metro_postal) - len(tampere_postal),
    )

    results = {}
    floors = {}

    def take(part):
        values, part_floors = part
        results.update(values)
        floors.update(part_floors)

    # --- Helsinki: 2022 survey, else the 2012 metro survey ---
    metro_noise = fetch_metro_noise()
    try:
        hki_noise = fetch_helsinki_noise()
    except Exception as e:
        logger.warning("Helsinki 2022 WFS failed: %s — falling back to metro 2012", e)
        hki_noise = gpd.GeoDataFrame()
    take(compute_noise_per_postal_code(
        hki_postal, hki_noise if not hki_noise.empty else metro_noise,
        label="Helsinki 2022" if not hki_noise.empty else "Helsinki (metro 2012)",
    ))

    # --- Espoo, Vantaa, Kauniainen: 2012 metro survey ---
    take(compute_noise_per_postal_code(metro_postal, metro_noise, label="Espoo/Vantaa/Kauniainen"))

    # --- Everywhere else (and Tampere if its city WFS fails): Väylävirasto ---
    nationwide_noise = fetch_vayla_nationwide()

    try:
        tampere_noise = fetch_tampere_noise()
    except Exception as e:
        logger.warning("Tampere city WFS failed: %s — using Väylävirasto", e)
        tampere_noise = gpd.GeoDataFrame()
    if tampere_noise.empty:
        tampere_noise = nationwide_noise
    take(compute_noise_per_postal_code(tampere_postal, tampere_noise, label="Tampere"))

    rest = postal_gdf[~postal_gdf["pno"].isin(results)].copy()
    take(compute_noise_per_postal_code(rest, nationwide_noise, label="Nationwide (Väylävirasto)"))

    missing = [p for p in postal_gdf["pno"] if p not in results]
    if missing:
        raise SystemExit(f"{len(missing)} postal codes got no value: {missing[:10]}")

    # Write output
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)
    with open(FLOOR_FILE, "w", encoding="utf-8") as f:
        json.dump({k: int(v) if float(v).is_integer() else v for k, v in floors.items()},
                  f, indent=2, sort_keys=True)
    logger.info("Wrote %d postal codes to %s, %d floors to %s",
                len(results), OUTPUT_FILE.name, len(floors), FLOOR_FILE.name)


if __name__ == "__main__":
    main()
