import { describe, it, expect } from 'vitest';
import {
  affordabilityScore,
  orientationForTenure,
  AFFORDABILITY_OVERSHOOT_MAX,
  type AffordabilityInput,
  type AffordabilityInputProps,
} from '../utils/affordability';

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
