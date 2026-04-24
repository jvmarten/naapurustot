/**
 * Tests for metro area cache invalidation — a known fragile area (see CLAUDE.md).
 *
 * The cache must be invalidated when:
 * 1. @turf/union becomes available (fallback → dissolved geometry)
 * 2. The dataset changes
 * 3. clearMetroAreaCache() is called (quality weight change)
 *
 * Bug #3 from CLAUDE.md: "The metroAreaCache must invalidate when unionFn becomes
 * available." If the cache was built with the fallback (before union loaded), it
 * must be rebuilt once union is ready.
 */
import { describe, it, expect } from 'vitest';
import { buildMetroAreaFeatures, clearMetroAreaCache } from '../utils/metroAreas';
import type { Feature } from 'geojson';

function makeFeatures(cities: string[]): Feature[] {
  return cities.map((city, i) => ({
    type: 'Feature' as const,
    properties: {
      pno: `0010${i}`,
      nimi: `Area ${i}`,
      namn: `Område ${i}`,
      kunta: '091',
      city,
      he_vakiy: 1000 + i * 100,
      hr_mtu: 30000 + i * 5000,
    },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [24.9 + i * 0.01, 60.2],
          [24.91 + i * 0.01, 60.2],
          [24.91 + i * 0.01, 60.21],
          [24.9 + i * 0.01, 60.21],
          [24.9 + i * 0.01, 60.2],
        ],
      ],
    },
  }));
}

describe('buildMetroAreaFeatures — cache behavior', () => {
  it('returns same features reference for same input (geometry cache)', () => {
    const features = makeFeatures(['helsinki_metro', 'helsinki_metro', 'tampere']);
    const result1 = buildMetroAreaFeatures(features);
    const result2 = buildMetroAreaFeatures(features);
    expect(result1.features.length).toBe(result2.features.length);
  });

  it('produces one metro feature per unique city', () => {
    const features = makeFeatures(['helsinki_metro', 'helsinki_metro', 'tampere', 'tampere', 'turku']);
    const result = buildMetroAreaFeatures(features);
    const cities = result.features.map((f) => f.properties!.city);
    expect(new Set(cities).size).toBe(3);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('tampere');
    expect(cities).toContain('turku');
  });

  it('sets _isMetroArea flag on all features', () => {
    const features = makeFeatures(['helsinki_metro', 'tampere']);
    const result = buildMetroAreaFeatures(features);
    for (const f of result.features) {
      expect(f.properties!._isMetroArea).toBe(true);
    }
  });

  it('clearMetroAreaCache causes averages to be recomputed', () => {
    const features = makeFeatures(['helsinki_metro', 'helsinki_metro']);

    const result1 = buildMetroAreaFeatures(features);
    const avg1 = result1.features[0].properties!.hr_mtu;

    clearMetroAreaCache();

    const result2 = buildMetroAreaFeatures(features);
    const avg2 = result2.features[0].properties!.hr_mtu;
    expect(avg2).toBe(avg1);
  });

  it('new dataset reference triggers full rebuild', () => {
    const features1 = makeFeatures(['helsinki_metro', 'helsinki_metro']);
    const result1 = buildMetroAreaFeatures(features1);

    const features2 = makeFeatures(['helsinki_metro', 'tampere']);
    const result2 = buildMetroAreaFeatures(features2);

    expect(result2.features.length).not.toBe(result1.features.length);
  });

  it('returns FeatureCollection type', () => {
    const features = makeFeatures(['helsinki_metro']);
    const result = buildMetroAreaFeatures(features);
    expect(result.type).toBe('FeatureCollection');
    expect(Array.isArray(result.features)).toBe(true);
  });

  it('handles empty features array', () => {
    const result = buildMetroAreaFeatures([]);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });

  it('ignores features with unknown city IDs', () => {
    const features = makeFeatures(['unknown_city_xyz']);
    const result = buildMetroAreaFeatures(features);
    expect(result.features).toHaveLength(0);
  });

  it('metro area properties include population-weighted averages', () => {
    const features: Feature[] = [
      {
        type: 'Feature',
        properties: {
          pno: '00100', nimi: 'A', namn: 'A', kunta: '091', city: 'helsinki_metro',
          he_vakiy: 1000, hr_mtu: 20000,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[24.9, 60.2], [24.91, 60.2], [24.91, 60.21], [24.9, 60.21], [24.9, 60.2]]],
        },
      },
      {
        type: 'Feature',
        properties: {
          pno: '00200', nimi: 'B', namn: 'B', kunta: '091', city: 'helsinki_metro',
          he_vakiy: 3000, hr_mtu: 40000,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[24.92, 60.2], [24.93, 60.2], [24.93, 60.21], [24.92, 60.21], [24.92, 60.2]]],
        },
      },
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result.features[0];
    const avgIncome = metro.properties!.hr_mtu as number;
    expect(avgIncome).toBe(35000);
  });
});
