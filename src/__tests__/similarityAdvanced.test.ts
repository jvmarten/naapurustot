import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(
  pno: string,
  props: Partial<NeighborhoodProperties>,
  coords: [number, number] = [24.94, 60.17],
): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Område ${pno}`,
      kunta: '091',
      city: 'helsinki_metro' as const,
      ...props,
    } as NeighborhoodProperties,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [coords[0], coords[1]],
        [coords[0] + 0.01, coords[1]],
        [coords[0] + 0.01, coords[1] + 0.01],
        [coords[0], coords[1] + 0.01],
        [coords[0], coords[1]],
      ]],
    },
  };
}

describe('findSimilarNeighborhoods', () => {
  const baseProps: Partial<NeighborhoodProperties> = {
    hr_mtu: 30000,
    unemployment_rate: 5,
    higher_education_rate: 40,
    foreign_language_pct: 10,
    ownership_rate: 50,
    transit_stop_density: 30,
    property_price_sqm: 4000,
    crime_index: 50,
    population_density: 3000,
    child_ratio: 8,
  };

  it('returns the most similar neighborhoods first', () => {
    const target = makeFeature('00100', baseProps);
    const similar = makeFeature('00200', { ...baseProps, hr_mtu: 31000 }); // very close
    const different = makeFeature('00300', {
      ...baseProps,
      hr_mtu: 60000,
      unemployment_rate: 20,
      crime_index: 200,
    });
    const allFeatures = [target, similar, different];

    const results = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      allFeatures,
    );

    expect(results.length).toBe(2);
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });

  it('excludes the target neighborhood itself', () => {
    const target = makeFeature('00100', baseProps);
    const other = makeFeature('00200', baseProps);
    const results = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, other],
    );
    expect(results.every((r) => r.properties.pno !== '00100')).toBe(true);
  });

  it('returns at most count results', () => {
    const target = makeFeature('00100', baseProps);
    const features = [target];
    for (let i = 1; i <= 20; i++) {
      features.push(makeFeature(`001${String(i).padStart(2, '0')}`, {
        ...baseProps,
        hr_mtu: 30000 + i * 1000,
      }));
    }

    const results = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      features,
      3,
    );
    expect(results.length).toBe(3);
  });

  it('handles neighborhoods with missing metrics gracefully', () => {
    const target = makeFeature('00100', baseProps);
    const partial = makeFeature('00200', {
      hr_mtu: 30000,
      // All other metrics are null/missing
    });
    const full = makeFeature('00300', { ...baseProps, hr_mtu: 30500 });
    const results = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, partial, full],
    );
    // Both should be included; the one with more matching metrics may rank higher
    expect(results.length).toBe(2);
  });

  it('returns empty array when no candidates share any metrics', () => {
    const target = makeFeature('00100', baseProps);
    const empty = makeFeature('00200', {}); // no metrics at all
    const results = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, empty],
    );
    expect(results.length).toBe(0);
  });

  it('provides valid center coordinates', () => {
    const target = makeFeature('00100', baseProps, [24.94, 60.17]);
    const other = makeFeature('00200', { ...baseProps, hr_mtu: 35000 }, [25.0, 60.2]);
    const results = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, other],
    );
    expect(results.length).toBe(1);
    const [lng, lat] = results[0].center;
    // Center should be approximately (25.005, 60.205)
    expect(lng).toBeGreaterThan(24.9);
    expect(lat).toBeGreaterThan(60.1);
  });

  it('normalizes distance by number of metrics used', () => {
    const target = makeFeature('00100', baseProps);
    // Two candidates with identical distance on their shared metrics,
    // but different numbers of available metrics
    const a = makeFeature('00200', {
      hr_mtu: 40000,
      unemployment_rate: 10,
    });
    const b = makeFeature('00300', {
      hr_mtu: 40000,
      unemployment_rate: 10,
      higher_education_rate: 40,
      foreign_language_pct: 10,
      ownership_rate: 50,
    });

    const results = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, a, b],
    );
    // Both should have distance values; neither should be NaN
    for (const r of results) {
      expect(isFinite(r.distance)).toBe(true);
      expect(r.distance).toBeGreaterThanOrEqual(0);
    }
  });

  it('identical neighborhoods have distance 0', () => {
    const target = makeFeature('00100', baseProps);
    const clone = makeFeature('00200', baseProps);
    // Need at least 3 features for non-trivial min/max ranges (otherwise min===max for all metrics)
    const different = makeFeature('00300', {
      ...baseProps,
      hr_mtu: 60000,
      unemployment_rate: 20,
      crime_index: 200,
      population_density: 10000,
    });
    const results = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, clone, different],
    );
    expect(results.length).toBe(2);
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBe(0);
  });
});
