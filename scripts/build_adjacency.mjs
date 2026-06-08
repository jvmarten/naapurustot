#!/usr/bin/env node
/**
 * CF-12: standalone postal-code adjacency generator.
 *
 * Reads the ALREADY-COMMITTED src/data/regions/*.topojson and writes ONLY
 * src/data/adjacency.json (pno -> [neighbor pnos]). It does NOT regenerate any
 * TopoJSON, so running it produces a minimal, focused diff. The full data build
 * (scripts/build_region_data.mjs) emits the same artifact via the shared
 * scripts/lib/adjacency.mjs module, so the two never drift.
 *
 * Usage: node scripts/build_adjacency.mjs
 */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { buildAdjacencyFromRegions } from './lib/adjacency.mjs';

const rootDir = resolve(import.meta.dirname, '..');
const regionsDir = resolve(rootDir, 'src', 'data', 'regions');
const outPath = resolve(rootDir, 'src', 'data', 'adjacency.json');

const adjacency = buildAdjacencyFromRegions(regionsDir);
const json = JSON.stringify(adjacency);
writeFileSync(outPath, json + '\n');

const keys = Object.keys(adjacency).length;
console.log(
  `adjacency.json: ${keys} postal codes, ${json.length} raw / ${gzipSync(json, { level: 9 }).length} gzip bytes`,
);
