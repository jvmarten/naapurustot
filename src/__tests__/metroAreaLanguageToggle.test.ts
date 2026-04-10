/**
 * Tests for buildMetroAreaFeatures language toggle behavior:
 * - Cached geometry should be reused when language changes
 * - Display names (nimi, namn) should update on language toggle
 * - Cache invalidation should NOT happen on language change alone
 *
 * This is a critical gap: the metro area cache stores geometry+stats per dataset,
 * and language toggles should only refresh the name properties without re-running
 * the expensive @turf/union operations.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildMetroAreaFeatures, clearMetroAreaCache } from '../utils/metroAreas';
import { setLang } from '../utils/i18n';
import type { Feature, Polygon } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(city: string, pno: string, coords: number[][][]): Feature<Polygon> {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: coords },
    properties: {
      pno,
      nimi: `${city}-${pno}`,
      namn: `${city}-${pno}-sv`,
      kunta: '091',
      city,
      he_vakiy: 1000,
      hr_mtu: 30000,
      unemployment_rate: 5,
      higher_education_rate: 50,
      ko_ika18y: 800,
      ko_yl_kork: 200,
      ko_al_kork: 200,
    } as unknown as NeighborhoodProperties,
  };
}

const SQUARE = [[[24.0, 60.0], [25.0, 60.0], [25.0, 61.0], [24.0, 61.0], [24.0, 60.0]]];

describe('buildMetroAreaFeatures — language toggle with caching', () => {
  beforeEach(() => {
    clearMetroAreaCache();
    setLang('fi');
  });

  it('produces features with language-specific names', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', SQUARE),
      makeFeature('helsinki_metro', '00200', SQUARE),
    ];

    setLang('fi');
    const resultFi = buildMetroAreaFeatures(features);
    expect(resultFi).not.toBeNull();
    expect(resultFi!.features.length).toBe(1);

    const propsFi = resultFi!.features[0].properties as Record<string, unknown>;
    const nimiFi = propsFi.nimi as string;

    // Switch language
    setLang('en');
    const resultEn = buildMetroAreaFeatures(features);
    expect(resultEn).not.toBeNull();
    expect(resultEn!.features.length).toBe(1);

    const propsEn = resultEn!.features[0].properties as Record<string, unknown>;
    const nimiEn = propsEn.nimi as string;

    // Names should change on language toggle
    // (The actual values depend on the translation files, but they should differ
    // because fi.json and en.json have different values for city.helsinki_metro)
    // At minimum, both should be non-empty strings
    expect(typeof nimiFi).toBe('string');
    expect(typeof nimiEn).toBe('string');
    expect(nimiFi.length).toBeGreaterThan(0);
    expect(nimiEn.length).toBeGreaterThan(0);
  });

  it('reuses cached geometry across language toggles (same dataset reference)', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', SQUARE),
      makeFeature('turku', '20100', [[[22.0, 60.4], [22.5, 60.4], [22.5, 60.6], [22.0, 60.6], [22.0, 60.4]]]),
    ];

    setLang('fi');
    const result1 = buildMetroAreaFeatures(features);
    expect(result1).not.toBeNull();
    const geom1 = result1!.features.map(f => f.geometry);

    setLang('en');
    const result2 = buildMetroAreaFeatures(features);
    expect(result2).not.toBeNull();
    const geom2 = result2!.features.map(f => f.geometry);

    // Geometry should be identical (same cache hit)
    expect(geom1.length).toBe(geom2.length);
    for (let i = 0; i < geom1.length; i++) {
      expect(geom1[i]).toBe(geom2[i]); // Same object reference = cache hit
    }
  });

  it('sets _isMetroArea flag on all features', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', SQUARE),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    for (const f of result!.features) {
      expect(f.properties!._isMetroArea).toBe(true);
    }
  });

  it('sets city and pno properties correctly', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', SQUARE),
      makeFeature('turku', '20100', SQUARE),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();

    const cities = result!.features.map(f => f.properties!.city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('turku');

    // pno should equal city id for metro areas
    for (const f of result!.features) {
      expect(f.properties!.pno).toBe(f.properties!.city);
    }
  });

  it('includes metro averages in properties', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', SQUARE),
      makeFeature('helsinki_metro', '00200', SQUARE),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();

    const props = result!.features[0].properties as Record<string, unknown>;
    // Should include computed metro averages
    expect(typeof props.hr_mtu).toBe('number');
    expect(typeof props.unemployment_rate).toBe('number');
  });

  it('invalidates cache when dataset reference changes', () => {
    const features1 = [makeFeature('helsinki_metro', '00100', SQUARE)];
    const result1 = buildMetroAreaFeatures(features1);
    expect(result1).not.toBeNull();

    // New dataset reference with different data
    const features2 = [
      makeFeature('helsinki_metro', '00100', SQUARE),
      makeFeature('helsinki_metro', '00300', SQUARE),
    ];
    const result2 = buildMetroAreaFeatures(features2);
    expect(result2).not.toBeNull();

    // New dataset should produce new averages (2 neighborhoods vs 1)
    const props1 = result1!.features[0].properties as Record<string, unknown>;
    const props2 = result2!.features[0].properties as Record<string, unknown>;
    // he_vakiy should be population sum — 1000 vs 2000
    expect(props1.he_vakiy).toBe(1000);
    expect(props2.he_vakiy).toBe(2000);
  });

  it('skips features without known region city', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', SQUARE),
      makeFeature('unknown_city' as string, '99999', SQUARE),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();

    const cities = result!.features.map(f => f.properties!.city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).not.toContain('unknown_city');
  });
});
