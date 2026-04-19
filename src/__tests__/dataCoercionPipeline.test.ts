import { describe, it, expect } from 'vitest';
import { computeQualityIndices } from '../utils/qualityIndex';
import { computeChangeMetrics, computeQuickWinMetrics, computeMetroAverages } from '../utils/metrics';
import { filterSmallIslands } from '../utils/geometryFilter';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature, FeatureCollection } from 'geojson';

vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta', 'nimi', 'namn', 'city']);

function simulateCoercion(features: Feature[]): void {
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

function makeRealisticDataset(): Feature[] {
  return [
    {
      type: 'Feature',
      properties: {
        pno: '00100',
        nimi: 'Helsinki Keskusta',
        namn: 'Helsingfors centrum',
        kunta: '091',
        city: 'helsinki_metro',
        he_vakiy: '5000',
        hr_mtu: '42000',
        hr_ktu: '45000',
        pt_tyoll: '3500',
        pt_tyott: '250',
        pt_vakiy: '4200',
        ko_yl_kork: '800',
        ko_al_kork: '500',
        ko_ika18y: '4000',
        te_omis_as: '800',
        te_taly: '2500',
        te_vuok_as: '1500',
        he_0_2: '150',
        he_3_6: '200',
        pinta_ala: '2000000',
        ra_pt_as: '50',
        ra_asunn: '3000',
        pt_opisk: '400',
        pt_elakel: '600',
        crime_index: '80',
        unemployment_rate: '5.9',
        higher_education_rate: '32.5',
        transit_stop_density: '50',
        air_quality_index: '30',
        healthcare_density: '5',
        school_density: '3',
        daycare_density: '4',
        grocery_density: '8',
        cycling_density: '20',
        restaurant_density: '100',
        property_price_sqm: '6500',
        foreign_language_pct: '15',
        single_person_hh_pct: '55',
        income_history: '[[2018,38000],[2019,39000],[2020,40000],[2021,41000],[2022,42000]]',
        population_history: '[[2018,4800],[2019,4900],[2020,4950],[2021,4980],[2022,5000]]',
        unemployment_history: '[[2018,7.0],[2019,6.5],[2020,6.0],[2021,5.8],[2022,5.9]]',
        he_18_19: '200',
        he_20_24: '600',
        he_25_29: '500',
        he_naiset: '2600',
        he_miehet: '2400',
        te_eil_np: '300',
        te_laps: '400',
        tp_tyopy: '10000',
        tp_j_info: '2000',
        tp_q_terv: '1500',
        he_65_69: '300',
        he_70_74: '200',
        he_75_79: '100',
        he_80_84: '50',
        he_85_: '30',
        tp_jalo_bf: '1000',
        tp_o_julk: '800',
        tp_palv_gu: '5000',
        ra_raky: '100',
      } as unknown as NeighborhoodProperties,
      geometry: {
        type: 'Polygon',
        coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]],
      },
    },
    {
      type: 'Feature',
      properties: {
        pno: '02100',
        nimi: 'Tapiola',
        namn: 'Hagalund',
        kunta: '049',
        city: 'helsinki_metro',
        he_vakiy: '3000',
        hr_mtu: '38000',
        hr_ktu: '40000',
        pt_tyoll: '2000',
        pt_tyott: '100',
        pt_vakiy: '2500',
        ko_yl_kork: '400',
        ko_al_kork: '300',
        ko_ika18y: '2200',
        te_omis_as: '600',
        te_taly: '1200',
        te_vuok_as: '500',
        he_0_2: '100',
        he_3_6: '120',
        pinta_ala: '3000000',
        ra_pt_as: '200',
        ra_asunn: '1500',
        pt_opisk: '200',
        pt_elakel: '400',
        crime_index: '40',
        unemployment_rate: '4.0',
        higher_education_rate: '31.8',
        transit_stop_density: '30',
        air_quality_index: '22',
        healthcare_density: '3',
        school_density: '4',
        daycare_density: '3',
        grocery_density: '6',
        cycling_density: '15',
        restaurant_density: '30',
        property_price_sqm: '5000',
        foreign_language_pct: '10',
        single_person_hh_pct: '35',
        income_history: '[[2018,35000],[2019,36000],[2020,37000],[2021,37500],[2022,38000]]',
        population_history: '[[2018,2900],[2019,2920],[2020,2950],[2021,2980],[2022,3000]]',
        unemployment_history: '[[2018,5.5],[2019,5.0],[2020,4.5],[2021,4.2],[2022,4.0]]',
        he_18_19: '100',
        he_20_24: '200',
        he_25_29: '250',
        he_naiset: '1550',
        he_miehet: '1450',
        te_eil_np: '100',
        te_laps: '300',
        tp_tyopy: '5000',
        tp_j_info: '500',
        tp_q_terv: '800',
        he_65_69: '200',
        he_70_74: '130',
        he_75_79: '80',
        he_80_84: '30',
        he_85_: '20',
        tp_jalo_bf: '600',
        tp_o_julk: '400',
        tp_palv_gu: '2500',
        ra_raky: '30',
      } as unknown as NeighborhoodProperties,
      geometry: {
        type: 'Polygon',
        coordinates: [[[24.8, 60.15], [24.85, 60.15], [24.85, 60.2], [24.8, 60.2], [24.8, 60.15]]],
      },
    },
  ];
}

