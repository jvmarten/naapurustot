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
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const geojsonPath = resolve(rootDir, 'public', 'data', 'metro_neighborhoods.geojson');
const regionsDir = resolve(rootDir, 'src', 'data', 'regions');
const propertiesOutput = resolve(rootDir, 'src', 'data', 'region_properties.json');

// Ensure regions output directory exists
mkdirSync(regionsDir, { recursive: true });

if (!existsSync(geojsonPath)) {
  console.error(`Source GeoJSON not found: ${geojsonPath}`);
  process.exit(1);
}

console.log('Reading source GeoJSON...');
const geojson = JSON.parse(readFileSync(geojsonPath, 'utf-8'));
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

  // Convert to TopoJSON
  console.log(`  ${regionId}: ${regionFeatures.length} features → ${regionId}.topojson`);
  // Double-quote interpolated paths so a checkout path containing spaces (common
  // on dev/CI machines, e.g. "C:\Users\First Last\...") doesn't make the shell
  // split the input/redirect target and silently corrupt or skip the output.
  execSync(`npx -p topojson-server geo2topo neighborhoods="${tempPath}" > "${topoPath}"`, {
    stdio: 'inherit',
  });

  // Clean up temporary GeoJSON
  unlinkSync(tempPath);
}

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
const metadataPath = resolve(rootDir, 'src', 'data', 'build_metadata.json');
const buildMetadata = { generated: new Date().toISOString() };
const metadataJson = JSON.stringify(buildMetadata, null, 2) + '\n';
writeFileSync(metadataPath, metadataJson);
// IN-4: also expose it as a static asset (public/data → /data/build_metadata.json)
// so the health-check workflow can read the deployed data-freshness timestamp.
writeFileSync(resolve(rootDir, 'public', 'data', 'build_metadata.json'), metadataJson);
console.log(`  → build_metadata.json (generated ${buildMetadata.generated})`);

console.log('Done! Per-region TopoJSON files written to src/data/regions/, coverage to src/data/region_coverage.json');
