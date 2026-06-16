import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { FeatureCollection } from 'geojson';
import { useNavigate } from 'react-router-dom';
import type { NeighborhoodProperties } from '../utils/metrics';
import { t } from '../utils/i18n';
import { trackEvent } from '../utils/analytics';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getFeatureCenter } from '../utils/geometryFilter';
import { loadAllData } from '../utils/dataLoader';
import { computeQualityIndices, isCustomWeights, type QualityWeights } from '../utils/qualityIndex';
import { getNationalRanges } from '../utils/nationalRanges';
import { buildProfileUrl } from '../utils/profileUrl';
import { ComparisonScopeToggle, type ComparisonScope } from './ComparisonScopeToggle';
import { defaultWizardAnswers, type WizardAnswers } from '../hooks/useWizardProfile';
import type { AffordabilityState } from '../hooks/useAffordability';
import { affordabilityScore, orientationForTenure, type AffordabilityScore } from '../utils/affordability';

interface WizardProps {
  data: FeatureCollection | null;
  onSelect: (pno: string, center: [number, number]) => void;
  onClose: () => void;
  onShowOnMap?: (pnos: string[]) => void;
  /** CF-4: pre-fill the wizard from a persisted/shared priority profile. */
  initialAnswers?: WizardAnswers;
  /** CF-4: persist the current answers (localStorage + cloud sync + share URL). */
  onSaveProfile?: (answers: WizardAnswers) => void;
  /** CF-4: map the answers onto live Quality Index weights so the map reflects them. */
  onApplyToMap?: (answers: WizardAnswers) => void;
  /** CF-1pt3: live Quality-Index weights, so national-scope matches score
   *  quality_index the same as the region map (loadAllData uses default weights). */
  qualityWeights?: QualityWeights;
  /** CF-14: the user's affordability inputs (income/budget + size), if any. Lets the
   *  wizard fold "within my budget" into the match. Undefined/empty → no affordability UI. */
  affordability?: AffordabilityState;
  /** DT-2: the current city scope. On the default `?city=all` view `data` is the 69
   *  region aggregates, so the wizard defaults to national postal-area scope instead of
   *  "within this area" (which has no single area in view). */
  cityFilter?: string;
}

/** CF-5: per-criterion "why it matched" breakdown — the area's actual value against
 *  the threshold/preference the user chose, and whether it helped or hurt the score. */
interface Contribution {
  label: string;
  actual: string;
  target: string;
  direction: 'up' | 'down' | 'neutral';
}

interface ScoredNeighborhood {
  pno: string;
  name: string;
  qualityIndex: number | null;
  score: number;
  reasons: string[];
  contributions: Contribution[];
  center: [number, number];
}

/** CF-14: how affordability is folded into the wizard result. */
export type AffordabilityMatchMode = 'off' | 'filter' | 'soft';

// CF-4: WizardAnswers/defaultWizardAnswers now live in hooks/useWizardProfile.ts
// (shared with the persistence hook and the share-URL codec). Aliased here so the
// existing in-component references stay terse.
const defaultAnswers = defaultWizardAnswers;

