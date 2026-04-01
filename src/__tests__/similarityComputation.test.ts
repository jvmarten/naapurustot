import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(pno: string, props: Partial<NeighborhoodProperties> = {}): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]],
    },
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Area ${pno}`,
      kunta: '091',
      city: 'helsinki_metro',
      he_vakiy: 1000,
      hr_mtu: 30000,
      unemployment_rate: 5,
      higher_education_rate: 40,
      foreign_language_pct: 10,
      ownership_rate: 50,
      transit_stop_density: 10,
      property_price_sqm: 3000,
      crime_index: 2,
      population_density: 5000,
      child_ratio: 15,
      ...props,
    } as NeighborhoodProperties,
  };
}

describe('findSimilarNeighborhoods', () => {
  it('returns empty array when dataset has only the target', () => {
    const target = makeFeature('00100');
    const result = findSimilarNeighborhoods(target.properties as NeighborhoodProperties, [target]);
    expect(result).toEqual([]);
  });

  it('returns the closest match first', () => {
    const target = makeFeature('00100', { hr_mtu: 30000, unemployment_rate: 5 });
    const similar = makeFeature('00200', { hr_mtu: 31000, unemployment_rate: 5.5 });
    const different = makeFeature('00300', { hr_mtu: 80000, unemployment_rate: 20 });

    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, similar, different],
    );

    expect(result).toHaveLength(2);
    expect(result[0].properties.pno).toBe('00200');
    expect(result[1].properties.pno).toBe('00300');
    expect(result[0].distance).toBeLessThan(result[1].distance);
  });

  it('respects count parameter', () => {
    const target = makeFeature('00100');
    const features = [target];
    for (let i = 1; i <= 10; i++) {
      features.push(makeFeature(`0010${i}`, { hr_mtu: 30000 + i * 1000 }));
    }

    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      features,
      3,
    );
    expect(result).toHaveLength(3);
  });

  it('excludes the target itself from results', () => {
    const target = makeFeature('00100');
    const other = makeFeature('00200');
    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, other],
    );

    const pnos = result.map(r => r.properties.pno);
    expect(pnos).not.toContain('00100');
  });

  it('skips candidates with no valid numeric metrics', () => {
    const target = makeFeature('00100');
    const nullFeature = makeFeature('00200', {
      hr_mtu: null as any,
      unemployment_rate: null as any,
      higher_education_rate: null as any,
      foreign_language_pct: null as any,
      ownership_rate: null as any,
      transit_stop_density: null as any,
      property_price_sqm: null as any,
      crime_index: null as any,
      population_density: null as any,
      child_ratio: null as any,
    });

    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, nullFeature],
    );
    expect(result).toEqual([]);
  });

  it('computes center correctly for Polygon features', () => {
    const target = makeFeature('00100', { hr_mtu: 30000 });
    const other: GeoJSON.Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[25.0, 60.2], [25.1, 60.2], [25.1, 60.3], [25.0, 60.3], [25.0, 60.2]]],
      },
      properties: {
        ...makeFeature('00200', { hr_mtu: 40000 }).properties,
        pno: '00200',
      },
    };

    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, other],
    );

    expect(result).toHaveLength(1);
    const [lng, lat] = result[0].center;
    // Bounding box center: (25.0+25.1)/2=25.05, (60.2+60.3)/2=60.25
    expect(lng).toBeCloseTo(25.05, 1);
    expect(lat).toBeCloseTo(60.25, 1);
  });

  it('computes center for MultiPolygon features', () => {
    const target = makeFeature('00100', { hr_mtu: 30000 });
    const other: GeoJSON.Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[25.0, 60.0], [25.1, 60.0], [25.1, 60.1], [25.0, 60.1], [25.0, 60.0]]],
          [[[26.0, 61.0], [26.1, 61.0], [26.1, 61.1], [26.0, 61.1], [26.0, 61.0]]],
        ],
      },
      properties: { ...makeFeature('00200', { hr_mtu: 40000 }).properties, pno: '00200' },
    };

    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, other],
    );

    expect(result).toHaveLength(1);
    // Center should be average of all coordinates
    expect(result[0].center[0]).toBeGreaterThan(25);
    expect(result[0].center[1]).toBeGreaterThan(60);
  });

  it('distance is zero for identical neighborhoods', () => {
    const target = makeFeature('00100', { hr_mtu: 30000 });
    const twin = makeFeature('00200', { hr_mtu: 30000 }); // Same values
    // Need a third feature with different values to establish valid ranges
    const different = makeFeature('00300', { hr_mtu: 60000, unemployment_rate: 20, higher_education_rate: 10 });

    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, twin, different],
    );

    expect(result.length).toBeGreaterThanOrEqual(1);
    const twinResult = result.find(r => r.properties.pno === '00200');
    expect(twinResult).toBeDefined();
    expect(twinResult!.distance).toBe(0);
  });

  it('normalizes distance by number of metrics used', () => {
    const target = makeFeature('00100', { hr_mtu: 30000 });
    const slightlyDiff = makeFeature('00200', { hr_mtu: 35000 });
    const veryDiff = makeFeature('00300', { hr_mtu: 80000, unemployment_rate: 25 });

    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, slightlyDiff, veryDiff],
    );

    // slightlyDiff should be closer than veryDiff
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].properties.pno).toBe('00200');
    expect(result[0].distance).toBeLessThan(result[1].distance);
  });

  it('handles empty features array', () => {
    const target = makeFeature('00100');
    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [],
    );
    expect(result).toEqual([]);
  });

  it('handles features with null properties gracefully', () => {
    const target = makeFeature('00100');
    const nullPropFeature: GeoJSON.Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.1] },
      properties: null,
    };

    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, nullPropFeature],
    );
    // Null properties feature should be skipped
    expect(result).toEqual([]);
  });
});
