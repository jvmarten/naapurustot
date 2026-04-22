import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NeighborhoodProperties } from '../utils/metrics';

let findSimilarNeighborhoods: typeof import('../utils/similarity').findSimilarNeighborhoods;

function makeFeature(pno: string, props: Partial<NeighborhoodProperties> = {}): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9 + Math.random() * 0.1, 60.1 + Math.random() * 0.1] },
    properties: {
      pno, nimi: `Area ${pno}`, namn: `Area ${pno}`, kunta: '091', city: 'helsinki',
      he_vakiy: 1000, hr_mtu: 30000, unemployment_rate: 7,
      higher_education_rate: 40, foreign_language_pct: 10, ownership_rate: 50,
      transit_stop_density: 20, property_price_sqm: 4000, crime_index: 50,
      population_density: 3000, child_ratio: 8,
      ...props,
    } as NeighborhoodProperties,
  };
}

describe('findSimilarNeighborhoods critical paths', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/similarity');
    findSimilarNeighborhoods = mod.findSimilarNeighborhoods;
  });

  it('excludes the target neighborhood itself', () => {
    const target = makeFeature('00100');
    const features = [target, makeFeature('00200'), makeFeature('00300')];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features);
    expect(result.every(r => r.properties.pno !== '00100')).toBe(true);
  });

  it('returns neighborhoods sorted by ascending distance', () => {
    const target = makeFeature('00100', { hr_mtu: 30000 });
    const features = [
      target,
      makeFeature('00200', { hr_mtu: 30001 }), // very similar
      makeFeature('00300', { hr_mtu: 50000 }), // different
      makeFeature('00400', { hr_mtu: 30002 }), // very similar
    ];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].distance).toBeGreaterThanOrEqual(result[i - 1].distance);
    }
  });

  it('respects count parameter', () => {
    const target = makeFeature('00100', { hr_mtu: 30000 });
    // Need at least one outlier to create valid ranges for metrics
    const features = [
      target,
      makeFeature('00200', { hr_mtu: 30000 }),
      makeFeature('00300', { hr_mtu: 30000 }),
      makeFeature('00400', { hr_mtu: 60000 }), // outlier ensures hr_mtu has a valid range
    ];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features, 2);
    expect(result.length).toBe(2);
  });

  it('returns fewer than count when not enough candidates', () => {
    const target = makeFeature('00100', { hr_mtu: 30000 });
    const features = [target, makeFeature('00200', { hr_mtu: 60000 })];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features, 5);
    expect(result.length).toBe(1);
  });

  it('when all metrics are identical and only 2 features, ranges are zero → no candidates', () => {
    // With min===max for every metric, no metric has a valid range.
    // All candidates get usedMetrics=0 and are excluded.
    const target = makeFeature('00100');
    const features = [target, makeFeature('00200'), makeFeature('00300')];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features);
    expect(result.length).toBe(0);
  });

  it('identical metrics with diversity elsewhere yield distance 0', () => {
    const target = makeFeature('00100', { hr_mtu: 30000 });
    const features = [
      target,
      makeFeature('00200', { hr_mtu: 30000 }),
      makeFeature('00300', { hr_mtu: 60000 }), // outlier ensures hr_mtu range exists
    ];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features);
    const match = result.find(r => r.properties.pno === '00200')!;
    expect(match).toBeDefined();
    expect(match.distance).toBe(0);
  });

  it('skips candidates where all metrics are null', () => {
    const target = makeFeature('00100');
    const nullFeature = makeFeature('00200', {
      hr_mtu: null, unemployment_rate: null, higher_education_rate: null,
      foreign_language_pct: null, ownership_rate: null, transit_stop_density: null,
      property_price_sqm: null, crime_index: null, population_density: null, child_ratio: null,
    });
    const features = [target, nullFeature, makeFeature('00300')];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features);
    expect(result.every(r => r.properties.pno !== '00200')).toBe(true);
  });

  it('skips metrics where target value is null', () => {
    // target has null hr_mtu; others differ on hr_mtu but agree on everything else
    // Need range diversity so at least one metric has min != max
    const target = makeFeature('00100', { hr_mtu: null, unemployment_rate: 5 });
    const f1 = makeFeature('00200', { hr_mtu: 50000, unemployment_rate: 5 });
    const f2 = makeFeature('00300', { hr_mtu: 20000, unemployment_rate: 15 }); // outlier
    const features = [target, f1, f2];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features);
    // hr_mtu is skipped for target (null). unemployment_rate has range [5,15].
    // f1 has unemployment_rate=5 (same as target), f2 has 15 (different)
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].properties.pno).toBe('00200'); // closer on unemployment_rate
  });

  it('handles NaN and Infinity values by skipping those metrics', () => {
    // Need diversity so ranges exist
    const target = makeFeature('00100', { hr_mtu: 30000 });
    const nanFeature = makeFeature('00200', { hr_mtu: NaN, unemployment_rate: Infinity });
    const normalFeature = makeFeature('00300', { hr_mtu: 30000 });
    const outlier = makeFeature('00400', { hr_mtu: 60000, unemployment_rate: 20 }); // creates ranges
    const features = [target, nanFeature, normalFeature, outlier];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features);
    const pnos = result.map(r => r.properties.pno);
    expect(pnos).toContain('00300'); // identical to target
  });

  it('returns center coordinates for each similar neighborhood', () => {
    const target = makeFeature('00100', { hr_mtu: 30000 });
    const features = [target, makeFeature('00200', { hr_mtu: 30000 }), makeFeature('00300', { hr_mtu: 60000 })];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features);
    for (const r of result) {
      expect(r.center).toHaveLength(2);
      expect(typeof r.center[0]).toBe('number');
      expect(typeof r.center[1]).toBe('number');
      expect(isFinite(r.center[0])).toBe(true);
      expect(isFinite(r.center[1])).toBe(true);
    }
  });

  it('cache invalidates when different features array is passed', () => {
    const target = makeFeature('00100');
    // Need a third feature to ensure hr_mtu has a valid range in both datasets
    const features1 = [target, makeFeature('00200', { hr_mtu: 50000 }), makeFeature('00300', { hr_mtu: 10000 })];
    const result1 = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features1);

    const features2 = [target, makeFeature('00200'), makeFeature('00300', { hr_mtu: 10000 })];
    const result2 = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features2);

    // 00200 in features1 differs from target on hr_mtu → nonzero distance
    const d1_00200 = result1.find(r => r.properties.pno === '00200')!;
    expect(d1_00200.distance).toBeGreaterThan(0);
    // 00200 in features2 is identical to target → zero distance
    const d2_00200 = result2.find(r => r.properties.pno === '00200')!;
    expect(d2_00200.distance).toBe(0);
  });

  it('distance is normalized by number of used metrics', () => {
    const target = makeFeature('00100');
    // f1 differs on one metric
    const f1 = makeFeature('00200', { hr_mtu: 50000 });
    // f2 differs on all metrics to a similar degree
    const f2 = makeFeature('00300', {
      hr_mtu: 50000, unemployment_rate: 20, higher_education_rate: 80,
      foreign_language_pct: 50, ownership_rate: 90, transit_stop_density: 100,
      property_price_sqm: 12000, crime_index: 150, population_density: 20000, child_ratio: 20,
    });
    const features = [target, f1, f2];
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, features);
    expect(result[0].properties.pno).toBe('00200');
    expect(result[0].distance).toBeLessThan(result[1].distance);
  });
});
