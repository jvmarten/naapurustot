import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { QUALITY_FACTORS, getDefaultWeights, isCustomWeights, type QualityWeights } from '../utils/qualityIndex';
import { getLang } from '../utils/i18n';
import { t } from '../utils/i18n';

interface Props {
  weights: QualityWeights;
  onChange: (weights: QualityWeights) => void;
  onClose: () => void;
}

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

  const handleChange = (v: number) => {
    setLocalValue(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(v), 200);
  };

  const pct = `${localValue}%`;
  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-surface-700 dark:text-surface-300">{label}</span>
        <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 tabular-nums w-8 text-right">
          {localValue}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={localValue}
          onChange={(e) => handleChange(Number(e.target.value))}
          className={`slider-${sliderId} w-full h-2 rounded-full appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2
                     [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
                     [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
                     [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2
                     [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md
                     [&::-moz-range-thumb]:cursor-pointer`}
          style={{
            background: `linear-gradient(to right, ${color} ${pct}, rgb(var(--color-surface-200)) ${pct})`,
          }}
        />
        <style>{`
          .slider-${sliderId}::-webkit-slider-thumb { background-color: ${color}; }
          .slider-${sliderId}::-moz-range-thumb { background-color: ${color}; }
        `}</style>
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

  // Auto-expand secondary section if any secondary factor has non-zero weight
  useEffect(() => {
    const hasActiveSecondary = secondaryFactors.some((f) => (weights[f.id] ?? 0) > 0);
    if (hasActiveSecondary) setShowMore(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (factorId: string, value: number) => {
      onChange({ ...weights, [factorId]: value });
    },
    [weights, onChange],
  );

  const handleReset = useCallback(() => {
    onChange(getDefaultWeights());
    setShowMore(false);
  }, [onChange]);

  const isCustom = isCustomWeights(weights);

  // Calculate effective weight percentages for display
  const totalWeight = useMemo(
    () => QUALITY_FACTORS.reduce((sum, f) => sum + (weights[f.id] ?? 0), 0),
    [weights],
  );

  const renderFactorSliders = (factors: typeof QUALITY_FACTORS) =>
    factors.map((factor) => {
      const w = weights[factor.id] ?? 0;
      const effectivePct = totalWeight > 0 ? ((w / totalWeight) * 100).toFixed(0) : '0';
      return (
        <div key={factor.id}>
          <WeightSlider
            label={`${factor.label[lang]}${w > 0 ? ` (${effectivePct}%)` : ''}`}
            value={w}
            onChange={(v) => handleChange(factor.id, v)}
            color={FACTOR_COLORS[factor.id] ?? '#6b7280'}
            sliderId={factor.id}
          />
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
          {isCustom && (
            <button
              onClick={handleReset}
              className="text-xs text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
            >
              {t('custom_quality.reset')}
            </button>
          )}
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
            {QUALITY_FACTORS.filter((f) => (weights[f.id] ?? 0) > 0).map((f) => (
              <div
                key={f.id}
                className="h-full transition-all duration-300"
                style={{
                  width: `${((weights[f.id] ?? 0) / totalWeight) * 100}%`,
                  backgroundColor: FACTOR_COLORS[f.id] ?? '#6b7280',
                }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-40">
        <div className="bg-white dark:bg-surface-900 rounded-t-2xl shadow-2xl border-t border-surface-200 dark:border-surface-700/50
                        max-h-[85vh] overflow-y-auto">
          {/* Drag handle */}
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 rounded-full bg-surface-300 dark:bg-surface-600" />
          </div>
          {content}
        </div>
      </div>
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
