import { describe, it, expect } from 'vitest';
import {
  normalize,
  buildFitRanges,
  getNationalFitRanges,
  scoreFeatureFit,
  computeNationalFit,
  FIT_RANGE_KEYS,
} from '../utils/fitScore';
import { defaultWizardAnswers, type WizardAnswers } from '../hooks/useWizardProfile';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { AffordabilityState } from '../hooks/useAffordability';

function mkArea(overrides: Record<string, number | string | null> = {}): NeighborhoodProperties {
  return {
    pno: '00100', nimi: 'Test', he_vakiy: 1000, quality_index: 50,
    transit_stop_density: 10, restaurant_density: 5, ra_as_kpa: 60,
    child_ratio: 15, daycare_density: 2, school_density: 1, healthcare_density: 1,
    ownership_rate: 50, rental_rate: 50, property_price_sqm: 4000, rental_price_sqm: 20,
    ...overrides,
  } as unknown as NeighborhoodProperties;
}

describe('normalize', () => {
  it('clamps to [0,1] and returns 0.5 for null / degenerate ranges', () => {
    expect(normalize(5, 0, 10)).toBe(0.5);
    expect(normalize(-1, 0, 10)).toBe(0);
    expect(normalize(99, 0, 10)).toBe(1);
    expect(normalize(null, 0, 10)).toBe(0.5);
    expect(normalize(5, 3, 3)).toBe(0.5); // min === max
  });
});

describe('buildFitRanges', () => {
  it('collects per-metric min/max over the features for every range key', () => {
    const ranges = buildFitRanges([
      { type: 'Feature', geometry: null, properties: mkArea({ transit_stop_density: 2 }) },
      { type: 'Feature', geometry: null, properties: mkArea({ transit_stop_density: 20 }) },
    ] as unknown as GeoJSON.Feature[]);
    expect(ranges.transit_stop_density).toEqual({ min: 2, max: 20 });
    // Degenerate (all equal) collapses to {0,1} so normalize stays neutral.
    expect(ranges.ownership_rate).toEqual({ min: 0, max: 1 });
    for (const k of FIT_RANGE_KEYS) expect(ranges[k as string]).toBeDefined();
  });
});

describe('computeNationalFit', () => {
  it('returns an integer score in [0,100]', () => {
    const fit = computeNationalFit(mkArea(), defaultWizardAnswers);
    expect(Number.isInteger(fit.score)).toBe(true);
    expect(fit.score).toBeGreaterThanOrEqual(0);
    expect(fit.score).toBeLessThanOrEqual(100);
    expect(fit.excluded).toBe(false);
  });

  it('uses the stable national ranges (same area → same score regardless of caller)', () => {
    const a = computeNationalFit(mkArea(), defaultWizardAnswers);
    const b = computeNationalFit(mkArea(), defaultWizardAnswers);
    expect(a.score).toBe(b.score);
  });

  it('scores an in-budget area higher than an otherwise identical out-of-budget one', () => {
    // defaultWizardAnswers budget is 1000–6000 €/m².
    const inBudget = computeNationalFit(mkArea({ property_price_sqm: 4000 }), defaultWizardAnswers);
    const overBudget = computeNationalFit(mkArea({ property_price_sqm: 9000 }), defaultWizardAnswers);
    expect(inBudget.score).toBeGreaterThan(overBudget.score);
  });
});

describe('scoreFeatureFit affordability fold', () => {
  const ranges = getNationalFitRanges();
  const overBudgetState: AffordabilityState = { mode: 'budget', income: null, budget: 500, sizeM2: 50 };
  const answers: WizardAnswers = { ...defaultWizardAnswers, tenurePreference: 'either' };
  const pricey = mkArea({ property_price_sqm: 10000, rental_price_sqm: 40 });

  it("is a no-op when mode is 'off'", () => {
    const res = scoreFeatureFit(pricey, answers, ranges, overBudgetState, 'off');
    expect(res.excluded).toBe(false);
  });

  it("excludes an over-budget area in 'filter' mode", () => {
    const res = scoreFeatureFit(pricey, answers, ranges, overBudgetState, 'filter');
    expect(res.excluded).toBe(true);
  });

  it("keeps but down-weights an over-budget area in 'soft' mode", () => {
    const soft = scoreFeatureFit(pricey, answers, ranges, overBudgetState, 'soft');
    const off = scoreFeatureFit(pricey, answers, ranges, overBudgetState, 'off');
    expect(soft.excluded).toBe(false);
    expect(soft.score).toBeLessThanOrEqual(off.score);
  });
});
