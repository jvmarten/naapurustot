#!/usr/bin/env node
/**
 * Generate a fine-grained grid GeoJSON for the light pollution layer.
 *
 * Creates ~500m square grid cells over the Helsinki metro area and assigns
 * each cell the real VIIRS radiance value from the postal code it falls in.
 * This allows the map to render light pollution at grid resolution while
 * keeping postal code borders visible as overlays.
 *
 * Data source: real VIIRS radiance values already aggregated per postal code
 * in scripts/light_pollution.json (from NASA VIIRS Black Marble VNP46A4).
 *
 * Output: public/data/light_pollution_grid.geojson
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const GEOJSON_PATH = resolve(ROOT, 'public/data/metro_neighborhoods.geojson');
const RADIANCE_PATH = resolve(ROOT, 'scripts/light_pollution.json');
const OUTPUT_PATH = resolve(ROOT, 'public/data/light_pollution_grid.geojson');

// Grid cell size in degrees (~500m at 60°N latitude)
// At 60°N: 1° longitude ≈ 55.8 km, 1° latitude ≈ 111.3 km
// 500m ≈ 0.00896° longitude, 0.00449° latitude
const CELL_LNG = 0.009;
const CELL_LAT = 0.0045;

function pointInPolygon(point, polygon) {
  // Ray-casting algorithm for point-in-polygon
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInMultiPolygon(point, multiPolygon) {
  for (const polygon of multiPolygon) {
    // polygon[0] is the outer ring, polygon[1..n] are holes
    if (pointInPolygon(point, polygon[0])) {
      // Check not in holes
      let inHole = false;
      for (let h = 1; h < polygon.length; h++) {
        if (pointInPolygon(point, polygon[h])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

function main() {
  console.log('Loading metro neighborhoods...');
  const geojson = JSON.parse(readFileSync(GEOJSON_PATH, 'utf-8'));
  const radiance = JSON.parse(readFileSync(RADIANCE_PATH, 'utf-8'));

  const features = geojson.features;
  console.log(`  ${features.length} neighborhoods, ${Object.keys(radiance).length} radiance values`);

  // Compute bounding box
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const f of features) {
    const coordStr = JSON.stringify(f.geometry.coordinates);
    const nums = coordStr.match(/-?\d+\.\d+/g);
    if (!nums) continue;
    for (let i = 0; i < nums.length - 1; i += 2) {
      const lng = parseFloat(nums[i]);
      const lat = parseFloat(nums[i + 1]);
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  console.log(`  Bbox: [${minLng.toFixed(4)}, ${minLat.toFixed(4)}, ${maxLng.toFixed(4)}, ${maxLat.toFixed(4)}]`);

  // Build a simple spatial lookup: for each feature, store pno, radiance, and coords
  const neighborhoods = features
    .filter(f => f.properties.pno && radiance[f.properties.pno] !== undefined)
    .map(f => ({
      pno: f.properties.pno,
      radiance: radiance[f.properties.pno],
      coords: f.geometry.coordinates,
      type: f.geometry.type,
    }));

  console.log(`  ${neighborhoods.length} neighborhoods with radiance data`);

  // Generate grid cells
  console.log('Generating grid cells...');
  const gridFeatures = [];

  const cols = Math.ceil((maxLng - minLng) / CELL_LNG);
  const rows = Math.ceil((maxLat - minLat) / CELL_LAT);
  console.log(`  Grid dimensions: ${cols} x ${rows} = ${cols * rows} potential cells`);

  for (let row = 0; row < rows; row++) {
    const cellMinLat = minLat + row * CELL_LAT;
    const cellMaxLat = cellMinLat + CELL_LAT;
    const centerLat = (cellMinLat + cellMaxLat) / 2;

    for (let col = 0; col < cols; col++) {
      const cellMinLng = minLng + col * CELL_LNG;
      const cellMaxLng = cellMinLng + CELL_LNG;
      const centerLng = (cellMinLng + cellMaxLng) / 2;

      // Find which neighborhood contains the cell center
      let matchedRadiance = null;
      for (const n of neighborhoods) {
        const multiCoords = n.type === 'MultiPolygon' ? n.coords : [n.coords];
        if (pointInMultiPolygon([centerLng, centerLat], multiCoords)) {
          matchedRadiance = n.radiance;
          break;
        }
      }

      if (matchedRadiance === null) continue;

      gridFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [round6(cellMinLng), round6(cellMinLat)],
            [round6(cellMaxLng), round6(cellMinLat)],
            [round6(cellMaxLng), round6(cellMaxLat)],
            [round6(cellMinLng), round6(cellMaxLat)],
            [round6(cellMinLng), round6(cellMinLat)],
          ]],
        },
        properties: {
          radiance: matchedRadiance,
        },
      });
    }

    if (row % 20 === 0) {
      process.stdout.write(`  Row ${row}/${rows} (${gridFeatures.length} cells so far)\r`);
    }
  }

  console.log(`\n  Generated ${gridFeatures.length} grid cells`);

  // Stats
  const vals = gridFeatures.map(f => f.properties.radiance);
  vals.sort((a, b) => a - b);
  console.log(`  Radiance: min=${vals[0]}, median=${vals[Math.floor(vals.length / 2)]}, max=${vals[vals.length - 1]}`);

  const output = {
    type: 'FeatureCollection',
    features: gridFeatures,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  const sizeMB = (Buffer.byteLength(JSON.stringify(output)) / 1024 / 1024).toFixed(1);
  console.log(`  Wrote ${OUTPUT_PATH} (${sizeMB} MB, ${gridFeatures.length} cells)`);
}

function round6(n) {
  return Math.round(n * 1000000) / 1000000;
}

main();
