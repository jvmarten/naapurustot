/**
 * Tests for similarity.ts cache invalidation across dataset switches.
 *
 * The similarity module caches min/max ranges keyed by array reference identity.
 * Bug: if the dataset array changes (e.g. user switches region), stale ranges
 * could produce incorrect similarity results.
 *
 * These tests verify:
 * 1. Ranges are recomputed when dataset reference changes
 * 2. Results are correct after switching datasets
 * 3. Same dataset reference uses cached ranges (performance)
 */
import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[25, 60], [25.01, 60], [25.01, 60.01], [25, 60.01], [25, 60]]] },
    properties: { pno: '00000', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki', ...props } as NeighborhoodProperties,
  };
}

describe('similarity — cache invalidation on dataset change', () => {
  it('returns correct results when switching between different datasets', () => {
    // Dataset 1: incomes range 20k-40k
    const dataset1 = [
      makeFeature({ pno: '00100', hr_mtu: 20000 }),
      makeFeature({ pno: '00200', hr_mtu: 30000 }),
      makeFeature({ pno: '00300', hr_mtu: 40000 }),
    ];

    // Dataset 2: incomes range 50k-90k (completely different range)
    const dataset2 = [
      makeFeature({ pno: '10100', hr_mtu: 50000 }),
      makeFeature({ pno: '10200', hr_mtu: 70000 }),
      makeFeature({ pno: '10300', hr_mtu: 90000 }),
    ];

    const target1 = dataset1[0].properties as NeighborhoodProperties;
    const target2 = dataset2[0].properties as NeighborhoodProperties;

    // Query dataset 1
    const results1 = findSimilarNeighborhoods(target1, dataset1, 2);
    expect(results1.length).toBe(2);
    // 00200 (30k) is closer to 00100 (20k) than 00300 (40k)
    expect(results1[0].properties.pno).toBe('00200');
    expect(results1[1].properties.pno).toBe('00300');

    // Switch to dataset 2 — cache should invalidate
    const results2 = findSimilarNeighborhoods(target2, dataset2, 2);
    expect(results2.length).toBe(2);
    // 10200 (70k) is closer to 10100 (50k) than 10300 (90k)
    expect(results2[0].properties.pno).toBe('10200');
    expect(results2[1].properties.pno).toBe('10300');
  });

  it('switching back to original dataset recomputes correctly', () => {
    const datasetA = [
      makeFeature({ pno: '00100', hr_mtu: 10000, unemployment_rate: 5 }),
      makeFeature({ pno: '00200', hr_mtu: 20000, unemployment_rate: 10 }),
      makeFeature({ pno: '00300', hr_mtu: 30000, unemployment_rate: 15 }),
    ];

    const datasetB = [
      makeFeature({ pno: '20100', hr_mtu: 80000, unemployment_rate: 2 }),
      makeFeature({ pno: '20200', hr_mtu: 85000, unemployment_rate: 3 }),
      makeFeature({ pno: '20300', hr_mtu: 90000, unemployment_rate: 4 }),
    ];

    const targetA = datasetA[0].properties as NeighborhoodProperties;

    // First call with A
    const firstA = findSimilarNeighborhoods(targetA, datasetA, 2);

    // Switch to B
    const targetB = datasetB[0].properties as NeighborhoodProperties;
    findSimilarNeighborhoods(targetB, datasetB, 2);

    // Switch back to A — must NOT use stale B ranges
    // Need a new array reference to trigger cache invalidation
    const datasetA2 = [...datasetA];
    const secondA = findSimilarNeighborhoods(targetA, datasetA2, 2);

    // Results should still be correct (same relative distances)
    expect(secondA[0].properties.pno).toBe(firstA[0].properties.pno);
    expect(secondA[1].properties.pno).toBe(firstA[1].properties.pno);
  });

  it('same array reference reuses cache (performance)', () => {
    const dataset = [
      makeFeature({ pno: '00100', hr_mtu: 25000 }),
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
      makeFeature({ pno: '00300', hr_mtu: 45000 }),
    ];

    const target = dataset[0].properties as NeighborhoodProperties;

    // Call twice with same array reference
    const first = findSimilarNeighborhoods(target, dataset, 2);
    const second = findSimilarNeighborhoods(target, dataset, 2);

    // Same results (cache hit)
    expect(first[0].properties.pno).toBe(second[0].properties.pno);
    expect(first[0].distance).toBe(second[0].distance);
  });
});

describe('similarity — edge cases', () => {
  it('target not in dataset returns all other features', () => {
    const dataset = [
      makeFeature({ pno: '00100', hr_mtu: 25000 }),
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
    ];
    const target: NeighborhoodProperties = {
      pno: '99999', nimi: 'External', namn: 'External',
      hr_mtu: 30000, kunta: null, city: null,
    } as NeighborhoodProperties;

    const results = findSimilarNeighborhoods(target, dataset, 5);
    expect(results.length).toBe(2);
  });

  it('all neighborhoods with identical metrics have distance 0', () => {
    const dataset = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 5 }),
      makeFeature({ pno: '00200', hr_mtu: 30000, unemployment_rate: 5 }),
      makeFeature({ pno: '00300', hr_mtu: 30000, unemployment_rate: 5 }),
    ];
    const target = dataset[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, dataset, 2);
    // All features are identical, distance should be 0
    for (const r of results) {
      expect(r.distance).toBe(0);
    }
  });

  it('features with all null metrics are excluded', () => {
    const dataset = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: null, unemployment_rate: null, higher_education_rate: null }),
      makeFeature({ pno: '00300', hr_mtu: 40000 }),
    ];
    const target = dataset[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, dataset, 5);
    // 00200 has no comparable metrics, so it should be excluded
    const pnos = results.map(r => r.properties.pno);
    expect(pnos).not.toContain('00200');
    expect(pnos).toContain('00300');
  });

  it('count parameter limits results', () => {
    const dataset = Array.from({ length: 20 }, (_, i) =>
      makeFeature({ pno: String(i).padStart(5, '0'), hr_mtu: 20000 + i * 1000 })
    );
    const target = dataset[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, dataset, 3);
    expect(results.length).toBe(3);
  });
});
