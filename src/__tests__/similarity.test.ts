import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, any>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    },
    properties: props,
  };
}

describe('findSimilarNeighborhoods — configurable metrics (CF-6)', () => {
  const target = { pno: '00100', nimi: 'T', namn: 'T', hr_mtu: 30000, crime_index: 50 };
  // A matches the target's income exactly but differs wildly in crime; B is the
  // mirror image. Which one is "most similar" should depend on the chosen metric.
  const features = [
    makeFeature({ pno: '00100', nimi: 'T', namn: 'T', hr_mtu: 30000, crime_index: 50 }),
    makeFeature({ pno: '00200', nimi: 'A', namn: 'A', hr_mtu: 30000, crime_index: 200 }),
    makeFeature({ pno: '00300', nimi: 'B', namn: 'B', hr_mtu: 90000, crime_index: 50 }),
  ];

  it('ranks by income alone when only hr_mtu is selected', () => {
    const r = findSimilarNeighborhoods(target as any, features, 2, ['hr_mtu']);
    expect(r[0].properties.pno).toBe('00200');
  });

  it('ranks by crime alone when only crime_index is selected', () => {
    const r = findSimilarNeighborhoods(target as any, features, 2, ['crime_index']);
    expect(r[0].properties.pno).toBe('00300');
  });

  it('falls back to the default metric set for an empty subset', () => {
    const r = findSimilarNeighborhoods(target as any, features, 2, []);
    expect(r.length).toBeGreaterThan(0);
  });
});

describe('findSimilarNeighborhoods — per-metric weights (CF-5)', () => {
  // Target sits at the low end of both metrics. A matches income but is far on crime;
  // B matches crime but is far on income. With equal weights they tie; tilting the
  // weight toward one metric must break the tie toward the candidate that matches it.
  const target = { pno: '00100', nimi: 'T', namn: 'T', hr_mtu: 0, crime_index: 0 };
  const features = [
    makeFeature({ pno: '00100', nimi: 'T', namn: 'T', hr_mtu: 0, crime_index: 0 }),
    makeFeature({ pno: '00200', nimi: 'A', namn: 'A', hr_mtu: 0, crime_index: 100 }),
    makeFeature({ pno: '00300', nimi: 'B', namn: 'B', hr_mtu: 100, crime_index: 0 }),
  ];

  it('ties when both metrics carry equal weight', () => {
    const r = findSimilarNeighborhoods(target as any, features, 2, ['hr_mtu', 'crime_index'], { hr_mtu: 1, crime_index: 1 });
    expect(r[0].distance).toBeCloseTo(r[1].distance, 10);
  });

  it('prefers the income-matching candidate when income is weighted higher', () => {
    // Heavier income weight punishes B (income mismatch) more than A.
    const r = findSimilarNeighborhoods(target as any, features, 2, ['hr_mtu', 'crime_index'], { hr_mtu: 3, crime_index: 1 });
    expect(r[0].properties.pno).toBe('00200');
  });

  it('prefers the crime-matching candidate when crime is weighted higher', () => {
    const r = findSimilarNeighborhoods(target as any, features, 2, ['hr_mtu', 'crime_index'], { hr_mtu: 1, crime_index: 3 });
    expect(r[0].properties.pno).toBe('00300');
  });

  it('a weight of 0 excludes a metric exactly like deselecting it', () => {
    const weighted = findSimilarNeighborhoods(target as any, features, 3, ['hr_mtu', 'crime_index'], { hr_mtu: 1, crime_index: 0 });
    const subset = findSimilarNeighborhoods(target as any, features, 3, ['hr_mtu']);
    expect(weighted.map((r) => r.properties.pno)).toEqual(subset.map((r) => r.properties.pno));
    weighted.forEach((r, i) => expect(r.distance).toBeCloseTo(subset[i].distance, 10));
  });

  it('all-default weights reproduce the unweighted distances', () => {
    const weighted = findSimilarNeighborhoods(target as any, features, 3, ['hr_mtu', 'crime_index'], { hr_mtu: 1, crime_index: 1 });
    const plain = findSimilarNeighborhoods(target as any, features, 3, ['hr_mtu', 'crime_index']);
    weighted.forEach((r, i) => {
      expect(r.properties.pno).toBe(plain[i].properties.pno);
      expect(r.distance).toBeCloseTo(plain[i].distance, 10);
    });
  });

  it('scaling all weights uniformly does not change distances', () => {
    // Distance normalizes by total weight, so 2× every weight cancels out.
    const w1 = findSimilarNeighborhoods(target as any, features, 3, ['hr_mtu', 'crime_index'], { hr_mtu: 1, crime_index: 1 });
    const w2 = findSimilarNeighborhoods(target as any, features, 3, ['hr_mtu', 'crime_index'], { hr_mtu: 2, crime_index: 2 });
    w1.forEach((r, i) => expect(r.distance).toBeCloseTo(w2[i].distance, 10));
  });
});

