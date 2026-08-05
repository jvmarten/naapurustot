import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import {
  QUALITY_FACTORS, getDefaultWeights, isCustomWeights, type QualityWeights,
  QUALITY_DIMENSIONS, QUALITY_PERSONAS, getPersonaWeights, detectPersona, getFactorDimension,
} from '../utils/qualityIndex';
import { getLang } from '../utils/i18n';
import { t } from '../utils/i18n';
import { trackEvent } from '../utils/analytics';
import { useBottomSheet } from '../hooks/useBottomSheet';

interface Props {
  weights: QualityWeights;
  onChange: (weights: QualityWeights) => void;
  onClose: () => void;
}

/** Values this close to 0 snap to exactly 0, so dragging down to "ignore this"
 *  cannot overshoot into "actively prefer the opposite". Without it the only way to
 *  reach 0 is to land on a single pixel, and a near-miss silently reverses the
 *  factor's meaning rather than just weakening it. */
const ZERO_DETENT = 4;

const WeightSlider: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
  sliderId: string;
}> = ({ label, value, onChange, color, sliderId }) => {
  // Local state for smooth drag; debounce the expensive parent callback
  // (quality index recomputation across ~200 features + Map source update).
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setLocalValue(value); }, [value]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const handleChange = (raw: number) => {
    const v = Math.abs(raw) <= ZERO_DETENT ? 0 : raw;
    setLocalValue(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(v), 200);
  };

  const min = -100;
  const max = 100;
  // Thumb position as % of track width
  const thumbPct = (localValue + 100) / 2;
  const trackBg = 'rgb(var(--color-surface-200))';
  // Fill from centre (50%) outward to the thumb, so the track reads as a direction
  // plus a magnitude rather than a bare amount.
  const background = localValue >= 0
    ? `linear-gradient(to right, ${trackBg} 0%, ${trackBg} 50%, ${color} 50%, ${color} ${thumbPct}%, ${trackBg} ${thumbPct}%, ${trackBg} 100%)`
    : `linear-gradient(to right, ${trackBg} 0%, ${trackBg} ${thumbPct}%, ${color} ${thumbPct}%, ${color} 50%, ${trackBg} 50%, ${trackBg} 100%)`;

  const displayValue = localValue > 0 ? `+${localValue}` : `${localValue}`;

  // The bare number is meaningless to a screen reader — "-40" says nothing about
  // which end of the metric it favours. Spell the direction out.
  const valueText = localValue === 0
    ? t('custom_quality.aria_ignored')
    : `${Math.abs(localValue)} — ${t(localValue > 0 ? 'custom_quality.aria_prefer_more' : 'custom_quality.aria_prefer_less')}`;

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span id={`qw-label-${sliderId}`} className="text-sm text-surface-700 dark:text-surface-300">{label}</span>
        <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 tabular-nums w-10 text-right">
          {displayValue}
        </span>
      </div>
      <div className="relative">
        <div
          aria-hidden
          className="absolute top-1/2 left-1/2 w-px h-3 -translate-x-1/2 -translate-y-1/2 bg-surface-400 dark:bg-surface-500 pointer-events-none"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={localValue}
          aria-labelledby={`qw-label-${sliderId}`}
          aria-valuetext={valueText}
          onChange={(e) => handleChange(Number(e.target.value))}
          className={`slider-${sliderId} relative w-full h-2 rounded-full appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2
                     [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
                     [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
                     [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2
                     [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md
                     [&::-moz-range-thumb]:cursor-pointer`}
          style={{ background, touchAction: 'pan-y' }}
        />
        <style>{`
          .slider-${sliderId}::-webkit-slider-thumb { background-color: ${color}; }
          .slider-${sliderId}::-moz-range-thumb { background-color: ${color}; }
        `}</style>
      </div>
      {/* Which way is "+"? Never make the user infer it from the factor's name —
          some labels name a desirable quantity, some a hazard, most neither. */}
      <div aria-hidden className="flex justify-between mt-0.5 text-[9px] leading-none text-surface-400 dark:text-surface-500">
        <span>← {t('custom_quality.dir_less')}</span>
        <span>{t('custom_quality.dir_more')} →</span>
      </div>
    </div>
  );
};

