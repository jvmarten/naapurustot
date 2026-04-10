/**
 * Integration test for the full data processing pipeline:
 * processTopology (private) flow tested via its constituent parts:
 * 1. String-to-number coercion (dataLoader pattern)
 * 2. Island filtering (geometryFilter)
 * 3. Quality index computation
 * 4. Change metrics computation
 * 5. Quick-win metrics computation
 * 6. Metro averages computation
 *
 * This test verifies the full pipeline produces correct, internally consistent results.
 */
import { describe, it, expect } from 'vitest';
import { computeQualityIndices } from '../utils/qualityIndex';
import { computeChangeMetrics, computeQuickWinMetrics, computeMetroAverages, parseTrendSeries } from '../utils/metrics';
import { filterSmallIslands } from '../utils/geometryFilter';
import type { Feature, FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

// Simulate the processTopology pipeline with string-typed properties
// (as they arrive from TopoJSON quantization)
const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta']);

function coerceProperties(features: Feature[]): void {
  for (const feat of features) {
    if (!feat.properties) continue;
    for (const key of Object.keys(feat.properties)) {
      if (ID_FIELDS.has(key)) continue;
      const v = feat.properties[key];
      if (typeof v === 'string' && v.trim() !== '') {
        const num = Number(v);
        if (isFinite(num)) feat.properties[key] = num;
      }
    }
  }
}

function makeRawFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.0, 60.0], [25.0, 60.0], [25.0, 61.0], [24.0, 61.0], [24.0, 60.0]]],
    },
    properties: props,
  };
}

describe('data pipeline integration — string coercion', () => {
  it('converts string-typed numeric properties to numbers', () => {
    const features = [
      makeRawFeature({
        pno: '00100',
        nimi: 'Helsinki keskusta',
        kunta: '091',
        he_vakiy: '5000',
        hr_mtu: '35000',
        unemployment_rate: '4.5',
        higher_education_rate: '65.2',
      }),
    ];
    coerceProperties(features);
    const p = features[0].properties!;
    expect(typeof p.he_vakiy).toBe('number');
    expect(p.he_vakiy).toBe(5000);
    expect(typeof p.hr_mtu).toBe('number');
    expect(p.hr_mtu).toBe(35000);
    expect(typeof p.unemployment_rate).toBe('number');
    expect(p.unemployment_rate).toBeCloseTo(4.5);
    expect(typeof p.higher_education_rate).toBe('number');
    expect(p.higher_education_rate).toBeCloseTo(65.2);
  });

  it('preserves ID fields as strings (pno, kunta)', () => {
    const features = [
      makeRawFeature({
        pno: '00100',
        kunta: '091',
        postinumeroalue: '00100',
        he_vakiy: '1000',
      }),
    ];
    coerceProperties(features);
    const p = features[0].properties!;
    expect(typeof p.pno).toBe('string');
    expect(p.pno).toBe('00100');
    expect(typeof p.kunta).toBe('string');
    expect(p.kunta).toBe('091');
    expect(typeof p.postinumeroalue).toBe('string');
  });

  it('does not coerce empty strings to 0', () => {
    const features = [
      makeRawFeature({ pno: '00100', some_field: '' }),
    ];
    coerceProperties(features);
    expect(features[0].properties!.some_field).toBe('');
  });

  it('does not coerce whitespace-only strings', () => {
    const features = [
      makeRawFeature({ pno: '00100', some_field: '   ' }),
    ];
    coerceProperties(features);
    expect(features[0].properties!.some_field).toBe('   ');
  });

  it('handles scientific notation strings', () => {
    const features = [
      makeRawFeature({ pno: '00100', value: '1.5e4' }),
    ];
    coerceProperties(features);
    expect(features[0].properties!.value).toBe(15000);
  });

  it('does not coerce NaN/Infinity strings', () => {
    const features = [
      makeRawFeature({ pno: '00100', a: 'NaN', b: 'Infinity', c: '-Infinity' }),
    ];
    coerceProperties(features);
    // NaN: Number('NaN') returns NaN, isFinite(NaN) = false → not coerced
    expect(features[0].properties!.a).toBe('NaN');
    // Infinity: Number('Infinity') returns Infinity, isFinite(Infinity) = false → not coerced
    expect(features[0].properties!.b).toBe('Infinity');
    expect(features[0].properties!.c).toBe('-Infinity');
  });
});

