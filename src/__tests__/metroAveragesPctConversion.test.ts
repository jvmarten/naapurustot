/**
 * Tests for computeMetroAverages percentage-to-count conversion correctness.
 *
 * Covers ALL pctOfPop and pctOfHh metrics in METRIC_DEFS to ensure:
 * 1. Percentages are converted to counts before accumulation
 * 2. Counts are converted back to percentages after division
 * 3. Population-weighted vs household-weighted distinction is correct
 * 4. Unequal population/household sizes produce different results than naive averaging
 */
import { describe, it, expect } from 'vitest';
import { computeMetroAverages } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00000', nimi: 'Test', namn: 'Test', ...props } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [25, 60] },
  };
}

describe('computeMetroAverages — all pctOfPop metrics', () => {
  it('youth_ratio_pct is weighted by population, not naively averaged', () => {
    // Area A: pop 500, youth 40% → 200 youth
    // Area B: pop 1500, youth 10% → 150 youth
    // Total: 350 / 2000 = 17.5%
    // Naive avg would be (40 + 10) / 2 = 25% — WRONG
    const features = [
      makeFeature({ he_vakiy: 500, youth_ratio_pct: 40 }),
      makeFeature({ he_vakiy: 1500, youth_ratio_pct: 10 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.youth_ratio_pct).toBe(17.5);
    expect(avg.youth_ratio_pct).not.toBe(25); // Would be 25 if naively averaged
  });

  it('elderly_ratio_pct is weighted by population', () => {
    // Area A: pop 1000, elderly 30% → 300
    // Area B: pop 4000, elderly 10% → 400
    // Total: 700 / 5000 = 14%
    const features = [
      makeFeature({ he_vakiy: 1000, elderly_ratio_pct: 30 }),
      makeFeature({ he_vakiy: 4000, elderly_ratio_pct: 10 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.elderly_ratio_pct).toBe(14.0);
  });

  it('employment_rate is computed from raw counts (pt_tyoll / pt_vakiy)', () => {
    // Area A: working-age 2000, employed 1800 → 90%
    // Area B: working-age 1000, employed 500 → 50%
    // Total: 2300 / 3000 = 76.7%
    const features = [
      makeFeature({ he_vakiy: 3000, pt_vakiy: 2000, pt_tyoll: 1800 }),
      makeFeature({ he_vakiy: 1000, pt_vakiy: 1000, pt_tyoll: 500 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.employment_rate).toBe(76.7);
  });
});

describe('computeMetroAverages — all pctOfHh metrics', () => {
  it('single_parent_hh_pct is weighted by household count', () => {
    // Area A: pop 1000, te_taly 200, single_parent 25% → 50
    // Area B: pop 2000, te_taly 800, single_parent 10% → 80
    // Total: 130 / 1000 = 13%
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 200, single_parent_hh_pct: 25 }),
      makeFeature({ he_vakiy: 2000, te_taly: 800, single_parent_hh_pct: 10 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.single_parent_hh_pct).toBe(13.0);
  });

  it('families_with_children_pct weighted by households across 3 areas', () => {
    // A: te_taly=100, pct=80% → 80
    // B: te_taly=300, pct=20% → 60
    // C: te_taly=600, pct=50% → 300
    // Total: 440 / 1000 = 44%
    const features = [
      makeFeature({ he_vakiy: 500, te_taly: 100, families_with_children_pct: 80 }),
      makeFeature({ he_vakiy: 1000, te_taly: 300, families_with_children_pct: 20 }),
      makeFeature({ he_vakiy: 2000, te_taly: 600, families_with_children_pct: 50 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.families_with_children_pct).toBe(44.0);
  });

  it('pctOfHh metrics use te_taly not population for weighting', () => {
    // Both areas have same population but different household counts.
    // If weighted by population, result would differ.
    // A: pop 1000, te_taly 900, single_person_hh_pct 80% → 720
    // B: pop 1000, te_taly 100, single_person_hh_pct 20% → 20
    // Correct (hh-weighted): 740 / 1000 = 74%
    // Wrong (pop-weighted): would be (1000*80 + 1000*20) / 2000 = 50%
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 900, single_person_hh_pct: 80 }),
      makeFeature({ he_vakiy: 1000, te_taly: 100, single_person_hh_pct: 20 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.single_person_hh_pct).toBe(74.0);
    expect(avg.single_person_hh_pct).not.toBe(50.0); // Would be 50 if pop-weighted
  });
});

describe('computeMetroAverages — edge cases in pct conversion', () => {
  it('area with null percentage is excluded from pctOfPop', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: null }),
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 30 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.foreign_language_pct).toBe(30.0);
  });

  it('area with zero households excluded from pctOfHh', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 0, families_with_children_pct: 90 }),
      makeFeature({ he_vakiy: 1000, te_taly: 500, families_with_children_pct: 40 }),
    ];
    const avg = computeMetroAverages(features);
    // Only area B contributes: 40%
    expect(avg.families_with_children_pct).toBe(40.0);
  });

  it('100% and 0% boundary values convert correctly', () => {
    // A: pop 1000, pct=100% → 1000 count
    // B: pop 1000, pct=0% → 0 count
    // Total: 1000 / 2000 = 50%
    const features = [
      makeFeature({ he_vakiy: 1000, youth_ratio_pct: 100 }),
      makeFeature({ he_vakiy: 1000, youth_ratio_pct: 0 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.youth_ratio_pct).toBe(50.0);
  });

  it('very small percentages maintain precision', () => {
    // A: pop 10000, pct=0.1% → 10
    // B: pop 10000, pct=0.3% → 30
    // Total: 40 / 20000 = 0.2%
    const features = [
      makeFeature({ he_vakiy: 10000, elderly_ratio_pct: 0.1 }),
      makeFeature({ he_vakiy: 10000, elderly_ratio_pct: 0.3 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.elderly_ratio_pct).toBe(0.2);
  });
});