describe('findSimilarNeighborhoods', () => {
  it('returns the correct number of results', () => {
    const target = {
      pno: '00100',
      nimi: 'Target',
      namn: 'Target',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    };

    const features = [
      makeFeature({ pno: '00100', nimi: 'Target', namn: 'Target', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', nimi: 'A', namn: 'A', hr_mtu: 31000, unemployment_rate: 11, higher_education_rate: 51 }),
      makeFeature({ pno: '00300', nimi: 'B', namn: 'B', hr_mtu: 32000, unemployment_rate: 12, higher_education_rate: 52 }),
      makeFeature({ pno: '00400', nimi: 'C', namn: 'C', hr_mtu: 33000, unemployment_rate: 13, higher_education_rate: 53 }),
      makeFeature({ pno: '00500', nimi: 'D', namn: 'D', hr_mtu: 34000, unemployment_rate: 14, higher_education_rate: 54 }),
      makeFeature({ pno: '00600', nimi: 'E', namn: 'E', hr_mtu: 35000, unemployment_rate: 15, higher_education_rate: 55 }),
      makeFeature({ pno: '00700', nimi: 'F', namn: 'F', hr_mtu: 50000, unemployment_rate: 20, higher_education_rate: 80 }),
    ];

    const result = findSimilarNeighborhoods(target as any, features, 3);
    expect(result).toHaveLength(3);
  });

  it('excludes the target neighborhood from results', () => {
    const target = {
      pno: '00100',
      nimi: 'Target',
      namn: 'Target',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    };

    const features = [
      makeFeature({ pno: '00100', nimi: 'Target', namn: 'Target', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', nimi: 'A', namn: 'A', hr_mtu: 31000, unemployment_rate: 11, higher_education_rate: 51 }),
      makeFeature({ pno: '00300', nimi: 'B', namn: 'B', hr_mtu: 50000, unemployment_rate: 20, higher_education_rate: 80 }),
    ];

    const result = findSimilarNeighborhoods(target as any, features, 5);
    const pnos = result.map((r) => r.properties.pno);
    expect(pnos).not.toContain('00100');
  });

  it('handles empty features array', () => {
    const target = {
      pno: '00100',
      nimi: 'Target',
      namn: 'Target',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    };

    const result = findSimilarNeighborhoods(target as any, [], 5);
    expect(result).toHaveLength(0);
  });

  it('handles features with null metrics', () => {
    const target = {
      pno: '00100',
      nimi: 'Target',
      namn: 'Target',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    };

    const features = [
      makeFeature({ pno: '00100', nimi: 'Target', namn: 'Target', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', nimi: 'A', namn: 'A', hr_mtu: null, unemployment_rate: null, higher_education_rate: null }),
      makeFeature({ pno: '00300', nimi: 'B', namn: 'B', hr_mtu: 35000, unemployment_rate: 12, higher_education_rate: 55 }),
    ];

    const result = findSimilarNeighborhoods(target as any, features, 5);
    // Feature with all null metrics should be excluded (no comparable metrics)
    const pnos = result.map((r) => r.properties.pno);
    expect(pnos).not.toContain('00200');
    expect(pnos).toContain('00300');
  });

  it('returns distance of 0 for identical neighborhoods', () => {
    const target = {
      pno: '00100',
      nimi: 'Target',
      namn: 'Target',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    };

    const features = [
      makeFeature({ pno: '00100', nimi: 'Target', namn: 'Target', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      // Same metrics, different pno
      makeFeature({ pno: '00200', nimi: 'Clone', namn: 'Clone', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      // Different metrics to establish a min-max range
      makeFeature({ pno: '00300', nimi: 'Different', namn: 'Different', hr_mtu: 50000, unemployment_rate: 20, higher_education_rate: 80 }),
    ];

    const result = findSimilarNeighborhoods(target as any, features, 5);
    const clone = result.find((r) => r.properties.pno === '00200');
    expect(clone).toBeDefined();
    expect(clone!.distance).toBe(0);
  });
});
