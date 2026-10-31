import { describe, it, expect } from 'vitest';
import { computeMetroAverages } from '../utils/metrics';
import type { Feature } from 'geojson';
import { ages2064 } from './ages2064';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('computeMetroAverages — pctOfPop conversion', () => {
  it('correctly converts pctOfPop metrics back to percentage', () => {
    // foreign_language_pct is pctOfPop — should accumulate as count, then convert back
    const features = [
      makeFeature({ he_vakiy: 100, foreign_language_pct: 50 }), // 50 people
      makeFeature({ he_vakiy: 300, foreign_language_pct: 10 }), // 30 people
    ];
    const avg = computeMetroAverages(features);
    // count = 50+30=80, weight = 100+300=400, pct = (80/400)*100 = 20
    expect(avg.foreign_language_pct).toBe(20);
  });

  it('correctly computes employment_rate from raw counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_vakiy: 800, ...ages2064(800), pt_tyoll: 560 }), // 70%
      makeFeature({ he_vakiy: 1000, pt_vakiy: 800, ...ages2064(800), pt_tyoll: 400 }), // 50%
    ];
    const avg = computeMetroAverages(features);
    // totalEmployed = 960, totalActPop = 1600, pct = (960/1600)*100 = 60
    expect(avg.employment_rate).toBe(60);
  });

  it('correctly converts elderly_ratio_pct (pctOfPop)', () => {
    const features = [
      makeFeature({ he_vakiy: 2000, elderly_ratio_pct: 25 }), // 500 elderly
      makeFeature({ he_vakiy: 2000, elderly_ratio_pct: 15 }), // 300 elderly
    ];
    const avg = computeMetroAverages(features);
    // count = 500+300=800, weight = 4000, pct = (800/4000)*100 = 20
    expect(avg.elderly_ratio_pct).toBe(20);
  });
});

describe('computeMetroAverages — pctOfHh conversion', () => {
  it('correctly weights single_person_hh_pct by household count', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 500, single_person_hh_pct: 40 }), // 200 single-person HH
      makeFeature({ he_vakiy: 1000, te_taly: 300, single_person_hh_pct: 60 }), // 180 single-person HH
    ];
    const avg = computeMetroAverages(features);
    // count = 200+180=380, hhWeight = 500+300=800, pct = (380/800)*100 = 47.5
    expect(avg.single_person_hh_pct).toBe(47.5);
  });

  it('correctly weights families_with_children_pct by household count', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 400, families_with_children_pct: 25 }),
      makeFeature({ he_vakiy: 1000, te_taly: 600, families_with_children_pct: 50 }),
    ];
    const avg = computeMetroAverages(features);
    // count = 100+300=400, hhWeight = 400+600=1000, pct = 40
    expect(avg.families_with_children_pct).toBe(40);
  });
});

describe('computeMetroAverages — ratio metric denominators', () => {
  it('unemployment uses the labour force (employed + unemployed), not total pop', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, pt_vakiy: 3000, pt_tyott: 300, pt_tyoll: 2700 }),
      makeFeature({ he_vakiy: 5000, pt_vakiy: 4000, pt_tyott: 200, pt_tyoll: 3800 }),
    ];
    const avg = computeMetroAverages(features);
    // totalUnemployed = 500, totalActPop = 7000 (not 10000)
    expect(avg.unemployment_rate).toBeCloseTo((500 / 7000) * 100, 1);
  });

  it('unemployment rate needs no pt_vakiy: its base is the labour force', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_vakiy: null, pt_tyott: 100, pt_tyoll: 900 }),
    ];
    const avg = computeMetroAverages(features);
    // 100 / (100 + 900) — pt_vakiy plays no part
    expect(avg.unemployment_rate).toBe(10);
  });

  it('higher_education uses adult pop (ko_ika18y), not total pop', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, ko_ika18y: 8000, ko_yl_kork: 2000, ko_al_kork: 1000 }),
    ];
    const avg = computeMetroAverages(features);
    // 3000/8000*100 = 37.5
    expect(avg.higher_education_rate).toBe(37.5);
  });

  it('student_share uses working-age pop', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, pt_vakiy: 7000, pt_opisk: 700 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.student_share).toBe(10);
  });

  it('pensioner_share uses total population', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, pt_elakel: 2500 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.pensioner_share).toBe(25);
  });

  it('detached_house_share uses total dwellings', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, ra_asunn: 500, ra_pt_as: 100 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.detached_house_share).toBe(20);
  });
});

describe('computeMetroAverages — requirePositive filtering', () => {
  it('excludes zero income from weighted average', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 0 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    // hr_mtu=0 is excluded (requirePositive), so only 40000 contributes
    expect(avg.hr_mtu).toBe(40000);
  });

  it('excludes negative property price', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, property_price_sqm: -500 }),
      makeFeature({ he_vakiy: 1000, property_price_sqm: 4000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.property_price_sqm).toBe(4000);
  });
});

describe('computeMetroAverages — edge cases', () => {
  it('handles NaN values gracefully', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: NaN }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
  });

  it('handles Infinity values gracefully', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: Infinity }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
  });

  it('omits metrics when all source data is null', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: null, pt_tyott: null }),
    ];
    const avg = computeMetroAverages(features);
    // Omitted (not 0) so the all-Finland choropleth renders gray for "no data".
    expect(avg.hr_mtu).toBeUndefined();
    expect(avg.unemployment_rate).toBeUndefined();
  });

  it('partial child data: only he_0_2 present', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_0_2: 50, he_3_6: null }),
    ];
    const avg = computeMetroAverages(features);
    // totalChildren = 50 (only he_0_2), totalPop = 1000
    expect(avg.child_ratio).toBe(5);
  });
});

// Finland's unemployment rate is per labour force (employed + unemployed), Statistics
// Finland's own definition. It was unemployed / all residents, about half the real rate.
describe('computeMetroAverages — unemployment per labour force', () => {
  it('divides by employed + unemployed, not by residents', () => {
    const avg = computeMetroAverages([
      makeFeature({ he_vakiy: 10000, pt_vakiy: 10000, pt_tyott: 400, pt_tyoll: 3600 }),
    ]);
    expect(avg.unemployment_rate).toBe(10);
  });

  it('leaves out an area that publishes no employed count', () => {
    const avg = computeMetroAverages([
      makeFeature({ he_vakiy: 1000, pt_tyott: 100, pt_tyoll: 900 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, pt_tyott: 500, pt_tyoll: null }),
    ]);
    expect(avg.unemployment_rate).toBe(10);
  });
});
