import React, { useState, useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';
import { t } from '../utils/i18n';

interface WizardProps {
  data: FeatureCollection | null;
  onSelect: (pno: string, center: [number, number]) => void;
  onClose: () => void;
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

/** Compute a simple centroid from a GeoJSON geometry */
function computeCentroid(geometry: GeoJSON.Geometry): [number, number] {
  const coords: number[][] = [];

  function extract(g: GeoJSON.Geometry) {
    switch (g.type) {
      case 'Polygon':
        for (const ring of g.coordinates) {
          for (const c of ring) coords.push(c);
        }
        break;
      case 'MultiPolygon':
        for (const poly of g.coordinates) {
          for (const ring of poly) {
            for (const c of ring) coords.push(c);
          }
        }
        break;
      case 'Point':
        coords.push(g.coordinates);
        break;
      case 'MultiPoint':
        for (const c of g.coordinates) coords.push(c);
        break;
      case 'LineString':
        for (const c of g.coordinates) coords.push(c);
        break;
      case 'MultiLineString':
        for (const line of g.coordinates) {
          for (const c of line) coords.push(c);
        }
        break;
      case 'GeometryCollection':
        for (const child of g.geometries) extract(child);
        break;
    }
  }

  extract(geometry);

  if (coords.length === 0) return [24.94, 60.17]; // fallback Helsinki center

  let sumLng = 0;
  let sumLat = 0;
  for (const c of coords) {
    sumLng += c[0];
    sumLat += c[1];
  }
  return [sumLng / coords.length, sumLat / coords.length];
}

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

  // Collect ranges for normalization
  const vals = (key: keyof NeighborhoodProperties) =>
    features
      .map((f) => (f.properties as NeighborhoodProperties)[key] as number | null)
      .filter((v): v is number => v != null);

  const range = (key: keyof NeighborhoodProperties) => {
    const v = vals(key);
    if (v.length === 0) return { min: 0, max: 1 };
    return { min: Math.min(...v), max: Math.max(...v) };
  };

  const transitRange = range('transit_stop_density');
  const noiseRange = range('noise_level');
  const restaurantRange = range('restaurant_density');
  const aptSizeRange = range('ra_as_kpa');
  const childRange = range('child_ratio');
  const daycareRange = range('daycare_density');
  const schoolRange = range('school_density');
  const healthcareRange = range('healthcare_density');
  const ownershipRange = range('ownership_rate');
  const rentalRange = range('rental_rate');

  const results: ScoredNeighborhood[] = [];

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
      const noiseScore = 1 - normalize(p.noise_level, noiseRange.min, noiseRange.max);
      const restaurantInv = 1 - normalize(p.restaurant_density, restaurantRange.min, restaurantRange.max);
      score += (noiseScore * 1.5 + restaurantInv * 0.5);
      totalWeight += 2;
      if (noiseScore > 0.7) reasons.push(t('wizard.reason_quiet'));
    } else if (answers.quietPreference === 'lively') {
      const restaurantScore = normalize(p.restaurant_density, restaurantRange.min, restaurantRange.max);
      const noiseAccept = normalize(p.noise_level, noiseRange.min, noiseRange.max);
      score += (restaurantScore * 1.5 + noiseAccept * 0.5);
      totalWeight += 2;
      if (restaurantScore > 0.7) reasons.push(t('wizard.reason_lively'));
    } else {
      totalWeight += 0.5;
      score += 0.25;
    }

    // --- Budget filter ---
    const price = p.property_price_sqm;
    if (price != null) {
      if (price >= answers.budgetMin && price <= answers.budgetMax) {
        const midBudget = (answers.budgetMin + answers.budgetMax) / 2;
        const budgetFit = 1 - Math.abs(price - midBudget) / (answers.budgetMax - answers.budgetMin + 1);
        score += budgetFit * 2;
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

    results.push({
      pno: p.pno,
      name: p.nimi,
      qualityIndex: p.quality_index,
      score: Math.round(finalScore * 100),
      reasons: uniqueReasons.slice(0, 3),
      center: computeCentroid(feature.geometry),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 5);
}

const STEP_COUNT = 4;

export const NeighborhoodWizard: React.FC<WizardProps> = ({ data, onSelect, onClose }) => {
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
              onClick={onClose}
              className="px-5 py-2 rounded-xl text-sm font-medium bg-blue-500 text-white
                         hover:bg-blue-600 transition-colors shadow-md"
            >
              {t('wizard.finish')}
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
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
