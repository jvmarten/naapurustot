#!/usr/bin/env python3
"""Public-transport reachability per Swedish DeSO area -> scripts/se/transit_deso.json.

Finland's score (scripts/build_transit_reachability_grid.py) is the mean rush-hour
door-to-door public-transport time from a 250 m cell to the Helsinki region's centres,
mapped linearly from 10 min (100) to 90 min (0). Finland takes those times from the
Helsinki Region Travel Time Matrix; Sweden has no such matrix, so this script routes them
itself, from Samtrafiken's national timetable:

- Timetable: GTFS Sweden 3 (Trafiklab, every operator in the country, CC0), the weekday
  SERVICE_DATE. Trips run on that date per calendar/calendar_dates; trips of the day
  before whose times pass 24:00 are kept too. A stop that does not allow boarding
  (pickup_type 1) or alighting (drop_off_type 1) is honoured; stops served on request
  (2, 3) are kept, as in the timetable.
- Hubs: each FA25 region is named after its centre municipality, or two of them
  ("Malmö-Lund"). The hub in each named municipality is its seat's travel centre: the
  station named "<seat> Centralstation / C / resecentrum / station / busstation /
  terminal" (70 of the 85 have one). Where there are several, or none, it is the station
  with the most boardable departures 08:00-14:00 within 500 m, counting its neighbours'
  (a centre is a cluster of stops; the single busiest one is a bus terminal at its edge,
  and the busiest cluster alone picked Stensele over Storuman and Stadsbiblioteket over
  Stockholm C). The whole window, not the rush hour: Dorotea has no departure 08:00-09:00. The hubs are printed and written to the output for review.
- Routing: a profile Connection Scan over every connection leaving 08:00-14:00
  (transit_profile.c). Time is door to door: walking to a stop within 1.5 km, waiting,
  riding, changing (1 min slack, walks between stops within 400 m) and walking from the
  hub's platforms, or walking the whole way if that is faster. Walks are straight lines ×
  1.3 at 4.5 km/h. Each origin departs at every minute 08:00-08:59 and its time is the
  mean over those 60 departures — the waiting a resident who leaves at a random minute
  meets, which is what the matrix's rush-hour average measures. A region with two hubs
  takes the mean of the two, as Finland's cell takes the mean over its four.
- Origins: Finland averages the 250 m cells of a postal area. Here the 250 m points of a
  DeSO are weighted by the residents of SCB's 1 km population grid cell holding them
  (stat:befolkning_1km_2025, CC0; the grid fetch_se_water_proximity.py uses), so a large
  rural DeSO is scored where its people live, not across its empty forest. A DeSO with no
  populated point is scored at its representative point.
- Score: the same linear map as Finland's, per point, then the weighted mean per DeSO.
  A departure minute from which nothing reaches the hub on a connection leaving by 14:00
  is only a lower bound (14:00 minus the departure); a point whose bounded mean still
  scores above 0 is left out rather than published high.

Walking is not routed on the street network (Finland's matrix is), so a river or a
motorway between an origin and its stop is not seen. Only display geometry
(se_deso.geojson) is used to place points.

Usage: python scripts/se/fetch_se_transit.py [sweden.zip]
       TRAFIKLAB_KEY (GTFS Sweden 3) is needed only when the zip is not given or cached.
"""

from __future__ import annotations

import csv
import io
import json
import os
import pickle
import re
import subprocess
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import requests
import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import shape
from shapely.ops import transform

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fetch_se_water_proximity import GRID_LAYER, population_grid  # noqa: E402

ROOT = HERE.parent.parent
SE_GEOJSON = ROOT / "public" / "data" / "se_deso.geojson"
CACHE = HERE / "cache"
GTFS_CACHE = CACHE / "gtfs_sweden.zip"
GTFS_URL = "https://opendata.samtrafiken.se/gtfs-sweden/sweden.zip"
SRC = HERE / "transit_profile.c"
BIN = CACHE / "transit_profile"
OUT = HERE / "transit_deso.json"

SERVICE_DATE = "20261110"  # a Tuesday in an ordinary week
WINDOW = (8 * 3600, 9 * 3600)  # departure minutes routed from
SCAN_END = 14 * 3600  # must match transit_profile.c
SCORE_MIN, SCORE_MAX = 10.0, 90.0  # Finland's: minutes -> 100 .. 0
# Municipalities whose seat is not named after them.
SEAT = {"Gotland": "Visby", "Härjedalen": "Sveg", "Malung-Sälen": "Malung", "Dals-Ed": "Ed",
        "Ovanåker": "Edsbyn"}
