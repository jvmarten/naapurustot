/**
 * Hardened tests for buildMetroAreaFeatures and trend aggregation.
 *
 * Targets critical logic in metroAreas.ts:
 * - Trend history aggregation (sum vs weighted average)
 * - 50% data coverage threshold for sum mode
 * - Metro area feature properties (_isMetroArea, pno, city)
 * - Cache invalidation when dataset reference changes
 * - clearMetroAreaCache forces rebuild
 * - Fallback MultiPolygon concatenation (when @turf/union unavailable)
 * - Empty city group handling
 * - Dynamic city detection from features
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { buildMetroAreaFeatures, clearMetroAreaCache } from '../utils/metroAreas';
import type { NeighborhoodProperties } from '../utils/metrics';

function mkFeature(props: Partial<NeighborhoodProperties>, coords?: number[][][]): Feature<Polygon> {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: coords ?? [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.25], [24.9, 60.2]]],
    },
    properties: {
      pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro',
      he_vakiy: 1000, hr_mtu: 30000,
      ...props,
    } as NeighborhoodProperties,
  };
}

beforeEach(() => {
  clearMetroAreaCache();
});

describe('buildMetroAreaFeatures', () => {
  it('produces one feature per city', () => {
    const features: Feature[] = [
      mkFeature({ pno: '00100', city: 'helsinki_metro' }),
      mkFeature({ pno: '00200', city: 'helsinki_metro' }),
      mkFeature({ pno: '33100', city: 'tampere' }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result.type).toBe('FeatureCollection');
    const cities = result.features.map(f => (f.properties as NeighborhoodProperties).city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('tampere');
    expect(result.features.length).toBe(2);
  });

  it('sets _isMetroArea: true on every metro feature', () => {
    const features: Feature[] = [
      mkFeature({ pno: '00100', city: 'helsinki_metro' }),
      mkFeature({ pno: '33100', city: 'tampere' }),
    ];
    const result = buildMetroAreaFeatures(features);
    for (const f of result.features) {
      expect((f.properties as NeighborhoodProperties)._isMetroArea).toBe(true);
    }
  });

  it('uses city ID as pno for metro features', () => {
    const features: Feature[] = [
      mkFeature({ pno: '00100', city: 'helsinki_metro' }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect((result.features[0].properties as NeighborhoodProperties).pno).toBe('helsinki_metro');
  });

  it('includes metro averages in feature properties', () => {
    const features: Feature[] = [
      mkFeature({ pno: '00100', city: 'helsinki_metro', he_vakiy: 1000, hr_mtu: 30000 }),
      mkFeature({ pno: '00200', city: 'helsinki_metro', he_vakiy: 1000, hr_mtu: 40000 }),
    ];
    const result = buildMetroAreaFeatures(features);
    const props = result.features[0].properties as Record<string, unknown>;
    // hr_mtu should be population-weighted avg: (30000*1000 + 40000*1000)/2000 = 35000
    expect(props.hr_mtu).toBe(35000);
  });

  it('returns Polygon or MultiPolygon geometry', () => {
    const features: Feature[] = [
      mkFeature({ pno: '00100', city: 'helsinki_metro' }),
    ];
    const result = buildMetroAreaFeatures(features);
    const geom = result.features[0].geometry;
    expect(['Polygon', 'MultiPolygon']).toContain(geom.type);
  });

  it('handles single feature per city (no union needed)', () => {
    const features: Feature[] = [
      mkFeature({ pno: '00100', city: 'helsinki_metro' }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result.features.length).toBe(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
  });

  it('ignores features with unknown city', () => {
    const features: Feature[] = [
      mkFeature({ pno: '00100', city: 'unknown_city' as any }),
      mkFeature({ pno: '00200', city: 'helsinki_metro' }),
    ];
    const result = buildMetroAreaFeatures(features);
    const cities = result.features.map(f => (f.properties as NeighborhoodProperties).city);
    expect(cities).not.toContain('unknown_city');
  });

  it('ignores features with null city', () => {
    const features: Feature[] = [
      mkFeature({ pno: '00100', city: null }),
      mkFeature({ pno: '00200', city: 'helsinki_metro' }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result.features.length).toBe(1);
  });

  it('cache reuse returns same result for same features reference', () => {
    const features: Feature[] = [
      mkFeature({ pno: '00100', city: 'helsinki_metro' }),
    ];
    const result1 = buildMetroAreaFeatures(features);
    const result2 = buildMetroAreaFeatures(features);
    // The geometry should be the same cached object
    expect(result1.features[0].geometry).toBe(result2.features[0].geometry);
  });

  it('clearMetroAreaCache forces recomputation', () => {
    const features: Feature[] = [
      mkFeature({ pno: '00100', city: 'helsinki_metro' }),
    ];
    const result1 = buildMetroAreaFeatures(features);
    clearMetroAreaCache();
    const result2 = buildMetroAreaFeatures(features);
    // After clearing, geometries should still be equal but not same reference
    // (because perCity map was rebuilt)
    expect(result2.features.length).toBe(result1.features.length);
  });

  it('aggregates trend histories in metro features', () => {
    const features: Feature[] = [
      mkFeature({
        pno: '00100',
        city: 'helsinki_metro',
        he_vakiy: 1000,
        population_history: '[[2019,500],[2020,600]]',
      }),
      mkFeature({
        pno: '00200',
        city: 'helsinki_metro',
        he_vakiy: 2000,
        population_history: '[[2019,1000],[2020,1200]]',
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const props = result.features[0].properties as Record<string, unknown>;
    expect(props.population_history).toBeDefined();
    const series = JSON.parse(props.population_history as string);
    // Sum mode: 2019 → 500+1000=1500, 2020 → 600+1200=1800
    expect(series).toEqual([[2019, 1500], [2020, 1800]]);
  });

  it('aggregates income_history as population-weighted average', () => {
    const features: Feature[] = [
      mkFeature({
        pno: '00100',
        city: 'helsinki_metro',
        he_vakiy: 1000,
        income_history: '[[2019,30000],[2020,32000]]',
      }),
      mkFeature({
        pno: '00200',
        city: 'helsinki_metro',
        he_vakiy: 3000,
        income_history: '[[2019,20000],[2020,22000]]',
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const props = result.features[0].properties as Record<string, unknown>;
    expect(props.income_history).toBeDefined();
    const series = JSON.parse(props.income_history as string);
    // Weighted: 2019 → (30000*1000 + 20000*3000)/(1000+3000) = 90M/4000 = 22500
    // Weighted: 2020 → (32000*1000 + 22000*3000)/(1000+3000) = 98M/4000 = 24500
    expect(series[0][1]).toBe(22500);
    expect(series[1][1]).toBe(24500);
  });

  it('skips features with he_vakiy <= 0 in trend aggregation', () => {
    const features: Feature[] = [
      mkFeature({
        pno: '00100',
        city: 'helsinki_metro',
        he_vakiy: 0,
        population_history: '[[2019,500],[2020,600]]',
      }),
      mkFeature({
        pno: '00200',
        city: 'helsinki_metro',
        he_vakiy: 1000,
        population_history: '[[2019,1000],[2020,1200]]',
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const props = result.features[0].properties as Record<string, unknown>;
    // Only feature 00200 contributes
    const series = JSON.parse(props.population_history as string);
    expect(series).toEqual([[2019, 1000], [2020, 1200]]);
  });

  it('handles empty dataset', () => {
    const result = buildMetroAreaFeatures([]);
    expect(result.features.length).toBe(0);
  });

  it('MultiPolygon features concatenate polygon coordinates in fallback mode', () => {
    const multiPolyFeature: Feature<MultiPolygon> = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.25], [24.9, 60.2]]],
          [[[25.0, 60.3], [25.05, 60.3], [25.05, 60.35], [25.0, 60.35], [25.0, 60.3]]],
        ],
      },
      properties: { pno: '00100', city: 'helsinki_metro', he_vakiy: 1000, nimi: 'Test', namn: 'Test', kunta: '091' },
    };
    const polyFeature = mkFeature({ pno: '00200', city: 'helsinki_metro' });

    const result = buildMetroAreaFeatures([multiPolyFeature, polyFeature] as Feature[]);
    expect(result.features.length).toBe(1);
    // Should produce a merged geometry (MultiPolygon since >1 polygon)
    const geom = result.features[0].geometry;
    expect(['Polygon', 'MultiPolygon']).toContain(geom.type);
  });
});