describe('data pipeline integration — full pipeline', () => {
  it('processes features through coercion → island filter → quality index → change metrics → metro averages', () => {
    const rawFeatures = [
      makeRawFeature({
        pno: '00100', nimi: 'Neighborhood A', namn: 'A', kunta: '091', city: 'helsinki_metro',
        he_vakiy: '2000', hr_mtu: '35000', crime_index: '15', unemployment_rate: '4',
        higher_education_rate: '60', transit_stop_density: '50',
        healthcare_density: '5', school_density: '3', daycare_density: '4', grocery_density: '6',
        air_quality_index: '22', ko_ika18y: '1600', ko_yl_kork: '500', ko_al_kork: '300',
        pt_tyott: '80', pt_vakiy: '1600', pt_tyoll: '1200',
        income_history: '[[2018,32000],[2019,33000],[2020,34000],[2021,35000]]',
        he_18_19: '50', he_20_24: '100', he_25_29: '150',
        he_naiset: '1050', he_miehet: '950', te_taly: '800',
      }),
      makeRawFeature({
        pno: '00200', nimi: 'Neighborhood B', namn: 'B', kunta: '091', city: 'helsinki_metro',
        he_vakiy: '3000', hr_mtu: '45000', crime_index: '8', unemployment_rate: '3',
        higher_education_rate: '70', transit_stop_density: '80',
        healthcare_density: '7', school_density: '5', daycare_density: '6', grocery_density: '8',
        air_quality_index: '18', ko_ika18y: '2400', ko_yl_kork: '1000', ko_al_kork: '500',
        pt_tyott: '72', pt_vakiy: '2400', pt_tyoll: '2000',
        income_history: '[[2018,40000],[2019,41000],[2020,43000],[2021,45000]]',
        he_18_19: '80', he_20_24: '200', he_25_29: '250',
        he_naiset: '1600', he_miehet: '1400', te_taly: '1200',
      }),
    ];

    // Step 1: Coerce string properties
    coerceProperties(rawFeatures);
    expect(typeof rawFeatures[0].properties!.he_vakiy).toBe('number');

    // Step 2: Filter small islands (no-op for single polygons)
    const filtered = filterSmallIslands(rawFeatures);
    expect(filtered.length).toBe(2);

    // Step 3: Compute quality indices
    computeQualityIndices(filtered);
    const qiA = (filtered[0].properties as NeighborhoodProperties).quality_index;
    const qiB = (filtered[1].properties as NeighborhoodProperties).quality_index;
    expect(qiA).not.toBeNull();
    expect(qiB).not.toBeNull();
    // B should score higher (lower crime, higher income, better education)
    expect(qiB!).toBeGreaterThan(qiA!);

    // Step 4: Compute change metrics
    computeChangeMetrics(filtered);
    const incomeChangeA = (filtered[0].properties as NeighborhoodProperties).income_change_pct;
    expect(incomeChangeA).not.toBeNull();
    // Income went from 32000 to 35000 = +9.375%
    expect(incomeChangeA!).toBeCloseTo(9.375, 1);

    // Step 5: Compute quick-win metrics
    computeQuickWinMetrics(filtered);
    const youthA = (filtered[0].properties as NeighborhoodProperties).youth_ratio_pct;
    expect(youthA).not.toBeNull();
    // (50+100+150)/2000 * 100 = 15%
    expect(youthA!).toBeCloseTo(15, 1);

    const genderA = (filtered[0].properties as NeighborhoodProperties).gender_ratio;
    expect(genderA).not.toBeNull();
    // 1050/950 ≈ 1.11
    expect(genderA!).toBeCloseTo(1.11, 2);

    // Step 6: Compute metro averages
    const averages = computeMetroAverages(filtered);
    expect(averages.he_vakiy).toBe(5000);
    // Population-weighted income: (35000*2000 + 45000*3000) / 5000 = 41000
    expect(averages.hr_mtu).toBe(41000);
    // Unemployment: (80+72) / (1600+2400) = 152/4000 = 3.8%
    expect(averages.unemployment_rate).toBeCloseTo(3.8, 1);
  });
});

