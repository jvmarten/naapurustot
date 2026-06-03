#!/usr/bin/env node
/**
 * Build fine-grained grid datasets for the app and emit a discovery manifest.
 *
 * Scans public/data/ for *_grid.geojson files and:
 *   1. Converts each to TopoJSON for a smaller payload — EXCEPT very large grids
 *      (> SIZE_THRESHOLD), which are served as raw GeoJSON (TopoJSON's arc
 *      encoding gives little benefit on dense rasterized grids and would bloat
 *      the repo). The threshold is what keeps light_pollution (~11 MB) on GeoJSON
 *      while air_quality (~2.4 MB) becomes TopoJSON.
 *   2. Writes src/data/grid_manifest.json (IN-1): maps each grid LayerId to its
 *      served file path, format, bbox, cell count, and coverage scope. The app's
 *      useGridData hook reads this manifest instead of a hardcoded path registry,
 *      so adding a grid is a data-only change and partial coverage is explicit in
 *      the UI rather than a silent choropleth fallback.
 *
 * The LayerId for a grid is the file stem with the trailing "_grid" removed,
 * e.g. air_quality_grid.geojson → LayerId "air_quality".
 *
 * If no grid GeoJSON exists, an empty manifest is written and the script exits
 * cleanly (grid data is optional).
 */
import { execSync } from 'node:child_process';
import { readdirSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const publicData = resolve(rootDir, 'public', 'data');
const manifestPath = resolve(rootDir, 'src', 'data', 'grid_manifest.json');

// Grids larger than this are served as raw GeoJSON rather than converted to
// TopoJSON. Dense grids barely shrink under TopoJSON and the conversion would
// commit a large redundant artifact.
const SIZE_THRESHOLD = 5 * 1024 * 1024;

// A grid wider than this many degrees of longitude is treated as nationwide;
// anything narrower is a regional grid (e.g. the Helsinki area), which the UI
// flags so users know the fine resolution does not cover the whole map.
const NATIONAL_LON_SPAN = 4;

/** Compute [minLon, minLat, maxLon, maxLat] and feature count from a GeoJSON FeatureCollection. */
function bboxAndCount(geojson) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords) visit(c);
  };
  const features = geojson.features ?? [];
  for (const f of features) {
    if (f.geometry?.coordinates) visit(f.geometry.coordinates);
  }
  const round = (n) => Math.round(n * 1e5) / 1e5;
  return {
    bbox: [round(minX), round(minY), round(maxX), round(maxY)],
    cells: features.length,
  };
}

const gridFiles = readdirSync(publicData).filter((f) => f.endsWith('_grid.geojson'));

const manifest = {};

for (const file of gridFiles) {
  const stem = basename(file, '.geojson'); // e.g. air_quality_grid
  const layerId = stem.replace(/_grid$/, '');
  const geojsonPath = resolve(publicData, file);
  const topoPath = resolve(publicData, `${stem}.topojson`);
  const size = statSync(geojsonPath).size;

  if (size <= SIZE_THRESHOLD) {
    console.log(`Converting ${file} → ${stem}.topojson`);
    // IN-6b: quantize with -q 1e5 so TopoJSON delta-encodes the (regular, axis-aligned)
    // grid cell coordinates — a payload win at imperceptible (sub-cell) precision loss.
    // Quote paths so spaces in the checkout path don't break the shell command.
    execSync(`npx -p topojson-server geo2topo -q 1e5 grid="${geojsonPath}" > "${topoPath}"`, { stdio: 'inherit' });
  } else {
    console.log(`Serving ${file} as raw GeoJSON (${(size / 1024 / 1024).toFixed(1)} MB > threshold)`);
  }

  const served = existsSync(topoPath)
    ? { path: `data/${stem}.topojson`, format: 'topojson' }
    : { path: `data/${stem}.geojson`, format: 'geojson' };

  const geojson = JSON.parse(readFileSync(geojsonPath, 'utf-8'));
  const { bbox, cells } = bboxAndCount(geojson);
  const scope = (bbox[2] - bbox[0]) > NATIONAL_LON_SPAN ? 'national' : 'regional';

  manifest[layerId] = { ...served, bbox, cells, scope };
  console.log(`  ${layerId}: ${served.format}, ${cells} cells, scope=${scope}, bbox=[${bbox.join(', ')}]`);
}

// Write the manifest with sorted keys for a stable diff.
const sorted = {};
for (const key of Object.keys(manifest).sort()) sorted[key] = manifest[key];
writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + '\n');
console.log(`Built ${gridFiles.length} grid dataset(s) → grid_manifest.json (${Object.keys(sorted).length} layer(s)).`);
