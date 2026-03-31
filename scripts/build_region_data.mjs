#!/usr/bin/env node
/**
 * Split the monolithic metro_neighborhoods.geojson into per-region TopoJSON files.
 *
 * Reads the main GeoJSON, groups features by their `city` property (which maps
 * to region IDs), and writes a separate TopoJSON file for each region into
 * src/data/regions/. Also writes a combined file (metro_neighborhoods.topojson)
 * for backward compatibility and for the "all" view.
 *
 * Usage: node scripts/build_region_data.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const geojsonPath = resolve(rootDir, 'public', 'data', 'metro_neighborhoods.geojson');
const regionsDir = resolve(rootDir, 'src', 'data', 'regions');
const combinedOutput = resolve(rootDir, 'src', 'data', 'metro_neighborhoods.topojson');

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
  execSync(`rm ${tempPath}`);
}

// Also build the combined TopoJSON (backward compat + "all" view)
console.log('Building combined metro_neighborhoods.topojson...');
execSync(
  `npx -p topojson-server geo2topo neighborhoods=${geojsonPath} > ${combinedOutput}`,
  { stdio: 'inherit' },
);

console.log('Done! Per-region TopoJSON files written to src/data/regions/');
