#!/usr/bin/env node
/**
 * Convert fine-grained grid GeoJSON files to TopoJSON for the app.
 *
 * Scans public/data/ for *_grid.geojson files and produces corresponding
 * TopoJSON files in src/data/. If no grid GeoJSON exists, the script
 * exits cleanly (grid data is optional — it only exists after running
 * the relevant Python fetch scripts with local source data).
 */
import { execSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const publicData = resolve(import.meta.dirname, '..', 'public', 'data');

const gridFiles = readdirSync(publicData).filter((f) => f.endsWith('_grid.geojson'));

if (gridFiles.length === 0) {
  console.log('No grid GeoJSON files found — skipping grid TopoJSON build.');
  process.exit(0);
}

for (const file of gridFiles) {
  const stem = basename(file, '.geojson'); // e.g. transit_reachability_grid
  const input = resolve(publicData, file);
  const output = resolve(publicData, `${stem}.topojson`);
  console.log(`Converting ${file} → ${stem}.topojson`);
  execSync(`npx -p topojson-server geo2topo grid=${input} > ${output}`, { stdio: 'inherit' });
}

console.log(`Built ${gridFiles.length} grid TopoJSON file(s).`);
