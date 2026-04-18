import React, { useState, useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';
import { t } from '../utils/i18n';
import { trackEvent } from '../utils/analytics';
import { getFeatureCenter } from '../utils/geometryFilter';

interface WizardProps {
  data: FeatureCollection | null;
  onSelect: (pno: string, center: [number, number]) => void;
  onClose: () => void;
  onShowOnMap?: (pnos: string[]) => void;
}

interface WizardAnswers {
  transitImportance: number;
  quietPreference: 'quiet' | 'lively' | 'neutral';
  budgetMin: number;
  budgetMax: number;
  sizePreference: 'small' | 'medium' | 'large';
  tenurePreference: 'own' | 'rent' | 'either';
  hasChildren: boolean;
  schoolImportance: number;
  healthcareImportance: number;
}

interface ScoredNeighborhood {
  pno: string;
  name: string;
  qualityIndex: number | null;
  score: number;
  reasons: string[];
  center: [number, number];
}

const defaultAnswers: WizardAnswers = {
  transitImportance: 3,
  quietPreference: 'neutral',
  budgetMin: 1000,
  budgetMax: 6000,
  sizePreference: 'medium',
  tenurePreference: 'either',
  hasChildren: false,
  schoolImportance: 3,
  healthcareImportance: 3,
};

/** Normalize a value within a range to 0-1 */
function normalize(value: number | null, min: number, max: number): number {
  if (value == null || max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function scoreNeighborhoods(
  data: FeatureCollection,
  answers: WizardAnswers,
): ScoredNeighborhood[] {
  const features = data.features.filter(
    (f) => f.properties && (f.properties as NeighborhoodProperties).he_vakiy != null,
  );

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

    // --- Transit importance ---
    const transitWeight = answers.transitImportance / 5;
    if (transitWeight > 0) {
      const transitScore = normalize(p.transit_stop_density, transitRange.min, transitRange.max);
      score += transitScore * transitWeight * 2;
      totalWeight += transitWeight * 2;
      if (transitScore > 0.7) reasons.push(t('wizard.reason_good_transit'));
    }

    // --- Quiet vs lively ---
    if (answers.quietPreference === 'quiet') {
      const restaurantInv = 1 - normalize(p.restaurant_density, restaurantRange.min, restaurantRange.max);
      score += restaurantInv * 2;
      totalWeight += 2;
      if (restaurantInv > 0.7) reasons.push(t('wizard.reason_quiet'));
    } else if (answers.quietPreference === 'lively') {
      const restaurantScore = normalize(p.restaurant_density, restaurantRange.min, restaurantRange.max);
      score += restaurantScore * 2;
      totalWeight += 2;
      if (restaurantScore > 0.7) reasons.push(t('wizard.reason_lively'));
    } else {
      totalWeight += 0.5;
      score += 0.25;
    }

    // --- Budget filter ---
    const price = p.property_price_sqm;
    const bMin = Math.min(answers.budgetMin, answers.budgetMax);
    const bMax = Math.max(answers.budgetMin, answers.budgetMax);
    if (price != null) {
      if (price >= bMin && price <= bMax) {
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

    // --- Tenure preference ---
    if (answers.tenurePreference === 'own') {
      const ownerScore = normalize(p.ownership_rate, ownershipRange.min, ownershipRange.max);
      score += ownerScore;
      totalWeight += 1;
      if (ownerScore > 0.7) reasons.push(t('wizard.reason_ownership'));
    } else if (answers.tenurePreference === 'rent') {
      const rentalScore = normalize(p.rental_rate, rentalRange.min, rentalRange.max);
      score += rentalScore;
      totalWeight += 1;
      if (rentalScore > 0.7) reasons.push(t('wizard.reason_rental'));
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
    }

    // --- Healthcare ---
    const healthWeight = answers.healthcareImportance / 5;
    if (healthWeight > 0) {
      const healthScore = normalize(p.healthcare_density, healthcareRange.min, healthcareRange.max);
      score += healthScore * healthWeight * 1.5;
      totalWeight += healthWeight * 1.5;
      if (healthScore > 0.7) reasons.push(t('wizard.reason_healthcare'));
    }

    const finalScore = totalWeight > 0 ? score / totalWeight : 0;

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
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((s) => ({
    pno: s.pno,
    name: s.name,
    qualityIndex: s.qualityIndex,
    score: s.score,
    reasons: s.reasons,
    // getFeatureCenter uses bbox midpoint, which is unbiased by the duplicate
    // closing vertex in GeoJSON rings. The previous custom centroid averaged
    // every vertex, pulling the result toward the first/last point of each
    // ring — noticeable on elongated or C-shaped postal code areas.
    center: getFeatureCenter(s.feature),
  }));
}

const STEP_COUNT = 4;

export const NeighborhoodWizard: React.FC<WizardProps> = ({ data, onSelect, onClose, onShowOnMap }) => {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<WizardAnswers>({ ...defaultAnswers });

  const topMatches = useMemo(() => {
    if (!data || step < 3) return [];
    return scoreNeighborhoods(data, answers);
  }, [data, answers, step]);

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
            onChange={(e) => setAnswers((a) => ({ ...a, budgetMin: Number(e.target.value) }))}
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
            onChange={(e) => setAnswers((a) => ({ ...a, budgetMax: Number(e.target.value) }))}
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
      <h3 className="text-lg font-bold text-surface-900 dark:text-white">
        {t('wizard.top_matches')}
      </h3>

      {topMatches.length === 0 ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">
          {t('filter.no_match')}
        </p>
      ) : (
        <div className="space-y-3">
          {/* PO-4: Show on Map button */}
          {onShowOnMap && topMatches.length > 0 && (
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
              onClick={() => onSelect(match.pno, match.center)}
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
      <div className="relative w-full max-w-lg mx-4 max-h-[90vh] flex flex-col
                      bg-white/95 dark:bg-surface-900/95 backdrop-blur-md
                      rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700/40">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700/50">
          <h2 className="text-base font-bold text-surface-900 dark:text-white">
            {t('wizard.title')}
          </h2>
          <button
            onClick={onClose}
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
