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
// CF-2: reuse the app's summary/percentile metric sets so the national ladder set stays
// in lockstep, and computeQualityIndices to derive the (unpersisted) quality_index ladder.
// Node v24 strips TS types natively; build_region_aggregates.mjs already imports these .ts.
import { computeQualityIndices } from '../src/utils/qualityIndex.ts';
import { SUMMARY_METRICS } from '../src/utils/areaSummary.ts';
import { PERCENTILE_METRICS } from '../src/utils/percentileRanks.ts';
import { decodeColumnar } from './lib/columnar.mjs';

const rootDir = resolve(import.meta.dirname, '..');
const propertiesPath = resolve(rootDir, 'src', 'data', 'region_properties.json');
const outputPath = resolve(rootDir, 'src', 'data', 'national_ranges.json');
// CF-2: national percentile ladder asset (a ?url static asset, zero bundle bytes).
const percentilesPath = resolve(rootDir, 'src', 'data', 'national_percentiles.json');

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
const props = decodeColumnar(JSON.parse(readFileSync(propertiesPath, 'utf-8')));
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

// CF-2: national percentile LADDERS. national_ranges.json carries only winsorized
// min/max/avg (for QI normalization); it cannot answer "top X% nationally". This second
// artifact carries a 101-point quantile curve per summary/percentile metric, read via
// percentileRankSorted, so the panel can state a true national standing WITHOUT fetching
// the ~12 MB national property set. Shipped as a ?url asset → zero bundle bytes. Idempotent:
// derives only from the committed region_properties.json + deterministic computeQualityIndices.
const ladderProps = new Set([
  ...SUMMARY_METRICS.map((m) => m.prop),
  ...Object.values(PERCENTILE_METRICS).map((d) => d.prop),
]);
// quality_index is derived, not persisted in region_properties (it is an ID_FIELD here), so
// compute it with DEFAULT weights against the just-built national ranges — the exact
// derivation build_region_aggregates.mjs uses, keeping the ladder byte-idempotent.
const nationalRangesMap = new Map(
  Object.entries(ranges).map(([k, r]) => [k, { min: r.min, max: r.max, avg: r.avg }]),
);
const featuresForQi = props.map((p) => ({ properties: p }));
computeQualityIndices(featuresForQi, undefined, nationalRangesMap);
// Metrics that drop non-positive placeholders (income), matching areaSummary/collectRange.
const requirePositiveProps = new Set([
  'hr_mtu',
  ...SUMMARY_METRICS.filter((m) => m.requirePositive).map((m) => m.prop),
]);
const percentileMetrics = {};
for (const key of ladderProps) {
  const requirePositive = requirePositiveProps.has(key);
  const values = [];
  for (const p of props) {
    if (!p) continue;
    const v = p[key];
    if (typeof v !== 'number' || !isFinite(v)) continue;
    if (requirePositive && v <= 0) continue;
    values.push(v);
  }
  if (values.length === 0) continue;
  values.sort((a, b) => a - b);
  // 101 quantiles p0..p100; percentileRankSorted binary-searches this ascending ladder.
  const ladder = Array.from({ length: 101 }, (_, i) => percentile(values, i / 100));
  percentileMetrics[key] = { ladder, n: values.length };
}
const percentilesArtifact = {
  method: 'quantile-ladder',
  breakpoints: 101,
  postalCodeCount: props.length,
  metrics: percentileMetrics,
};
writeFileSync(percentilesPath, JSON.stringify(percentilesArtifact, null, 2) + '\n');
console.log(`  → national_percentiles.json (${Object.keys(percentileMetrics).length} metric ladders)`);
// Surface a couple of headline metrics so the build log is auditable.
for (const key of ['crime_index', 'hr_mtu', 'unemployment_rate', 'air_quality_index']) {
  const r = ranges[key];
  const d = debug[key];
  if (r) console.log(`    ${key}: min(p2)=${r.min.toFixed(2)} max(p98)=${r.max.toFixed(2)} avg=${r.avg.toFixed(2)} [raw ${d.rawMin}..${d.rawMax}, n=${d.n}]`);
}
console.log('Done!');
