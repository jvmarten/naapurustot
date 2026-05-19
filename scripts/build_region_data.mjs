#!/usr/bin/env node
/**
 * Split the monolithic metro_neighborhoods.geojson into per-region TopoJSON files.
 *
 * Reads the main GeoJSON, groups features by their `city` property (which maps
 * to region IDs), and writes a separate TopoJSON file for each region into
 * src/data/regions/. Also writes a combined file (metro_neighborhoods.topojson)
 * for backward compatibility and for the "all" view.
 *
 * In addition, pre-bakes a dissolved outer outline per region into
 * src/data/region_outlines.topojson. This is consumed by src/utils/metroAreas.ts
 * to render the "all cities" view without running @turf/union at runtime
 * (CF-5 Phase B; eliminates the most fragile client-side path per CLAUDE.md
 * pitfalls #1-#4).
 *
 * Usage: node scripts/build_region_data.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import unionPkg from '@turf/union';
const union = unionPkg.default ?? unionPkg;

const rootDir = resolve(import.meta.dirname, '..');
const geojsonPath = resolve(rootDir, 'public', 'data', 'metro_neighborhoods.geojson');
const regionsDir = resolve(rootDir, 'src', 'data', 'regions');
const combinedOutput = resolve(rootDir, 'src', 'data', 'metro_neighborhoods.topojson');
const outlinesGeojsonPath = resolve(rootDir, 'src', 'data', 'region_outlines.geojson');
const outlinesTopojsonPath = resolve(rootDir, 'src', 'data', 'region_outlines.topojson');

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
  execSync(`npx -p topojson-server geo2topo neighborhoods=${tempPath} > ${topoPath}`, {
    stdio: 'inherit',
  });

  // Clean up temporary GeoJSON
  unlinkSync(tempPath);
}

// Also build the combined TopoJSON (backward compat + "all" view)
console.log('Building combined metro_neighborhoods.topojson...');
execSync(
  `npx -p topojson-server geo2topo neighborhoods=${geojsonPath} > ${combinedOutput}`,
  { stdio: 'inherit' },
);

// CF-5 Phase B: pre-bake region outer outlines so the "all cities" view does
// not need to run @turf/union at runtime. Skips the "other" / "unknown" bucket.
console.log('Pre-baking region outlines (dissolved outer boundaries)...');
const outlineFeatures = [];
for (const [regionId, regionFeatures] of byRegion) {
  if (regionId === 'other' || regionId === 'unknown') continue;

  const polyFeatures = regionFeatures.filter((f) => {
    const tp = f.geometry?.type;
    return tp === 'Polygon' || tp === 'MultiPolygon';
  });
  if (polyFeatures.length === 0) {
    console.log(`  ${regionId}: skipped (no polygon features)`);
    continue;
  }

  let merged;
  if (polyFeatures.length === 1) {
    merged = { type: 'Feature', properties: {}, geometry: polyFeatures[0].geometry };
  } else {
    merged = union({ type: 'FeatureCollection', features: polyFeatures });
  }

  if (!merged) {
    console.log(`  ${regionId}: union returned null, skipped`);
    continue;
  }

  outlineFeatures.push({
    type: 'Feature',
    properties: { city: regionId, _isMetroArea: true },
    geometry: merged.geometry,
  });
  console.log(`  ${regionId}: outline baked (${polyFeatures.length} polygons dissolved)`);
}

const outlinesGeojson = { type: 'FeatureCollection', features: outlineFeatures };
writeFileSync(outlinesGeojsonPath, JSON.stringify(outlinesGeojson));
// Pre-quantize to 1e5 grid (sub-meter precision at country scale) and simplify
// to drop pixel-scale vertices. Region outlines are only used for the all-cities
// outer-boundary line layer; preserving every postal-code vertex is wasted bytes.
const tmpQuant = resolve(rootDir, 'src', 'data', '_region_outlines_q.topojson');
execSync(
  `npx -p topojson-server geo2topo -q 1e5 outlines=${outlinesGeojsonPath} > ${tmpQuant}`,
  { stdio: 'inherit' },
);
execSync(
  `npx -p topojson-simplify toposimplify -p 1e-6 -f ${tmpQuant} > ${outlinesTopojsonPath}`,
  { stdio: 'inherit' },
);
unlinkSync(tmpQuant);
unlinkSync(outlinesGeojsonPath);
console.log(`  → region_outlines.topojson (${outlineFeatures.length} regions)`);

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

console.log('Done! Per-region TopoJSON files written to src/data/regions/, outlines to src/data/region_outlines.topojson, coverage to src/data/region_coverage.json');
