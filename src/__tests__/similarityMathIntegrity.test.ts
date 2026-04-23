import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    },
    properties: props,
  };
}

function baseProps(pno: string, overrides: Record<string, unknown> = {}) {
  return {
    pno, nimi: `N-${pno}`, namn: `N-${pno}`,
    hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 40,
    foreign_language_pct: 15, ownership_rate: 50, transit_stop_density: 20,
    property_price_sqm: 3500, crime_index: 5, population_density: 4000, child_ratio: 6,
    ...overrides,
  };
}

describe('similarity — mathematical correctness', () => {
  it('distance is symmetric: dist(A,B) === dist(B,A)', () => {
    const propsA = baseProps('00100', { hr_mtu: 20000, unemployment_rate: 5 });
    const propsB = baseProps('00200', { hr_mtu: 40000, unemployment_rate: 15 });
    const features = [
      makeFeature(propsA), makeFeature(propsB),
      makeFeature(baseProps('00300', { hr_mtu: 50000, unemployment_rate: 20 })),
    ];
    const distAtoB = findSimilarNeighborhoods(propsA as any, features, 5)
      .find(r => r.properties.pno === '00200')?.distance;
    const distBtoA = findSimilarNeighborhoods(propsB as any, features, 5)
      .find(r => r.properties.pno === '00100')?.distance;
    expect(distAtoB).toBeCloseTo(distBtoA!, 10);
  });

  it('triangle inequality: dist(A,C) <= dist(A,B) + dist(B,C)', () => {
    const propsA = baseProps('00100', { hr_mtu: 10000 });
    const propsB = baseProps('00200', { hr_mtu: 30000 });
    const propsC = baseProps('00300', { hr_mtu: 50000 });
    const features = [makeFeature(propsA), makeFeature(propsB), makeFeature(propsC)];
    const fromA = findSimilarNeighborhoods(propsA as any, features, 5);
    const distAB = fromA.find(r => r.properties.pno === '00200')?.distance ?? 0;
    const distAC = fromA.find(r => r.properties.pno === '00300')?.distance ?? 0;
    const fromB = findSimilarNeighborhoods(propsB as any, features, 5);
    const distBC = fromB.find(r => r.properties.pno === '00300')?.distance ?? 0;
    expect(distAC).toBeLessThanOrEqual(distAB + distBC + 1e-10);
  });

  it('maximally different neighborhoods → distance is 1.0', () => {
    const target = baseProps('00100', { hr_mtu: 10000 });
    const other = baseProps('00200', { hr_mtu: 50000 });
    const features = [makeFeature(target), makeFeature(other)];
    const results = findSimilarNeighborhoods(target as any, features, 5);
    expect(results[0].distance).toBeCloseTo(1.0, 5);
  });

  it('results are sorted by ascending distance', () => {
    const target = baseProps('00100', { hr_mtu: 10000 });
    const features = [
      makeFeature(target),
      makeFeature(baseProps('00200', { hr_mtu: 12000 })),
      makeFeature(baseProps('00300', { hr_mtu: 30000 })),
      makeFeature(baseProps('00400', { hr_mtu: 50000 })),
      makeFeature(baseProps('00500', { hr_mtu: 11000 })),
    ];
    const results = findSimilarNeighborhoods(target as any, features, 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('count parameter limits results correctly', () => {
    const target = baseProps('00100');
    const features = Array.from({ length: 20 }, (_, i) =>
      makeFeature(baseProps(`${(i + 1).toString().padStart(5, '0')}`, { hr_mtu: 20000 + i * 1000 })),
    );
    features.unshift(makeFeature(target));
    expect(findSimilarNeighborhoods(target as any, features, 3)).toHaveLength(3);
    expect(findSimilarNeighborhoods(target as any, features, 1)).toHaveLength(1);
    expect(findSimilarNeighborhoods(target as any, features, 50)).toHaveLength(20);
  });
});

describe('similarity — missing/partial data handling', () => {
  it('compares using only shared valid metrics', () => {
    const target = baseProps('00100', { foreign_language_pct: null });
    const candidate = baseProps('00200', { foreign_language_pct: null, hr_mtu: 30000 });
    const different = baseProps('00300', { hr_mtu: 60000 });
    const features = [makeFeature(target), makeFeature(candidate), makeFeature(different)];
    const results = findSimilarNeighborhoods(target as any, features, 5);
    expect(results[0].properties.pno).toBe('00200');
  });

  it('handles target with NaN metrics by using remaining metrics', () => {
    const target = baseProps('00100', { hr_mtu: NaN });
    const features = [
      makeFeature(target),
      makeFeature(baseProps('00200', { unemployment_rate: 5 })),
      makeFeature(baseProps('00300', { unemployment_rate: 20 })),
    ];
    const results = findSimilarNeighborhoods(target as any, features, 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns center coordinates for each result', () => {
    const target = baseProps('00100');
    const features = [makeFeature(target), makeFeature(baseProps('00200', { hr_mtu: 35000 }))];
    const results = findSimilarNeighborhoods(target as any, features, 5);
    expect(results[0].center).toHaveLength(2);
    expect(typeof results[0].center[0]).toBe('number');
  });
});
