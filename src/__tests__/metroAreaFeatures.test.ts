/**
 * Tests for buildMetroAreaFeatures to prevent regressions where
 * postal code borders appear in the all-cities view.
 *
 * The Map component's line layer filters out features with _isMetroArea: true,
 * so this property MUST be set on all metro area features.
 */
import { describe, it, expect } from 'vitest';
import { buildMetroAreaFeatures } from '../utils/metroAreas';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(
  city: string,
  pno: string,
  coords: number[][][],
): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Area ${pno}`,
      city,
      he_vakiy: 1000,
    } as unknown as NeighborhoodProperties,
    geometry: { type: 'Polygon', coordinates: coords },
  };
}

const square1: number[][][] = [[[24, 60], [25, 60], [25, 61], [24, 61], [24, 60]]];
const square2: number[][][] = [[[25, 60], [26, 60], [26, 61], [25, 61], [25, 60]]];

describe('buildMetroAreaFeatures', () => {
  it('sets _isMetroArea: true on every metro area feature', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', square1),
      makeFeature('helsinki_metro', '00200', square2),
      makeFeature('tampere', '33100', square1),
    ];

    const result = buildMetroAreaFeatures(features);

    expect(result.features.length).toBeGreaterThan(0);
    for (const f of result.features) {
      expect(f.properties?._isMetroArea).toBe(true);
    }
  });

  it('produces one feature per city with neighborhoods', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', square1),
      makeFeature('helsinki_metro', '00200', square2),
      makeFeature('turku', '20100', square1),
    ];

    const result = buildMetroAreaFeatures(features);

    const cities = result.features.map((f) => f.properties?.city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('turku');
    expect(cities).not.toContain('tampere'); // no tampere features provided
    expect(result.features).toHaveLength(2);
  });

  it('uses MultiPolygon geometry type', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', square1),
      makeFeature('helsinki_metro', '00200', square2),
    ];

    const result = buildMetroAreaFeatures(features);

    expect(result.features[0].geometry.type).toBe('MultiPolygon');
  });
});
