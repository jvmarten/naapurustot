#!/usr/bin/env python3
"""
Fetch transit stop data nationwide and compute stop density per postal code.

Primary source (nationwide):
- Digiroad national public-transport stop register (Väylä / Finnish Transport
  Infrastructure Agency), served via the open OGC API Features endpoint:
  https://avoinapi.vaylapilvi.fi/vaylatiedot/ogc/features/v1
  collection ``digiroad:dr_pysakki`` — ~96 000 stops covering ALL of Finland
  (every roadside bus stop, terminal, etc.), key-free, CC BY 4.0, WGS84/CRS84.
  This is the authoritative national stop dataset that the regional GTFS feeds
  are themselves derived from, and unlike a single regional GTFS it covers
  rural Finland.

Secondary / refresh sources (regional, optional, best-effort live fetch):
- Turku region: Föli GTFS stops API (https://data.foli.fi/gtfs/stops)
- Tampere region: ITS Factory stop-points API
  (https://data.itsfactory.fi/journeys/api/1/stop-points)

Merge policy (preserves existing authoritative urban values):
1. Existing scripts/transit_stop_density.json values (HSL / Föli / Nysse cities,
   computed previously incl. tram/metro) are treated as AUTHORITATIVE and kept
   verbatim for those postal codes.
2. For every OTHER postal code the nationwide Digiroad density is used.
3. Live Föli/Nysse stops, if reachable, only fill postal codes that are not
   already covered by (1) — so they never override the committed urban values.

Output: scripts/transit_stop_density.json — { postal_code: stops_per_km2 }
"""

import datetime
import json
import logging
import sys
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import Point

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent
GEOJSON_PATH = OUT_DIR.parent / "public" / "data" / "metro_neighborhoods.geojson"
EXISTING_FILE = OUT_DIR / "transit_stop_density.json"

# Browser-like UA — some Finnish open-data hosts reject default python-requests UA.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 naapurustot.fi/data-pipeline"
)

# Digiroad national public-transport stop layer (OGC API Features, key-free).
DIGIROAD_BASE = "https://avoinapi.vaylapilvi.fi/vaylatiedot/ogc/features/v1"
DIGIROAD_COLLECTION = "digiroad:dr_pysakki"
DIGIROAD_PAGE_SIZE = 10000

# Föli (Turku region) GTFS stops
FOLI_STOPS_URL = "https://data.foli.fi/gtfs/stops"

# ITS Factory (Tampere region) stop-points
NYSSE_STOPS_URL = "https://data.itsfactory.fi/journeys/api/1/stop-points"


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    return s


def load_postal_boundaries() -> gpd.GeoDataFrame:
    """Load postal code boundaries from the pipeline GeoJSON (EPSG:4326)."""
    gdf = gpd.read_file(GEOJSON_PATH, engine="pyogrio")
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    # Normalise postal-code column to ``pno`` (string, zero-padded).
    if "pno" not in gdf.columns and "postinumeroalue" in gdf.columns:
        gdf["pno"] = gdf["postinumeroalue"]
    gdf["pno"] = gdf["pno"].astype(str).str.zfill(5)
    return gdf


def fetch_digiroad_stops(session: requests.Session) -> list[dict]:
    """Fetch every Finnish public-transport stop from Digiroad (national).

    Decommissioned stops (``viim_vo_pv`` last-validity date in the past) are
    dropped so density reflects currently-served stops.
    """
    logger.info("Fetching national Digiroad public-transport stops...")
    today = datetime.date.today()
    items_url = f"{DIGIROAD_BASE}/collections/{DIGIROAD_COLLECTION}/items"

    stops: list[dict] = []
    seen: set = set()
    dropped = 0
    # NOTE: this OGC API endpoint ignores the standard `offset` param (it returns
    # the first page every time); it paginates via `startIndex`. We also dedup on
    # the stop id so a misbehaving server can never inflate counts.
    start_index = 0
    total = None
    while True:
        params = {"f": "json", "limit": DIGIROAD_PAGE_SIZE, "startIndex": start_index}
        try:
            r = session.get(items_url, params=params, timeout=180)
            r.raise_for_status()
            payload = r.json()
        except Exception as e:  # noqa: BLE001
            logger.error("  Digiroad request failed at startIndex %d: %s", start_index, e)
            break

        if total is None:
            total = payload.get("numberMatched")
            logger.info("  numberMatched=%s", total)

        feats = payload.get("features", [])
        if not feats:
            break

        new_in_page = 0
        for f in feats:
            sid = (f.get("properties") or {}).get("valtak_id", f.get("id"))
            if sid in seen:
                continue
            seen.add(sid)
            new_in_page += 1

            geom = f.get("geometry") or {}
            coords = geom.get("coordinates")
            if not coords or len(coords) < 2:
                continue
            last = ((f.get("properties") or {}).get("viim_vo_pv") or "").strip()
            if last:
                try:
                    if datetime.date.fromisoformat(last[:10]) < today:
                        dropped += 1
                        continue
                except ValueError:
                    # Unparseable / non-ISO validity date: keep the stop as
                    # active rather than dropping it on a date-format quirk.
                    pass
            stops.append({"lon": float(coords[0]), "lat": float(coords[1])})

        # Stop if the server stops giving us new records (guards against a
        # server that ignores paging) or we've consumed everything.
        if new_in_page == 0:
            break
        start_index += len(feats)
        if total is not None and start_index >= total:
            break
        if len(feats) < DIGIROAD_PAGE_SIZE:
            break

    logger.info(
        "  Kept %d active Digiroad stops (%d unique fetched, %d decommissioned dropped)",
        len(stops),
        len(seen),
        dropped,
    )
    return stops


