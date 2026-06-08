import { describe, it, expect } from 'vitest';
import type { FeatureCollection, Feature } from 'geojson';
import {
  affordabilityScore,
  orientationForTenure,
  AFFORDABILITY_OVERSHOOT_MAX,
  type AffordabilityInput,
  type AffordabilityInputProps,
} from '../utils/affordability';
import {
  isAffordabilityActive,
  computeAffordablePnos,
  affordabilityAdjustedMatch,
} from '../utils/filterUtils';

// rent 20 €/m²/mo, price 5000 €/m². At 50 m²: rent 1000 €/mo, price 250k.
const CHEAP: AffordabilityInputProps = { rental_price_sqm: 20, property_price_sqm: 5000 };
// Twice as pricey: rent 2000 €/mo at 50 m².
const PRICEY: AffordabilityInputProps = { rental_price_sqm: 40, property_price_sqm: 10000 };
// No price data at all.
const NO_DATA: AffordabilityInputProps = { rental_price_sqm: null, property_price_sqm: null };

const BUDGET_1500: AffordabilityInput = { mode: 'budget', monthlyBudget: 1500, sizeM2: 50 };

describe('affordabilityScore', () => {
  it('is a no-op (not applicable, neutral weight) when there is no usable budget', () => {
    const s = affordabilityScore({ mode: 'income', monthlyIncome: null, sizeM2: 50 }, CHEAP);
    expect(s.applicable).toBe(false);
    expect(s.affordable).toBeNull();
    expect(s.weight).toBe(1); // neutral: never penalizes
  });

  it('is not applicable (neutral) when the relevant price field is missing', () => {
    const s = affordabilityScore(BUDGET_1500, NO_DATA, 'rent');
    expect(s.applicable).toBe(false);
    expect(s.weight).toBe(1);
  });

  it('passes an affordable rent (share <= 1) with full soft weight', () => {
    // rent 1000 vs budget 1500 → share ~0.67 → within, weight 1.
    const s = affordabilityScore(BUDGET_1500, CHEAP, 'rent');
    expect(s.applicable).toBe(true);
    expect(s.affordable).toBe(true);
    expect(s.share).toBeCloseTo(1000 / 1500, 5);
    expect(s.weight).toBe(1);
  });

  it('fails an over-budget rent and decays the soft weight', () => {
    // rent 2000 vs budget 1500 → share ~1.33 → over budget, weight < 1.
    const s = affordabilityScore(BUDGET_1500, PRICEY, 'rent');
    expect(s.affordable).toBe(false);
    expect(s.share).toBeCloseTo(2000 / 1500, 5);
    expect(s.weight).toBeGreaterThan(0);
    expect(s.weight).toBeLessThan(1);
  });

  it('bottoms the soft weight out at 0 once the cost hits OVERSHOOT_MAX×budget', () => {
    // rent 2000 vs budget 1000 → share 2.0 → weight 0.
    const s = affordabilityScore({ mode: 'budget', monthlyBudget: 1000, sizeM2: 50 }, PRICEY, 'rent');
    expect(s.share).toBeCloseTo(AFFORDABILITY_OVERSHOOT_MAX, 5);
    expect(s.weight).toBe(0);
  });

  it("'either' takes the cheaper of rent vs buy", () => {
    const budget = 1200;
    const input = { mode: 'budget' as const, monthlyBudget: budget, sizeM2: 50 };
    const rentOnly = affordabilityScore(input, CHEAP, 'rent');
    const buyOnly = affordabilityScore(input, CHEAP, 'buy');
    const either = affordabilityScore(input, CHEAP, 'either');
    expect(either.affordable).toBe(true);
    // 'either' must report the smaller (cheaper) of the two single-path shares.
    expect(either.share).toBeCloseTo(Math.min(rentOnly.share!, buyOnly.share!), 5);
  });
});

describe('orientationForTenure', () => {
  it('maps the wizard tenure answer to an orientation', () => {
    expect(orientationForTenure('own')).toBe('buy');
    expect(orientationForTenure('rent')).toBe('rent');
    expect(orientationForTenure('either')).toBe('either');
  });
});

function fc(props: Array<Partial<AffordabilityInputProps> & { pno: string; he_vakiy?: number }>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: props.map((p): Feature => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { he_vakiy: 1000, ...p },
    })),
  };
}

describe('isAffordabilityActive', () => {
  it('is false for null/empty input (graceful no-op guard)', () => {
    expect(isAffordabilityActive(null)).toBe(false);
    expect(isAffordabilityActive(undefined)).toBe(false);
    expect(isAffordabilityActive({ mode: 'income', monthlyIncome: null, sizeM2: 50 })).toBe(false);
  });

  it('is true once a usable budget exists', () => {
    expect(isAffordabilityActive(BUDGET_1500)).toBe(true);
  });
});

describe('computeAffordablePnos', () => {
  const data = fc([
    { pno: '00100', rental_price_sqm: 20, property_price_sqm: 5000 },  // rent 1000 → within 1500
    { pno: '00200', rental_price_sqm: 40, property_price_sqm: 10000 }, // rent 2000 → over 1500
    { pno: '00300', rental_price_sqm: null, property_price_sqm: null }, // unjudgeable → included
    { pno: '00400', rental_price_sqm: 20, property_price_sqm: 5000, he_vakiy: 0 }, // no population → skipped
  ]);

  it('returns null when affordability is inactive (caller skips ANDing it in)', () => {
    expect(computeAffordablePnos(data, null)).toBeNull();
    expect(computeAffordablePnos(data, { mode: 'income', monthlyIncome: null, sizeM2: 50 })).toBeNull();
  });

  it('keeps within-budget and unjudgeable areas, drops the over-budget one', () => {
    const pnos = computeAffordablePnos(data, BUDGET_1500, 'rent')!;
    expect(pnos.has('00100')).toBe(true);  // within
    expect(pnos.has('00200')).toBe(false); // over budget → filtered out
    expect(pnos.has('00300')).toBe(true);  // can't judge → included, never disqualified
    expect(pnos.has('00400')).toBe(false); // zero population → excluded like other filters
  });
});

describe('affordabilityAdjustedMatch', () => {
  const within = { pno: '00100', rental_price_sqm: 20, property_price_sqm: 5000 } as unknown as Parameters<typeof affordabilityAdjustedMatch>[1];
  const over = { pno: '00200', rental_price_sqm: 40, property_price_sqm: 10000 } as unknown as Parameters<typeof affordabilityAdjustedMatch>[1];
  const noData = { pno: '00300', rental_price_sqm: null, property_price_sqm: null } as unknown as Parameters<typeof affordabilityAdjustedMatch>[1];

  it('returns the base match unchanged when affordability is inactive', () => {
    expect(affordabilityAdjustedMatch(80, within, null, 'rent')).toBe(80);
  });

  it('leaves an affordable area at its base match', () => {
    expect(affordabilityAdjustedMatch(80, within, BUDGET_1500, 'rent')).toBe(80);
  });

  it('penalizes an over-budget area', () => {
    const adjusted = affordabilityAdjustedMatch(80, over, BUDGET_1500, 'rent');
    expect(adjusted).toBeLessThan(80);
    expect(adjusted).toBeGreaterThanOrEqual(0);
  });

  it('leaves an unjudgeable area untouched (no penalty for missing data)', () => {
    expect(affordabilityAdjustedMatch(80, noData, BUDGET_1500, 'rent')).toBe(80);
  });
});