describe('Full data processing pipeline — coercion → filter → quality → change → quickwin → metro averages', () => {
  it('processes a realistic dataset end-to-end without errors', () => {
    const features = makeRealisticDataset();

    // Step 1: Coercion (simulating TopoJSON string values)
    simulateCoercion(features);

    // Verify coercion: numeric strings became numbers
    expect(typeof (features[0].properties as NeighborhoodProperties).he_vakiy).toBe('number');
    expect((features[0].properties as NeighborhoodProperties).he_vakiy).toBe(5000);

    // Verify ID fields stayed as strings
    expect(typeof (features[0].properties as NeighborhoodProperties).pno).toBe('string');
    expect((features[0].properties as NeighborhoodProperties).pno).toBe('00100');
    expect(typeof (features[0].properties as NeighborhoodProperties).kunta).toBe('string');

    // Step 2: Filter islands (no-op here, single polygons)
    const filtered = filterSmallIslands(features);
    expect(filtered.length).toBe(2);

    // Step 3: Quality indices
    computeQualityIndices(filtered);
    const qi0 = (filtered[0].properties as NeighborhoodProperties).quality_index;
    const qi1 = (filtered[1].properties as NeighborhoodProperties).quality_index;
    expect(qi0).not.toBeNull();
    expect(qi1).not.toBeNull();
    expect(Number.isInteger(qi0!)).toBe(true);
    expect(qi0!).toBeGreaterThanOrEqual(0);
    expect(qi0!).toBeLessThanOrEqual(100);

    // Step 4: Change metrics
    computeChangeMetrics(filtered);
    const incomeChange = (filtered[0].properties as NeighborhoodProperties).income_change_pct;
    expect(incomeChange).not.toBeNull();
    // (42000-38000)/38000 * 100 ≈ 10.5%
    expect(incomeChange!).toBeCloseTo(10.5, 0);

    // Step 5: Quick-win metrics
    computeQuickWinMetrics(filtered);
    const youthRatio = (filtered[0].properties as NeighborhoodProperties).youth_ratio_pct;
    expect(youthRatio).not.toBeNull();
    // (200+600+500)/5000 * 100 = 26.0%
    expect(youthRatio!).toBe(26.0);

    const genderRatio = (filtered[0].properties as NeighborhoodProperties).gender_ratio;
    expect(genderRatio).not.toBeNull();
    // 2600/2400 = 1.08
    expect(genderRatio!).toBeCloseTo(1.08, 2);

    const elderlyRatio = (filtered[0].properties as NeighborhoodProperties).elderly_ratio_pct;
    expect(elderlyRatio).not.toBeNull();
    // (300+200+100+50+30)/5000 = 13.6%
    expect(elderlyRatio!).toBe(13.6);

    // Step 6: Metro averages
    const avg = computeMetroAverages(filtered);
    expect(avg.he_vakiy).toBe(8000);
    expect(avg.hr_mtu).toBeGreaterThan(0);

    // Unemployment rate should be computed from raw counts
    // (250+100)/(4200+2500) = 350/6700 ≈ 5.2%
    expect(avg.unemployment_rate).toBeCloseTo(5.2, 1);

    // Higher education rate from raw counts
    // (800+500+400+300)/(4000+2200) = 2000/6200 ≈ 32.3%
    expect(avg.higher_education_rate).toBeCloseTo(32.3, 1);
  });

  it('preserves JSON string properties during coercion', () => {
    const features = makeRealisticDataset();
    simulateCoercion(features);

    // income_history should remain a string (it's valid JSON but not a plain number)
    const history = (features[0].properties as NeighborhoodProperties).income_history;
    expect(typeof history).toBe('string');
  });

  it('does not coerce empty strings to 0', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: { pno: '00100', nimi: 'Test', empty_field: '' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    };

    simulateCoercion([feature]);
    expect(feature.properties!.empty_field).toBe('');
  });

  it('Tapiola should have higher quality than Keskusta (lower crime, better air)', () => {
    const features = makeRealisticDataset();
    simulateCoercion(features);
    filterSmallIslands(features);
    computeQualityIndices(features);

    const qiKeskusta = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qiTapiola = (features[1].properties as NeighborhoodProperties).quality_index!;

    // Tapiola: lower crime (40 vs 80), better air (22 vs 30), lower unemployment (4 vs 5.9)
    // But Keskusta has higher income, more transit, more services
    // With default weights (safety=25), Tapiola should score higher
    expect(qiTapiola).toBeGreaterThan(qiKeskusta);
  });
});
