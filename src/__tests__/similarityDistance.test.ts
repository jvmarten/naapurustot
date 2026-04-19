import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      kunta: '091',
      city: 'helsinki_metro',
      ...props,
    } as NeighborhoodProperties,
    geometry: { type: 'Polygon', coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]] },
  };
}

describe('findSimilarNeighborhoods — distance normalization', () => {
  it('normalizes distance by number of available metrics', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'Target', namn: 'Target', kunta: '091', city: 'helsinki_metro',
      hr_mtu: 35000, unemployment_rate: 5,
    } as NeighborhoodProperties;

    // Need 3+ distinct values per metric so min!=max (otherwise range is excluded)
    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 35000, unemployment_rate: 5 }),
      makeFeature({ pno: '00200', hr_mtu: 35000, unemployment_rate: null }),
      makeFeature({ pno: '00300', hr_mtu: 35000, unemployment_rate: 5 }),
      makeFeature({ pno: '00400', hr_mtu: 50000, unemployment_rate: 15 }),
    ];

    const results = findSimilarNeighborhoods(target, allFeatures, 5);

    // 00300 has 0 distance (identical on 2 metrics)
    const match300 = results.find(r => r.properties.pno === '00300');
    expect(match300).toBeDefined();
    expect(match300!.distance).toBe(0);

    // 00200 has 0 distance on the one shared metric (hr_mtu identical)
    const match200 = results.find(r => r.properties.pno === '00200');
    expect(match200).toBeDefined();
    expect(match200!.distance).toBe(0);
  });

  it('never returns the target neighborhood itself', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'Target', namn: 'Target', kunta: '091', city: 'helsinki_metro',
      hr_mtu: 35000, unemployment_rate: 5,
    } as NeighborhoodProperties;

    // Need 3+ distinct values so min!=max
    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 35000, unemployment_rate: 5 }),
      makeFeature({ pno: '00200', hr_mtu: 35000, unemployment_rate: 5 }),
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 15 }),
    ];

    const results = findSimilarNeighborhoods(target, allFeatures, 10);
    expect(results.every(r => r.properties.pno !== '00100')).toBe(true);
    expect(results.length).toBe(2);
  });

  it('returns empty when all candidates have no comparable metrics', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'Target', namn: 'Target', kunta: '091', city: 'helsinki_metro',
      hr_mtu: 35000,
    } as NeighborhoodProperties;

    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 35000 }),
      makeFeature({ pno: '00200', hr_mtu: null }),
    ];

    // 00200 has no hr_mtu, and target has no other metrics.
    // The candidate should have 0 usedMetrics and be excluded.
    // BUT: hr_mtu min=max=35000, so range is excluded from mins/maxs
    const results = findSimilarNeighborhoods(target, allFeatures, 5);
    // With only one value (35000) for hr_mtu, min===max, so it's excluded from similarity
    expect(results.length).toBe(0);
  });

  it('sorts results by ascending distance', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'Target', namn: 'Target', kunta: '091', city: 'helsinki_metro',
      hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50,
    } as NeighborhoodProperties;

    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50 }),
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 15, higher_education_rate: 10 }),
      makeFeature({ pno: '00400', hr_mtu: 32000, unemployment_rate: 6, higher_education_rate: 48 }),
    ];

    const results = findSimilarNeighborhoods(target, allFeatures, 5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('respects the count parameter', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'Target', namn: 'Target', kunta: '091', city: 'helsinki_metro',
      hr_mtu: 30000,
    } as NeighborhoodProperties;

    const allFeatures = Array.from({ length: 20 }, (_, i) =>
      makeFeature({ pno: String(i).padStart(5, '0'), hr_mtu: 30000 + i * 1000 }),
    );

    const results = findSimilarNeighborhoods(target, allFeatures, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('computes center coordinates for results', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'Target', namn: 'Target', kunta: '091', city: 'helsinki_metro',
      hr_mtu: 30000, unemployment_rate: 5,
    } as NeighborhoodProperties;

    // Need 3+ distinct values so min!=max
    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 5 }),
      makeFeature({ pno: '00200', hr_mtu: 30000, unemployment_rate: 5 }),
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 15 }),
    ];

    const results = findSimilarNeighborhoods(target, allFeatures, 5);
    expect(results.length).toBe(2);
    const closest = results[0];
    expect(closest.center).toBeDefined();
    expect(closest.center[0]).toBeCloseTo(24.95, 1);
    expect(closest.center[1]).toBeCloseTo(60.15, 1);
  });
});
