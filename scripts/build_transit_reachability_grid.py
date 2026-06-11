#!/usr/bin/env python3
"""
Build a real 250 m public-transport reachability grid for the Helsinki
metropolitan area from the Helsinki Region Travel Time Matrix 2023.

Data source
-----------
Helsinki Region Travel Time Matrix 2018-2023
  Zenodo record: https://zenodo.org/records/11220980
  License: CC BY 4.0
  Granularity: 250 m x 250 m YKR grid (13,132 cells), EPSG:3067.

The matrix gives, for every (from_id, to_id) ordered pair of YKR grid cells,
travel times by several modes. The 2023 public-transport columns are:

  pt_r_avg / pt_r_slo  - rush hour (avg / slow) door-to-door PT time, minutes
  pt_m_avg / pt_m_slo  - midday   (avg / slow) door-to-door PT time, minutes
  pt_n_avg / pt_n_slo  - night    (avg / slow) door-to-door PT time, minutes

(The task brief referred to pt_r_t / pt_m_t; in the 2023 release the equivalent
"PT total travel time incl. walk" column is pt_r_avg. We use pt_r_avg, the
rush-hour average door-to-door PT time, which already includes the walk legs to
and from stops and the wait time. A value of -1 means "no PT route".)

Method
------
1. Download the small grid geometry GeoPackage (~0.34 MB) and read the cell
   polygons (column `id` = YKR_ID, CRS EPSG:3067).
2. Pick a small set of key DESTINATION cells = the YKR cells containing the
   major regional centres (Helsinki centre, Pasila, Leppavaara, Tikkurila).
   Found by point-in-polygon against the grid.
3. Read ONLY the matrix rows whose to_id is one of those destinations. The
   2.6 GB travel-time .csv.zip on Zenodo is the traditional one-CSV-per-
   destination archive: each member is
       ..._travel_times_to_<YKR_ID>.csv
   and holds every from_id that reaches that destination. Zenodo serves HTTP
   range requests (206), so we open the remote zip lazily and inflate only the
   ~4 destination member CSVs (~0.13 MB compressed each) instead of downloading
   or streaming the whole 2.6 GB archive. This reads the EXACT same authoritative
   rows that filtering the full matrix by to_id would yield -- no proxy, no
   regression, no fabrication. (A full-stream fallback over .csv.zst with the
   `zstandard` library, filtering by to_id, would produce identical numbers; the
   range method is just dramatically cheaper.)
4. For each from_id, collect the PT travel times (pt_r_avg) to each destination,
   ignoring -1 / missing, and take the MEAN over the reachable destinations.
   Cells with no PT route to any destination get no score (omitted).
5. Convert mean PT minutes -> 0-100 score (higher = better reachability):
       score = clamp(100 * (1 - (mean - MIN) / (MAX - MIN)), 0, 100)
   with MIN = 10 min, MAX = 90 min. This is an absolute, interpretable scale:
   a cell whose mean PT time to the four hubs is <=10 min scores ~100, and one
   at >=90 min scores 0. (A percentile rank was the documented alternative; the
   linear clamp was chosen so the score is comparable across rebuilds and does
   not depend on the cell population.)
6. Emit public/data/transit_reachability_grid.geojson: a FeatureCollection of
   the 250 m cell polygons reprojected to EPSG:4326, each with a single
   property `reachability` (0-100, 1 dp). Only cells with a score are included.
   Matches the existing grid convention (public/data/light_pollution_grid.geojson).

This script does NOT run build:data, does NOT touch the frontend/registry, and
does NOT persist the multi-GB archive (only the tiny grid gpkg lands in TEMP).
"""
from __future__ import annotations

import csv
import io
import logging
import tempfile
import time
import zipfile
from pathlib import Path

import geopandas as gpd
import requests
from pyproj import Transformer
from shapely.geometry import Point, mapping

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
ZENODO_RECORD = "11220980"
ZENODO_API = f"https://zenodo.org/api/records/{ZENODO_RECORD}"

GRID_FILE_KEY = "Helsinki_Travel_Time_Matrix_2023_grid.gpkg.zip"
MATRIX_FILE_KEY = "Helsinki_Travel_Time_Matrix_2023_travel_times.csv.zip"

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = SCRIPT_DIR.parent / "public" / "data" / "transit_reachability_grid.geojson"
TEMP_DIR = Path(tempfile.gettempdir()) / "naapurustot_ttm2023"

# PT travel-time column used (rush-hour average, door-to-door, minutes).
PT_COLUMN = "pt_r_avg"
NO_ROUTE = -1

# Major regional centres -> approximate (lat, lon). The YKR cell containing each
# point becomes a destination.
DESTINATION_POINTS = {
    "Helsinki centre (Rautatientori/Kamppi)": (60.171, 24.941),
    "Pasila": (60.199, 24.933),
    "Leppavaara (Espoo)": (60.219, 24.813),
    "Tikkurila (Vantaa)": (60.292, 25.044),
}

