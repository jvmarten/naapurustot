/**
 * CF-1: Affordability calculator (pure math).
 *
 * Given a user's monthly net income OR a fixed monthly housing budget, plus an
 * apartment size, estimate the monthly rent and the purchase price for an area
 * and express each as a share of the user's budget. The "budget" is either an
 * explicit monthly housing budget (€/month, used directly for rent) or derived
 * from net income via a configurable affordability ratio.
 *
 * All numbers trace to real GeoJSON fields:
 *   - estimated monthly rent  = rental_price_sqm (€/m²/month) × sizeM2
 *   - estimated purchase price = property_price_sqm (€/m²) × sizeM2
 *
 * This module is intentionally dependency-free and side-effect-free so it can be
 * unit-tested in isolation and reused by CF-14 (map shading + ranking) later.
 */

/** What the user supplied: a monthly net income, or a direct monthly housing budget. */
export type AffordabilityMode = 'income' | 'budget';

/** A traffic-light band describing how comfortably a cost fits the budget. */
export type AffordabilityBand = 'green' | 'amber' | 'red';

/** The minimal slice of NeighborhoodProperties the calculator reads. */
export interface AffordabilityInputProps {
  rental_price_sqm: number | string | null | undefined;
  property_price_sqm: number | string | null | undefined;
  /** Local median income (€/year) — context only, not used in the math. */
  hr_mtu?: number | string | null | undefined;
}

export interface AffordabilityInput {
  mode: AffordabilityMode;
  /** Monthly net income (€/month) when mode === 'income'. */
  monthlyIncome?: number | null;
  /** Monthly housing budget (€/month) when mode === 'budget'. */
  monthlyBudget?: number | null;
  /** Apartment size in m². */
  sizeM2: number;
}

export interface AffordabilityResult {
  /** Estimated monthly rent (€/month), or null when rental_price_sqm is missing. */
  monthlyRent: number | null;
  /** Estimated purchase price (€), or null when property_price_sqm is missing. */
  purchasePrice: number | null;
  /** Monthly housing budget actually used for the rent share (€/month). */
  monthlyBudget: number;
  /** Rent ÷ monthly budget (0–∞), or null when rent unknown / budget ≤ 0. */
  rentShare: number | null;
  /** Estimated monthly mortgage payment for the purchase (€/month), or null. */
  monthlyMortgage: number | null;
  /** Monthly mortgage ÷ monthly budget, or null when unknown / budget ≤ 0. */
  buyShare: number | null;
  /** Band for the rent share, or null when not computable. */
  rentBand: AffordabilityBand | null;
  /** Band for the buy (mortgage) share, or null when not computable. */
  buyBand: AffordabilityBand | null;
}

/**
 * Share of net income a household can comfortably direct at housing. 0.30 is the
 * widely used "30% rule" affordability threshold; only applied when the user
 * enters an income rather than a direct budget.
 */
export const INCOME_TO_HOUSING_RATIO = 0.3;

/** Share thresholds for the rent traffic-light bands (fraction of monthly budget). */
export const RENT_GREEN_MAX = 1.0; // ≤ budget → comfortable
export const RENT_AMBER_MAX = 1.25; // up to 25% over → stretch

/** Share thresholds for the mortgage traffic-light bands (fraction of monthly budget). */
export const BUY_GREEN_MAX = 1.0;
export const BUY_AMBER_MAX = 1.25;

/**
 * Mortgage assumptions for translating a purchase price into a comparable monthly
 * payment. Deliberately conservative and explicit so the UI can disclose them:
 *  - 25% down payment (so 75% is financed)
 *  - 3.5% nominal annual interest
 *  - 25-year (300-month) term
 * These are assumptions, not data — the panel surfaces them as such.
 */
export const MORTGAGE_DOWN_PAYMENT = 0.25;
export const MORTGAGE_ANNUAL_RATE = 0.035;
export const MORTGAGE_TERM_MONTHS = 25 * 12;

