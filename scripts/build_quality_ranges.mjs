#!/usr/bin/env node
/**
 * Compute nationwide min/max/avg for every numeric neighborhood property and
 * write src/data/quality_ranges.json.
 *
 * The Quality Index min-max normalizes each metric. Single-region views load
 * only one seutukunta's data file, so at runtime they cannot see the rest of
 * the country — normalizing against the loaded features alone makes a postal
 * code's score relative to its sub-region, not comparable nationwide. This
 * precomputed file supplies the national ranges so every region's scores sit
 * on one common scale.
 *
 * Mirrors collectRange() in src/utils/qualityIndex.ts — notably the rule that
 * non-positive hr_mtu (median income) values are treated as missing.
 *
 * Run as part of `npm run build:data`. Usage: node scripts/build_quality_ranges.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const geojsonPath = resolve(rootDir, 'public', 'data', 'metro_neighborhoods.geojson');
const output = resolve(rootDir, 'src', 'data', 'quality_ranges.json');

console.log('Reading source GeoJSON...');
const geojson = JSON.parse(readFileSync(geojsonPath, 'utf-8'));
const features = geojson.features;
console.log(`  ${features.length} features`);

// quality_index / quality_breakdown are derived client-side from the other
// metrics — they must never be treated as an input range.
const EXCLUDED = new Set(['quality_index', 'quality_breakdown']);

const acc = new Map(); // prop -> { min, max, sum, count }

for (const f of features) {
  const props = f.properties;
  if (!props) continue;
  for (const key of Object.keys(props)) {
    if (EXCLUDED.has(key)) continue;
    const v = props[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    // Mirror collectRange(): non-positive median income is missing data.
    if (key === 'hr_mtu' && v <= 0) continue;
    let a = acc.get(key);
    if (!a) {
      a = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
      acc.set(key, a);
    }
    if (v < a.min) a.min = v;
    if (v > a.max) a.max = v;
    a.sum += v;
    a.count++;
  }
}

// Sort keys for a stable, diff-friendly file.
const ranges = {};
for (const [key, a] of [...acc].sort(([x], [y]) => x.localeCompare(y))) {
  if (a.count === 0) continue;
  ranges[key] = { min: a.min, max: a.max, avg: a.sum / a.count };
}

writeFileSync(output, JSON.stringify(ranges, null, 2) + '\n');
console.log(`  → src/data/quality_ranges.json (${Object.keys(ranges).length} metrics)`);
