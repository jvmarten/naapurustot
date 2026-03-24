#!/usr/bin/env node
/**
 * Post-processes the TopoJSON file to embed build metadata.
 * Run automatically as part of `npm run build:data`.
 *
 * Adds a top-level `metadata` object with:
 *   - updated: ISO date string of the build (YYYY-MM)
 *   - builtAt: full ISO timestamp
 */
import { readFileSync, writeFileSync } from 'fs';

const TOPO_PATH = 'src/data/metro_neighborhoods.topojson';

const topo = JSON.parse(readFileSync(TOPO_PATH, 'utf8'));

const now = new Date();
topo.metadata = {
  updated: now.toISOString().slice(0, 7),       // e.g. "2026-03"
  builtAt: now.toISOString(),                     // full timestamp
};

writeFileSync(TOPO_PATH, JSON.stringify(topo));
console.log(`Injected metadata into ${TOPO_PATH}: updated=${topo.metadata.updated}`);
