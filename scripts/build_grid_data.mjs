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
import { readdirSync, existsSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const publicData = resolve(rootDir, 'public', 'data');
const manifestPath = resolve(rootDir, 'src', 'data', 'grid_manifest.json');

// CF-9: per-region bboxes ("minLat,minLon,maxLat,maxLon") for sharding national
// grids so a region-scoped session fetches only its own cells, not the whole
// nationwide grid (light_pollution is ~11 MB / 50 k cells).
const seutukuntaBboxes = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'seutukunta_bboxes.json'), 'utf-8'),
);
const REGION_BBOXES = Object.entries(seutukuntaBboxes).map(([id, s]) => {
  const [minLat, minLon, maxLat, maxLon] = String(s).split(',').map(Number);
  return { id, minLon, minLat, maxLon, maxLat, area: (maxLon - minLon) * (maxLat - minLat) };
});

/** Assign a cell centroid to the tightest-fitting region whose bbox contains it
 *  (smallest bbox area), so each cell lands in exactly one shard — no duplication. */
function regionForCentroid(lon, lat) {
  let best = null;
  for (const r of REGION_BBOXES) {
    if (lon >= r.minLon && lon <= r.maxLon && lat >= r.minLat && lat <= r.maxLat) {
      if (!best || r.area < best.area) best = r;
    }
  }
  return best?.id ?? null;
}

/** bbox-midpoint centroid of a grid cell's outer ring. */
function gridCellCentroid(feat) {
  const ring = feat.geometry?.coordinates?.[0];
  if (!ring || !ring.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return isFinite(minX) ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
}

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

  // CF-9: shard a national grid into per-region files so a region session fetches
  // only its own cells. Each cell is assigned to the tightest region bbox containing
  // its centroid (one shard per cell — no duplication). The whole-file path above is
  // kept for the all-Finland scope. Cells in no region bbox stay only in the whole file.
  if (scope === 'national') {
    const shardDir = resolve(publicData, `${stem}_shards`);
    rmSync(shardDir, { recursive: true, force: true });
    mkdirSync(shardDir, { recursive: true });
    const byRegion = new Map();
    for (const f of geojson.features ?? []) {
      const c = gridCellCentroid(f);
      if (!c) continue;
      const region = regionForCentroid(c[0], c[1]);
      if (!region) continue;
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region).push(f);
    }
    let nShards = 0;
    for (const [region, feats] of [...byRegion.entries()].sort()) {
      writeFileSync(
        resolve(shardDir, `${stem}_${region}.geojson`),
        JSON.stringify({ type: 'FeatureCollection', features: feats }),
      );
      nShards += 1;
    }
    // Store a single path TEMPLATE (not 69 paths) so the statically-imported
    // manifest stays tiny in the JS bundle; useGridData substitutes the region id
    // and falls back to the whole file on a miss.
    manifest[layerId].shardPattern = `data/${stem}_shards/${stem}_{region}.geojson`;
    console.log(`  ${layerId}: sharded ${cells} cells → ${nShards} region shards`);
  }
  console.log(`  ${layerId}: ${served.format}, ${cells} cells, scope=${scope}, bbox=[${bbox.join(', ')}]`);
}

// Write the manifest with sorted keys for a stable diff.
const sorted = {};
for (const key of Object.keys(manifest).sort()) sorted[key] = manifest[key];
writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + '\n');
console.log(`Built ${gridFiles.length} grid dataset(s) → grid_manifest.json (${Object.keys(sorted).length} layer(s)).`);