const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Standard amortizing-loan monthly payment. Returns null for non-positive principal. */
export function monthlyMortgagePayment(
  principal: number,
  annualRate: number = MORTGAGE_ANNUAL_RATE,
  termMonths: number = MORTGAGE_TERM_MONTHS,
): number | null {
  if (!Number.isFinite(principal) || principal <= 0 || termMonths <= 0) return null;
  const r = annualRate / 12;
  if (r === 0) return principal / termMonths;
  const factor = Math.pow(1 + r, termMonths);
  return (principal * r * factor) / (factor - 1);
}

/** Map a cost/budget share to a traffic-light band using the supplied thresholds. */
export function bandForShare(
  share: number | null,
  greenMax: number,
  amberMax: number,
): AffordabilityBand | null {
  if (share == null || !Number.isFinite(share)) return null;
  if (share <= greenMax) return 'green';
  if (share <= amberMax) return 'amber';
  return 'red';
}

/**
 * Resolve the effective monthly housing budget from the user's input. In income
 * mode this is INCOME_TO_HOUSING_RATIO of the monthly net income; in budget mode
 * it is the entered budget directly. Returns 0 for missing/invalid input so
 * callers treat shares as not-computable rather than dividing by zero.
 */
export function effectiveMonthlyBudget(input: AffordabilityInput): number {
  if (input.mode === 'budget') {
    const b = toNum(input.monthlyBudget);
    return b != null && b > 0 ? b : 0;
  }
  const income = toNum(input.monthlyIncome);
  return income != null && income > 0 ? income * INCOME_TO_HOUSING_RATIO : 0;
}

/**
 * CF-1 core: compute estimated rent, purchase price, their monthly shares of the
 * user's budget, and the traffic-light band for each. Pure; safe to call on every
 * keystroke. The signature `affordabilityFor(input, props)` is the stable base
 * that CF-14 reuses for map shading and ranking.
 */
export function affordabilityFor(
  input: AffordabilityInput,
  props: AffordabilityInputProps,
): AffordabilityResult {
  const size = toNum(input.sizeM2);
  const sizeM2 = size != null && size > 0 ? size : 0;

  const rentSqm = toNum(props.rental_price_sqm);
  const priceSqm = toNum(props.property_price_sqm);

  const monthlyRent = rentSqm != null && rentSqm > 0 && sizeM2 > 0 ? rentSqm * sizeM2 : null;
  const purchasePrice = priceSqm != null && priceSqm > 0 && sizeM2 > 0 ? priceSqm * sizeM2 : null;

  const monthlyBudget = effectiveMonthlyBudget(input);
  const usableBudget = monthlyBudget > 0 ? monthlyBudget : 0;

  const rentShare = monthlyRent != null && usableBudget > 0 ? monthlyRent / usableBudget : null;

  const financed = purchasePrice != null ? purchasePrice * (1 - MORTGAGE_DOWN_PAYMENT) : null;
  const monthlyMortgage = financed != null ? monthlyMortgagePayment(financed) : null;
  const buyShare = monthlyMortgage != null && usableBudget > 0 ? monthlyMortgage / usableBudget : null;

  return {
    monthlyRent,
    purchasePrice,
    monthlyBudget: usableBudget,
    rentShare,
    monthlyMortgage,
    buyShare,
    rentBand: bandForShare(rentShare, RENT_GREEN_MAX, RENT_AMBER_MAX),
    buyBand: bandForShare(buyShare, BUY_GREEN_MAX, BUY_AMBER_MAX),
  };
}

/** Sensible clamp ranges for the user inputs (shared by the form + the URL codec). */
export const AFFORDABILITY_LIMITS = {
  income: { min: 1, max: 1_000_000 },
  budget: { min: 1, max: 1_000_000 },
  size: { min: 1, max: 1000 },
} as const;

/** True when a number is finite and within [min, max]. */
export function inRange(n: number | null | undefined, min: number, max: number): boolean {
  return n != null && Number.isFinite(n) && n >= min && n <= max;
}