TRAVEL_CENTRE = r"[ ,]+(centralstation|c|resecentrum.*|station|busstation|bussstation|bussterminal|terminal)"
HUB_CLUSTER_M = 500.0  # a hub is the station with the most departures within this
TARGET_M = 500.0  # platforms within this of a hub station walk to it
CELL = 250

to_3006 = Transformer.from_crs("EPSG:4326", "EPSG:3006", always_xy=True).transform


def gtfs_zip() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    if GTFS_CACHE.exists():
        return GTFS_CACHE
    key = os.environ.get("TRAFIKLAB_KEY")
    if not key:
        raise SystemExit("TRAFIKLAB_KEY not set and no cached GTFS zip")
    CACHE.mkdir(exist_ok=True)
    # The endpoint refuses requests that do not offer gzip (it answers 406).
    with requests.get(GTFS_URL, params={"key": key}, headers={"Accept-Encoding": "gzip"},
                      stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(GTFS_CACHE, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return GTFS_CACHE


def rows(z: zipfile.ZipFile, name: str):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))


def secs(hms: str) -> int:
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def services_on(z: zipfile.ZipFile, date: str) -> set[str]:
    from datetime import date as Date
    d = Date(int(date[:4]), int(date[4:6]), int(date[6:]))
    day = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][d.weekday()]
    active = {r["service_id"] for r in rows(z, "calendar.txt")
              if r[day] == "1" and r["start_date"] <= date <= r["end_date"]}
    for r in rows(z, "calendar_dates.txt"):
        if r["date"] == date:
            (active.add if r["exception_type"] == "1" else active.discard)(r["service_id"])
    return active


def previous(date: str) -> str:
    from datetime import date as Date, timedelta
    d = Date(int(date[:4]), int(date[4:6]), int(date[6:])) - timedelta(days=1)
    return d.strftime("%Y%m%d")


def connections(z: zipfile.ZipFile):
    """Elementary connections leaving WINDOW[0]..SCAN_END on SERVICE_DATE, in seconds."""
    today, yesterday = services_on(z, SERVICE_DATE), services_on(z, previous(SERVICE_DATE))
    shift = {}
    for r in rows(z, "trips.txt"):
        if r["service_id"] in today:
            shift[r["trip_id"]] = 0
        elif r["service_id"] in yesterday:
            shift.setdefault(r["trip_id"], -86400)
    print(f"  {sum(v == 0 for v in shift.values())} trips run on {SERVICE_DATE}", file=sys.stderr)
    trips: dict[str, list] = defaultdict(list)
    for r in rows(z, "stop_times.txt"):
        s = shift.get(r["trip_id"])
        if s is None:
            continue
        if not r["arrival_time"] or not r["departure_time"]:
            raise SystemExit(f"trip {r['trip_id']}: a stop time without a time")
        trips[r["trip_id"]].append((int(r["stop_sequence"]), secs(r["arrival_time"]) + s,
                                    secs(r["departure_time"]) + s, r["stop_id"],
                                    r["pickup_type"] != "1", r["drop_off_type"] != "1"))
    out = []
    for trip, st in trips.items():
        st.sort()
        for a, b in zip(st, st[1:]):
            if WINDOW[0] <= a[2] <= SCAN_END and b[1] >= a[2]:
                out.append((a[2], b[1], a[3], b[3], trip, a[4], b[5], a[0]))
    return out


def deso_shapes():
    fc = json.loads(SE_GEOJSON.read_text())
    codes = [f["properties"]["pno"] for f in fc["features"]]
    region = {f["properties"]["pno"]: f["properties"]["city"] for f in fc["features"]}
    geoms = [transform(to_3006, shape(f["geometry"])) for f in fc["features"]]
    return codes, region, geoms


