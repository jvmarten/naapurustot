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
import { defaultWizardAnswers, budgetForPriceLevel, priceLevelFromBudget, type WizardAnswers, type WizardQuestionKey } from '../hooks/useWizardProfile';
import type { AffordabilityState } from '../hooks/useAffordability';
import { scoreFeatureFit, buildFitRanges, type FitContribution, type AffordabilityMatchMode } from '../utils/fitScore';

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
  /** RU-A: add the wizard's matches to the durable shortlist. Works in BOTH scopes —
   *  the shortlist is pno-based, so national-scope matches (geometry-stripped, no
   *  Show-on-Map) still get a persistent action instead of only opening a profile. */
  onAddToShortlist?: (pnos: string[]) => void;
  /** RU-A: toggle a single match in/out of the shortlist from its result row. */
  onToggleShortlist?: (pno: string) => void;
  /** RU-A: whether a pno is already shortlisted, for the per-row toggle state. */
  isInShortlist?: (pno: string) => boolean;
}

interface ScoredNeighborhood {
  pno: string;
  name: string;
  qualityIndex: number | null;
  score: number;
  reasons: string[];
  contributions: FitContribution[];
  center: [number, number];
}

/** CF-14: how affordability is folded into the wizard result. Re-exported from the
 *  shared scorer for any existing importers. */
export type { AffordabilityMatchMode };

// CF-4: WizardAnswers/defaultWizardAnswers now live in hooks/useWizardProfile.ts
// (shared with the persistence hook and the share-URL codec). Aliased here so the
// existing in-component references stay terse.
const defaultAnswers = defaultWizardAnswers;

