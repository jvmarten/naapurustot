#!/usr/bin/env node
/**
 * IN-1: Build the kaavat & hankkeet (zoning plans + infrastructure projects)
 * datasets the app and prerender consume, from the committed raw fetches
 * (fetch_vayla_projects.py + fetch_city_zoning.py) and the postal polygons in
 * metro_neighborhoods.geojson. Network-free transform — runs inside build:data.
 *
 * Emits:
 *   - scripts/area_planning.json — per-pno list of nearby entries (a build input
 *     read at prerender, NEVER shipped — same pattern as scripts/flood_risk.json).
 *   - public/data/planning_projects_shards/planning_projects_{region}.geojson
 *       (Väylä state projects — national coverage)
 *   - public/data/planning_plans_shards/planning_plans_{region}.geojson
 *       (municipal vireillä asemakaava — partial coverage, participating cities)
 *   - src/data/planning_manifest.json — per-region presence, scope flags and the
 *     snapshot date (read by usePlanningData and the planning controls).
 *
 * "Nearby" = the planning features that geometrically intersect the postal
 * polygon (real geometry, never proxied). Region sharding uses the same
 * seutukunta ids as the grid shards (feature.properties.city), so usePlanningData
 * fetches a region's planning shard exactly like a grid shard. Features that
 * intersect no postal polygon (e.g. an offshore waterway corridor) fall back to
 * the tightest seutukunta bbox containing their centroid so the map still shows
 * them.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bbox as turfBbox } from '@turf/bbox';
import { booleanIntersects } from '@turf/boolean-intersects';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = resolve(ROOT, 'scripts', 'planning_raw');
const GEOJSON = resolve(ROOT, 'public', 'data', 'metro_neighborhoods.geojson');
const PROJECTS_SHARD_DIR = resolve(ROOT, 'public', 'data', 'planning_projects_shards');
const PLANS_SHARD_DIR = resolve(ROOT, 'public', 'data', 'planning_plans_shards');
const AREA_SHARD_DIR = resolve(ROOT, 'public', 'data', 'planning_area_shards');
const AREA_PLANNING_OUT = resolve(ROOT, 'scripts', 'area_planning.json');
const MANIFEST_OUT = resolve(ROOT, 'src', 'data', 'planning_manifest.json');

const MAX_ENTRIES_PER_PNO = 12;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const bboxesOverlap = (a, b) =>
  !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

// Seutukunta bboxes → tightest-fit region for a centroid (the grid-shard rule),
// used only as a fallback for features that intersect no postal polygon.
const seutuBboxes = readJson(resolve(ROOT, 'scripts', 'seutukunta_bboxes.json'));
const REGION_BBOXES = Object.entries(seutuBboxes).map(([id, s]) => {
  const [minLat, minLon, maxLat, maxLon] = String(s).split(',').map(Number);
  return { id, minLon, minLat, maxLon, maxLat, area: (maxLon - minLon) * (maxLat - minLat) };
});
function regionForCentroid(lon, lat) {
  let best = null;
  for (const r of REGION_BBOXES) {
    if (lon >= r.minLon && lon <= r.maxLon && lat >= r.minLat && lat <= r.maxLat) {
      if (!best || r.area < best.area) best = r;
    }
  }
  return best?.id ?? null;
}
function featureCentroid(b) {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

// ── Load postal polygons (with their region id) ──────────────────────────────
console.log('Reading postal polygons...');
const postal = readJson(GEOJSON).features
  .filter((f) => f.geometry && f.properties?.pno)
  .map((f) => ({
    pno: f.properties.pno,
    region: f.properties.city || 'other',
    feature: f,
    bbox: turfBbox(f),
  }));
console.log(`  ${postal.length} postal polygons`);

// ── Load raw planning features ───────────────────────────────────────────────
function loadRaw(name) {
  const p = resolve(RAW_DIR, name);
  if (!existsSync(p)) {
    console.warn(`  (no ${name} — shipping without it)`);
    return { features: [], meta: {} };
  }
  const fc = readJson(p);
  return { features: fc.features ?? [], meta: { cities: fc._cities ?? [] } };
}
const projects = loadRaw('vayla_projects.geojson');
const plans = loadRaw('city_plans.geojson');
console.log(`  ${projects.features.length} projects, ${plans.features.length} city plans`);

// ── Intersect each planning feature with postal polygons ─────────────────────
const areaPlanning = {}; // pno -> entries[]
const projectRegions = new Map(); // region -> features[]
const planRegions = new Map();

function pushRegion(map, region, feat) {
  if (!map.has(region)) map.set(region, []);
  map.get(region).push(feat);
}

function process(feature, regionMap) {
  const fb = turfBbox(feature);
  const matchedRegions = new Set();
  let matchedAny = false;
  for (const pc of postal) {
    if (!bboxesOverlap(fb, pc.bbox)) continue;
    let hit = false;
    try {
      hit = booleanIntersects(feature, pc.feature);
    } catch {
      hit = false; // malformed geometry → skip this pair, never fabricate a match
    }
    if (!hit) continue;
    matchedAny = true;
    matchedRegions.add(pc.region);
    (areaPlanning[pc.pno] ||= []).push(feature.properties);
  }
  if (matchedRegions.size === 0) {
    // No postal intersection — fall back to the centroid's seutukunta so the
    // overlay still renders it (e.g. offshore waterway corridors).
    const r = regionForCentroid(...featureCentroid(fb));
    if (r) matchedRegions.add(r);
  }
  for (const r of matchedRegions) pushRegion(regionMap, r, feature);
  return matchedAny;
}

console.log('Intersecting projects...');
for (const f of projects.features) process(f, projectRegions);
console.log('Intersecting city plans...');
for (const f of plans.features) process(f, planRegions);

// ── Per-pno list: plans first (most local), then projects; newest first; capped ─
const RANK = { plan: 0, project: 1 };
const dateKey = (e) => (e.date ? String(e.date) : '');
let pnoWithData = 0;
for (const pno of Object.keys(areaPlanning)) {
  const list = areaPlanning[pno];
  list.sort((a, b) => (RANK[a.kind] - RANK[b.kind]) || dateKey(b).localeCompare(dateKey(a)));
  areaPlanning[pno] = list.slice(0, MAX_ENTRIES_PER_PNO).map((e) => ({
    name: e.name, kind: e.kind, ptype: e.ptype, subtype: e.subtype,
    status: e.status, date: e.date ?? null, url: e.url, source: e.source,
  }));
  pnoWithData += 1;
}

// Round coordinates to ~1 m (5 decimals) — these are line/polygon overlays, so
// sub-metre precision is invisible on the map but inflates the lazy shard fetch.
function roundCoords(c) {
  if (typeof c[0] === 'number') return [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];
  return c.map(roundCoords);
}
function roundedFeature(f) {
  return { ...f, geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates) } };
}

// ── Write shards (one file per region) ───────────────────────────────────────
function writeShards(dir, stem, regionMap) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const counts = {};
  for (const [region, feats] of [...regionMap.entries()].sort()) {
    writeFileSync(
      resolve(dir, `${stem}_${region}.geojson`),
      JSON.stringify({ type: 'FeatureCollection', features: feats.map(roundedFeature) }),
    );
    counts[region] = feats.length;
  }
  return counts;
}
const projectCounts = writeShards(PROJECTS_SHARD_DIR, 'planning_projects', projectRegions);
const planCounts = writeShards(PLANS_SHARD_DIR, 'planning_plans', planRegions);

// ── area_planning.json (build input; never shipped) ──────────────────────────
writeFileSync(AREA_PLANNING_OUT, JSON.stringify(areaPlanning, null, 0) + '\n');

// ── Per-region pno→entries shards for the in-app panel (CF-3) ─────────────────
// A free lazy asset fetched only when a panel is open: keeps per-area planning
// OUT of region_properties.json's ~10.6 MB first-paint payload while giving the
// panel the exact same entries the prerendered profiles show (one source).
const pnoRegion = new Map(postal.map((p) => [p.pno, p.region]));
const areaByRegion = {};
for (const [pno, entries] of Object.entries(areaPlanning)) {
  const r = pnoRegion.get(pno) || 'other';
  (areaByRegion[r] ||= {})[pno] = entries;
}
rmSync(AREA_SHARD_DIR, { recursive: true, force: true });
mkdirSync(AREA_SHARD_DIR, { recursive: true });
const areaCounts = {};
for (const [region, map] of Object.entries(areaByRegion).sort()) {
  writeFileSync(resolve(AREA_SHARD_DIR, `planning_area_${region}.json`), JSON.stringify(map));
  areaCounts[region] = Object.keys(map).length;
}

// ── manifest ─────────────────────────────────────────────────────────────────
// Snapshot date drives the honest "tilanne <snapshot>" coverage caption.
const snapshot = new Date().toISOString().slice(0, 10);
const manifest = {
  snapshot,
  projects: {
    scope: 'national',
    shardPattern: 'data/planning_projects_shards/planning_projects_{region}.geojson',
    total: projects.features.length,
    regions: projectCounts,
  },
  plans: {
    scope: 'partial',
    shardPattern: 'data/planning_plans_shards/planning_plans_{region}.geojson',
    total: plans.features.length,
    cities: plans.meta.cities ?? [],
    regions: planCounts,
  },
  // CF-3: per-region pno→entries shards for the in-app panel list.
  area: {
    shardPattern: 'data/planning_area_shards/planning_area_{region}.json',
    regions: areaCounts,
  },
};
writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2) + '\n');

console.log(
  `Done. ${pnoWithData} postal codes have nearby planning; ` +
    `projects in ${Object.keys(projectCounts).length} regions, ` +
    `plans in ${Object.keys(planCounts).length} regions (cities: ${(plans.meta.cities ?? []).join(', ')}); ` +
    `snapshot ${snapshot}.`,
);
