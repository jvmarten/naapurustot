#!/usr/bin/env python
"""
IN-1: Fetch in-progress (vireillä) detailed zoning plans (asemakaava) from the
participating municipalities' open WFS feeds and write a normalized,
Ryhti-lifecycle-tagged GeoJSON (WGS84) for the planning builder.

Coverage is HONEST PARTIAL — only municipalities with a reachable open feed.
A failed or absent feed reduces coverage (gray fallback in the UI); it never
fabricates data. Each city's status vocabulary is mapped onto the Ryhti plan
lifecycle (vireilla → luonnos → ehdotus → hyvaksytty → voimassa) so the ~6 city
adapters can later collapse into one Ryhti fetcher as municipalities onboard
through 2029. License: CC BY 4.0 per each city's open-data portal.

Two server families:
  - GeoServer (Helsinki, Tampere, Vantaa): native GeoJSON, EPSG:4326 lon/lat.
  - Tekla TwsServer (Espoo, Turku, Jyväskylä): WFS 1.1.0, GML only → read via
    geopandas/GDAL, with an axis-order safety net + a Finland-bbox sanity filter.

Run on the data refresh; output is committed so the node builder stays
network-free.
"""
import io
import json
import re
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).parent / "planning_raw" / "city_plans.geojson"
# Stamped with the fetch date so build_planning_data.mjs derives the planning
# snapshot from real data vintage (deterministic), not the build-time clock.
SNAPSHOT = Path(__file__).parent / "planning_raw" / "snapshot.txt"

# Finland bbox (WGS84) — any feature whose centroid falls outside is dropped as
# bad geometry (guards against WFS axis-order surprises). lon 19–32, lat 59–71.
FI_BBOX = (19.0, 59.0, 32.0, 71.0)


def ryhti_status(raw: str | None) -> str:
    s = (raw or "").lower()
    if "lainvoima" in s or "voimassa" in s or "voimaan" in s:
        return "voimassa"
    if "hyväksy" in s or "hyvaksy" in s:
        return "hyvaksytty"
    if "ehdotus" in s:
        return "ehdotus"
    if "luonnos" in s or "valmistel" in s:
        return "luonnos"
    return "vireilla"  # default: these are vireillä layers / OAS phases


def _get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "naapurustot-data/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _in_finland(geom: dict) -> bool:
    c = geom.get("coordinates")
    while isinstance(c, list) and c and isinstance(c[0], list):
        c = c[0]
    if not (isinstance(c, list) and len(c) >= 2):
        return False
    lon, lat = c[0], c[1]
    return FI_BBOX[0] <= lon <= FI_BBOX[2] and FI_BBOX[1] <= lat <= FI_BBOX[3]


def _emit(name, plan_id, status_raw, date, url, city, fallback_url):
    nm = (name or "").strip() or (f"Asemakaava {plan_id}" if plan_id else "Asemakaava")
    return {
        "name": nm,
        "kind": "plan",
        "ptype": "zoning",
        "subtype": "Asemakaava",
        "status": ryhti_status(status_raw),
        "date": (str(date).strip() or None) if date else None,
        "url": (url or "").strip() or fallback_url,
        "source": city,
    }


# ── GeoServer (GeoJSON) cities ───────────────────────────────────────────────
def fetch_geoserver(city, base, layer, fields, fallback_url):
    q = {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": layer, "outputFormat": "application/json",
        "srsName": "EPSG:4326", "count": "100000",
    }
    url = base + "?" + urllib.parse.urlencode(q)
    fc = json.loads(_get(url))
    out = []
    for f in fc.get("features", []):
        p = f.get("properties", {}) or {}
        g = f.get("geometry")
        if not g or not g.get("coordinates") or not _in_finland(g):
            continue
        name = fields["name"](p) if callable(fields.get("name")) else p.get(fields.get("name", ""))
        url_v = fields["url"](p) if callable(fields.get("url")) else p.get(fields.get("url", ""))
        out.append({
            "type": "Feature", "geometry": g,
            "properties": _emit(name, p.get(fields.get("plan_id", "")),
                                p.get(fields.get("status", "")), p.get(fields.get("date", "")),
                                url_v, city, fallback_url),
        })
    return out


# ── Tekla (GML) cities, via geopandas ────────────────────────────────────────
def fetch_tekla(city, url, fields, fallback_url):
    import geopandas as gpd
    from shapely.ops import transform as shp_transform

    raw = _get(url)
    gdf = gpd.read_file(io.BytesIO(raw))
    if gdf.empty:
        return []
    # Reproject to WGS84 if a CRS is known; otherwise assume the requested 4326.
    try:
        gdf = gdf.to_crs(4326) if gdf.crs else gdf.set_crs(4326, allow_override=True)
    except Exception:
        gdf = gdf.set_crs(4326, allow_override=True)
    # Axis-order safety net: if X looks like latitude (≈59–71), swap to lon/lat.
    minx, miny, maxx, maxy = gdf.total_bounds
    if 55 <= minx <= 72 and 18 <= miny <= 33:
        gdf = gdf.set_geometry(gdf.geometry.apply(lambda g: shp_transform(lambda x, y, z=None: (y, x), g)))

    out = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        gj = json.loads(gpd.GeoSeries([geom]).to_json())["features"][0]["geometry"]
        if not _in_finland(gj):
            continue
        get = lambda k: row[k] if k and k in row and row[k] is not None else None  # noqa: E731
        name = fields["name"](row) if callable(fields.get("name")) else get(fields.get("name"))
        out.append({
            "type": "Feature", "geometry": gj,
            "properties": _emit(name, get(fields.get("plan_id")), get(fields.get("status")),
                                get(fields.get("date")), get(fields.get("url")), city, fallback_url),
        })
    return out


