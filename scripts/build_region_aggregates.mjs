#!/usr/bin/env node
/**
 * CF-8: build src/data/region_aggregates.json — the small per-region aggregate
 * artifact that drives the all-Finland first paint.
 *
 * The default landing (`?city=all`) renders 69 seutukunta aggregates that
 * `buildMetroAreaFeatures` computes client-side from the full ~10.6 MB
 * region_properties.json. This script precomputes those aggregates at build time so
 * the landing fetches a few KB instead, deferring the full national set to the events
 * that genuinely need per-postal data (custom weights, deep-linked `?pno=`, search).
 *
 * Parity is the whole point: the records here are produced by the SAME
 * `buildRegionAggregates` the runtime uses, fed the SAME inputs as the runtime
 * all-cities path (`processProperties`): the national properties array, with
 * quality_index normalized against the SAME national_ranges.json the client reads via
 * getNationalRanges(). So when a trigger later loads the full set, the view upgrades
 * in place without the region colours shifting.
 *
 * Runs AFTER build_national_ranges.mjs in the build:data chain (it needs the ranges).
 * Deterministic output (sorted region keys, no timestamp) so the auto-merge
 * idempotency gate (`git diff --exit-code src/data`) passes on an unchanged rebuild.
 *
 * Usage: node scripts/build_region_aggregates.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Node's TypeScript stripping (22.18+/24) loads these — same path prerender.mjs uses.
// All three transitively import only Node-safe modules (no Vite `?url` specifiers).
import { computeQualityIndices } from '../src/utils/qualityIndex.ts';
import { computeChangeMetrics, computeQuickWinMetrics } from '../src/utils/metrics.ts';
import { buildRegionAggregates } from '../src/utils/metroAggregation.ts';
import { decodeColumnar } from './lib/columnar.mjs';

const rootDir = resolve(import.meta.dirname, '..');
const propertiesPath = resolve(rootDir, 'src', 'data', 'region_properties.json');
const rangesPath = resolve(rootDir, 'src', 'data', 'national_ranges.json');
const outputPath = resolve(rootDir, 'src', 'data', 'region_aggregates.json');

console.log('Building region_aggregates.json (all-cities first-paint artifact)...');

// The geometry-stripped national properties array (written by build_region_data.mjs).
const propsArray = decodeColumnar(JSON.parse(readFileSync(propertiesPath, 'utf-8')));

// National normalization ranges (written by build_national_ranges.mjs). Mirror
// getNationalRanges(): a Map<property, { min, max, avg }>.
const rangesRaw = JSON.parse(readFileSync(rangesPath, 'utf-8')).ranges ?? {};
const nationalRanges = new Map();
for (const key of Object.keys(rangesRaw)) {
  const r = rangesRaw[key];
  nationalRanges.set(key, { min: r.min, max: r.max, avg: r.avg });
}

// Wrap into features and process EXACTLY as the runtime processProperties does
// (geometry: null; quality against national ranges; change + quick-win metrics).
const features = propsArray.map((properties) => ({ type: 'Feature', properties, geometry: null }));
computeQualityIndices(features, undefined, nationalRanges);
computeChangeMetrics(features);
computeQuickWinMetrics(features);

const { national, regions } = buildRegionAggregates(features);

// The national postal composite distribution, as ascending [value, count] pairs.
//
// The all-Finland landing paints the 69 regional means and never downloads the postal
// areas they were aggregated from, so it has no cohort to derive the selected quality
// display scale (stretch / winsorized / percentile) from — every non-raw mode silently
// showed the raw composite there. The composite carries one decimal, so the 3,018 areas
// compress to a few hundred pairs; that is still cheap enough to ship and reproduces the
// exact same transform applyQualityScale derives from the full set.
const cohortCounts = new Map();
for (const f of features) {
  const v = f.properties.quality_index;
  if (typeof v === 'number' && Number.isFinite(v)) cohortCounts.set(v, (cohortCounts.get(v) ?? 0) + 1);
}
const qualityCohort = [...cohortCounts.entries()].sort((a, b) => a[0] - b[0]);

// Deterministic serialization: sort region keys so the committed artifact is a
// stable diff and the idempotency gate passes on an unchanged rebuild.
const sortedRegions = {};
for (const cityId of Object.keys(regions).sort()) sortedRegions[cityId] = regions[cityId];

const artifact = { national, regions: sortedRegions, qualityCohort };
writeFileSync(outputPath, JSON.stringify(artifact));

const regionCount = Object.keys(sortedRegions).length;
const cohortTotal = qualityCohort.reduce((sum, [, n]) => sum + n, 0);
const bytes = readFileSync(outputPath).length;
console.log(`  → region_aggregates.json (${regionCount} regions, ${qualityCohort.length} distinct composites over ${cohortTotal} areas, ${bytes} bytes)`);
console.log('Done!');
