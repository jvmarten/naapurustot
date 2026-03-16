import { describe, it, expect } from 'vitest';
import { computeMetroAverages } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, any>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('computeMetroAverages', () => {
  it('computes population-weighted income average', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
      makeFeature({ he_vakiy: 3000, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    // (30000*1000 + 40000*3000) / (1000+3000) = 150_000_000 / 4000 = 37500
    expect(avg.hr_mtu).toBe(37500);
  });

  it('computes unemployment rate from raw counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 100 }),
      makeFeature({ he_vakiy: 1000, pt_tyott: 200 }),
    ];
    const avg = computeMetroAverages(features);
    // (100 + 200) / 2000 * 100 = 15.0 → rounded to 1 decimal = 15
    expect(avg.unemployment_rate).toBe(15);
  });

  it('computes higher education rate from degree holders / adult pop', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, ko_yl_kork: 100, ko_al_kork: 200, ko_ika18y: 800 }),
      makeFeature({ he_vakiy: 1000, ko_yl_kork: 150, ko_al_kork: 150, ko_ika18y: 700 }),
    ];
    const avg = computeMetroAverages(features);
    // totalHigherEd = 100+200+150+150 = 600, totalAdultPop = 800+700 = 1500
    // 600/1500 * 100 = 40.0
    expect(avg.higher_education_rate).toBe(40);
  });

  it('computes ownership and rental rates from household counts', () => {
    const features = [
      makeFeature({ he_vakiy: 500, te_omis_as: 200, te_vuok_as: 100, te_taly: 400 }),
      makeFeature({ he_vakiy: 500, te_omis_as: 300, te_vuok_as: 50, te_taly: 600 }),
    ];
    const avg = computeMetroAverages(features);
    // ownership: (200+300) / (400+600) = 500/1000 = 50%
    expect(avg.ownership_rate).toBe(50);
    // rental: (100+50) / (400+600) = 150/1000 = 15%
    expect(avg.rental_rate).toBe(15);
  });

  it('computes population-weighted apartment size', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, ra_as_kpa: 60 }),
      makeFeature({ he_vakiy: 1000, ra_as_kpa: 80 }),
    ];
    const avg = computeMetroAverages(features);
    // (60*1000 + 80*1000) / 2000 = 70.0
    expect(avg.ra_as_kpa).toBe(70);
  });

  it('computes child ratio from he_0_2 and he_3_6', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_0_2: 30, he_3_6: 20 }),
      makeFeature({ he_vakiy: 1000, he_0_2: 40, he_3_6: 10 }),
    ];
    const avg = computeMetroAverages(features);
    // totalChildren = 30+20+40+10 = 100, totalPop = 2000 → 5.0%
    expect(avg.child_ratio).toBe(5);
  });

  it('computes population density from pop / area', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, pinta_ala: 1_000_000 }), // 1 km²
      makeFeature({ he_vakiy: 5000, pinta_ala: 1_000_000 }), // 1 km²
    ];
    const avg = computeMetroAverages(features);
    // 10000 / (2_000_000 / 1_000_000) = 10000 / 2 = 5000
    expect(avg.population_density).toBe(5000);
  });

  it('returns zeros for empty feature list', () => {
    const avg = computeMetroAverages([]);
    expect(avg.hr_mtu).toBe(0);
    expect(avg.unemployment_rate).toBe(0);
    expect(avg.he_vakiy).toBe(0);
  });

  it('skips features with null or zero population', () => {
    const features = [
      makeFeature({ he_vakiy: null, hr_mtu: 50000 }),
      makeFeature({ he_vakiy: 0, hr_mtu: 50000 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
    expect(avg.he_vakiy).toBe(1000);
  });

  it('computes population-weighted foreign language percentage', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 10 }),
      makeFeature({ he_vakiy: 3000, foreign_language_pct: 20 }),
    ];
    const avg = computeMetroAverages(features);
    // totalForeignLang = (10/100)*1000 + (20/100)*3000 = 100 + 600 = 700
    // foreignLangCount = 4000
    // (700/4000) * 100 = 17.5
    expect(avg.foreign_language_pct).toBe(17.5);
  });

  it('computes population-weighted property price', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, property_price_sqm: 3000 }),
      makeFeature({ he_vakiy: 1000, property_price_sqm: 5000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.property_price_sqm).toBe(4000);
  });
});