def fetch_foli_stops(session: requests.Session) -> list[dict]:
    """Fetch transit stops from Föli (Turku) GTFS API (best-effort)."""
    logger.info("Fetching Föli (Turku) transit stops...")
    try:
        r = session.get(FOLI_STOPS_URL, timeout=60)
        r.raise_for_status()
        data = r.json()
        stops = []
        for _stop_id, stop in data.items():
            lat = stop.get("stop_lat")
            lon = stop.get("stop_lon")
            if lat and lon:
                stops.append({"lat": float(lat), "lon": float(lon)})
        logger.info("  Found %d Föli stops", len(stops))
        return stops
    except Exception as e:  # noqa: BLE001
        logger.warning("  Could not fetch Föli stops: %s", e)
        return []


def fetch_nysse_stops(session: requests.Session) -> list[dict]:
    """Fetch transit stops from ITS Factory (Tampere/Nysse) API (best-effort)."""
    logger.info("Fetching Nysse (Tampere) transit stops...")
    try:
        r = session.get(NYSSE_STOPS_URL, timeout=60)
        r.raise_for_status()
        data = r.json()
        stops = []
        body = data.get("body", []) if isinstance(data, dict) else data
        if isinstance(body, list):
            for stop in body:
                loc = stop.get("location")
                if isinstance(loc, str) and "," in loc:
                    parts = loc.split(",")
                    try:
                        stops.append({"lat": float(parts[0].strip()), "lon": float(parts[1].strip())})
                    except ValueError:
                        # Skip stops whose "lat,lon" location isn't numeric.
                        pass
        logger.info("  Found %d Nysse stops", len(stops))
        return stops
    except Exception as e:  # noqa: BLE001
        logger.warning("  Could not fetch Nysse stops: %s", e)
        return []


def compute_density(postal: gpd.GeoDataFrame, stops: list[dict]) -> dict[str, float]:
    """Compute transit stop density (stops/km²) per postal code.

    Returns a value for EVERY postal code (0.0 when no stop falls inside),
    so callers get nationwide coverage. Stops are matched in EPSG:4326 and
    polygon areas are measured in the Finnish equal-area projection EPSG:3067.
    """
    if not stops:
        return {}

    # Stops as a GeoDataFrame and a spatial join (within) — vectorised & fast.
    pts = gpd.GeoDataFrame(
        geometry=[Point(s["lon"], s["lat"]) for s in stops],
        crs="EPSG:4326",
    )
    postal_4326 = postal[["pno", "geometry"]].copy()
    joined = gpd.sjoin(pts, postal_4326, predicate="within", how="inner")
    counts = joined.groupby("pno").size().to_dict()

    # Areas in km² from the equal-area projection.
    areas_m2 = postal.to_crs(epsg=3067).geometry.area
    result: dict[str, float] = {}
    for idx, pno in postal["pno"].items():
        if not pno:
            continue
        area_km2 = areas_m2.loc[idx] / 1_000_000
        if area_km2 <= 0:
            continue
        result[pno] = round(counts.get(pno, 0) / area_km2, 1)
    return result


def main() -> None:
    try:
        postal = load_postal_boundaries()
    except Exception as e:  # noqa: BLE001
        logger.error("Cannot load postal boundaries: %s", e)
        sys.exit(1)
    logger.info("Loaded %d postal-code polygons", len(postal))

    # 1. Existing authoritative urban values (HSL / Föli / Nysse).
    existing: dict[str, float] = {}
    if EXISTING_FILE.exists():
        with open(EXISTING_FILE, encoding="utf-8") as f:
            existing = json.load(f)
        logger.info("Loaded %d existing authoritative entries", len(existing))

    session = _session()

    # 2. Nationwide Digiroad density (the coverage backbone).
    digiroad_stops = fetch_digiroad_stops(session)
    if not digiroad_stops:
        logger.error("No national stops fetched — aborting to avoid clobbering data.")
        sys.exit(1)
    national = compute_density(postal, digiroad_stops)
    logger.info("Computed Digiroad density for %d postal codes", len(national))

    # 3. Best-effort live regional refresh — only used to fill postal codes that
    #    are neither in `existing` nor (meaningfully) covered above.
    regional_stops = fetch_foli_stops(session) + fetch_nysse_stops(session)
    regional = compute_density(postal, regional_stops) if regional_stops else {}

    # Merge: start from nationwide, layer regional (where it has stops) for
    # non-authoritative codes, then apply authoritative existing values last.
    result: dict[str, float] = dict(national)
    for pno, dens in regional.items():
        if pno not in existing and dens > 0:
            result[pno] = dens
    for pno, dens in existing.items():
        result[pno] = dens

    result = {k: result[k] for k in sorted(result)}

    with open(EXISTING_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    vals = list(result.values())
    logger.info("Wrote %s", EXISTING_FILE.name)
    logger.info(
        "Coverage: %d postal codes | min=%.1f max=%.1f mean=%.1f",
        len(result),
        min(vals),
        max(vals),
        sum(vals) / len(vals),
    )


if __name__ == "__main__":
    main()