def tampere_url(p):
    """Tampere stores the plan URL inside an HTML anchor field."""
    html = p.get("KAAVAN_VERKKOSIVU_JA_DOKUMENTIT") or ""
    m = re.search(r'https?://[^"\'<> ]+', html)
    return m.group(0) if m else None


def main() -> int:
    HEL = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs"
    TRE = "https://geodata.tampere.fi/geoserver/wfs"
    VAN = "https://gis.vantaa.fi/geoserver/wfs"
    geoserver_jobs = [
        ("Helsinki", HEL, "avoindata:Kaavahakemisto_alue_kaava_vireilla",
         {"name": None, "plan_id": "kaavatunnus", "status": "luokka", "date": "muokkauspvm", "url": None},
         "https://kartta.hel.fi/"),
        ("Tampere", TRE, "maankaytto:AK_KAAVATYOT_GSVIEW",
         {"name": None, "plan_id": "DIAARINRO", "status": None, "date": None, "url": tampere_url},
         "https://www.tampere.fi/asuminen-ja-ymparisto/kaavoitus"),
        ("Vantaa", VAN, "kaava:kaavat_vireilla",
         {"name": "kaavanimi1", "plan_id": "kaavatunnus", "status": "vaihe", "date": "kasit_pvm", "url": "kaavalinkki"},
         "https://www.vantaa.fi/fi/kaavoitus"),
    ]

    def tekla(base, layer, srs="EPSG:4326", extra=""):
        return (f"{base}?service=WFS&version=1.1.0&request=GetFeature&typeName={layer}"
                f"&outputFormat=GML3&srsName={srs}&maxFeatures=100000{extra}")

    jkl_filter = ("&filter=" + urllib.parse.quote(
        "<Filter><PropertyIsEqualTo><PropertyName>Kaavatilanne</PropertyName>"
        "<Literal>Vireillä</Literal></PropertyIsEqualTo></Filter>"))
    tekla_jobs = [
        ("Espoo", tekla("https://kartat.espoo.fi/teklaogcweb/wfs.ashx", "GIS:Kaavoitushankkeet"),
         {"name": "KaavanNimi", "plan_id": "Kaavatunnus", "status": "Kaavatilanne", "date": "ViimVaihePvmXML", "url": "wwwFi"},
         "https://www.espoo.fi/fi/kaupunkisuunnittelu"),
        ("Turku", tekla("https://turku.asiointi.fi/TeklaOGCWeb/WFS.ashx", "GIS:Akaava_Asemakaava_alueet_vireilla"),
         {"name": "KaavanNimi", "plan_id": "Kaavatunnus", "status": "Kaavatilanne", "date": None, "url": "URL"},
         "https://www.turku.fi/asuminen-ja-ymparisto/kaupunkisuunnittelu/kaavoitus"),
        ("Jyväskylä", tekla("https://kartta.jkl.fi/teklaogcweb/wfs.ashx", "GIS:Asemakaavat", extra=jkl_filter),
         {"name": "KaavanNimi", "plan_id": "Kaavatunnus", "status": "Kaavatilanne", "date": "ViimVaihePvm", "url": None},
         "https://www.jyvaskyla.fi/kaavoitus"),
    ]

    out_features = []
    cities_ok = []
    for city, base, layer, fields, fb in geoserver_jobs:
        try:
            feats = fetch_geoserver(city, base, layer, fields, fb)
            print(f"  {city} (GeoServer): {len(feats)} vireillä plans")
            out_features += feats
            if feats:
                cities_ok.append(city)
        except Exception as e:  # noqa: BLE001
            print(f"  WARN {city}: {e}", file=sys.stderr)
    for city, url, fields, fb in tekla_jobs:
        try:
            feats = fetch_tekla(city, url, fields, fb)
            print(f"  {city} (Tekla/GML): {len(feats)} vireillä plans")
            out_features += feats
            if feats:
                cities_ok.append(city)
        except Exception as e:  # noqa: BLE001
            print(f"  WARN {city}: {e}", file=sys.stderr)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": out_features,
                    "_cities": sorted(cities_ok)}, ensure_ascii=False),
        encoding="utf-8",
    )
    # Advance the planning snapshot only on a successful fetch, so a failed/empty
    # run can't push the "tilanne <snapshot>" caption past the data it actually has.
    if out_features:
        SNAPSHOT.write_text(datetime.now(timezone.utc).date().isoformat() + "\n", encoding="utf-8")
    print(f"Wrote {len(out_features)} city plan features from {len(cities_ok)} cities "
          f"({', '.join(cities_ok)}) -> {OUT.relative_to(Path.cwd())}")
    return 0 if out_features else 1


if __name__ == "__main__":
    raise SystemExit(main())