# Linear score mapping (minutes -> 0..100).
SCORE_MIN_MIN = 10.0   # mean PT time at/below this -> score 100
SCORE_MAX_MIN = 90.0   # mean PT time at/above this -> score 0

HTTP_HEADERS = {
    "User-Agent": "naapurustot.fi data pipeline (+https://naapurustot.fi)"
}


# --------------------------------------------------------------------------- #
# Lazy, range-backed remote file (so zipfile can read only what it needs)
# --------------------------------------------------------------------------- #
class HttpRangeFile(io.RawIOBase):
    """A seekable, read-only file object backed by HTTP range requests.

    Lets ``zipfile.ZipFile`` parse the End-Of-Central-Directory + central
    directory and inflate individual members of a remote ZIP without
    downloading the whole archive. Requires the server to honour Range
    requests (Zenodo returns HTTP 206).
    """

    def __init__(self, url: str, session: requests.Session | None = None):
        super().__init__()
        self.url = url
        self.s = session or requests.Session()
        self.s.headers.update(HTTP_HEADERS)
        r = self.s.head(url, allow_redirects=True, timeout=60)
        r.raise_for_status()
        if "Content-Length" not in r.headers:
            raise RuntimeError("Server did not report Content-Length")
        self.length = int(r.headers["Content-Length"])
        self.pos = 0
        self.n_requests = 0
        self.n_bytes = 0

    # io plumbing -----------------------------------------------------------
    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        elif whence == io.SEEK_END:
            self.pos = self.length + offset
        return self.pos

    def tell(self) -> int:
        return self.pos

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            size = self.length - self.pos
        if size <= 0:
            return b""
        end = min(self.pos + size, self.length) - 1
        if end < self.pos:
            return b""
        last_exc: Exception | None = None
        for attempt in range(5):
            try:
                r = self.s.get(
                    self.url,
                    headers={"Range": f"bytes={self.pos}-{end}"},
                    timeout=180,
                )
                r.raise_for_status()
                data = r.content
                break
            except requests.RequestException as exc:  # pragma: no cover
                last_exc = exc
                wait = 2 ** attempt
                logger.warning("  range read retry %d in %ds (%s)", attempt + 1, wait, exc)
                time.sleep(wait)
        else:  # pragma: no cover
            raise last_exc  # type: ignore[misc]
        self.n_requests += 1
        self.n_bytes += len(data)
        self.pos += len(data)
        return data


# --------------------------------------------------------------------------- #
# Steps
# --------------------------------------------------------------------------- #
def resolve_file_urls() -> dict[str, str]:
    """Return {file_key: download_url} from the Zenodo record API."""
    logger.info("Querying Zenodo record %s ...", ZENODO_RECORD)
    r = requests.get(ZENODO_API, headers=HTTP_HEADERS, timeout=60)
    r.raise_for_status()
    files = r.json().get("files", [])
    urls = {f["key"]: f["links"]["self"] for f in files}
    for key in (GRID_FILE_KEY, MATRIX_FILE_KEY):
        if key not in urls:
            raise RuntimeError(f"Expected file not found in record: {key}")
    return urls


def download_grid(url: str) -> Path:
    """Download the small grid gpkg.zip to TEMP (cached) and return the path."""
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    dest = TEMP_DIR / GRID_FILE_KEY
    if dest.exists() and dest.stat().st_size > 0:
        logger.info("Grid already in TEMP: %s", dest)
        return dest
    logger.info("Downloading grid geometry -> %s", dest)
    with requests.get(url, headers=HTTP_HEADERS, stream=True, timeout=180) as r:
        r.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(chunk_size=1 << 16):
                fh.write(chunk)
    logger.info("  grid downloaded (%.2f MB)", dest.stat().st_size / 1e6)
    return dest


def load_grid(grid_zip: Path) -> gpd.GeoDataFrame:
    """Read the YKR grid (EPSG:3067). Cell-id column is `id`."""
    gdf = gpd.read_file("zip://" + str(grid_zip))
    if "id" not in gdf.columns:
        raise RuntimeError(f"Grid missing `id` column; has {list(gdf.columns)}")
    gdf["id"] = gdf["id"].astype("int64")
    logger.info("Loaded grid: %d cells, CRS=%s", len(gdf), gdf.crs)
    return gdf


def find_destination_cells(grid: gpd.GeoDataFrame) -> dict[str, int]:
    """Return {centre_name: YKR_ID} for each destination point (point-in-poly)."""
    tf = Transformer.from_crs("EPSG:4326", "EPSG:3067", always_xy=True)
    sindex = grid.sindex
    out: dict[str, int] = {}
    for name, (lat, lon) in DESTINATION_POINTS.items():
        x, y = tf.transform(lon, lat)
        pt = Point(x, y)
        ykr = None
        for i in sindex.query(pt):
            if grid.geometry.iloc[i].contains(pt):
                ykr = int(grid.iloc[i]["id"])
                break
        if ykr is None:
            raise RuntimeError(f"No grid cell contains destination {name} ({lat},{lon})")
        out[name] = ykr
        logger.info("  destination %-42s -> YKR_ID %d", name, ykr)
    return out