// Assign distinct colors to each factor
const FACTOR_COLORS: Record<string, string> = {
  safety: '#ef4444',
  employment: '#3b82f6',
  income: '#22c55e',
  education: '#a855f7',
  transit: '#f59e0b',
  services: '#ec4899',
  air_quality: '#06b6d4',
  cycling: '#84cc16',
  grocery_access: '#0ea5e9',
  restaurants: '#e11d48',
};

const primaryFactors = QUALITY_FACTORS.filter((f) => f.primary);
const secondaryFactors = QUALITY_FACTORS.filter((f) => !f.primary);

export const CustomQualityPanel: React.FC<Props> = ({ weights, onChange, onClose }) => {
  const lang = getLang();
  const panelRef = useRef<HTMLDivElement>(null);
  const [showMore, setShowMore] = useState(false);

  // Mobile bottom sheet state
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // MO5: Unified bottom sheet drag behavior (reuses the FilterPanel pattern)
  const { sheetHeight, isDragging, snap, cycleSnap, handlers: sheetHandlers } = useBottomSheet({
    halfRatio: 0.85,
    initialSnap: 'half',
    onClose,
  });

  // Auto-expand secondary section if any secondary factor has non-zero weight
  useEffect(() => {
    const hasActiveSecondary = secondaryFactors.some((f) => (weights[f.id] ?? 0) !== 0);
    if (hasActiveSecondary) setShowMore(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (factorId: string, value: number) => {
      trackEvent('adjust-quality-weight', { factor: factorId, value: String(value) });
      onChange({ ...weights, [factorId]: value });
    },
    [weights, onChange],
  );

  // CF-1: apply a named persona preset (cloud-synced like any custom weights).
  const handlePersona = useCallback(
    (personaId: string) => {
      trackEvent('select-quality-persona', { persona: personaId });
      onChange(getPersonaWeights(personaId));
    },
    [onChange],
  );
  const activePersona = useMemo(() => detectPersona(weights), [weights]);

  const handleReset = useCallback(() => {
    onChange(getDefaultWeights());
    setShowMore(false);
  }, [onChange]);

  const isCustom = isCustomWeights(weights);

  // Calculate effective weight percentages for display (bipolar factors use abs value)
  const totalWeight = useMemo(
    () => QUALITY_FACTORS.reduce((sum, f) => sum + Math.abs(weights[f.id] ?? 0), 0),
    [weights],
  );

  const renderOneSlider = (factor: typeof QUALITY_FACTORS[number]) => {
    const w = weights[factor.id] ?? 0;
    const absW = Math.abs(w);
    const effectivePct = totalWeight > 0 ? ((absW / totalWeight) * 100).toFixed(0) : '0';
    return (
      <div key={factor.id}>
        <WeightSlider
          label={`${factor.label[lang]}${absW > 0 ? ` (${effectivePct}%)` : ''}`}
          value={w}
          onChange={(v) => handleChange(factor.id, v)}
          color={FACTOR_COLORS[factor.id] ?? '#6b7280'}
          sliderId={factor.id}
        />
      </div>
    );
  };

  // CF-1: render sliders grouped under their conceptual dimension headers.
  const renderFactorSliders = (factors: typeof QUALITY_FACTORS) =>
    QUALITY_DIMENSIONS.map((dim) => {
      const inDim = factors.filter((f) => getFactorDimension(f.id) === dim.id);
      if (inDim.length === 0) return null;
      return (
        <div key={dim.id}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mt-2 mb-0.5">
            {dim.label[lang]}
          </div>
          {inDim.map(renderOneSlider)}
        </div>
      );
    });

  const content = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-200 dark:border-surface-700/50">
        <h3 className="text-sm font-bold text-surface-900 dark:text-white">
          {t('custom_quality.title')}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            disabled={!isCustom}
            className="text-xs px-2 py-1 rounded-md border border-surface-200 dark:border-surface-700
                       text-surface-600 dark:text-surface-300
                       enabled:hover:bg-surface-100 enabled:dark:hover:bg-surface-800
                       enabled:hover:text-surface-900 enabled:dark:hover:text-white
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors"
          >
            {t('custom_quality.reset')}
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg
                       text-surface-400 hover:text-surface-600 dark:hover:text-surface-200
                       hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="px-5 pt-3 pb-1">
        <p className="text-xs text-surface-500 dark:text-surface-400">
          {t('custom_quality.description')}
        </p>
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
          {t('custom_quality.signed_hint')}
        </p>
      </div>

      {/* CF-1: Persona presets — named lenses that reweight the dimensions */}
      <div className="px-5 pt-2 pb-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1.5">
          {t('custom_quality.personas')}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUALITY_PERSONAS.map((p) => (
            <button
              key={p.id}
              onClick={() => handlePersona(p.id)}
              title={p.description[lang]}
              aria-pressed={activePersona === p.id}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border
                ${activePersona === p.id
                  ? 'bg-brand-500/15 dark:bg-brand-600/20 text-brand-700 dark:text-brand-300 border-brand-500/40'
                  : 'bg-surface-100/60 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 border-transparent hover:bg-surface-200/60 dark:hover:bg-surface-700/60'}`}
            >
              {p.label[lang]}
            </button>
          ))}
        </div>
      </div>

      {/* Primary Sliders */}
      <div className="px-5 pb-2 space-y-0.5">
        {renderFactorSliders(primaryFactors)}
      </div>

      {/* Show more / less toggle */}
      {secondaryFactors.length > 0 && (
        <div className="px-5 pb-2">
          <button
            onClick={() => setShowMore(!showMore)}
            className="flex items-center gap-1.5 text-xs font-medium text-surface-500 dark:text-surface-400
                       hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-200 ${showMore ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            {showMore ? t('custom_quality.show_less') : t('custom_quality.show_more')}
          </button>
        </div>
      )}

      {/* Secondary Sliders */}
      {showMore && (
        <div className="px-5 pb-4 space-y-0.5 border-t border-surface-100 dark:border-surface-800 pt-2">
          {renderFactorSliders(secondaryFactors)}
        </div>
      )}

      {/* Active factor summary */}
      {totalWeight > 0 && (
        <div className="px-5 pb-4">
          <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
            {QUALITY_FACTORS.filter((f) => (weights[f.id] ?? 0) !== 0).map((f) => {
              const w = weights[f.id] ?? 0;
              const c = FACTOR_COLORS[f.id] ?? '#6b7280';
              // The bar is sized by |weight|, so a −60 and a +60 segment are the same
              // width. Hatch the inverted ones so the bar doesn't read as "all of this
              // is what I want more of".
              const inverted = w < 0;
              return (
                <div
                  key={f.id}
                  title={`${f.label[lang]}: ${w > 0 ? '+' : ''}${w}`}
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${(Math.abs(w) / totalWeight) * 100}%`,
                    backgroundColor: c,
                    backgroundImage: inverted
                      ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0 2px, transparent 2px 4px)'
                      : undefined,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <>
        {/* Backdrop — tap outside to close */}
        <div
          className="fixed inset-0 z-30 bg-black/20 dark:bg-black/40"
          onClick={onClose}
        />

        {/* Bottom sheet — height driven by the drag gesture */}
        <div
          role="dialog"
          aria-label={t('custom_quality.title')}
          className="fixed inset-x-0 bottom-0 z-40 flex flex-col
                     bg-white dark:bg-surface-900 rounded-t-2xl shadow-2xl
                     border-t border-surface-200 dark:border-surface-700/50"
          style={{
            height: sheetHeight,
            transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
          }}
        >
          {/* Drag handle — functional drag-to-dismiss affordance */}
          <button
            type="button"
            onClick={cycleSnap}
            aria-expanded={snap !== 'peek'}
            aria-label={t('aria.expand_sheet')}
            className="flex w-full justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none flex-shrink-0
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 rounded-t-2xl"
            onTouchStart={sheetHandlers.onTouchStart}
            onTouchMove={sheetHandlers.onTouchMove}
            onTouchEnd={sheetHandlers.onTouchEnd}
            onTouchCancel={sheetHandlers.onTouchCancel}
          >
            <div className="w-10 h-1 rounded-full bg-surface-300 dark:bg-surface-600" />
          </button>
          <div className="flex-1 overflow-y-auto pb-safe">
            {content}
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      ref={panelRef}
      className="absolute top-[3.5rem] right-[15rem] z-30 w-72 max-h-[85vh] overflow-y-auto
                 bg-white/95 dark:bg-surface-900/95 backdrop-blur-md
                 rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700/40"
    >
      {content}
    </div>
  );
};
