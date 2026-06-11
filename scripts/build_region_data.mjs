#!/usr/bin/env node
/**
 * Split the monolithic metro_neighborhoods.geojson into per-region TopoJSON files.
 *
 * Reads the main GeoJSON, groups features by their `city` property (which maps
 * to region IDs), and writes a separate TopoJSON file for each region into
 * src/data/regions/. Also writes src/data/region_properties.json — a
 * geometry-stripped properties array used as the all-cities aggregation input.
 *
 * Also computes per-region metric coverage into src/data/region_coverage.json.
 *
 * The "all cities" view geometry comes from src/data/seutukunnat.topojson
 * (all 69 official seutukunta boundaries) — see scripts/build_seutukunta_boundaries.mjs.
 *
 * Usage: node scripts/build_region_data.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildAdjacencyFromRegions } from './lib/adjacency.mjs';
import { computeDataUpdateEvents, mergeDataUpdates } from './lib/data-updates.mjs';

const rootDir = resolve(import.meta.dirname, '..');
const geojsonPath = resolve(rootDir, 'public', 'data', 'metro_neighborhoods.geojson');
const regionsDir = resolve(rootDir, 'src', 'data', 'regions');
const propertiesOutput = resolve(rootDir, 'src', 'data', 'region_properties.json');
const payloadManifestPath = resolve(rootDir, 'src', 'data', 'region_payload_manifest.json');

// Ensure regions output directory exists
mkdirSync(regionsDir, { recursive: true });

if (!existsSync(geojsonPath)) {
  console.error(`Source GeoJSON not found: ${geojsonPath}`);
  process.exit(1);
}

console.log('Reading source GeoJSON...');
const geojsonRaw = readFileSync(geojsonPath, 'utf-8');
const geojson = JSON.parse(geojsonRaw);
const features = geojson.features;
console.log(`  ${features.length} features total`);

// Group features by city (region) property. Features without a known region
// are grouped under "other" (e.g., postal codes outside configured metro areas
// when running with --all-finland).
const byRegion = new Map();
for (const feature of features) {
  const city = feature.properties?.city || 'other';
  const key = city === 'unknown' ? 'other' : city;
  if (!byRegion.has(key)) byRegion.set(key, []);
  byRegion.get(key).push(feature);
}

console.log(`  ${byRegion.size} region(s) found: ${[...byRegion.keys()].join(', ')}`);

// IN-6: per-region payload sizes for a committed, diffable manifest. For each
// emitted TopoJSON we record its raw byte length and its gzipped byte length
// (fixed level 9 so the value is reproducible across machines/runs), plus the
// feature count. Shipping both raw + gzip means a regression in either the
// on-disk artifact or what the CDN actually serves over the wire shows up in
// the diff. The CI "Region geodata payload report" step prints live dist sizes;
// this manifest is the committed baseline those numbers can be checked against.
const payloadByRegion = {};

// Write per-region GeoJSON and convert to TopoJSON
for (const [regionId, regionFeatures] of byRegion) {
  const regionGeojson = {
    type: 'FeatureCollection',
    features: regionFeatures,
  };

  // Write temporary GeoJSON
  const tempPath = resolve(regionsDir, `${regionId}.geojson`);
  const topoPath = resolve(regionsDir, `${regionId}.topojson`);
  writeFileSync(tempPath, JSON.stringify(regionGeojson));

  // Convert to TopoJSON.
  console.log(`  ${regionId}: ${regionFeatures.length} features → ${regionId}.topojson`);
  // IN-6b: quantize coordinates with -q 1e5 (same lever as build_seutukunta_boundaries.mjs).
  // Quantization snaps coordinates to an integer grid within each region's own bbox,
  // which lets TopoJSON delta-encode them — a large payload win on the map hot path.
  // At 1e5 over a single region's extent the grid step is sub-metre to a few metres,
  // far finer than the rendered border needs, so no visible boundary change. We do NOT
  // run toposimplify here: removing points would visibly alter small/intricate postal
  // polygons, and quantization alone captures most of the saving losslessly-in-practice.
  // Double-quote interpolated paths so a checkout path containing spaces (common
  // on dev/CI machines, e.g. "C:\Users\First Last\...") doesn't make the shell
  // split the input/redirect target and silently corrupt or skip the output.
  execSync(`npx -p topojson-server geo2topo -q 1e5 neighborhoods="${tempPath}" > "${topoPath}"`, {
    stdio: 'inherit',
  });

  // IN-6: measure the emitted TopoJSON. Read the bytes geo2topo just wrote
  // (rather than re-serializing) so the recorded raw size is exactly the
  // committed artifact, then gzip at a fixed level for a reproducible figure.
  const topoBuffer = readFileSync(topoPath);
  payloadByRegion[regionId] = {
    topojson_bytes: topoBuffer.length,
    gzip_bytes: gzipSync(topoBuffer, { level: 9 }).length,
    feature_count: regionFeatures.length,
  };

  // Clean up temporary GeoJSON
  unlinkSync(tempPath);
}

// IN-6: write the payload manifest with deterministically sorted region keys
// and a top-level total, matching the stable-diff convention used for
// grid_manifest.json / region_coverage.json (sorted keys, 2-space indent,
// trailing newline).
const sortedPayload = {};
let totalTopojsonBytes = 0;
let totalGzipBytes = 0;
let totalFeatureCount = 0;
for (const regionId of Object.keys(payloadByRegion).sort()) {
  sortedPayload[regionId] = payloadByRegion[regionId];
  totalTopojsonBytes += payloadByRegion[regionId].topojson_bytes;
  totalGzipBytes += payloadByRegion[regionId].gzip_bytes;
  totalFeatureCount += payloadByRegion[regionId].feature_count;
}
const payloadManifest = {
  total: {
    regions: Object.keys(sortedPayload).length,
    topojson_bytes: totalTopojsonBytes,
    gzip_bytes: totalGzipBytes,
    feature_count: totalFeatureCount,
  },
  regions: sortedPayload,
};
writeFileSync(payloadManifestPath, JSON.stringify(payloadManifest, null, 2) + '\n');
console.log(
  `  → region_payload_manifest.json (${payloadManifest.total.regions} regions, ` +
    `${totalTopojsonBytes} raw / ${totalGzipBytes} gzip bytes)`,
);

// CF-12: postal-code adjacency graph (pno -> [neighbor pnos]) derived from the
// just-written region TopoJSON arc-sharing. Shared arcs encode shared borders,
// so this is exact and free of geometry math. Within-region only (we never ship
// a combined topology), keyed by the globally-unique postal code. Emitted both
// as a bundleable source JSON and a static /data asset for the lazy fetch path.
console.log('Building postal-code adjacency graph from TopoJSON arc-sharing...');
const adjacency = buildAdjacencyFromRegions(regionsDir);
const adjacencyJson = JSON.stringify(adjacency);
writeFileSync(resolve(rootDir, 'src', 'data', 'adjacency.json'), adjacencyJson + '\n');
const adjKeys = Object.keys(adjacency).length;
console.log(
  `  → adjacency.json (${adjKeys} postal codes, ` +
    `${adjacencyJson.length} raw / ${gzipSync(adjacencyJson, { level: 9 }).length} gzip bytes)`,
);

// CF-5: properties-only dataset for the "all cities" view. That view
// aggregates per-region stats and takes its geometry from seutukunnat.topojson,
// so it never needs the ~3000 postal-code polygons — shipping them as a
// combined TopoJSON was ~35 MB of dead weight. The properties array is a
// fraction of that.
console.log('Writing region_properties.json (all-cities aggregation input)...');
writeFileSync(propertiesOutput, JSON.stringify(features.map((f) => f.properties)));

// CF-5 Phase C: pre-compute per-region metric coverage so the CitySelector can
// surface honest data-density expectations before users click in. A metric is
// considered "present" for a region when >= COVERAGE_THRESHOLD of the region's
// features have a non-null, non-empty value for that property. Identifier and
// derived fields are excluded. The "total" denominator is the union of metrics
// that meet the threshold in at least one region.
console.log('Computing per-region metric coverage...');
const COVERAGE_THRESHOLD = 0.5;
const EXCLUDED_PROPS = new Set([
  'pno', 'postinumeroalue', 'nimi', 'namn', 'kunta', 'city',
  'quality_index', 'quality_breakdown',
  'income_change', 'population_change', 'unemployment_change',
  'population_history', 'income_history', 'unemployment_history',
  // CF-7: property-price & crime time-series arrays are trend data, not a
  // coverage metric — exclude from the per-region density count.
  'property_price_history', 'crime_index_history',
]);

function isMeaningful(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

const presentByRegion = new Map();
const allMetricKeys = new Set();

for (const [regionId, regionFeatures] of byRegion) {
  if (regionId === 'other' || regionId === 'unknown') continue;

  const propCounts = new Map();
  for (const f of regionFeatures) {
    const props = f.properties || {};
    for (const key of Object.keys(props)) {
      if (EXCLUDED_PROPS.has(key)) continue;
      if (key.startsWith('_')) continue;
      if (isMeaningful(props[key])) {
        propCounts.set(key, (propCounts.get(key) || 0) + 1);
      }
    }
  }

  const total = regionFeatures.length;
  const present = new Set();
  for (const [key, count] of propCounts) {
    if (count / total >= COVERAGE_THRESHOLD) {
      present.add(key);
      allMetricKeys.add(key);
    }
  }
  presentByRegion.set(regionId, present);
}

const totalMetrics = allMetricKeys.size;
const coverageManifest = {};
for (const [regionId, present] of presentByRegion) {
  coverageManifest[regionId] = {
    present: present.size,
    total: totalMetrics,
  };
}

const coveragePath = resolve(rootDir, 'src', 'data', 'region_coverage.json');
writeFileSync(coveragePath, JSON.stringify(coverageManifest, null, 2));
console.log(`  → region_coverage.json (${Object.keys(coverageManifest).length} regions, ${totalMetrics} metric universe)`);
for (const [regionId, { present, total }] of Object.entries(coverageManifest)) {
  console.log(`    ${regionId}: ${present}/${total} metrics`);
}

// QW-1: build-derived data-freshness timestamp. Written once per build:data run
// and committed alongside the other data artifacts (region_coverage.json etc.),
// so the SettingsDropdown "Data last updated" label reflects the real last data
// build instead of a hand-edited, drift-prone string. `npm run build` (the deploy
// build) does not run build:data, so this value stays pinned to the data refresh.
// IN-3b: build-time provenance manifest. For every registry metric actually
// stored in the GeoJSON, record its source/vintage/granularity/proxy flag (from
// data_sources.json) alongside the real row count and coverage % computed from the
// features here. This gives every shipped metric a dated, machine-readable
// provenance record — a defensible audit trail and the input for the per-layer
// freshness panel — without re-running the (network-bound) Python pipeline.
const registryPath = resolve(rootDir, 'src', 'data', 'data_sources.json');
const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
const provenanceMetrics = {};
for (const [metric, meta] of Object.entries(registry.metrics ?? {})) {
  if (meta.stored === false) continue; // client-derived (e.g. quality index): no stored column
  let count = 0;
  for (const f of features) {
    if (isMeaningful((f.properties ?? {})[metric])) count += 1;
  }
  provenanceMetrics[metric] = {
    source: meta.source,
    vintage: meta.vintage,
    granularity: meta.granularity,
    is_proxy: Boolean(meta.is_proxy),
    row_count: count,
    coverage_pct: features.length ? Math.round((count / features.length) * 1000) / 10 : 0,
  };
}
const sortedProvenanceMetrics = {};
for (const k of Object.keys(provenanceMetrics).sort()) sortedProvenanceMetrics[k] = provenanceMetrics[k];

const metadataPath = resolve(rootDir, 'src', 'data', 'build_metadata.json');
// IN-5: derive `generated` from a hash of the source GeoJSON content instead of
// Date.now(). This makes build:data idempotent — re-running it against unchanged
// data reproduces a byte-identical build_metadata.json, which is what the
// auto-merge idempotency gate (`git diff --exit-code src/data`) checks, and it
// mechanically enforces the CLAUDE.md "never skip build:data" rule. It is also the
// correct semantics for the "Data last updated" label: the timestamp only advances
// when the underlying data actually changes. The timestamp is captured the first
// time a given dataset is built (during the data refresh) and then preserved across
// rebuilds of the same data.
const sourceHash = createHash('sha256').update(geojsonRaw).digest('hex').slice(0, 16);
let prevMetadata = {};
try { prevMetadata = JSON.parse(readFileSync(metadataPath, 'utf-8')); } catch { /* first build */ }
const generated =
  prevMetadata.source_hash === sourceHash && typeof prevMetadata.generated === 'string'
    ? prevMetadata.generated
    : new Date().toISOString();