/**
 * Rank the loaded areas against the wizard answers. The per-area scoring lives in
 * the shared scorer (utils/fitScore.ts) so the "Fit for you" badge uses the exact
 * same algorithm; here it runs against REGION-scoped ranges (buildFitRanges over the
 * loaded features) and folds in affordability, then returns the top 5 with centroids.
 */
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

  // Region-scoped normalization ranges, collected once over the loaded features.
  const ranges = buildFitRanges(features);

  // Hold candidates with their feature reference so we can compute centroids
  // only for the final top 5 after sorting.
  const scored: (Omit<ScoredNeighborhood, 'center'> & { feature: GeoJSON.Feature })[] = [];

  for (const feature of features) {
    const p = feature.properties as NeighborhoodProperties;
    if (!p.pno || !p.nimi) continue;

    const res = scoreFeatureFit(p, answers, ranges, affordability, affordabilityMode);
    if (res.excluded) continue; // CF-14 hard affordability filter dropped this area

    scored.push({
      feature,
      pno: p.pno,
      name: p.nimi,
      qualityIndex: p.quality_index,
      score: res.score,
      reasons: res.reasons,
      contributions: res.contributions,
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

// Activation: one-tap "quick start" intents shown on the first step. Each maps onto a
// fresh set of wizard answers mirroring the top relocation criteria (Kantar-KAKS:
// safety/peace, service proximity, public transport, family, affordability) and jumps
// straight to the ranked results, so the finder pays off in a single tap. The user can
// step Back to refine any answer afterwards.
const PRESET_AFFORDABLE = budgetForPriceLevel(2); // tier 2 = "affordable" (~p20–p40 €/m²)
const PRESETS: ReadonlyArray<{ key: string; answers: Partial<WizardAnswers> }> = [
  { key: 'safe_quiet', answers: { quietPreference: 'quiet' } },
  { key: 'services', answers: { healthcareImportance: 5 } },
  { key: 'transit', answers: { transitImportance: 5 } },
  { key: 'family', answers: { hasChildren: true, schoolImportance: 5 } },
  { key: 'affordable', answers: { budgetMin: PRESET_AFFORDABLE.min, budgetMax: PRESET_AFFORDABLE.max } },
];

// Shared styling for the 1–5 range sliders (transit, school, healthcare, price tier).
const RANGE_INPUT_CLASS = `flex-1 h-2 rounded-full appearance-none cursor-pointer
  bg-surface-200 dark:bg-surface-700
  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500
  [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
  [&::-webkit-slider-thumb]:cursor-pointer
  [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
  [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500
  [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md
  [&::-moz-range-thumb]:cursor-pointer`;

export const NeighborhoodWizard: React.FC<WizardProps> = ({ data, onSelect, onClose, onShowOnMap, initialAnswers, onSaveProfile, onApplyToMap, affordability, qualityWeights, cityFilter, onAddToShortlist, onToggleShortlist, isInShortlist }) => {
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

  // Per-question skip: a skipped question is dropped from the match entirely.
  const isSkipped = (k: WizardQuestionKey) => !!answers.skipped[k];
  const toggleSkip = (k: WizardQuestionKey) =>
    setAnswers((a) => ({ ...a, skipped: { ...a.skipped, [k]: !a.skipped[k] } }));

  // Wrap a question with its label and a Skip toggle. When skipped, the inputs are
  // replaced by a short hint (and excluded from scoring) until the user un-skips.
  // NB: a plain JSX-returning helper, NOT a component — inlining keeps the controlled
  // inputs from remounting (and losing focus) on every render.
  const renderQuestion = (k: WizardQuestionKey, label: string, body: React.ReactNode) => {
    const skipped = isSkipped(k);
    return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-sm font-medium text-surface-700 dark:text-surface-300">{label}</span>
          <button
            type="button"
            onClick={() => toggleSkip(k)}
            aria-pressed={skipped}
            className={`flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors
              ${skipped
                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                : 'text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800'
              }`}
          >
            {skipped ? t('wizard.skipped') : t('wizard.skip')}
          </button>
        </div>
        {skipped
          ? <p className="text-xs italic text-surface-500 dark:text-surface-400">{t('wizard.skip_hint')}</p>
          : body}
      </div>
    );
  };

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
      {renderQuestion('transit', t('wizard.transit_importance'),
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-400">1</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={answers.transitImportance}
            aria-label={t('wizard.transit_importance')}
            onChange={(e) => setAnswers((a) => ({ ...a, transitImportance: Number(e.target.value) }))}
            className={RANGE_INPUT_CLASS}
          />
          <span className="text-xs text-surface-400">5</span>
          <span className="text-sm font-semibold text-blue-500 tabular-nums w-4 text-center">
            {answers.transitImportance}
          </span>
        </div>
      )}

      {/* Quiet vs lively */}
      {renderQuestion('quiet', t('wizard.quiet_preference'),
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
      )}

      {/* Near foreign-language speakers? (diversity proxy) */}
      {renderQuestion('foreigners', t('wizard.foreigners_preference'),
        <div className="grid grid-cols-3 gap-2">
          {(['away', 'neutral', 'near'] as const).map((pref) => (
            <button
              key={pref}
              onClick={() => setAnswers((a) => ({ ...a, foreignersPreference: pref }))}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors
                ${answers.foreignersPreference === pref
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                }`}
            >
              {t(`wizard.foreigners_${pref}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderHousingStep = () => {
    const priceLevel = priceLevelFromBudget(answers.budgetMin, answers.budgetMax);
    return (
    <div className="space-y-6">
      <h3 className="text-lg font-bold text-surface-900 dark:text-white">
        {t('wizard.step_housing')}
      </h3>

      {/* Budget — simple "affordable → expensive" slider by default, exact min/max on demand */}
      {renderQuestion('budget', t('wizard.budget'),
        <div className="space-y-2">
          {answers.budgetAdvanced ? (
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
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="text-xs text-surface-400 whitespace-nowrap">{t('wizard.price_affordable')}</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={priceLevel}
                  aria-label={t('wizard.budget')}
                  aria-valuetext={t(`wizard.price_level_${priceLevel}`)}
                  onChange={(e) => { const b = budgetForPriceLevel(Number(e.target.value)); setAnswers((a) => ({ ...a, budgetMin: b.min, budgetMax: b.max })); }}
                  className={RANGE_INPUT_CLASS}
                />
                <span className="text-xs text-surface-400 whitespace-nowrap">{t('wizard.price_pricey')}</span>
              </div>
              <p className="text-[11px] text-surface-500 dark:text-surface-400">
                {t(`wizard.price_level_${priceLevel}`)}
                <span className="text-surface-500 dark:text-surface-400"> · {answers.budgetMin}–{answers.budgetMax} {t('wizard.budget_unit')}</span>
              </p>
            </>
          )}
          <button
            type="button"
            onClick={() => setAnswers((a) => ({ ...a, budgetAdvanced: !a.budgetAdvanced }))}
            className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            {answers.budgetAdvanced ? t('wizard.price_simple') : t('wizard.price_advanced')}
          </button>
        </div>
      )}

      {/* Apartment size preference */}
      {renderQuestion('size', t('wizard.size_preference'),
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
      )}

      {/* Tenure preference */}
      {renderQuestion('tenure', t('wizard.tenure_preference'),
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
      )}
    </div>
    );
  };

  const renderFamilyStep = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-bold text-surface-900 dark:text-white">
        {t('wizard.step_family')}
      </h3>

      {/* Has children */}
      {renderQuestion('children', t('wizard.has_children'),
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
      )}

      {/* School importance (only when the user has children and didn't skip that question) */}
      {answers.hasChildren && !isSkipped('children') && renderQuestion('school', t('wizard.school_importance'),
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-400">1</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={answers.schoolImportance}
            aria-label={t('wizard.school_importance')}
            onChange={(e) => setAnswers((a) => ({ ...a, schoolImportance: Number(e.target.value) }))}
            className={RANGE_INPUT_CLASS}
          />
          <span className="text-xs text-surface-400">5</span>
          <span className="text-sm font-semibold text-blue-500 tabular-nums w-4 text-center">
            {answers.schoolImportance}
          </span>
        </div>
      )}

      {/* Healthcare importance */}
      {renderQuestion('healthcare', t('wizard.healthcare_importance'),
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-400">1</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={answers.healthcareImportance}
            aria-label={t('wizard.healthcare_importance')}
            onChange={(e) => setAnswers((a) => ({ ...a, healthcareImportance: Number(e.target.value) }))}
            className={RANGE_INPUT_CLASS}
          />
          <span className="text-xs text-surface-400">5</span>
          <span className="text-sm font-semibold text-blue-500 tabular-nums w-4 text-center">
            {answers.healthcareImportance}
          </span>
        </div>
      )}
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
          <span className="text-[11px] text-surface-500 dark:text-surface-400">
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
          <p className="text-[11px] text-surface-500 dark:text-surface-400">
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
          {/* RU-A: turn the ephemeral top-5 into a durable, comparable, shareable set.
              Available in BOTH scopes — national matches can't Show-on-Map (geometry-
              stripped) but CAN be shortlisted. mergeIntoShortlist dedupes, so re-adds
              are safe. */}
          {onAddToShortlist && topMatches.length > 0 && (
            <button
              type="button"
              onClick={() => { onAddToShortlist(topMatches.map((m) => m.pno)); trackEvent('wizard-add-shortlist'); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                         bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300
                         hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('wizard.add_all_shortlist')}
            </button>
          )}
          {topMatches.map((match, i) => {
            const inShortlist = isInShortlist?.(match.pno) ?? false;
            return (
              // RU-A: stretched-link card. The absolute button fills the card so a tap
              // anywhere opens the area; the content is pointer-events-none (clicks fall
              // through to it) EXCEPT the shortlist toggle, which re-enables pointer
              // events above it. Two sibling buttons — no nested-interactive a11y issue.
              <div
                key={match.pno}
                className="relative rounded-xl transition-colors
                           bg-surface-50 dark:bg-surface-800/60 hover:bg-surface-100 dark:hover:bg-surface-700/60
                           border border-surface-200 dark:border-surface-700/50
                           focus-within:ring-2 focus-within:ring-brand-500/60"
              >
                <button
                  type="button"
                  onClick={() => handleResultClick(match.pno, match.name, match.center)}
                  aria-label={match.name}
                  className="absolute inset-0 z-0 rounded-xl focus:outline-none"
                />
                <div className="relative z-[1] p-3 pointer-events-none">
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
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold text-blue-500 tabular-nums">
                        {match.score}%
                      </span>
                      {onToggleShortlist && (
                        <button
                          type="button"
                          onClick={() => onToggleShortlist(match.pno)}
                          aria-pressed={inShortlist}
                          aria-label={inShortlist ? t('shortlist.remove') : t('shortlist.add')}
                          title={inShortlist ? t('shortlist.remove') : t('shortlist.add')}
                          className={`pointer-events-auto -m-1 p-1 rounded-lg transition-colors
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60
                            ${inShortlist
                              ? 'text-blue-500 hover:text-blue-600'
                              : 'text-surface-400 hover:text-blue-500 hover:bg-surface-100 dark:hover:bg-surface-700'}`}
                        >
                          {inShortlist ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                          )}
                        </button>
                      )}
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
                            <span className="text-surface-500 dark:text-surface-400"> · {c.target}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
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
          {/* Activation: one-tap intent presets on the first step — fill a fresh
              profile and jump straight to results. */}
          {step === 0 && (
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-2">
                {t('wizard.quickstart')}
              </p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      setAnswers({ ...defaultAnswers, ...p.answers });
                      setStep(STEP_COUNT - 1);
                      trackEvent('wizard-preset', { preset: p.key });
                    }}
                    className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                               bg-surface-50 dark:bg-surface-800 text-surface-700 dark:text-surface-300
                               border-surface-200 dark:border-surface-700/50
                               hover:bg-blue-500/10 hover:border-blue-500/40 hover:text-blue-600 dark:hover:text-blue-300
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {t(`wizard.preset_${p.key}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
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
