#!/usr/bin/env node
/**
 * Fetch the 69 Finnish seutukunta (sub-region) boundaries from Statistics
 * Finland and bake them into src/data/seutukunnat.topojson.
 *
 * This is the CF-5 Phase D1 "draw all the area lines first" layer: a single
 * Finland-wide outline dataset that gives the map structural completeness
 * before per-region postal-code data is ingested. Each boundary feature
 * carries the region ID used in src/utils/regions.ts so the app can match a
 * boundary to its region config and data-availability state.
 *
 * Also prints a per-region viewport block (center / zoom / bounds derived from
 * each seutukunta bbox) for scaffolding the not-yet-ingested regions.
 *
 * Source: Tilastokeskus WFS, layer tilastointialueet:seutukunta1000k_2025
 * (1:1,000,000 generalized, EPSG:4326). Matches scripts/seutukunnat.json.
 *
 * Usage: node scripts/build_seutukunta_boundaries.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const cachePath = resolve(rootDir, 'scripts', '_seutukunta_boundaries.json');
const tmpGeojson = resolve(rootDir, 'src', 'data', '_seutukunnat.geojson');
const tmpQuant = resolve(rootDir, 'src', 'data', '_seutukunnat_q.topojson');
const outTopojson = resolve(rootDir, 'src', 'data', 'seutukunnat.topojson');

const WFS_URL =
  'https://geo.stat.fi/geoserver/tilastointialueet/wfs?service=WFS&version=2.0.0' +
  '&request=GetFeature&typeNames=tilastointialueet:seutukunta1000k_2025' +
  '&outputFormat=application/json&srsName=EPSG:4326';

// Mapping from the 21 already-scaffolded region IDs (src/utils/regions.ts) to
// their seutukunta code. The other 48 seutukunnat get a slug derived from the
// Finnish name.
const EXISTING_REGION_BY_CODE = {
  '011': 'helsinki_metro', '023': 'turku', '064': 'tampere', '171': 'oulu',
  '131': 'jyvaskyla', '071': 'lahti', '112': 'kuopio', '043': 'pori',
  '122': 'joensuu', '091': 'lappeenranta', '152': 'vaasa', '081': 'kouvola',
  '191': 'rovaniemi', '142': 'seinajoki', '101': 'mikkeli', '082': 'kotka',
  '022': 'salo', '015': 'porvoo', '162': 'kokkola', '182': 'kajaani', '041': 'rauma',
};

/** Slugify a Finnish seutukunta name into a stable region ID. */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function getBoundaries() {
  // Prefer a fresh fetch; fall back to the cached probe file if offline.
  try {
    const res = await fetch(WFS_URL);
    if (!res.ok) throw new Error(`WFS responded ${res.status}`);
    const json = await res.json();
    writeFileSync(cachePath, JSON.stringify(json));
    console.log(`Fetched ${json.features.length} seutukunta boundaries from WFS`);
    return json;
  } catch (err) {
    if (existsSync(cachePath)) {
      console.warn(`WFS fetch failed (${err.message}), using cached ${cachePath}`);
      return JSON.parse(readFileSync(cachePath, 'utf-8'));
    }
    throw err;
  }
}

/** Bounding box [minLon, minLat, maxLon, maxLat] of a GeoJSON geometry. */
function bboxOf(geometry) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (const c of coords) visit(c);
    }
  };
  visit(geometry.coordinates);
  return [minLon, minLat, maxLon, maxLat];
}

/** Derive an approximate map zoom from a seutukunta bbox. */
function zoomFor(bbox) {
  const lonSpan = bbox[2] - bbox[0];
  const latSpan = bbox[3] - bbox[1];
  // Longitude degrees are visually ~half a latitude degree at Finnish latitudes.
  const effSpan = Math.max(lonSpan * 0.5, latSpan, 0.05);
  const zoom = 8.05 - Math.log2(effSpan);
  return Math.min(11, Math.max(5, Math.round(zoom * 10) / 10));
}

const raw = await getBoundaries();

// Canonical seutukunta → municipality codes (scripts/seutukunnat.json, keyed by
// seutukunta code). Used to emit a region-id-keyed municipalities file that
// scripts/prepare_data.py consumes.
const seutukunnatData = JSON.parse(
  readFileSync(resolve(rootDir, 'scripts', 'seutukunnat.json'), 'utf-8'),
);
const muniCodesBySeutukunta = {};
for (const s of seutukunnatData.seutukunnat) {
  muniCodesBySeutukunta[s.code] = s.municipality_codes;
}