// ─── CF-14: affordability-aware scoring / filtering ─────────────────────────
// Folds CF-1's pure math into the discovery wizard and Quality-Index match-%, so
// "best match" can optionally respect "within my budget". Everything here is a
// no-op when the user has no usable affordability input — graceful default.

/**
 * Which cost an area is judged against. 'rent' / 'buy' look at exactly one share;
 * 'either' passes when *either* renting or buying fits, and uses the better
 * (lower) of the two shares for the soft weight. Mirrors the wizard's tenure
 * answer ('own' → 'buy', 'rent' → 'rent', 'either' → 'either').
 */
export type AffordabilityOrientation = 'rent' | 'buy' | 'either';

export interface AffordabilityScore {
  /** True when input + size + a relevant price field were all usable — i.e. the
   *  affordability test actually ran. When false, callers must treat the area as
   *  neither helped nor hurt (no-op). */
  applicable: boolean;
  /** True when the relevant cost is within budget (share ≤ 1.0). null when not applicable. */
  affordable: boolean | null;
  /** The decisive cost/budget share used (rent, buy, or the better of the two). null when not applicable. */
  share: number | null;
  /**
   * Soft 0–1 multiplier for ranking: 1 when comfortably within budget, decaying
   * toward 0 as the cost overshoots (1 at share ≤ 1, 0 at share ≥ OVERSHOOT_MAX).
   * 1 (neutral) when not applicable so it never penalizes areas the test can't judge.
   */
  weight: number;
}

/** Share at/above which the soft affordability weight bottoms out at 0. A cost
 *  twice the budget contributes nothing; between 1× and 2× it ramps down linearly. */
export const AFFORDABILITY_OVERSHOOT_MAX = 2.0;

const softWeightForShare = (share: number | null): number => {
  if (share == null || !Number.isFinite(share)) return 1; // not judgeable → neutral
  if (share <= RENT_GREEN_MAX) return 1;
  if (share >= AFFORDABILITY_OVERSHOOT_MAX) return 0;
  return (AFFORDABILITY_OVERSHOOT_MAX - share) / (AFFORDABILITY_OVERSHOOT_MAX - RENT_GREEN_MAX);
};

/**
 * CF-14 core: judge how an area's housing cost fits the user's budget. Reuses
 * affordabilityFor (no duplicated math). When the input carries no usable budget
 * (effectiveMonthlyBudget ≤ 0) or the relevant price field is missing, returns a
 * NEUTRAL, non-applicable result so the caller leaves the area's score untouched.
 *
 * `orientation` picks rent vs buy (or either); 'either' passes when the cheaper of
 * the two paths fits, and scores on that better share.
 */
export function affordabilityScore(
  input: AffordabilityInput,
  props: AffordabilityInputProps,
  orientation: AffordabilityOrientation = 'either',
): AffordabilityScore {
  const NEUTRAL: AffordabilityScore = { applicable: false, affordable: null, share: null, weight: 1 };
  if (effectiveMonthlyBudget(input) <= 0) return NEUTRAL;

  const r = affordabilityFor(input, props);
  const shares: number[] = [];
  if (orientation !== 'buy' && r.rentShare != null) shares.push(r.rentShare);
  if (orientation !== 'rent' && r.buyShare != null) shares.push(r.buyShare);
  if (shares.length === 0) return NEUTRAL; // no relevant price data → can't judge

  // 'either' takes the cheaper path; a single-orientation request has one share.
  const share = Math.min(...shares);
  return {
    applicable: true,
    affordable: share <= RENT_GREEN_MAX,
    share,
    weight: softWeightForShare(share),
  };
}

/** Map a wizard tenure answer to the affordability orientation. */
export function orientationForTenure(tenure: 'own' | 'rent' | 'either'): AffordabilityOrientation {
  return tenure === 'own' ? 'buy' : tenure === 'rent' ? 'rent' : 'either';
}
