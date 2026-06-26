/**
 * CF-4 / "Fit for you": the per-area match scorer behind the Neighborhood Finder.
 *
 * Extracted from NeighborhoodWizard.scoreNeighborhoods so the SAME algorithm powers
 * both the wizard's top-5 ranking (region-scoped normalization ranges) and a
 * persistent "Fit for you" badge shown on the panel, profile page and comparison
 * (national winsorized ranges, so the % means the same thing in every view).
 *
 * Pure + side-effect-free except for reading the active language via t() to build
 * the human-readable "why it matched" breakdown — callers that render those strings
 * must subscribe to useI18nVersion().
 */
import type { NeighborhoodProperties } from './metrics';
import type { WizardAnswers } from '../hooks/useWizardProfile';
import type { AffordabilityState } from '../hooks/useAffordability';
import { affordabilityScore, orientationForTenure, type AffordabilityScore } from './affordability';
import { getNationalRanges } from './nationalRanges';
import { t } from './i18n';

/** How affordability is folded into the match. Owned by the scorer (was the wizard). */
export type AffordabilityMatchMode = 'off' | 'filter' | 'soft';

/** Per-criterion "why it matched" breakdown — the area's actual value vs the chosen
 *  preference, and whether it helped or hurt the score. */
export interface FitContribution {
  label: string;
  actual: string;
  target: string;
  direction: 'up' | 'down' | 'neutral';
}

export interface FitResult {
  /** 0–100 integer match score. */
  score: number;
  reasons: string[];
  contributions: FitContribution[];
  /** True when affordability 'filter' mode drops this area from the result set. */
  excluded: boolean;
}

/** Normalization bounds per metric, keyed by GeoJSON property name. */
export type FitRanges = Record<string, { min: number; max: number }>;

/** The metrics the scorer normalizes against (every one exists in national_ranges.json). */
export const FIT_RANGE_KEYS: (keyof NeighborhoodProperties)[] = [
  'transit_stop_density', 'restaurant_density', 'ra_as_kpa', 'child_ratio',
  'daycare_density', 'school_density', 'healthcare_density', 'ownership_rate', 'rental_rate',
];