// Assign region IDs; guard against slug collisions.
const usedIds = new Set(Object.values(EXISTING_REGION_BY_CODE));
const outFeatures = [];
const viewports = {};
const bboxes = {};
const municipalities = {};

for (const f of raw.features) {
  const code = f.properties.seutukunta;
  const nimi = f.properties.nimi;
  const namn = f.properties.namn;
  let regionId = EXISTING_REGION_BY_CODE[code];
  if (!regionId) {
    regionId = slugify(nimi);
    if (usedIds.has(regionId)) {
      throw new Error(`Region ID collision: ${regionId} (seutukunta ${code} ${nimi})`);
    }
    usedIds.add(regionId);
  }

  const bbox = bboxOf(f.geometry);
  viewports[regionId] = {
    code,
    nimi,
    namn,
    isExisting: !!EXISTING_REGION_BY_CODE[code],
    center: [
      Math.round(((bbox[0] + bbox[2]) / 2) * 1e5) / 1e5,
      Math.round(((bbox[1] + bbox[3]) / 2) * 1e5) / 1e5,
    ],
    zoom: zoomFor(bbox),
    bounds: bbox.map((v) => Math.round(v * 1e5) / 1e5),
  };
  // Overpass bbox string: "south,west,north,east" (lat,lon). bbox is
  // [minLon, minLat, maxLon, maxLat]. Pad slightly so POIs near the edge
  // are not clipped by boundary generalization.
  const r = (v) => Math.round(v * 1e4) / 1e4;
  bboxes[regionId] = [
    r(bbox[1] - 0.02), r(bbox[0] - 0.02), r(bbox[3] + 0.02), r(bbox[2] + 0.02),
  ].join(',');
  municipalities[regionId] = [...(muniCodesBySeutukunta[code] || [])].sort();

  outFeatures.push({
    type: 'Feature',
    properties: { region: regionId, seutukunta: code, nimi, namn },
    geometry: f.geometry,
  });
}

console.log(`Assigned region IDs to ${outFeatures.length} seutukunnat`);

// Write intermediate GeoJSON, quantize + simplify into the final topojson.
writeFileSync(tmpGeojson, JSON.stringify({ type: 'FeatureCollection', features: outFeatures }));
// Quote paths so spaces in the checkout path don't break the shell command.
// Quantize to a ~1e4 grid (≈137 m lon / 115 m lat at Finnish latitudes). This is
// strictly sub-pixel at the zoom levels the outlines render at (5–7; a zoom-7 pixel is
// ≈575 m here), so there is no visible degradation, but it shrinks the largest
// first-paint asset by ~37% over the wire vs the previous -q 1e5. Vertex topology is
// preserved; only coordinate precision drops.
execSync(
  `npx -p topojson-server geo2topo -q 1e4 seutukunnat="${tmpGeojson}" > "${tmpQuant}"`,
  { stdio: 'inherit' },
);
execSync(
  `npx -p topojson-simplify toposimplify -p 1e-6 -f "${tmpQuant}" > "${outTopojson}"`,
  { stdio: 'inherit' },
);
unlinkSync(tmpGeojson);
unlinkSync(tmpQuant);

// Emit the viewport block for regions.ts scaffolding.
const viewportsPath = resolve(rootDir, 'scripts', '_seutukunta_viewports.json');
writeFileSync(viewportsPath, JSON.stringify(viewports, null, 2));

// Emit per-region Overpass bboxes + municipality codes — both region-id-keyed,
// consumed by scripts/prepare_data.py when ingesting a region's data.
const bboxesPath = resolve(rootDir, 'scripts', 'seutukunta_bboxes.json');
writeFileSync(bboxesPath, JSON.stringify(bboxes, null, 2));
const muniPath = resolve(rootDir, 'scripts', 'seutukunta_municipalities.json');
writeFileSync(muniPath, JSON.stringify(municipalities, null, 2));

console.log(`Wrote ${outTopojson}`);
console.log(`Wrote ${viewportsPath} (${Object.keys(viewports).length} region viewports)`);
console.log(`Wrote ${bboxesPath} (${Object.keys(bboxes).length} region bboxes)`);
console.log(`Wrote ${muniPath} (${Object.keys(municipalities).length} region municipality sets)`);