def read_destination_member(
    zf: zipfile.ZipFile, member_name: str
) -> dict[int, float]:
    """Parse one destination member CSV -> {from_id: pt_minutes} (reachable only)."""
    raw = zf.read(member_name)
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8")))
    if PT_COLUMN not in (reader.fieldnames or []):
        raise RuntimeError(
            f"Column {PT_COLUMN!r} not in member {member_name}; "
            f"have {reader.fieldnames}"
        )
    result: dict[int, float] = {}
    for row in reader:
        val = row.get(PT_COLUMN, "")
        if val == "" or val is None:
            continue
        try:
            t = float(val)
        except ValueError:
            continue
        if t <= NO_ROUTE:  # -1 = no route
            continue
        result[int(row["from_id"])] = t
    return result


def collect_pt_times(
    matrix_url: str, destinations: dict[str, int]
) -> dict[int, list[float]]:
    """Open the remote matrix zip and gather PT times per from_id to each dest."""
    logger.info("Opening remote matrix zip via HTTP range requests ...")
    rf = HttpRangeFile(matrix_url)
    logger.info("  archive size: %.0f MB", rf.length / 1e6)
    zf = zipfile.ZipFile(rf)
    names = zf.namelist()
    logger.info("  archive lists %d members", len(names))

    # Map each destination YKR_ID -> its member CSV name.
    by_suffix: dict[int, str] = {}
    for n in names:
        if n.endswith(".csv") and "_travel_times_to_" in n:
            try:
                ykr = int(n.rsplit("_travel_times_to_", 1)[1][:-4])
            except ValueError:
                continue
            by_suffix[ykr] = n

    per_from: dict[int, list[float]] = {}
    for name, ykr in destinations.items():
        member = by_suffix.get(ykr)
        if member is None:
            raise RuntimeError(f"No matrix member for destination {name} (YKR {ykr})")
        logger.info("  reading PT times to %s (YKR %d) ...", name, ykr)
        times = read_destination_member(zf, member)
        logger.info("    %d reachable origins", len(times))
        for from_id, t in times.items():
            per_from.setdefault(from_id, []).append(t)

    logger.info(
        "Downloaded %.2f MB in %d range requests to extract %d destination members",
        rf.n_bytes / 1e6, rf.n_requests, len(destinations),
    )
    return per_from


def score_from_mean(mean_minutes: float) -> float:
    """Linear minutes -> 0..100 score, clamped."""
    span = SCORE_MAX_MIN - SCORE_MIN_MIN
    raw = 100.0 * (1.0 - (mean_minutes - SCORE_MIN_MIN) / span)
    return max(0.0, min(100.0, raw))


def build_geojson(
    grid: gpd.GeoDataFrame, per_from: dict[int, list[float]]
) -> dict:
    """Join scores to grid polygons (reprojected to 4326) -> FeatureCollection."""
    # Per from_id mean PT time -> score.
    scores: dict[int, float] = {}
    for from_id, times in per_from.items():
        if not times:
            continue
        mean_minutes = sum(times) / len(times)
        scores[from_id] = round(score_from_mean(mean_minutes), 1)

    grid_4326 = grid.to_crs(epsg=4326)
    features = []
    for ykr, geom in zip(grid_4326["id"].tolist(), grid_4326.geometry):
        score = scores.get(int(ykr))
        if score is None or geom is None or geom.is_empty:
            continue
        gj = mapping(geom)
        gj["coordinates"] = _round_coords(gj["coordinates"], 6)
        features.append(
            {"type": "Feature", "geometry": gj, "properties": {"reachability": score}}
        )
    return {"type": "FeatureCollection", "features": features}


def _round_coords(coords, ndigits):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], ndigits), round(coords[1], ndigits)]
    return [_round_coords(c, ndigits) for c in coords]


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> None:
    logger.info("=== Transit Reachability Grid (Helsinki TTM 2023, 250 m YKR) ===")
    urls = resolve_file_urls()

    grid_zip = download_grid(urls[GRID_FILE_KEY])
    grid = load_grid(grid_zip)

    destinations = find_destination_cells(grid)
    per_from = collect_pt_times(urls[MATRIX_FILE_KEY], destinations)

    fc = build_geojson(grid, per_from)
    features = fc["features"]

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    import json
    with open(OUTPUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, ensure_ascii=False, separators=(",", ":"))

    # ---- stats ----
    vals = [f["properties"]["reachability"] for f in features]
    logger.info("=== RESULT ===")
    logger.info("Output: %s", OUTPUT_FILE)
    logger.info("Features: %d (of %d grid cells)", len(features), len(grid))
    if vals:
        logger.info(
            "reachability: min=%.1f max=%.1f mean=%.1f",
            min(vals), max(vals), sum(vals) / len(vals),
        )
        for f in features[:3]:
            c = f["geometry"]["coordinates"][0][0]
            logger.info(
                "  sample: reachability=%.1f at ~[%.5f, %.5f]",
                f["properties"]["reachability"], c[0], c[1],
            )


if __name__ == "__main__":
    main()
