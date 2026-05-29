#!/usr/bin/env node
/**
 * Compute national reference ranges for Quality Index normalization (CF-1 phase C).
 *
 * The map lazy-loads one seutukunta's postal codes at a time, so the client can
 * never see all ~3018 postal codes at once and therefore cannot compute a
 * nation-wide min/max on the fly. This script pre-computes, for every numeric
 * property, the national distribution across all postal codes and writes it to
 * src/data/national_ranges.json. `computeQualityIndices` reads it so a score of
 * "72" means the same thing in Helsinki and Oulu — the default normalization
 * scope — while the "within region" toggle still recomputes locally.
 *
 * Source of truth is src/data/region_properties.json (the geometry-stripped
 * national properties array already produced by build_region_data.mjs), so this
 * needs no network access and stays in lockstep with the shipped data.
 *
 * Normalization bounds are winsorized to the 2nd/98th percentile: a single
 * extreme postal code (e.g. a CBD property price far above everywhere else)
 * must not compress the entire rest of the country into a narrow band. The raw
 * min/max are kept alongside for transparency. The mean is the missing-data
 * fallback used by getFactorScore.
 *
 * Usage: node scripts/build_national_ranges.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const propertiesPath = resolve(rootDir, 'src', 'data', 'region_properties.json');
const outputPath = resolve(rootDir, 'src', 'data', 'national_ranges.json');

// Winsorization tails. p2/p98 trims the most extreme 2% on each side so a lone
// outlier postal code cannot dominate the scale. Mirror this constant in any
// documentation that explains the methodology.
const LOWER_PCT = 0.02;
const UPPER_PCT = 0.98;

// Identifier / non-metric fields that must never be normalized. quality_index is
// derived (not present in the source), but guard it anyway so a future change
// that persists it can't make the index normalize against itself.
const ID_FIELDS = new Set([
  'id', 'pno', 'postinumeroalue', 'nimi', 'namn', 'kunta', 'city',
  'vuosi', 'euref_x', 'euref_y', 'quality_index',
]);

/** Percentile (linear interpolation) over an already-sorted ascending array. */
function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

console.log('Reading region_properties.json...');
const props = JSON.parse(readFileSync(propertiesPath, 'utf-8'));
console.log(`  ${props.length} postal codes`);

// Collect every finite numeric value per property, mirroring collectRange in
// src/utils/qualityIndex.ts exactly (including the hr_mtu <= 0 exclusion, which
// drops sentinel/suppressed income values).
const valuesByProp = new Map();
for (const p of props) {
  if (!p) continue;
  for (const key of Object.keys(p)) {
    if (ID_FIELDS.has(key)) continue;
    if (key.startsWith('_')) continue;
    const v = p[key];
    if (typeof v !== 'number' || !isFinite(v)) continue;
    if (key === 'hr_mtu' && v <= 0) continue;
    let arr = valuesByProp.get(key);
    if (!arr) { arr = []; valuesByProp.set(key, arr); }
    arr.push(v);
  }
}

// The artifact is statically imported into the JS bundle, so it carries only the
// three fields the client normalizes with (min/max/avg). Raw bounds and counts
// are logged below for audit but kept out of the file to spare bundle bytes.
const ranges = {};
const debug = {};
let count = 0;
for (const [key, values] of valuesByProp) {
  if (values.length === 0) continue;
  values.sort((a, b) => a - b);
  const p2 = percentile(values, LOWER_PCT);
  const p98 = percentile(values, UPPER_PCT);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  // `min`/`max` are the normalization bounds the client uses (winsorized p2/p98).
  ranges[key] = { min: p2, max: p98, avg };
  debug[key] = { rawMin: values[0], rawMax: values[values.length - 1], n: values.length };
  count++;
}

const artifact = {
  // Document how the bounds were derived so the file is self-explaining.
  method: 'winsorized-minmax',
  lowerPercentile: LOWER_PCT,
  upperPercentile: UPPER_PCT,
  postalCodeCount: props.length,
  rangeCount: count,
  ranges,
};

writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + '\n');
console.log(`  → national_ranges.json (${count} properties over ${props.length} postal codes)`);
// Surface a couple of headline metrics so the build log is auditable.
for (const key of ['crime_index', 'hr_mtu', 'unemployment_rate', 'air_quality_index']) {
  const r = ranges[key];
  const d = debug[key];
  if (r) console.log(`    ${key}: min(p2)=${r.min.toFixed(2)} max(p98)=${r.max.toFixed(2)} avg=${r.avg.toFixed(2)} [raw ${d.rawMin}..${d.rawMax}, n=${d.n}]`);
}
console.log('Done!');
