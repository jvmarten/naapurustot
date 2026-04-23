import { describe, it, expect } from 'vitest';
import { computeQualityIndices } from '../utils/qualityIndex';
import { computeChangeMetrics, computeQuickWinMetrics, computeMetroAverages } from '../utils/metrics';
import { filterSmallIslands } from '../utils/geometryFilter';
import type { Feature } from 'geojson';

const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta', 'nimi', 'namn', 'city']);

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

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    properties: props,
  };
}

describe('numeric coercion — edge cases', () => {
  it('coerces string numbers to actual numbers', () => {
    const f = [makeFeature({ he_vakiy: '1000', hr_mtu: '35000' })];
    coerceProperties(f);
    expect(typeof f[0].properties!.he_vakiy).toBe('number');
    expect(f[0].properties!.hr_mtu).toBe(35000);
  });

  it('preserves ID fields as strings', () => {
    const f = [makeFeature({ pno: '00100', kunta: '091', nimi: 'Kallio', city: 'helsinki_metro' })];
    coerceProperties(f);
    expect(typeof f[0].properties!.pno).toBe('string');
    expect(typeof f[0].properties!.kunta).toBe('string');
  });

  it('does not coerce empty or whitespace strings to 0', () => {
    const f = [makeFeature({ hr_mtu: '', other: '   ' })];
    coerceProperties(f);
    expect(f[0].properties!.hr_mtu).toBe('');
    expect(f[0].properties!.other).toBe('   ');
  });

  it('does not coerce Infinity strings', () => {
    const f = [makeFeature({ hr_mtu: 'Infinity' })];
    coerceProperties(f);
    expect(f[0].properties!.hr_mtu).toBe('Infinity');
  });

  it('coerces "0", negative, and scientific notation', () => {
    const f = [makeFeature({ a: '0', b: '-5.3', c: '1.5e3' })];
    coerceProperties(f);
    expect(f[0].properties!.a).toBe(0);
    expect(f[0].properties!.b).toBe(-5.3);
    expect(f[0].properties!.c).toBe(1500);
  });

  it('preserves null, boolean, and existing numbers', () => {
    const f = [makeFeature({ a: null, b: true, c: 35000 })];
    coerceProperties(f);
    expect(f[0].properties!.a).toBeNull();
    expect(f[0].properties!.b).toBe(true);
    expect(f[0].properties!.c).toBe(35000);
  });
});

describe('full pipeline integration — coercion → computation → averages', () => {
  it('produces valid output from string-typed TopoJSON properties', () => {
    const features = [
      makeFeature({
        pno: '00100', nimi: 'A', namn: 'A', city: 'helsinki_metro', kunta: '091',
        he_vakiy: '1000', hr_mtu: '35000', unemployment_rate: '8.5',
        higher_education_rate: '45', pt_tyoll: '500', pt_tyott: '50', pt_vakiy: '800',
        ko_yl_kork: '200', ko_al_kork: '100', ko_ika18y: '800',
        te_omis_as: '200', te_vuok_as: '100', te_taly: '400',
        he_0_2: '20', he_3_6: '30', pinta_ala: '1000000',
        ra_asunn: '500', crime_index: '5', transit_stop_density: '15',
        air_quality_index: '2', property_price_sqm: '4000',
        healthcare_density: '3', school_density: '2', daycare_density: '4', grocery_density: '5',
        he_18_19: '30', he_20_24: '50', he_25_29: '40',
        he_naiset: '520', he_miehet: '480',
        he_65_69: '40', he_70_74: '30', he_75_79: '20', he_80_84: '10', he_85_: '5',
      }),
      makeFeature({
        pno: '00200', nimi: 'B', namn: 'B', city: 'helsinki_metro', kunta: '091',
        he_vakiy: '2000', hr_mtu: '45000', unemployment_rate: '5',
        higher_education_rate: '60', pt_tyoll: '1200', pt_tyott: '80', pt_vakiy: '1600',
        ko_yl_kork: '500', ko_al_kork: '300', ko_ika18y: '1600',
        te_omis_as: '500', te_vuok_as: '200', te_taly: '800',
        he_0_2: '50', he_3_6: '60', pinta_ala: '2000000',
        ra_asunn: '800', crime_index: '3', transit_stop_density: '25',
        air_quality_index: '1.5', property_price_sqm: '5000',
        healthcare_density: '4', school_density: '3', daycare_density: '5', grocery_density: '6',
        he_18_19: '60', he_20_24: '100', he_25_29: '80',
        he_naiset: '1050', he_miehet: '950',
        he_65_69: '70', he_70_74: '50', he_75_79: '30', he_80_84: '20', he_85_: '10',
      }),
    ];

    coerceProperties(features);
    const filtered = filterSmallIslands(features);
    computeQualityIndices(filtered);
    computeChangeMetrics(filtered);
    computeQuickWinMetrics(filtered);
    const avg = computeMetroAverages(filtered);

    for (const f of filtered) {
      const p = f.properties as any;
      expect(typeof p.quality_index).toBe('number');
      expect(p.quality_index).toBeGreaterThanOrEqual(0);
      expect(p.quality_index).toBeLessThanOrEqual(100);
      expect(typeof p.youth_ratio_pct).toBe('number');
      expect(typeof p.gender_ratio).toBe('number');
    }

    expect(avg.he_vakiy).toBe(3000);
    expect(avg.hr_mtu).toBeGreaterThan(0);
    expect(avg.unemployment_rate).toBeGreaterThan(0);
    expect(avg.unemployment_rate).toBeLessThan(100);

    const qi0 = (filtered[0].properties as any).quality_index;
    const qi1 = (filtered[1].properties as any).quality_index;
    expect(qi0).not.toBe(qi1);
  });
});
