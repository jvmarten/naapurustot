#!/usr/bin/env node
/**
 * Convert building-footprint GeoJSON to TopoJSON and emit a discovery manifest.
 *
 * Input : public/data/buildings_<region>.geojson  (scripts/fetch_helsinki_buildings.py)
 * Output: public/data/buildings_<region>.topojson
 *         src/data/buildings_manifest.json
 *
 * These footprints carry a MEASURED height per building and feed the /live/ shadow
 * layer. The manifest records each shard's bbox so the runtime can decide, without
 * fetching anything, whether a given viewport is covered by authoritative heights or
 * has to fall back to the live OpenStreetMap query — and can then say which one it
 * used. That decision has to be cheap and honest, which is why the bbox lives in a
 * tiny statically-imported manifest rather than being derived from the shard itself.
 *
 * Mirrors scripts/build_grid_data.mjs: same geo2topo invocation, same manifest-driven
 * discovery, so adding a city is dropping in a new GeoJSON and re-running.
 *
 * If no buildings GeoJSON exists, an empty manifest is written and the script exits
 * cleanly — the shadow layer then runs entirely on the OSM fallback.
 */
import { execSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const publicData = resolve(rootDir, 'public', 'data');
const manifestPath = resolve(rootDir, 'src', 'data', 'buildings_manifest.json');

// Quantization for geo2topo. 1e5 over a city-sized extent is centimetre-level —
// well below the 0.5 m simplification the fetcher already applied, so it costs no
// visible outline detail while letting TopoJSON delta-encode the coordinates.
const QUANTIZE = '1e5';

function bboxAndCount(geojson) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let count = 0;
  for (const feature of geojson.features ?? []) {
    const rings = feature.geometry?.coordinates ?? [];
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lat < minLat) minLat = lat;
        if (lon > maxLon) maxLon = lon;
        if (lat > maxLat) maxLat = lat;
      }
    }
    count++;
  }
  return { bbox: [minLon, minLat, maxLon, maxLat], count };
}

const files = existsSync(publicData)
  ? readdirSync(publicData).filter((f) => /^buildings_.*\.geojson$/.test(f)).sort()
  : [];

const manifest = {};
for (const file of files) {
  const stem = basename(file, '.geojson');
  const regionId = stem.replace(/^buildings_/, '');
  const geojsonPath = resolve(publicData, file);
  const topoPath = resolve(publicData, `${stem}.topojson`);

  console.log(`Converting ${file} → ${stem}.topojson`);
  execSync(`npx -p topojson-server geo2topo -q ${QUANTIZE} buildings="${geojsonPath}" > "${topoPath}"`, {
    stdio: 'inherit',
  });

  const geojson = JSON.parse(readFileSync(geojsonPath, 'utf-8'));
  const { bbox, count } = bboxAndCount(geojson);
  manifest[regionId] = {
    path: `data/${stem}.topojson`,
    bbox,
    count,
    bytes: statSync(topoPath).size,
  };
  console.log(
    `  ${count} buildings, ${(statSync(topoPath).size / 1048576).toFixed(2)} MB topojson`,
  );
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + '\n');
console.log(`Wrote ${manifestPath} (${Object.keys(sorted).length} shard(s)).`);