const buildMetadata = {
  generated,
  source_hash: sourceHash,
  rows_total: features.length,
  metrics: sortedProvenanceMetrics,
};
// PO-5: append real data-change events (vintage/coverage shifts vs the PREVIOUS
// build_metadata, read before we overwrite it) to the committed data_updates.json,
// which drives the indexable "Data updated" changelog and the Atom feed. Real build
// events only — no fabricated dates. On an unchanged rebuild this is a no-op.
const dataUpdatesPath = resolve(rootDir, 'src', 'data', 'data_updates.json');
const prevMetrics = prevMetadata.metrics ?? {};
let dataUpdates = [];
try { dataUpdates = JSON.parse(readFileSync(dataUpdatesPath, 'utf-8')); } catch { /* none yet */ }
const updateEvents = computeDataUpdateEvents(prevMetrics, sortedProvenanceMetrics, buildMetadata.generated.slice(0, 10));
const mergedUpdates = mergeDataUpdates(dataUpdates, updateEvents);
writeFileSync(dataUpdatesPath, JSON.stringify(mergedUpdates, null, 2) + '\n');
if (updateEvents.length > 0) console.log(`  → data_updates.json (+${updateEvents.length} change events)`);

const metadataJson = JSON.stringify(buildMetadata, null, 2) + '\n';
writeFileSync(metadataPath, metadataJson);
// IN-4: also expose it as a static asset (public/data → /data/build_metadata.json)
// so the health-check workflow can read the deployed data-freshness timestamp.
writeFileSync(resolve(rootDir, 'public', 'data', 'build_metadata.json'), metadataJson);
console.log(`  → build_metadata.json (generated ${buildMetadata.generated})`);

console.log('Done! Per-region TopoJSON files written to src/data/regions/, coverage to src/data/region_coverage.json');
