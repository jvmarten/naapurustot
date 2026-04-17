import { describe, it, expect } from 'vitest';
import { computeQuickWinMetrics, computeChangeMetrics, computeMetroAverages } from '../utils/metrics';
import { computeQualityIndices } from '../utils/qualityIndex';
import { filterSmallIslands } from '../utils/geometryFilter';

describe('processTopology — ID field preservation', () => {
  const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta', 'nimi', 'namn', 'city']);

  function coerceProperties(properties: Record<string, unknown>): Record<string, unknown> {
    for (const key of Object.keys(properties)) {
      if (ID_FIELDS.has(key)) continue;
      const v = properties[key];
      if (typeof v === 'string' && v.trim() !== '') {
        const num = Number(v);
        if (isFinite(num)) properties[key] = num;
      }
    }
    return properties;
  }

  it('preserves the full set of ID fields including nimi, namn, and city', () => {
    const props = coerceProperties({
      pno: '00100',
      postinumeroalue: '00200',
      kunta: '091',
      nimi: 'Kallio 123',
      namn: 'Berghäll 456',
      city: 'helsinki_metro',
      hr_mtu: '35000',
    });
    expect(props.pno).toBe('00100');
    expect(props.postinumeroalue).toBe('00200');
    expect(props.kunta).toBe('091');
    expect(props.nimi).toBe('Kallio 123');
    expect(props.namn).toBe('Berghäll 456');
    expect(props.city).toBe('helsinki_metro');
    expect(props.hr_mtu).toBe(35000);
  });

  it('coerces numeric-looking strings that are not ID fields', () => {
    const props = coerceProperties({
      pno: '00100',
      transit_stop_density: '12.5',
      crime_index: '85',
      property_price_sqm: '3500.50',
    });
    expect(props.transit_stop_density).toBe(12.5);
    expect(props.crime_index).toBe(85);
    expect(props.property_price_sqm).toBe(3500.5);
  });

  it('does not coerce JSON string values (e.g., history arrays)', () => {
    const historyStr = '[[2019,30000],[2020,32000]]';
    const props = coerceProperties({
      pno: '00100',
      income_history: historyStr,
    });
    expect(props.income_history).toBe(historyStr);
  });

  it('handles properties with only whitespace', () => {
    const props = coerceProperties({
      pno: '00100',
      field1: '   ',
      field2: '\t',
    });
    expect(props.field1).toBe('   ');
    expect(props.field2).toBe('\t');
  });

  it('handles properties with arrays and objects (no crash)', () => {
    const props = coerceProperties({
      pno: '00100',
      arr: [1, 2, 3],
      obj: { nested: true },
    });
    expect(props.arr).toEqual([1, 2, 3]);
    expect(props.obj).toEqual({ nested: true });
  });
});

describe('processTopology — full pipeline with edge-case data', () => {
  it('handles features with all null metric values', () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: {
          pno: '00100', nimi: 'Empty', namn: 'Empty', kunta: '091', city: 'test',
          he_vakiy: null, hr_mtu: null, pt_tyoll: null, pt_tyott: null,
          unemployment_rate: null, higher_education_rate: null,
        },
        geometry: { type: 'Polygon', coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.2]]] },
      },
    ];
    const filtered = filterSmallIslands(features);
    computeQualityIndices(filtered);
    computeChangeMetrics(filtered);
    computeQuickWinMetrics(filtered);
    const avg = computeMetroAverages(filtered);

    expect(filtered[0].properties!.quality_index).toBeNull();
    expect(avg).toBeDefined();
  });

  it('handles mixed valid and invalid features', () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: {
          pno: '00100', nimi: 'A', namn: 'A', kunta: '091', city: 'test',
          he_vakiy: 5000, hr_mtu: 35000, pt_tyoll: 3000, pt_tyott: 300,
          pt_vakiy: 4000, ko_ika18y: 4000, ko_yl_kork: 800, ko_al_kork: 600,
          te_taly: 2500, te_omis_as: 1200, te_vuok_as: 1100, pinta_ala: 2000000,
          unemployment_rate: 7.5, higher_education_rate: 35, crime_index: 50,
          transit_stop_density: 40, air_quality_index: 25,
          healthcare_density: 3, school_density: 2, daycare_density: 4, grocery_density: 5,
        },
        geometry: { type: 'Polygon', coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.2]]] },
      },
      {
        type: 'Feature',
        properties: {
          pno: '00200', nimi: 'B', namn: 'B', kunta: '091', city: 'test',
          he_vakiy: null, hr_mtu: null,
        },
        geometry: { type: 'Polygon', coordinates: [[[25.0, 60.3], [25.05, 60.3], [25.05, 60.35], [25.0, 60.3]]] },
      },
    ];
    const filtered = filterSmallIslands(features);
    computeQualityIndices(filtered);
    const avg = computeMetroAverages(filtered);

    expect(filtered[0].properties!.quality_index).toBe(50);
    expect(avg.he_vakiy).toBe(5000);
  });

  it('pipeline order matters: quality index depends on raw data, not derived', () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: {
          pno: '00100', nimi: 'A', namn: 'A', kunta: '091', city: 'test',
          he_vakiy: 3000, hr_mtu: 25000, unemployment_rate: 5,
          higher_education_rate: 40, crime_index: 30,
          transit_stop_density: 20, air_quality_index: 15,
          healthcare_density: 2, school_density: 1, daycare_density: 3, grocery_density: 4,
        },
        geometry: { type: 'Polygon', coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.2]]] },
      },
      {
        type: 'Feature',
        properties: {
          pno: '00200', nimi: 'B', namn: 'B', kunta: '091', city: 'test',
          he_vakiy: 7000, hr_mtu: 45000, unemployment_rate: 15,
          higher_education_rate: 60, crime_index: 80,
          transit_stop_density: 60, air_quality_index: 45,
          healthcare_density: 5, school_density: 4, daycare_density: 6, grocery_density: 8,
        },
        geometry: { type: 'Polygon', coordinates: [[[25.0, 60.3], [25.05, 60.3], [25.05, 60.35], [25.0, 60.3]]] },
      },
    ];

    filterSmallIslands(features);
    computeQualityIndices(features);
    computeChangeMetrics(features);
    computeQuickWinMetrics(features);
    const avg = computeMetroAverages(features);

    const qi0 = features[0].properties!.quality_index as number;
    const qi1 = features[1].properties!.quality_index as number;
    expect(qi0).toBeGreaterThanOrEqual(0);
    expect(qi0).toBeLessThanOrEqual(100);
    expect(qi1).toBeGreaterThanOrEqual(0);
    expect(qi1).toBeLessThanOrEqual(100);
    // Population-weighted: (25000*3000 + 45000*7000) / (3000+7000) = 39000
    expect(avg.hr_mtu).toBe(39000);
  });
});

describe('resetDataCache', () => {
  it('can be called multiple times safely', async () => {
    const mod = await import('../utils/dataLoader');
    mod.resetDataCache();
    mod.resetDataCache();
    mod.resetDataCache();
  });
});