def origin_points(codes, geoms):
    """250 m points weighted by their 1 km cell's residents / 16, per DeSO index."""
    cells = population_grid()
    pop = {(int(x // 1000), int(y // 1000)): n for x, y, n in cells}
    pts, weights, owner = [], [], []
    for (cx, cy), n in pop.items():
        for i in range(4):
            for j in range(4):
                pts.append((cx * 1000 + CELL * i + CELL / 2, cy * 1000 + CELL * j + CELL / 2))
                weights.append(n / 16)
    tree = STRtree(geoms)
    pi, gi = tree.query(shapely.points(pts), predicate="within")
    seen = set()
    xy, w = [], []
    for p, g in zip(pi.tolist(), gi.tolist()):
        if p in seen:
            continue
        seen.add(p)
        xy.append(pts[p])
        w.append(weights[p])
        owner.append(g)
    held = set(owner)
    rep = [g for g in range(len(codes)) if g not in held]
    for g in rep:
        p = geoms[g].representative_point()
        xy.append((p.x, p.y))
        w.append(1.0)
        owner.append(g)
    print(f"  {len(xy) - len(rep)} populated 250 m points, {len(rep)} DeSOs at their representative point",
          file=sys.stderr)
    return np.array(xy), np.array(w), np.array(owner)


def score(minutes: float) -> float:
    return max(0.0, min(100.0, 100.0 * (1.0 - (minutes - SCORE_MIN) / (SCORE_MAX - SCORE_MIN))))


def main() -> None:
    path = gtfs_zip()
    z = zipfile.ZipFile(path)
    feed = next(rows(z, "feed_info.txt"))
    print(f"GTFS {feed['feed_id']} {feed['feed_version']}, service date {SERVICE_DATE}", file=sys.stderr)

    stop_rec = {r["stop_id"]: r for r in rows(z, "stops.txt")}
    parsed = CACHE / f"transit_conns_{feed['feed_version']}_{SERVICE_DATE}.pkl"
    if parsed.exists():
        conns = pickle.loads(parsed.read_bytes())
    else:
        conns = connections(z)
        CACHE.mkdir(exist_ok=True)
        parsed.write_bytes(pickle.dumps(conns))
    print(f"  {len(conns)} connections leaving 08:00-14:00", file=sys.stderr)

    used = sorted({c[2] for c in conns} | {c[3] for c in conns})
    sidx = {s: i for i, s in enumerate(used)}
    lonlat = np.array([(float(stop_rec[s]["stop_lon"]), float(stop_rec[s]["stop_lat"])) for s in used])
    sx, sy = to_3006(lonlat[:, 0], lonlat[:, 1])
    # A few stops sit at 0°N 0°E or in the sea off Scotland ("Stockholm, Tallink",
    # "Örebro, Fredsgatan"). They are ridden through but never walked to or from.
    misplaced = (lonlat[:, 1] < 40) | (lonlat[:, 0] < 0) | ~np.isfinite(sx) | ~np.isfinite(sy)
    sx[misplaced] = np.nan
    sy[misplaced] = np.nan
    print(f"  {len(used)} stops, {int(misplaced.sum())} without a usable position", file=sys.stderr)
    trip_ids = sorted({c[4] for c in conns})
    tidx = {t: i for i, t in enumerate(trip_ids)}

    codes, region, geoms = deso_shapes()
    fa25 = json.loads((HERE / "fa25.json").read_text())
    kommuner = json.loads((HERE / "kommuner.json").read_text())

    # Hubs: the busiest station in each municipality a region is named after.
    station_of = {s: (stop_rec[s]["parent_station"] or s) for s in used}
    deps: dict[str, int] = defaultdict(int)
    for c in conns:
        if c[5]:
            deps[station_of[c[2]]] += 1
    stations = [s for s in sorted(deps) if float(stop_rec[s]["stop_lat"]) >= 40 and float(stop_rec[s]["stop_lon"]) >= 0]
    st_xy = np.array([to_3006(float(stop_rec[s]["stop_lon"]), float(stop_rec[s]["stop_lat"])) for s in stations])
    tree = STRtree(geoms)
    nearest = tree.nearest(shapely.points(st_xy))
    kommun_of = {s: codes[g][:4] for s, g in zip(stations, nearest.tolist())}
    st_pos = dict(zip(stations, map(tuple, st_xy)))
    hubs = []
    for r in fa25:
        centres = [k for k in r["kommuner"] if kommuner[k] in r["name"]]
        if not centres:
            raise SystemExit(f"{r['id']}: no municipality named in {r['name']!r}")
        for k in centres:
            cand = [s for s in stations if kommun_of[s] == k]
            if not cand:
                raise SystemExit(f"{r['id']}: no station with departures in {kommuner[k]}")
            cxy = np.array([st_pos[s] for s in cand])
            cdep = np.array([deps[s] for s in cand])
            near = [int(cdep[np.hypot(*(cxy - p).T) <= HUB_CLUSTER_M].sum()) for p in cxy]
            seat = SEAT.get(kommuner[k], kommuner[k])
            named = [i for i, s in enumerate(cand)
                     if re.fullmatch(re.escape(seat) + TRAVEL_CENTRE, stop_rec[s]["stop_name"], re.I)]
            best_i = max(named or range(len(cand)), key=lambda i: (near[i], cdep[i], cand[i]))
            best = cand[best_i]
            hubs.append((r["id"], k, best))
            print(f"  hub {r['id']:28} {kommuner[k]:16} {stop_rec[best]['stop_name']} "
                  f"({near[best_i]} dep 08-14 within {HUB_CLUSTER_M:.0f} m{'' if named else ', by departures'})",
                  file=sys.stderr)

    xy, w, owner = origin_points(codes, geoms)
    point_region = np.array([region[codes[g]] for g in owner])

    CACHE.mkdir(exist_ok=True)
    subprocess.run(["cc", "-O2", "-o", str(BIN), str(SRC), "-lm"], check=True)
    stops_bin = CACHE / "transit_stops.bin"
    conns_bin = CACHE / "transit_conns.bin"
    with open(stops_bin, "wb") as f:
        f.write(np.array([len(used), 0], dtype="<i4").tobytes())
        f.write(np.column_stack([sx, sy]).astype("<f8").tobytes())
    # Departure descending; at a tie the later arrival, then the later stop of the same trip,
    # first — a trip's next connection must be scanned before the one feeding it.
    conns.sort(key=lambda c: (-c[0], -c[1], -c[7]))
    arr = np.array([(c[0], c[1], sidx[c[2]], sidx[c[3]], tidx[c[4]], int(c[5]) | (int(c[6]) << 1))
                    for c in conns], dtype="<i4")
    with open(conns_bin, "wb") as f:
        f.write(np.array([len(conns), len(trip_ids)], dtype="<i4").tobytes())
        f.write(arr.tobytes())
    del arr, conns

    children = defaultdict(list)
    for s in used:
        children[station_of[s]].append(sidx[s])
    sxy = np.column_stack([sx, sy])
    minutes = defaultdict(list)  # point index -> one mean per hub of its region
    bounded = np.zeros(len(xy), dtype=bool)
    for rid, k, hub in hubs:
        hx, hy = to_3006(float(stop_rec[hub]["stop_lon"]), float(stop_rec[hub]["stop_lat"]))
        d = np.hypot(sxy[:, 0] - hx, sxy[:, 1] - hy)
        targets = {i: 0 for i in children[hub]}
        for i in np.nonzero(d <= TARGET_M)[0].tolist():
            targets.setdefault(i, round(d[i] * 1.3 / 1.25))
        sel = np.nonzero(point_region == rid)[0]
        job, out = CACHE / "transit_job.bin", CACHE / "transit_out.bin"
        with open(job, "wb") as f:
            f.write(np.array([hx, hy], dtype="<f8").tobytes())
            f.write(np.array([len(targets), 0], dtype="<i4").tobytes())
            f.write(np.array(sorted(targets.items()), dtype="<i4").tobytes())
            f.write(np.array([len(sel), 0], dtype="<i4").tobytes())
            f.write(xy[sel].astype("<f8").tobytes())
        subprocess.run([str(BIN), str(stops_bin), str(conns_bin), str(job), str(out)], check=True)
        res = np.fromfile(out, dtype=[("m", "<f4"), ("b", "<i4")])
        for p, m, b in zip(sel.tolist(), res["m"].tolist(), res["b"].tolist()):
            minutes[p].append(m)
            bounded[p] |= b > 0
        print(f"  {rid}: {len(sel)} points, median {np.median(res['m']):.0f} min", file=sys.stderr)

    total = defaultdict(float)
    weight = defaultdict(float)
    dropped = 0
    for p, ms in minutes.items():
        sc = score(sum(ms) / len(ms))
        if bounded[p] and sc > 0:
            dropped += 1
            continue
        total[owner[p]] += w[p] * sc
        weight[owner[p]] += w[p]
    values = {codes[g]: round(total[g] / weight[g], 1) for g in total if weight[g] > 0}
    print(f"  {dropped} points left out (no journey by 14:00, mean still under 90 min)", file=sys.stderr)

    v = sorted(values.values())
    OUT.write_text(json.dumps({
        "source": "GTFS Sweden 3 (Samtrafiken via Trafiklab) + SCB 1 km population grid 2025",
        "feed_version": feed["feed_version"],
        "service_date": SERVICE_DATE,
        "grid_layer": GRID_LAYER,
        "hubs": {f"{rid}:{k}": stop_rec[h]["stop_name"] for rid, k, h in hubs},
        "values": dict(sorted(values.items())),
    }, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"wrote {OUT}: {len(v)} of {len(codes)} DeSOs; min {v[0]}, median {v[len(v) // 2]}, "
          f"p90 {v[int(len(v) * .9)]}, max {v[-1]}, zero {sum(1 for x in v if x == 0)}", file=sys.stderr)


if __name__ == "__main__":
    main()