describe('parseTrendSeries — edge cases', () => {
  it('rejects arrays with fewer than 2 data points', () => {
    expect(parseTrendSeries('[[2020, 100]]')).toBeNull();
  });

  it('rejects arrays with non-array elements', () => {
    expect(parseTrendSeries('[100, 200, 300]')).toBeNull();
  });

  it('rejects arrays with wrong-length inner arrays', () => {
    expect(parseTrendSeries('[[2020, 100, 999], [2021, 200, 888]]')).toBeNull();
  });

  it('rejects arrays containing NaN values', () => {
    expect(parseTrendSeries('[[2020, NaN], [2021, 200]]')).toBeNull();
  });

  it('rejects non-JSON strings', () => {
    expect(parseTrendSeries('not json')).toBeNull();
  });

  it('rejects null and undefined', () => {
    expect(parseTrendSeries(null)).toBeNull();
    expect(parseTrendSeries(undefined)).toBeNull();
  });

  it('accepts valid trend series', () => {
    const result = parseTrendSeries('[[2018, 100], [2019, 110], [2020, 120]]');
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    expect(result![0]).toEqual([2018, 100]);
  });

  it('accepts negative values in trend series', () => {
    const result = parseTrendSeries('[[2018, -5.5], [2019, 3.2]]');
    expect(result).not.toBeNull();
    expect(result![0][1]).toBe(-5.5);
  });
});

describe('computeChangeMetrics — edge cases', () => {
  it('returns null for features with no history', () => {
    const features = [makeRawFeature({ pno: '00100' })];
    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeNull();
    expect((features[0].properties as NeighborhoodProperties).population_change_pct).toBeNull();
  });

  it('computes negative change correctly', () => {
    const features = [
      makeRawFeature({
        pno: '00100',
        income_history: '[[2018, 40000], [2021, 30000]]',
      }),
    ];
    computeChangeMetrics(features);
    const change = (features[0].properties as NeighborhoodProperties).income_change_pct;
    expect(change).not.toBeNull();
    // (30000-40000)/40000 * 100 = -25%
    expect(change!).toBeCloseTo(-25, 1);
  });

  it('returns null when first value is zero (division by zero)', () => {
    const features = [
      makeRawFeature({
        pno: '00100',
        income_history: '[[2018, 0], [2021, 30000]]',
      }),
    ];
    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('handles negative first value using Math.abs', () => {
    const features = [
      makeRawFeature({
        pno: '00100',
        unemployment_history: '[[2018, -10], [2021, 10]]',
      }),
    ];
    computeChangeMetrics(features);
    const change = (features[0].properties as NeighborhoodProperties).unemployment_change_pct;
    // (10 - (-10)) / abs(-10) * 100 = 200%
    expect(change).not.toBeNull();
    expect(change!).toBeCloseTo(200, 0);
  });
});

describe('computeQuickWinMetrics — edge cases', () => {
  it('skips computation when population is null or zero', () => {
    const features = [
      makeRawFeature({
        pno: '00100', he_vakiy: 0,
        he_18_19: 10, he_20_24: 20, he_25_29: 30,
      }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('skips gender_ratio when male population is zero', () => {
    const features = [
      makeRawFeature({ pno: '00100', he_naiset: 500, he_miehet: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBeUndefined();
  });

  it('computes employment_rate correctly', () => {
    const features = [
      makeRawFeature({ pno: '00100', pt_tyoll: 750, pt_vakiy: 1000 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).employment_rate).toBe(75);
  });

  it('computes avg_household_size correctly', () => {
    const features = [
      makeRawFeature({ pno: '00100', he_vakiy: 3000, te_taly: 1500 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).avg_household_size).toBe(2);
  });

  it('computes new_construction_pct correctly', () => {
    const features = [
      makeRawFeature({ pno: '00100', ra_raky: 5, ra_asunn: 100 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).new_construction_pct).toBe(5);
  });
});
