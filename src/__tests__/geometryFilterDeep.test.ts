import { describe, it, expect } from 'vitest';
import { filterSmallIslands } from '../utils/geometryFilter';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

function makePolygon(coords: number[][][]): Feature<Polygon> {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: coords },
    properties: { name: 'test' },
  };
}

function makeMultiPolygon(polys: number[][][][]): Feature<MultiPolygon> {
  return {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: polys },
    properties: { name: 'test' },
  };
}

// A square of a given side length at origin
function square(size: number, offsetX = 0, offsetY = 0): number[][][] {
  return [[
    [offsetX, offsetY],
    [offsetX + size, offsetY],
    [offsetX + size, offsetY + size],
    [offsetX, offsetY + size],
    [offsetX, offsetY], // closed
  ]];
}

describe('filterSmallIslands — deep edge cases', () => {
  it('converts MultiPolygon to Polygon when only one polygon survives filtering', () => {
    // Large square (area ~100) + tiny square (area ~1, which is 1% of 100 < 15%)
    const feature = makeMultiPolygon([
      square(10),
      square(1, 20, 20),
    ]);
    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('keeps MultiPolygon when multiple polygons survive', () => {
    // Two squares of similar size
    const feature = makeMultiPolygon([
      square(10),
      square(8, 20, 20), // area 64 is 64% of 100, above 15%
    ]);
    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates.length).toBe(2);
  });

  it('handles polygon with holes (outer ring minus inner ring area)', () => {
    // Outer ring area is 100, inner ring area is 25 → net area = 75
    const polyWithHole: number[][][] = [
      // Outer ring
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      // Hole
      [[2, 2], [7, 2], [7, 7], [2, 7], [2, 2]],
    ];
    const feature = makeMultiPolygon([
      polyWithHole,
      square(1, 20, 20), // tiny island
    ]);
    const result = filterSmallIslands([feature]);
    // The tiny island (area 1) is < 15% of 75, so it should be filtered
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('preserves feature properties after filtering', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          square(10)[0] ? [square(10)[0]] : [],
          [square(1, 20, 20)[0]],
        ],
      },
      properties: { pno: '00100', nimi: 'Kallio', quality_index: 75 },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0].properties).toEqual({ pno: '00100', nimi: 'Kallio', quality_index: 75 });
  });

  it('handles exactly 15% threshold (borderline: area = 15% of max)', () => {
    // Main polygon area = 100, secondary = 15 (exactly 15%)
    const main = square(10);
    // sqrt(15) ≈ 3.873 → area ≈ 15
    const secondary: number[][][] = [
      [[0, 0], [3.873, 0], [3.873, 3.873], [0, 3.873], [0, 0]],
    ];
    const feature = makeMultiPolygon([main, secondary]);
    const result = filterSmallIslands([feature]);
    // Should keep both (>= 15% threshold)
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates.length).toBe(2);
  });

  it('handles multiple features independently', () => {
    const features = [
      makeMultiPolygon([square(10), square(1, 20, 20)]), // tiny island filtered
      makePolygon(square(5)), // single polygon, unchanged
      makeMultiPolygon([square(10), square(9, 20, 20)]), // both kept (81% of 100)
    ];
    const result = filterSmallIslands(features);
    expect(result[0].geometry.type).toBe('Polygon'); // tiny island removed
    expect(result[1].geometry.type).toBe('Polygon'); // unchanged
    expect(result[2].geometry.type).toBe('MultiPolygon'); // both kept
    expect((result[2].geometry as MultiPolygon).coordinates.length).toBe(2);
  });

  it('preserves original feature for non-Polygon/MultiPolygon types', () => {
    const point: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    };
    const result = filterSmallIslands([point]);
    expect(result[0]).toBe(point); // same reference
  });
});
