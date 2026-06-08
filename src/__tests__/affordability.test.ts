import { describe, it, expect } from 'vitest';
import {
  affordabilityFor,
  effectiveMonthlyBudget,
  monthlyMortgagePayment,
  bandForShare,
  inRange,
  INCOME_TO_HOUSING_RATIO,
  MORTGAGE_DOWN_PAYMENT,
  RENT_GREEN_MAX,
  RENT_AMBER_MAX,
  AFFORDABILITY_LIMITS,
  type AffordabilityInputProps,
} from '../utils/affordability';

const PROPS: AffordabilityInputProps = {
  rental_price_sqm: 20, // €/m²/month
  property_price_sqm: 5000, // €/m²
  hr_mtu: 32000,
};

describe('monthlyMortgagePayment', () => {
  it('computes a standard amortizing payment', () => {
    // 100k at 3.5% over 300 months ≈ 500.6 €/month
    const p = monthlyMortgagePayment(100_000, 0.035, 300);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(490);
    expect(p!).toBeLessThan(510);
  });

  it('handles a zero interest rate as straight-line', () => {
    expect(monthlyMortgagePayment(12_000, 0, 12)).toBeCloseTo(1000, 5);
  });

  it('returns null for non-positive principal', () => {
    expect(monthlyMortgagePayment(0)).toBeNull();
    expect(monthlyMortgagePayment(-5)).toBeNull();
  });
});

describe('effectiveMonthlyBudget', () => {
  it('applies the 30% rule in income mode', () => {
    expect(effectiveMonthlyBudget({ mode: 'income', monthlyIncome: 3000, sizeM2: 50 }))
      .toBeCloseTo(3000 * INCOME_TO_HOUSING_RATIO, 5);
  });

  it('uses the budget directly in budget mode', () => {
    expect(effectiveMonthlyBudget({ mode: 'budget', monthlyBudget: 1200, sizeM2: 50 })).toBe(1200);
  });

  it('returns 0 for missing/invalid input', () => {
    expect(effectiveMonthlyBudget({ mode: 'income', monthlyIncome: null, sizeM2: 50 })).toBe(0);
    expect(effectiveMonthlyBudget({ mode: 'budget', monthlyBudget: -10, sizeM2: 50 })).toBe(0);
  });
});

describe('bandForShare', () => {
  it('maps shares to green/amber/red', () => {
    expect(bandForShare(0.5, RENT_GREEN_MAX, RENT_AMBER_MAX)).toBe('green');
    expect(bandForShare(1.0, RENT_GREEN_MAX, RENT_AMBER_MAX)).toBe('green');
    expect(bandForShare(1.1, RENT_GREEN_MAX, RENT_AMBER_MAX)).toBe('amber');
    expect(bandForShare(1.25, RENT_GREEN_MAX, RENT_AMBER_MAX)).toBe('amber');
    expect(bandForShare(2.0, RENT_GREEN_MAX, RENT_AMBER_MAX)).toBe('red');
  });

  it('returns null for null/NaN', () => {
    expect(bandForShare(null, RENT_GREEN_MAX, RENT_AMBER_MAX)).toBeNull();
    expect(bandForShare(NaN, RENT_GREEN_MAX, RENT_AMBER_MAX)).toBeNull();
  });
});

describe('affordabilityFor', () => {
  it('computes rent and purchase price from sqm fields × size', () => {
    const r = affordabilityFor({ mode: 'budget', monthlyBudget: 1500, sizeM2: 50 }, PROPS);
    expect(r.monthlyRent).toBe(20 * 50); // 1000
    expect(r.purchasePrice).toBe(5000 * 50); // 250000
  });

  it('expresses rent as a share of the budget and bands it', () => {
    // rent 1000 vs budget 1000 → exactly green boundary
    const r = affordabilityFor({ mode: 'budget', monthlyBudget: 1000, sizeM2: 50 }, PROPS);
    expect(r.rentShare).toBeCloseTo(1.0, 5);
    expect(r.rentBand).toBe('green');
  });

  it('flags an over-budget rent as red', () => {
    // rent 1000 vs budget 400 → 2.5× → red
    const r = affordabilityFor({ mode: 'budget', monthlyBudget: 400, sizeM2: 50 }, PROPS);
    expect(r.rentShare).toBeCloseTo(2.5, 5);
    expect(r.rentBand).toBe('red');
  });

  it('derives the budget from income via the 30% rule', () => {
    // income 4000 → budget 1200; rent 1000 → share ~0.83 → green
    const r = affordabilityFor({ mode: 'income', monthlyIncome: 4000, sizeM2: 50 }, PROPS);
    expect(r.monthlyBudget).toBeCloseTo(1200, 5);
    expect(r.rentShare).toBeCloseTo(1000 / 1200, 5);
    expect(r.rentBand).toBe('green');
  });

  it('finances (1 - down payment) of the purchase price for the mortgage share', () => {
    const r = affordabilityFor({ mode: 'budget', monthlyBudget: 2000, sizeM2: 50 }, PROPS);
    const financed = 250_000 * (1 - MORTGAGE_DOWN_PAYMENT);
    const expectedPayment = monthlyMortgagePayment(financed);
    expect(r.monthlyMortgage).toBeCloseTo(expectedPayment!, 4);
    expect(r.buyShare).toBeCloseTo(expectedPayment! / 2000, 5);
    expect(r.buyBand).not.toBeNull();
  });

  it('returns nulls when a price field is missing', () => {
    const r = affordabilityFor(
      { mode: 'budget', monthlyBudget: 1500, sizeM2: 50 },
      { rental_price_sqm: null, property_price_sqm: null },
    );
    expect(r.monthlyRent).toBeNull();
    expect(r.purchasePrice).toBeNull();
    expect(r.rentShare).toBeNull();
    expect(r.buyShare).toBeNull();
    expect(r.rentBand).toBeNull();
    expect(r.buyBand).toBeNull();
  });

  it('returns null shares when there is no usable budget', () => {
    const r = affordabilityFor({ mode: 'income', monthlyIncome: 0, sizeM2: 50 }, PROPS);
    expect(r.monthlyRent).toBe(1000); // rent still computable from props
    expect(r.rentShare).toBeNull();
    expect(r.rentBand).toBeNull();
  });

  it('coerces string-valued props (GeoJSON sometimes stores numbers as strings)', () => {
    const r = affordabilityFor(
      { mode: 'budget', monthlyBudget: 1000, sizeM2: 50 },
      { rental_price_sqm: '20', property_price_sqm: '5000' },
    );
    expect(r.monthlyRent).toBe(1000);
    expect(r.purchasePrice).toBe(250_000);
  });

  it('treats non-positive size as no estimate', () => {
    const r = affordabilityFor({ mode: 'budget', monthlyBudget: 1000, sizeM2: 0 }, PROPS);
    expect(r.monthlyRent).toBeNull();
    expect(r.purchasePrice).toBeNull();
  });
});

describe('inRange', () => {
  it('validates against the shared limits', () => {
    expect(inRange(3000, AFFORDABILITY_LIMITS.income.min, AFFORDABILITY_LIMITS.income.max)).toBe(true);
    expect(inRange(0, AFFORDABILITY_LIMITS.income.min, AFFORDABILITY_LIMITS.income.max)).toBe(false);
    expect(inRange(2_000_000, AFFORDABILITY_LIMITS.income.min, AFFORDABILITY_LIMITS.income.max)).toBe(false);
    expect(inRange(null, 1, 10)).toBe(false);
    expect(inRange(NaN, 1, 10)).toBe(false);
  });
});