/** Normalize a value within a range to 0–1 (0.5 for missing/degenerate ranges). */
export function normalize(value: number | null | undefined, min: number, max: number): number {
  if (value == null || max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Collect region-scoped min/max for FIT_RANGE_KEYS in a single pass over features
 * (the wizard's prior inline range collection). Degenerate metrics fall back to
 * {0,1} so normalize() returns a neutral 0.5.
 */
export function buildFitRanges(features: GeoJSON.Feature[]): FitRanges {
  const mins: Record<string, number> = {};
  const maxs: Record<string, number> = {};
  for (const k of FIT_RANGE_KEYS) { mins[k as string] = Infinity; maxs[k as string] = -Infinity; }
  for (const f of features) {
    const p = f.properties as NeighborhoodProperties | null;
    if (!p) continue;
    for (const k of FIT_RANGE_KEYS) {
      const v = p[k] as number | null;
      if (typeof v === 'number' && isFinite(v)) {
        const key = k as string;
        if (v < mins[key]) mins[key] = v;
        if (v > maxs[key]) maxs[key] = v;
      }
    }
  }
  const ranges: FitRanges = {};
  for (const k of FIT_RANGE_KEYS) {
    const key = k as string;
    ranges[key] = mins[key] < maxs[key] ? { min: mins[key], max: maxs[key] } : { min: 0, max: 1 };
  }
  return ranges;
}

// National winsorized (p2/p98) ranges, built once from national_ranges.json. Stable
// across regions, so the "Fit for you" badge reads identically in every view.
let nationalFitRanges: FitRanges | null = null;
export function getNationalFitRanges(): FitRanges {
  if (nationalFitRanges) return nationalFitRanges;
  const m = getNationalRanges();
  const ranges: FitRanges = {};
  for (const k of FIT_RANGE_KEYS) {
    const e = m.get(k as string);
    ranges[k as string] = e ? { min: e.min, max: e.max } : { min: 0, max: 1 };
  }
  nationalFitRanges = ranges;
  return ranges;
}

/**
 * Score one area against a priority profile. Returns the 0–100 match score plus the
 * per-criterion breakdown. `ranges` supplies the normalization bounds — region-scoped
 * (buildFitRanges) for the wizard's top-5, national (getNationalFitRanges) for the
 * persistent badge. Affordability folding is a complete no-op unless
 * `affordabilityMode !== 'off'` AND usable affordability input is supplied — exactly
 * the wizard's prior behavior.
 */
export function scoreFeatureFit(
  p: NeighborhoodProperties,
  answers: WizardAnswers,
  ranges: FitRanges,
  affordability?: AffordabilityState | null,
  affordabilityMode: AffordabilityMatchMode = 'off',
): FitResult {
  const R = (k: string) => ranges[k] ?? { min: 0, max: 1 };

  let score = 0;
  let totalWeight = 0;
  const reasons: string[] = [];
  const contributions: FitContribution[] = [];
  const dirOf = (s: number): FitContribution['direction'] => (s > 0.6 ? 'up' : s < 0.4 ? 'down' : 'neutral');
  const fmtDensity = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} /km²`);
  const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} %`);

  // --- Transit importance ---
  const transitWeight = answers.transitImportance / 5;
  if (transitWeight > 0) {
    const r = R('transit_stop_density');
    const transitScore = normalize(p.transit_stop_density, r.min, r.max);
    score += transitScore * transitWeight * 2;
    totalWeight += transitWeight * 2;
    if (transitScore > 0.7) reasons.push(t('wizard.reason_good_transit'));
    contributions.push({
      label: t('wizard.transit_importance'),
      actual: fmtDensity(p.transit_stop_density),
      target: `${answers.transitImportance}/5`,
      direction: dirOf(transitScore),
    });
  }

  // --- Quiet vs lively ---
  if (answers.quietPreference === 'quiet') {
    const r = R('restaurant_density');
    const restaurantInv = 1 - normalize(p.restaurant_density, r.min, r.max);
    score += restaurantInv * 2;
    totalWeight += 2;
    if (restaurantInv > 0.7) reasons.push(t('wizard.reason_quiet'));
    contributions.push({
      label: t('wizard.quiet_preference'),
      actual: fmtDensity(p.restaurant_density),
      target: t('wizard.pref_quiet'),
      direction: dirOf(restaurantInv),
    });
  } else if (answers.quietPreference === 'lively') {
    const r = R('restaurant_density');
    const restaurantScore = normalize(p.restaurant_density, r.min, r.max);
    score += restaurantScore * 2;
    totalWeight += 2;
    if (restaurantScore > 0.7) reasons.push(t('wizard.reason_lively'));
    contributions.push({
      label: t('wizard.quiet_preference'),
      actual: fmtDensity(p.restaurant_density),
      target: t('wizard.pref_lively'),
      direction: dirOf(restaurantScore),
    });
  } else {
    totalWeight += 0.5;
    score += 0.25;
  }

  // --- Budget filter ---
  const price = p.property_price_sqm;
  const bMin = Math.min(answers.budgetMin, answers.budgetMax);
  const bMax = Math.max(answers.budgetMin, answers.budgetMax);
  if (price != null) {
    const inBudget = price >= bMin && price <= bMax;
    if (inBudget) {
      const budgetRange = bMax - bMin;
      // When range is 0 (min===max), exact match gets full score. Otherwise compute
      // how close the price is to the midpoint (0–1).
      const budgetFit = budgetRange === 0
        ? 1
        : 1 - Math.abs(price - (bMin + bMax) / 2) / (budgetRange / 2);
      score += Math.max(0, budgetFit) * 2;
      totalWeight += 2;
      reasons.push(t('wizard.reason_budget'));
    } else {
      // Penalize out-of-budget neighborhoods
      score += 0;
      totalWeight += 2;
    }
    contributions.push({
      label: t('wizard.budget'),
      actual: `${Math.round(price)} ${t('wizard.budget_unit')}`,
      target: `${bMin}–${bMax} ${t('wizard.budget_unit')}`,
      direction: inBudget ? 'up' : 'down',
    });
  }

  // --- Apartment size preference ---
  const sizeScore = (() => {
    const size = p.ra_as_kpa;
    if (size == null) return 0.5;
    const r = R('ra_as_kpa');
    const norm = normalize(size, r.min, r.max);
    switch (answers.sizePreference) {
      case 'small': return 1 - norm;
      case 'large': return norm;
      default: return 1 - Math.abs(norm - 0.5) * 2; // prefer middle
    }
  })();
  score += sizeScore;
  totalWeight += 1;
  if (sizeScore > 0.7) reasons.push(t('wizard.reason_apt_size'));
  contributions.push({
    label: t('wizard.size_preference'),
    actual: p.ra_as_kpa != null ? `${p.ra_as_kpa.toFixed(0)} m²` : '—',
    target: t(`wizard.size_${answers.sizePreference}`),
    direction: dirOf(sizeScore),
  });

  // --- Tenure preference ---
  if (answers.tenurePreference === 'own') {
    const r = R('ownership_rate');
    const ownerScore = normalize(p.ownership_rate, r.min, r.max);
    score += ownerScore;
    totalWeight += 1;
    if (ownerScore > 0.7) reasons.push(t('wizard.reason_ownership'));
    contributions.push({
      label: t('wizard.tenure_preference'),
      actual: fmtPct(p.ownership_rate),
      target: t('wizard.tenure_own'),
      direction: dirOf(ownerScore),
    });
  } else if (answers.tenurePreference === 'rent') {
    const r = R('rental_rate');
    const rentalScore = normalize(p.rental_rate, r.min, r.max);
    score += rentalScore;
    totalWeight += 1;
    if (rentalScore > 0.7) reasons.push(t('wizard.reason_rental'));
    contributions.push({
      label: t('wizard.tenure_preference'),
      actual: fmtPct(p.rental_rate),
      target: t('wizard.tenure_rent'),
      direction: dirOf(rentalScore),
    });
  } else {
    totalWeight += 0.5;
    score += 0.25;
  }

  // --- Children ---
  if (answers.hasChildren) {
    const childScore = normalize(p.child_ratio, R('child_ratio').min, R('child_ratio').max);
    const daycareScore = normalize(p.daycare_density, R('daycare_density').min, R('daycare_density').max);

    const schoolWeight = answers.schoolImportance / 5;
    const schoolScore = normalize(p.school_density, R('school_density').min, R('school_density').max);

    score += (childScore + daycareScore + schoolScore * schoolWeight) * 1.5;
    totalWeight += (2 + schoolWeight) * 1.5;

    if (daycareScore > 0.6) reasons.push(t('wizard.reason_daycare'));
    if (schoolScore > 0.6) reasons.push(t('wizard.reason_schools'));
    contributions.push({
      label: t('wizard.reason_daycare'),
      actual: fmtDensity(p.daycare_density),
      target: t('wizard.yes'),
      direction: dirOf(daycareScore),
    });
    contributions.push({
      label: t('wizard.school_importance'),
      actual: fmtDensity(p.school_density),
      target: `${answers.schoolImportance}/5`,
      direction: dirOf(schoolScore),
    });
  }

  // --- Healthcare ---
  const healthWeight = answers.healthcareImportance / 5;
  if (healthWeight > 0) {
    const r = R('healthcare_density');
    const healthScore = normalize(p.healthcare_density, r.min, r.max);
    score += healthScore * healthWeight * 1.5;
    totalWeight += healthWeight * 1.5;
    if (healthScore > 0.7) reasons.push(t('wizard.reason_healthcare'));
    contributions.push({
      label: t('wizard.healthcare_importance'),
      actual: fmtDensity(p.healthcare_density),
      target: `${answers.healthcareImportance}/5`,
      direction: dirOf(healthScore),
    });
  }

  let finalScore = totalWeight > 0 ? score / totalWeight : 0;

  // --- CF-14: affordability fold (only when the user enabled it AND has usable input) ---
  const affInput = affordability
    ? { mode: affordability.mode, monthlyIncome: affordability.income, monthlyBudget: affordability.budget, sizeM2: affordability.sizeM2 ?? 0 }
    : null;
  const affActive = affordabilityMode !== 'off' && affInput != null;
  if (affActive && affInput) {
    const affOrientation = orientationForTenure(answers.tenurePreference);
    const aff: AffordabilityScore = affordabilityScore(affInput, p, affOrientation);
    if (aff.applicable) {
      const overBudget = aff.affordable === false;
      if (affordabilityMode === 'filter' && overBudget) {
        // Hard filter: drop the area from the result set entirely.
        return { score: Math.round(finalScore * 100), reasons: [...new Set(reasons)].slice(0, 3), contributions, excluded: true };
      }
      if (affordabilityMode === 'soft') {
        // Soft weight: scale the whole match toward 0 as the cost overshoots.
        finalScore *= aff.weight;
      }
      if (!overBudget) reasons.push(t('wizard.reason_within_budget'));
      // Surface the affordability verdict in the "why it matched" breakdown.
      contributions.push({
        label: t('wizard.affordability'),
        actual: aff.share != null ? `${Math.round(aff.share * 100)} %` : '—',
        target: t(overBudget ? 'wizard.afford_over' : 'wizard.afford_within'),
        direction: overBudget ? 'down' : 'up',
      });
    }
  }

  return {
    score: Math.round(finalScore * 100),
    reasons: [...new Set(reasons)].slice(0, 3),
    contributions,
    excluded: false,
  };
}

/**
 * Convenience for the persistent "Fit for you" badge: score one area against the
 * saved priority profile using the stable national ranges, with no affordability
 * fold (the badge is a pure priorities match, independent of any budget input).
 */
export function computeNationalFit(p: NeighborhoodProperties, answers: WizardAnswers): FitResult {
  return scoreFeatureFit(p, answers, getNationalFitRanges());
}

/** Tailwind text/bg classes for a 0–100 fit score, matching the app's score ramp. */
export function fitToneClasses(score: number): { text: string; bg: string; ring: string } {
  if (score >= 75) return { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/30' };
  if (score >= 55) return { text: 'text-lime-700 dark:text-lime-300', bg: 'bg-lime-500/15', ring: 'ring-lime-500/30' };
  if (score >= 35) return { text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-500/15', ring: 'ring-amber-500/30' };
  return { text: 'text-surface-600 dark:text-surface-300', bg: 'bg-surface-500/10', ring: 'ring-surface-500/20' };
}
