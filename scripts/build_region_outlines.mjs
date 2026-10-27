#!/usr/bin/env node
/**
 * Combine every country's region outlines into src/data/region_outlines.topojson —
 * the one file the national view, the region tap test and the map's faint boundary
 * line read (metroAreas.ts, regionHit.ts, Map.tsx).
 *
 * Inputs, both already simplified by their own (network) build scripts:
 *   src/data/seutukunnat.topojson     Finland's 69 seutukunnat (build_seutukunta_boundaries.mjs)
 *   scripts/se/fa25_outlines.geojson  Sweden's 71 FA25 regions (scripts/se/build_se_geojson.py)
 *
 * Every output feature carries `region`, the regions.ts id. Offline and deterministic,
 * so it runs inside build:data and the idempotency gate covers it.
 *
 * Usage: node scripts/build_region_outlines.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { feature } from 'topojson-client';
import { topology } from 'topojson-server';

const rootDir = resolve(import.meta.dirname, '..');
const fiPath = resolve(rootDir, 'src', 'data', 'seutukunnat.topojson');
const sePath = resolve(rootDir, 'scripts', 'se', 'fa25_outlines.geojson');
const outPath = resolve(rootDir, 'src', 'data', 'region_outlines.topojson');

const fiTopo = JSON.parse(readFileSync(fiPath, 'utf-8'));
const fiObject = Object.keys(fiTopo.objects)[0];
const fi = feature(fiTopo, fiTopo.objects[fiObject]).features.map((f) => ({
  type: 'Feature',
  properties: { region: f.properties.region },
  geometry: f.geometry,
}));
const se = existsSync(sePath) ? JSON.parse(readFileSync(sePath, 'utf-8')).features : [];

const regions = { type: 'FeatureCollection', features: [...fi, ...se] };
// 3e4 over the two-country extent is a ~70 m grid — finer than the outlines' own
// simplification and invisible at the zooms they draw at.
const topo = topology({ regions }, 3e4);
writeFileSync(outPath, JSON.stringify(topo));
console.log(`region_outlines.topojson: ${fi.length} Finnish + ${se.length} Swedish regions, ${readFileSync(outPath).length} bytes`);