/** Normalize a value within a range to 0-1 */
function normalize(value: number | null, min: number, max: number): number {
  if (value == null || max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function scoreNeighborhoods(
  data: FeatureCollection,
  answers: WizardAnswers,
  // CF-14: optional affordability folding. When `affordabilityMode` is 'off' (or the
  // user has no usable income/budget+size input) this is a complete no-op — nothing
  // about the existing scoring changes for users who never opened the calculator.
  affordability?: AffordabilityState,
  affordabilityMode: AffordabilityMatchMode = 'off',
): ScoredNeighborhood[] {
  const features = data.features.filter(
    (f) => f.properties && (f.properties as NeighborhoodProperties).he_vakiy != null,
  );

  // CF-14: build the affordability input once. The orientation follows the wizard's
  // tenure answer (own → buy, rent → rent, either → cheaper of the two).
  const affOrientation = orientationForTenure(answers.tenurePreference);
  const affInput = affordability
    ? { mode: affordability.mode, monthlyIncome: affordability.income, monthlyBudget: affordability.budget, sizeM2: affordability.sizeM2 ?? 0 }
    : null;
  const affActive = affordabilityMode !== 'off' && affInput != null;

  // Collect all property ranges in a single pass over features instead of
  // iterating once per property (was 9 × ~200 = 1800 iterations, now ~200).
  const RANGE_KEYS: (keyof NeighborhoodProperties)[] = [
    'transit_stop_density', 'restaurant_density', 'ra_as_kpa', 'child_ratio',
    'daycare_density', 'school_density', 'healthcare_density', 'ownership_rate', 'rental_rate',
  ];
  const mins: Record<string, number> = {};
  const maxs: Record<string, number> = {};
  for (const k of RANGE_KEYS) { mins[k as string] = Infinity; maxs[k as string] = -Infinity; }
  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;
    for (const k of RANGE_KEYS) {
      const v = p[k] as number | null;
      if (typeof v === 'number' && isFinite(v)) {
        const key = k as string;
        if (v < mins[key]) mins[key] = v;
        if (v > maxs[key]) maxs[key] = v;
      }
    }
  }
  const toRange = (k: string) => mins[k] < maxs[k] ? { min: mins[k], max: maxs[k] } : { min: 0, max: 1 };

  const transitRange = toRange('transit_stop_density');
  const restaurantRange = toRange('restaurant_density');
  const aptSizeRange = toRange('ra_as_kpa');
  const childRange = toRange('child_ratio');
  const daycareRange = toRange('daycare_density');
  const schoolRange = toRange('school_density');
  const healthcareRange = toRange('healthcare_density');
  const ownershipRange = toRange('ownership_rate');
  const rentalRange = toRange('rental_rate');

  // Hold candidates with their feature reference so we can compute centroids
  // only for the final top 5 after sorting.
  const scored: (Omit<ScoredNeighborhood, 'center'> & { feature: GeoJSON.Feature })[] = [];

  for (const feature of features) {
    const p = feature.properties as NeighborhoodProperties;
    if (!p.pno || !p.nimi) continue;

    let score = 0;
    let totalWeight = 0;
    const reasons: string[] = [];
    // CF-5: capture each active criterion's actual value vs the chosen threshold.
    const contributions: Contribution[] = [];
    const dirOf = (s: number): Contribution['direction'] => (s > 0.6 ? 'up' : s < 0.4 ? 'down' : 'neutral');
    const fmtDensity = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} /km²`);
    const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} %`);

    // --- Transit importance ---
    const transitWeight = answers.transitImportance / 5;
    if (transitWeight > 0) {
      const transitScore = normalize(p.transit_stop_density, transitRange.min, transitRange.max);
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
      const restaurantInv = 1 - normalize(p.restaurant_density, restaurantRange.min, restaurantRange.max);
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
      const restaurantScore = normalize(p.restaurant_density, restaurantRange.min, restaurantRange.max);
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
        // When range is 0 (min===max), exact match gets full score.
        // Otherwise compute how close the price is to the midpoint (0–1).
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
      const norm = normalize(size, aptSizeRange.min, aptSizeRange.max);
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
      const ownerScore = normalize(p.ownership_rate, ownershipRange.min, ownershipRange.max);
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
      const rentalScore = normalize(p.rental_rate, rentalRange.min, rentalRange.max);
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
      const childScore = normalize(p.child_ratio, childRange.min, childRange.max);
      const daycareScore = normalize(p.daycare_density, daycareRange.min, daycareRange.max);

      const schoolWeight = answers.schoolImportance / 5;
      const schoolScore = normalize(p.school_density, schoolRange.min, schoolRange.max);

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
      const healthScore = normalize(p.healthcare_density, healthcareRange.min, healthcareRange.max);
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
    if (affActive && affInput) {
      const aff: AffordabilityScore = affordabilityScore(affInput, p, affOrientation);
      if (aff.applicable) {
        const overBudget = aff.affordable === false;
        if (affordabilityMode === 'filter' && overBudget) {
          // Hard filter: drop the area from the result set entirely.
          continue;
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

    // Deduplicate reasons
    const uniqueReasons = [...new Set(reasons)];

    // Defer centroid computation to after sort+slice — it iterates every
    // coordinate of the polygon (~100 points × 200 features = 20k ops) and
    // only the top 5 centers are ever used for flyTo targets.
    scored.push({
      feature,
      pno: p.pno,
      name: p.nimi,
      qualityIndex: p.quality_index,
      score: Math.round(finalScore * 100),
      reasons: uniqueReasons.slice(0, 3),
      contributions,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((s) => ({
    pno: s.pno,
    name: s.name,
    qualityIndex: s.qualityIndex,
    score: s.score,
    reasons: s.reasons,
    contributions: s.contributions,
    // getFeatureCenter uses bbox midpoint, which is unbiased by the duplicate
    // closing vertex in GeoJSON rings. The previous custom centroid averaged
    // every vertex, pulling the result toward the first/last point of each
    // ring — noticeable on elongated or C-shaped postal code areas.
    center: getFeatureCenter(s.feature),
  }));
}

const STEP_COUNT = 4;

export const NeighborhoodWizard: React.FC<WizardProps> = ({ data, onSelect, onClose, onShowOnMap, initialAnswers, onSaveProfile, onApplyToMap, affordability, qualityWeights, cityFilter }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  // CF-14: does the user have a usable affordability input (amount + size)? Only
  // then do we offer the "within my budget" control; otherwise it stays a no-op.
  const hasAffordability =
    affordability != null &&
    affordability.sizeM2 != null &&
    (affordability.mode === 'budget' ? affordability.budget != null : affordability.income != null);
  // CF-14: how affordability folds into the result. Default 'off' so existing users
  // (and anyone who hasn't set a budget) see exactly the historical behaviour.
  const [affordabilityMode, setAffordabilityMode] = useState<AffordabilityMatchMode>('off');
  // CF-4: pre-fill from a persisted/shared profile when provided.
  const [answers, setAnswers] = useState<WizardAnswers>(() => ({ ...defaultAnswers, ...initialAnswers }));
  // CF-4: feedback flag for the "Save my priorities" action.
  const [saved, setSaved] = useState(false);

  // CF-4: persist edited answers (debounced) so the profile, share URL and any
  // mapped weights track the wizard continuously, not just on an explicit save.
  const onSaveProfileRef = useRef(onSaveProfile);
  useEffect(() => { onSaveProfileRef.current = onSaveProfile; }, [onSaveProfile]);
  const firstAnswersRef = useRef(true);
  useEffect(() => {
    if (firstAnswersRef.current) { firstAnswersRef.current = false; return; }
    setSaved(false);
    const id = setTimeout(() => onSaveProfileRef.current?.(answers), 400);
    return () => clearTimeout(id);
  }, [answers]);
  // CF-6: score within this region or across all of Finland. The national dataset
  // (geometry-stripped region_properties.json) is lazy-loaded on first use.
  // DT-2: on the all-Finland view there is no single region in scope, so default to
  // national postal-area scope rather than ranking the 69 region aggregates.
  const [scope, setScope] = useState<ComparisonScope>(cityFilter === 'all' ? 'all' : 'region');
  const [nationalData, setNationalData] = useState<FeatureCollection | null>(null);
  const [nationalLoading, setNationalLoading] = useState(false);
  useEffect(() => {
    if (scope !== 'all') return;
    setNationalLoading(true);
    loadAllData()
      .then((res) => {
        const fc = res.data;
        // CF-1pt3: re-score nationally with the user's custom weights so wizard
        // matches use the same quality_index as the region map. loadAllData is
        // cached → re-running on a weights change is instant.
        if (qualityWeights && isCustomWeights(qualityWeights)) {
          computeQualityIndices(fc.features, qualityWeights, getNationalRanges());
        }
        setNationalData({ ...fc, features: [...fc.features] });
      })
      .catch(() => setScope('region')) // national dataset unavailable — fall back
      .finally(() => setNationalLoading(false));
  }, [scope, qualityWeights]);
  const isNational = scope === 'all';
  const activeData = isNational ? nationalData : data;

  // A11y: move focus into the dialog on open and restore it to the triggering
  // element on close, so keyboard/screen-reader users aren't left behind the modal.
  const panelRef = useRef<HTMLDivElement>(null);
  // PO-3: contain Tab focus within the wizard dialog (it declares aria-modal).
  useFocusTrap(panelRef);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => trigger?.focus?.();
  }, []);

  // CF-14: only fold affordability when the user has a usable input AND enabled it.
  const effectiveAffMode: AffordabilityMatchMode = hasAffordability ? affordabilityMode : 'off';
  const topMatches = useMemo(() => {
    if (!activeData || step < 3) return [];
    return scoreNeighborhoods(activeData, answers, affordability, effectiveAffMode);
  }, [activeData, answers, step, affordability, effectiveAffMode]);

  // CF-6: open a result. National features are geometry-stripped, so the map can't
  // fly to them — navigate to their profile page instead (as national similarity
  // does). Region-scope matches keep the fly-to path.
  const handleResultClick = (pno: string, name: string, center: [number, number]) => {
    if (isNational) {
      onClose();
      navigate(buildProfileUrl(pno, name));
    } else {
      onSelect(pno, center);
      onClose();
    }
  };

  const canNext = step < STEP_COUNT - 1;
  const canBack = step > 0;

  const stepTitles = [
    t('wizard.step_lifestyle'),
    t('wizard.step_housing'),
    t('wizard.step_family'),
    t('wizard.results'),
  ];

  const renderStepIndicator = () => (
    <div className="flex items-center gap-2 mb-6">
      {stepTitles.map((_title, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors
              ${i === step
                ? 'bg-blue-500 text-white'
                : i < step
                  ? 'bg-green-500 text-white'
                  : 'bg-surface-200 dark:bg-surface-700 text-surface-500 dark:text-surface-400'
              }`}
          >
            {i < step ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              i + 1
            )}
          </div>
          {i < stepTitles.length - 1 && (
            <div className={`w-6 h-0.5 ${i < step ? 'bg-green-500' : 'bg-surface-300 dark:bg-surface-600'}`} />
          )}
        </div>
      ))}
    </div>
  );

  const renderLifestyleStep = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-bold text-surface-900 dark:text-white">
        {t('wizard.step_lifestyle')}
      </h3>

      {/* Transit importance */}
      <div>
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
          {t('wizard.transit_importance')}
        </label>
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-400">1</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={answers.transitImportance}
            onChange={(e) => setAnswers((a) => ({ ...a, transitImportance: Number(e.target.value) }))}
            className="flex-1 h-2 rounded-full appearance-none cursor-pointer
                       bg-surface-200 dark:bg-surface-700
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500
                       [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
                       [&::-webkit-slider-thumb]:cursor-pointer
                       [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
                       [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500
                       [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md
                       [&::-moz-range-thumb]:cursor-pointer"
          />
          <span className="text-xs text-surface-400">5</span>
          <span className="text-sm font-semibold text-blue-500 tabular-nums w-4 text-center">
            {answers.transitImportance}
          </span>
        </div>
      </div>

      {/* Quiet vs lively */}
      <div>
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
          {t('wizard.quiet_preference')}
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(['quiet', 'neutral', 'lively'] as const).map((pref) => (
            <button
              key={pref}
              onClick={() => setAnswers((a) => ({ ...a, quietPreference: pref }))}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors
                ${answers.quietPreference === pref
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                }`}
            >
              {t(`wizard.pref_${pref}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderHousingStep = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-bold text-surface-900 dark:text-white">
        {t('wizard.step_housing')}
      </h3>

      {/* Budget range */}
      <div>
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
          {t('wizard.budget')}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={500}
            max={15000}
            step={100}
            value={answers.budgetMin}
            aria-label={`${t('wizard.budget')} (min)`}
            // Ignore empty/non-finite input (so clearing doesn't silently coerce to
            // Number('') === 0); clamp into range on blur.
            onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) setAnswers((a) => ({ ...a, budgetMin: n })); }}
            onBlur={() => setAnswers((a) => ({ ...a, budgetMin: Math.min(15000, Math.max(500, Number.isFinite(a.budgetMin) ? a.budgetMin : defaultAnswers.budgetMin)) }))}
            className="w-24 px-2 py-1.5 text-sm rounded-lg border border-surface-300 dark:border-surface-600
                       bg-white dark:bg-surface-800 text-surface-900 dark:text-white
                       focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <span className="text-surface-400">—</span>
          <input
            type="number"
            min={500}
            max={15000}
            step={100}
            value={answers.budgetMax}
            aria-label={`${t('wizard.budget')} (max)`}
            onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) setAnswers((a) => ({ ...a, budgetMax: n })); }}
            onBlur={() => setAnswers((a) => ({ ...a, budgetMax: Math.min(15000, Math.max(500, Number.isFinite(a.budgetMax) ? a.budgetMax : defaultAnswers.budgetMax)) }))}
            className="w-24 px-2 py-1.5 text-sm rounded-lg border border-surface-300 dark:border-surface-600
                       bg-white dark:bg-surface-800 text-surface-900 dark:text-white
                       focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <span className="text-xs text-surface-400">{t('wizard.budget_unit')}</span>
        </div>
      </div>

      {/* Apartment size preference */}
      <div>
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
          {t('wizard.size_preference')}
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(['small', 'medium', 'large'] as const).map((size) => (
            <button
              key={size}
              onClick={() => setAnswers((a) => ({ ...a, sizePreference: size }))}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors
                ${answers.sizePreference === size
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                }`}
            >
              {t(`wizard.size_${size}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Tenure preference */}
      <div>
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
          {t('wizard.tenure_preference')}
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(['own', 'rent', 'either'] as const).map((tenure) => (
            <button
              key={tenure}
              onClick={() => setAnswers((a) => ({ ...a, tenurePreference: tenure }))}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors
                ${answers.tenurePreference === tenure
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                }`}
            >
              {t(`wizard.tenure_${tenure}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderFamilyStep = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-bold text-surface-900 dark:text-white">
        {t('wizard.step_family')}
      </h3>

      {/* Has children */}
      <div>
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
          {t('wizard.has_children')}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((val) => (
            <button
              key={String(val)}
              onClick={() => setAnswers((a) => ({ ...a, hasChildren: val }))}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors
                ${answers.hasChildren === val
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                }`}
            >
              {val ? t('wizard.yes') : t('wizard.no')}
            </button>
          ))}
        </div>
      </div>

      {/* School importance (shown if has children) */}
      {answers.hasChildren && (
        <div>
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
            {t('wizard.school_importance')}
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-surface-400">1</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={answers.schoolImportance}
              onChange={(e) => setAnswers((a) => ({ ...a, schoolImportance: Number(e.target.value) }))}
              className="flex-1 h-2 rounded-full appearance-none cursor-pointer
                         bg-surface-200 dark:bg-surface-700
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                         [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500
                         [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
                         [&::-webkit-slider-thumb]:cursor-pointer
                         [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
                         [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500
                         [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md
                         [&::-moz-range-thumb]:cursor-pointer"
            />
            <span className="text-xs text-surface-400">5</span>
            <span className="text-sm font-semibold text-blue-500 tabular-nums w-4 text-center">
              {answers.schoolImportance}
            </span>
          </div>
        </div>
      )}

      {/* Healthcare importance */}
      <div>
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
          {t('wizard.healthcare_importance')}
        </label>
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-400">1</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={answers.healthcareImportance}
            onChange={(e) => setAnswers((a) => ({ ...a, healthcareImportance: Number(e.target.value) }))}
            className="flex-1 h-2 rounded-full appearance-none cursor-pointer
                       bg-surface-200 dark:bg-surface-700
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500
                       [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
                       [&::-webkit-slider-thumb]:cursor-pointer
                       [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
                       [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500
                       [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md
                       [&::-moz-range-thumb]:cursor-pointer"
          />
          <span className="text-xs text-surface-400">5</span>
          <span className="text-sm font-semibold text-blue-500 tabular-nums w-4 text-center">
            {answers.healthcareImportance}
          </span>
        </div>
      </div>
    </div>
  );

  const renderResults = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-surface-900 dark:text-white">
          {t('wizard.top_matches')}
        </h3>
        {/* CF-6: region vs all-Finland scope */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-surface-400 dark:text-surface-500">
            {t(isNational ? 'scope.all' : 'scope.region')}
          </span>
          <ComparisonScopeToggle scope={scope} onChange={setScope} disabled={nationalLoading} />
        </div>
      </div>

      {/* CF-14: affordability fold — only when the user has set a budget + size.
          'off' keeps results untouched; 'soft' boosts affordable areas in the
          match-%, 'filter' drops areas that overshoot the budget entirely. */}
      {hasAffordability && (
        <div className="rounded-xl bg-surface-50 dark:bg-surface-800/40 border border-surface-200 dark:border-surface-700/50 p-3 space-y-2">
          <p className="text-xs font-medium text-surface-700 dark:text-surface-300">
            {t('wizard.affordability_match')}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {(['off', 'soft', 'filter'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setAffordabilityMode(m)}
                aria-pressed={affordabilityMode === m}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-colors
                  ${affordabilityMode === m
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-surface-700/50 hover:bg-surface-200 dark:hover:bg-surface-700'
                  }`}
              >
                {t(`wizard.afford_mode_${m}`)}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-surface-400 dark:text-surface-500">
            {t(`wizard.afford_mode_${affordabilityMode}_hint`)}
          </p>
        </div>
      )}

      {/* CF-4: persist the priority profile + optionally reflect it on the live map */}
      {(onSaveProfile || onApplyToMap) && (
        <div className="flex flex-wrap items-center gap-2">
          {onSaveProfile && (
            <button
              onClick={() => { onSaveProfile(answers); setSaved(true); trackEvent('wizard-save-profile'); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300
                         hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {saved ? t('wizard.saved') : t('wizard.save_priorities')}
            </button>
          )}
          {onApplyToMap && !isNational && (
            <button
              onClick={() => { onApplyToMap(answers); trackEvent('wizard-apply-map'); onClose(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
            >
              {t('wizard.apply_to_map')}
            </button>
          )}
        </div>
      )}

      {nationalLoading && topMatches.length === 0 ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">
          {t('loading')}
        </p>
      ) : topMatches.length === 0 ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">
          {t('filter.no_match')}
        </p>
      ) : (
        <div className="space-y-3">
          {/* PO-4: Show on Map button — region scope only (national features are
              geometry-stripped and can't be drawn on the map). */}
          {onShowOnMap && !isNational && topMatches.length > 0 && (
            <button
              onClick={() => onShowOnMap(topMatches.map((m) => m.pno))}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                         bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              {t('wizard.show_on_map')}
            </button>
          )}
          {topMatches.map((match, i) => (
            <button
              key={match.pno}
              onClick={() => handleResultClick(match.pno, match.name, match.center)}
              className="w-full text-left p-3 rounded-xl transition-colors
                         bg-surface-50 dark:bg-surface-800/60 hover:bg-surface-100 dark:hover:bg-surface-700/60
                         border border-surface-200 dark:border-surface-700/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold
                                   flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-surface-900 dark:text-white truncate">
                      {match.name}
                    </div>
                    <div className="text-xs text-surface-500 dark:text-surface-400">
                      {match.pno}
                      {match.qualityIndex != null && (
                        <span className="ml-2">
                          {t('panel.quality_index')}: {match.qualityIndex.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex-shrink-0 text-sm font-bold text-blue-500 tabular-nums">
                  {match.score}%
                </div>
              </div>
              {match.reasons.length > 0 && (
                <div className="mt-2 ml-8">
                  <p className="text-xs text-surface-500 dark:text-surface-400">
                    <span className="font-medium">{t('wizard.why_match')}:</span>{' '}
                    {match.reasons.join(', ')}
                  </p>
                </div>
              )}
              {/* CF-5: per-criterion breakdown — actual value vs the chosen threshold */}
              {match.contributions.length > 0 && (
                <div className="mt-2 ml-8 space-y-0.5">
                  {match.contributions.slice(0, 6).map((c, ci) => (
                    <div key={ci} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="flex items-center gap-1 text-surface-500 dark:text-surface-400 truncate">
                        <span aria-hidden className={
                          c.direction === 'up' ? 'text-emerald-500' : c.direction === 'down' ? 'text-rose-500' : 'text-surface-400'
                        }>
                          {c.direction === 'up' ? '▲' : c.direction === 'down' ? '▼' : '•'}
                        </span>
                        <span className="truncate">{c.label}</span>
                      </span>
                      <span className="flex-shrink-0 tabular-nums text-surface-600 dark:text-surface-300">
                        {c.actual}
                        <span className="text-surface-400 dark:text-surface-500"> · {c.target}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const stepContent = [renderLifestyleStep, renderHousingStep, renderFamilyStep, renderResults];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('wizard.title')}
        tabIndex={-1}
        className="relative w-full max-w-lg mx-4 max-h-[90vh] flex flex-col outline-none
                      bg-white/95 dark:bg-surface-900/95 backdrop-blur-md
                      rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700/40">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700/50">
          <h2 className="text-base font-bold text-surface-900 dark:text-white">
            {t('wizard.title')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('aria.close')}
            className="w-8 h-8 flex items-center justify-center rounded-lg
                       text-surface-400 hover:text-surface-600 dark:hover:text-surface-200
                       hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {renderStepIndicator()}
          {stepContent[step]()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-surface-200 dark:border-surface-700/50">
          <button
            onClick={() => setStep((s) => s - 1)}
            disabled={!canBack}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors
              ${canBack
                ? 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700'
                : 'invisible'
              }`}
          >
            {t('wizard.back')}
          </button>

          {step === STEP_COUNT - 1 ? (
            <button
              onClick={() => { trackEvent('wizard-complete'); onClose(); }}
              className="px-5 py-2 rounded-xl text-sm font-medium bg-blue-500 text-white
                         hover:bg-blue-600 transition-colors shadow-md"
            >
              {t('wizard.finish')}
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => { trackEvent('wizard-step', { step: s + 2 }); return s + 1; })}
              disabled={!canNext}
              className="px-5 py-2 rounded-xl text-sm font-medium bg-blue-500 text-white
                         hover:bg-blue-600 transition-colors shadow-md"
            >
              {t('wizard.next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
