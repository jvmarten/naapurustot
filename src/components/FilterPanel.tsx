import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { FeatureCollection } from 'geojson';
import { LAYERS, type LayerId, type LayerConfig, getLayerById } from '../utils/colorScales';
import type { NeighborhoodProperties } from '../utils/metrics';
import { t, useI18nVersion } from '../utils/i18n';
import { useBottomSheet } from '../hooks/useBottomSheet';

import { type FilterCriterion, computeMatchingPnos, resolveCriterionBounds, bestMatchScore, type ScoredCriterion } from '../utils/filterUtils';
import { getFeatureCenter } from '../utils/geometryFilter';
import { FilterEmptyIllustration } from './EmptyStateIllustrations';
import { trackEvent } from '../utils/analytics';

type SortKey = 'score' | 'name' | LayerId;
type SortDir = 'asc' | 'desc';

import type { SavedPreset } from '../hooks/useFilterPresets';

interface FilterPanelProps {
  data: FeatureCollection | null;
  filters: FilterCriterion[];
  onFiltersChange: (filters: FilterCriterion[]) => void;
  onSelect: (pno: string, center: [number, number]) => void;
  onClose: () => void;
  savedPresets?: SavedPreset[];
  onSavePreset?: (name: string, criteria: FilterCriterion[]) => void;
  onRemovePreset?: (index: number) => void;
  /** Pre-computed matching PNOs from parent — avoids running computeMatchingPnos twice
   *  (App already computes this for the Map's filter highlight layer). */
  matchingPnos?: Set<string>;
  /** DT-1: true on the default `?city=all` view, where `data` is the 69 seutukunta
   *  aggregates — not the 3,018 postal areas. Surfaces a banner so the tool's
   *  "neighborhoods" copy doesn't silently rank sub-regions instead. */
  isAggregate?: boolean;
}

/** Get the data range (min stop, max stop) for a layer from its color stops. */
function getLayerRange(layer: LayerConfig): [number, number] {
  return [layer.stops[0], layer.stops[layer.stops.length - 1]];
}

/** Layers already used as filter criteria */
function usedLayerIds(filters: FilterCriterion[]): Set<LayerId> {
  return new Set(filters.map((f) => f.layerId));
}

// Available layers for the add-filter dropdown (exclude already used)
function availableLayers(filters: FilterCriterion[]): LayerConfig[] {
  const used = usedLayerIds(filters);
  return LAYERS.filter((l) => !used.has(l.id));
}

/* ------------------------------------------------------------------ */
/* Dual-thumb range slider                                            */
/* ------------------------------------------------------------------ */
const RangeSlider: React.FC<{
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  step: number;
  color: string;
  /** A11y: metric name + bound labels and a value formatter, so each thumb gets
   *  a distinct accessible name and a formatted aria-valuetext (A2). */
  label: string;
  minLabel: string;
  maxLabel: string;
  formatValue: (v: number) => string;
  /** Atomic update of both thumbs. Debounced inside the slider so the
   *  parent only sees one update per drag session, with both values in sync. */
  onChange: (next: { min: number; max: number }) => void;
}> = ({ min, max, valueMin, valueMax, step, color, label, minLabel, maxLabel, formatValue, onChange }) => {
  // Local state for smooth visual feedback during drag.
  // Parent callback is debounced to avoid recomputing filter matches + map layers on every tick.
  const [localMin, setLocalMin] = useState(valueMin);
  const [localMax, setLocalMax] = useState(valueMax);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Refs so the debounced flush always reads the latest dragged values and
  // the current onChange prop. Previously the slider had two separate
  // debounce callbacks (onMinChange/onMaxChange) sharing one timer. Dragging
  // one thumb then the other within 150ms cancelled the first timer, so the
  // first thumb's change was dropped and the second call's `{...criterion}`
  // spread wrote back a stale sibling value — silently losing user input.
  const latestMinRef = useRef(localMin);
  const latestMaxRef = useRef(localMax);
  const onChangeRef = useRef(onChange);
  // Update the onChange ref inside an effect (react-hooks/refs forbids writing
  // to refs during render). The ref is only read inside a setTimeout callback,
  // so the effect ordering is safe: if the prop changes, the effect runs
  // before any user interaction that could trigger a flush.
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Sync from parent when values change externally (e.g. preset loaded)
  useEffect(() => { setLocalMin(valueMin); latestMinRef.current = valueMin; }, [valueMin]);
  useEffect(() => { setLocalMax(valueMax); latestMaxRef.current = valueMax; }, [valueMax]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const scheduleFlush = () => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChangeRef.current({ min: latestMinRef.current, max: latestMaxRef.current });
    }, 150);
  };

  const handleMinChange = (v: number) => {
    const clamped = Math.min(v, localMax - step);
    setLocalMin(clamped);
    latestMinRef.current = clamped;
    scheduleFlush();
  };

  const handleMaxChange = (v: number) => {
    const clamped = Math.max(v, localMin + step);
    setLocalMax(clamped);
    latestMaxRef.current = clamped;
    scheduleFlush();
  };

  const range = max - min || 1;
  const pctMin = ((localMin - min) / range) * 100;
  const pctMax = ((localMax - min) / range) * 100;

  return (
    <div className="relative h-6 flex items-center select-none">
      {/* Track background */}
      <div className="absolute inset-x-0 h-1.5 rounded-full bg-surface-200 dark:bg-surface-700" />
      {/* Active range */}
      <div
        className="absolute h-1.5 rounded-full"
        style={{
          left: `${pctMin}%`,
          right: `${100 - pctMax}%`,
          backgroundColor: color,
          opacity: 0.6,
        }}
      />
      {/* Min thumb */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localMin}
        onChange={(e) => handleMinChange(Number(e.target.value))}
        aria-label={`${label} – ${minLabel}`}
        aria-valuetext={formatValue(localMin)}
        className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none
                   [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2
                   [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                   [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none
                   [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2
                   [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
        style={{
          // @ts-expect-error CSS custom properties
          '--tw-border-opacity': 1,
        }}
      />
      {/* Max thumb */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localMax}
        onChange={(e) => handleMaxChange(Number(e.target.value))}
        aria-label={`${label} – ${maxLabel}`}
        aria-valuetext={formatValue(localMax)}
        className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none
                   [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2
                   [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                   [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none
                   [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2
                   [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* CF-7: percentile-mode helpers                                      */
/* ------------------------------------------------------------------ */

/**
 * When a criterion is switched into percentile mode, seed its 0–100 bounds from the
 * absolute values' current position in the layer's stop range (best-effort), and
 * vice-versa when switching back. Keeps the toggle from snapping the slider to the
 * rails on every flip.
 */
function toPercentileBounds(c: FilterCriterion, layer: LayerConfig): FilterCriterion {
  const [lo, hi] = getLayerRange(layer);
  const span = hi - lo || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, Math.round(((v - lo) / span) * 100)));
  return { layerId: c.layerId, min: pct(c.min), max: pct(c.max), mode: 'percentile' };
}

function toAbsoluteBounds(c: FilterCriterion, layer: LayerConfig): FilterCriterion {
  const [lo, hi] = getLayerRange(layer);
  const span = hi - lo;
  const val = (p: number) => lo + (Math.max(0, Math.min(100, p)) / 100) * span;
  return { layerId: c.layerId, min: val(c.min), max: val(c.max) };
}

/**
 * CF-7: a human "top X% / bottom X%" superlative for a percentile range, honouring
 * the metric's direction. The slider axis is raw percentile rank (0 = lowest value,
 * 100 = highest). A superlative reads cleanly only when the band is anchored at the
 * favourable rail:
 *  - higher-is-better, band reaches the top (max = 100): "top {100−min}%".
 *  - lower-is-better, band reaches the bottom (min = 0):  "bottom {max}%".
 * For a mid-distribution slice (neither rail at the favourable end) we return '' and
 * the row falls back to showing just the resolved value range.
 */
function percentileHint(min: number, max: number, higherIsBetter: boolean): string {
  const lo = Math.round(min);
  const hi = Math.round(max);
  if (lo <= 0 && hi >= 100) return ''; // whole distribution — no superlative
  if (higherIsBetter) {
    if (hi >= 100) return t('filter.pct_top').replace('{n}', String(Math.max(1, 100 - lo)));
    return '';
  }
  if (lo <= 0) return t('filter.pct_bottom').replace('{n}', String(Math.max(1, hi)));
  return '';
}

/* ------------------------------------------------------------------ */
/* Single filter row                                                  */
/* ------------------------------------------------------------------ */
const FilterRow: React.FC<{
  criterion: FilterCriterion;
  onChange: (c: FilterCriterion) => void;
  onRemove: () => void;
  /** CF-7: active-scope features used to resolve percentile bounds to real values. */
  scopeFeatures: FeatureCollection['features'] | null;
}> = ({ criterion, onChange, onRemove, scopeFeatures }) => {
  const layer = getLayerById(criterion.layerId);
  const isPercentile = criterion.mode === 'percentile';
  const [rangeMin, rangeMax] = isPercentile ? [0, 100] : getLayerRange(layer);

  // Pick a step that makes sense for the range
  const range = rangeMax - rangeMin;
  const step = isPercentile ? 1 : range > 1000 ? 100 : range > 100 ? 1 : range > 10 ? 0.5 : 0.01;

  const midColorIdx = Math.floor(layer.colors.length / 2);
  const color = layer.colors[midColorIdx];

  // CF-7: resolved real-value bounds for the percentile slider (recomputed when the
  // scope data or bounds change). Null when the metric has no data in scope.
  const resolved = useMemo(
    () => (isPercentile ? resolveCriterionBounds(criterion, scopeFeatures) : null),
    [isPercentile, criterion, scopeFeatures],
  );

  const handleToggleMode = useCallback(() => {
    onChange(isPercentile ? toAbsoluteBounds(criterion, layer) : toPercentileBounds(criterion, layer));
  }, [isPercentile, criterion, layer, onChange]);

  const hint = isPercentile ? percentileHint(criterion.min, criterion.max, layer.higherIsBetter !== false) : '';

  return (
    <div className="px-3 py-2.5 border-b border-surface-100 dark:border-surface-800/30 last:border-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-surface-700 dark:text-surface-200 truncate">
          {t(layer.labelKey)}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleToggleMode}
            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide transition-colors
                       ${isPercentile
                         ? 'bg-brand-500/15 text-brand-600 dark:bg-brand-600/20 dark:text-brand-300'
                         : 'bg-surface-100 dark:bg-surface-800/60 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700/60'}`}
            title={t('filter.mode_toggle')}
            aria-pressed={isPercentile}
          >
            {isPercentile ? t('filter.mode_percentile') : t('filter.mode_absolute')}
          </button>
          <button
            onClick={onRemove}
            className="p-0.5 rounded hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors"
            aria-label={t('filter.remove')}
          >
            <svg className="w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <RangeSlider
        min={rangeMin}
        max={rangeMax}
        valueMin={criterion.min}
        valueMax={criterion.max}
        step={step}
        color={color}
        label={t(layer.labelKey)}
        minLabel={t('filter.min')}
        maxLabel={t('filter.max')}
        formatValue={(v) => (isPercentile ? `P${Math.round(v)}` : layer.format(v))}
        onChange={(next) => onChange({ ...criterion, min: next.min, max: next.max })}
      />
      <div className="flex justify-between mt-1 text-[10px] text-surface-500 dark:text-surface-400 tabular-nums">
        {/* Values reflect the RangeSlider's debounced local state via controlled inputs */}
        {isPercentile ? (
          <>
            <span>P{Math.round(criterion.min)}</span>
            <span>P{Math.round(criterion.max)}</span>
          </>
        ) : (
          <>
            <span>{layer.format(criterion.min)}</span>
            <span>{layer.format(criterion.max)}</span>
          </>
        )}
      </div>
      {/* CF-7: resolved real-value range + superlative hint, shown beneath the slider. */}
      {isPercentile && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
          <span className="text-surface-500 dark:text-surface-400 tabular-nums truncate">
            {resolved
              ? `${layer.format(resolved.valueMin)} – ${layer.format(resolved.valueMax)}`
              : t('filter.pct_no_data')}
          </span>
          {hint && (
            <span className="text-brand-600 dark:text-brand-400 font-medium flex-shrink-0">{hint}</span>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Add-filter dropdown                                                */
/* ------------------------------------------------------------------ */
const AddFilterDropdown: React.FC<{
  filters: FilterCriterion[];
  onAdd: (layerId: LayerId) => void;
}> = ({ filters, onAdd }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // AY-5: refs for focus management — first option on open, trigger on close.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // Memoize available layers — filters 70+ LAYERS entries, was recalculated
  // on every render (any state change in the parent) without memoization.
  const available = useMemo(() => availableLayers(filters), [filters]);

  // Close dropdown on outside click; AY-5: also on Escape, restoring focus to the trigger.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  // AY-5: move focus into the popup (first option) when it opens.
  React.useEffect(() => {
    if (open) popupRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        disabled={available.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                   bg-brand-500/10 dark:bg-brand-600/15 text-brand-700 dark:text-brand-300
                   hover:bg-brand-500/20 dark:hover:bg-brand-600/25 transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        {t('filter.add')}
      </button>

      {open && (
        <div
          ref={popupRef}
          role="listbox"
          aria-label={t('filter.add')}
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-52 overflow-y-auto
                        rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700/40
                        shadow-xl">
          {available.map((layer) => (
            <button
              key={layer.id}
              role="option"
              aria-selected={false}
              onClick={() => {
                trackEvent('add-filter', { metric: layer.id });
                onAdd(layer.id);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs text-surface-700 dark:text-surface-200
                         hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors
                         border-b border-surface-100 dark:border-surface-800/30 last:border-0"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: layer.colors[Math.floor(layer.colors.length / 2)] }}
                />
                {t(layer.labelKey)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* DT-3: inline "save preset" name field (replaces a native prompt())  */
/* ------------------------------------------------------------------ */
const SavePresetInline: React.FC<{ onSave: (name: string) => void }> = ({ onSave }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) { trackEvent('save-filter-preset'); onSave(trimmed); }
    setName('');
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-[10px] font-medium text-brand-600 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors"
      >
        {t('filter.save_preset')}
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); commit(); }}
      className="flex items-center gap-1"
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setName(''); setEditing(false); } }}
        placeholder={t('filter.preset_name')}
        aria-label={t('filter.preset_name')}
        className="flex-1 min-w-0 rounded bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700/40
                   px-2 py-1 text-[11px] text-surface-900 dark:text-white placeholder-surface-400
                   focus:outline-none focus:ring-1 focus:ring-brand-500/50"
      />
      <button type="submit" className="px-2 py-1 rounded text-[10px] font-semibold bg-brand-500/15 text-brand-700 dark:text-brand-300 hover:bg-brand-500/25 transition-colors">
        {t('filter.save')}
      </button>
      <button type="button" onClick={() => { setName(''); setEditing(false); }} aria-label={t('filter.cancel')} className="px-1.5 py-1 rounded text-[10px] text-surface-400 hover:text-surface-600 dark:hover:text-surface-300">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </form>
  );
};

/* ------------------------------------------------------------------ */
/* PO-5: Filter presets                                               */
/* ------------------------------------------------------------------ */
interface FilterPreset {
  labelKey: string;
  criteria: { layerId: LayerId; min: number; max: number }[];
}

const FILTER_PRESETS: FilterPreset[] = [
  // Thresholds are calibrated against the actual national distributions. The
  // previous ones were set when the densities were stored at one decimal and
  // assumed urban-scale values: "Families" (daycare >= 2/km²) matched 49 of
  // 3,018 areas and "Commuters" (transit >= 40/km², where the national maximum
  // is 58.5) matched seven. Both now select a usable slice of the country.
  {
    labelKey: 'filter.preset_families',
    criteria: [
      { layerId: 'child_ratio', min: 6, max: 20 },
      { layerId: 'daycare_density', min: 0.15, max: 20 },
    ],
  },
  {
    labelKey: 'filter.preset_commuters',
    criteria: [
      { layerId: 'transit_access', min: 5, max: 200 },
      { layerId: 'cycling_infra', min: 5, max: 300 },
    ],
  },
  {
    labelKey: 'filter.preset_affordable',
    criteria: [
      { layerId: 'property_price', min: 1000, max: 4000 },
    ],
  },
  {
    labelKey: 'filter.preset_premium',
    criteria: [
      { layerId: 'quality_index', min: 60, max: 100 },
      { layerId: 'air_quality', min: 18, max: 30 },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Main FilterPanel                                                   */
/* ------------------------------------------------------------------ */
export const FilterPanel: React.FC<FilterPanelProps> = React.memo(({
  data,
  filters,
  onFiltersChange,
  onSelect,
  onClose,
  savedPresets = [],
  onSavePreset,
  onRemovePreset,
  matchingPnos: externalMatchingPnos,
  isAggregate = false,
}) => {
  useI18nVersion();
  // QW-3: Unified bottom sheet drag behavior
  const sheetRef = useRef<HTMLDivElement>(null);
  const { sheetHeight, isDragging, snap, cycleSnap, handlers: sheetHandlers } = useBottomSheet({
    halfRatio: 0.85,
    initialSnap: 'half',
    onClose,
  });
  const [mobileResultsOpen, setMobileResultsOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Reuse matching PNOs from parent (App already computes this for the Map's
  // filter highlight layer) to avoid running O(n × filters) twice.
  // Falls back to local computation if prop not provided (backwards compat).
  const localMatchingPnos = useMemo(
    () => externalMatchingPnos ?? computeMatchingPnos(data, filters),
    [externalMatchingPnos, data, filters],
  );
  const matchingPnos = localMatchingPnos;
  const matchingFeatures = useMemo(() => {
    if (!data || matchingPnos.size === 0) return [];
    return data.features.filter((f) => matchingPnos.has((f.properties as NeighborhoodProperties).pno));
  }, [data, matchingPnos]);

  // CF-7: the active-scope feature set FilterRow resolves percentile bounds against.
  // This is `filteredData` from App — already region-scoped in single-city mode and the
  // metro aggregate in "all" mode — so percentiles honour the comparisonScope plumbing.
  const scopeFeatures = data?.features ?? null;

  // Pre-resolve layer configs once per filter change — avoids calling getLayerById
  // per-feature per-filter in the ranked computation (~200 features × 4 filters = 800
  // redundant Map lookups per slider drag tick). Also reused in the result list JSX.
  const resolvedFilters = useMemo(
    () => filters.map((c) => ({ ...c, layer: getLayerById(c.layerId) })),
    [filters],
  );

  // QW-2: rank matching neighborhoods by a direction- and percentile-aware "Best
  // match" score. Resolve each criterion's bounds for the active scope once (percentile
  // ranks → concrete quantiles), carry the layer's favourable direction, and skip any
  // criterion that can't resolve — then bestMatchScore positions each area within its
  // favourable end. The old path normalized raw values against stored bounds (which are
  // 0–100 ranks in percentile mode) and always rewarded higher values, so a safety/noise
  // filter surfaced the WORST areas first.
  const ranked = useMemo(() => {
    if (matchingFeatures.length === 0) return [];

    const scoredCriteria: ScoredCriterion[] = [];
    for (const rf of resolvedFilters) {
      const b = resolveCriterionBounds(rf, scopeFeatures);
      if (!b) continue;
      scoredCriteria.push({
        property: b.property,
        valueMin: b.valueMin,
        valueMax: b.valueMax,
        higherIsBetter: rf.layer.higherIsBetter !== false,
      });
    }

    const items = matchingFeatures.map((f) => {
      const p = f.properties as NeighborhoodProperties;
      return {
        pno: p.pno,
        name: p.nimi || p.pno,
        score: bestMatchScore(p, scoredCriteria),
        feature: f,
        properties: p,
      };
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    const sortLayer = sortKey !== 'score' && sortKey !== 'name'
      ? getLayerById(sortKey as LayerId)
      : null;
    items.sort((a, b) => {
      if (sortKey === 'score') return dir * (a.score - b.score);
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name, 'fi');
      const va = (a.properties[sortLayer!.property] as number) ?? 0;
      const vb = (b.properties[sortLayer!.property] as number) ?? 0;
      return dir * (va - vb);
    });

    return items;
  }, [matchingFeatures, resolvedFilters, scopeFeatures, sortKey, sortDir]);

  // Add a new filter criterion
  const handleAddFilter = useCallback(
    (layerId: LayerId) => {
      const layer = getLayerById(layerId);
      const [rangeMin, rangeMax] = getLayerRange(layer);
      onFiltersChange([...filters, { layerId, min: rangeMin, max: rangeMax }]);
    },
    [filters, onFiltersChange],
  );

  // Update an existing filter criterion
  const handleUpdateFilter = useCallback(
    (index: number, criterion: FilterCriterion) => {
      const next = [...filters];
      next[index] = criterion;
      onFiltersChange(next);
    },
    [filters, onFiltersChange],
  );

  // Remove a filter criterion
  const handleRemoveFilter = useCallback(
    (index: number) => {
      onFiltersChange(filters.filter((_, i) => i !== index));
    },
    [filters, onFiltersChange],
  );

  // Reset sortKey to 'score' if the selected layer filter is removed
  const validSortKey = sortKey === 'score' || sortKey === 'name' || filters.some((f) => f.layerId === sortKey)
    ? sortKey
    : 'score';
  React.useEffect(() => {
    if (validSortKey !== sortKey) setSortKey(validSortKey);
  }, [validSortKey, sortKey]);

  // ES-3: when active filters narrow to zero matches, auto-open the mobile results
  // pane so the "no match" guidance + one-tap Clear-all aren't hidden behind a
  // "Show results" link that a 0 count makes look pointless.
  React.useEffect(() => {
    if (filters.length > 0 && ranked.length === 0) setMobileResultsOpen(true);
  }, [filters.length, ranked.length]);

  // On the all-Finland view the filter ranks every postal area in the country. The
  // full national set loads on demand once a filter is active (`data` is null until it
  // resolves), so the banner reflects the live state: an invitation before any filter,
  // a loading note while the national set downloads, then a positive "all of Finland"
  // confirmation once areas are rankable. (Previously this said filtering was limited
  // to regions — no longer true.)
  const aggregateBanner = isAggregate ? (
    <div className="flex-shrink-0 mx-3 mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 dark:bg-amber-600/15 border border-amber-500/30 px-2.5 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-300" role="status">
      <span aria-hidden="true" className="mt-px">ⓘ</span>
      <span>{data ? t('filter.national_notice') : filters.length > 0 ? t('filter.national_loading') : t('filter.national_invite')}</span>
    </div>
  ) : null;

  const sortBar = filters.length > 0 ? (
    <div className="flex items-center gap-1.5 px-4 py-2 border-t border-surface-200 dark:border-surface-700/40 flex-shrink-0">
      <span className="text-[10px] font-medium text-surface-500 dark:text-surface-400 flex-shrink-0">
        {ranked.length} {t('filter.matches')}
      </span>
      <div className="flex-1" />
      <select
        value={validSortKey}
        onChange={(e) => {
          const newKey = e.target.value as SortKey;
          setSortKey(newKey);
          // Default direction: desc for score/layer values, asc for name
          setSortDir(newKey === 'name' ? 'asc' : 'desc');
        }}
        className="text-[10px] font-medium text-surface-600 dark:text-surface-300
                   bg-white dark:bg-surface-800
                   border border-surface-200 dark:border-surface-700/40 rounded px-1.5 py-0.5
                   cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-500/50
                   dark:[color-scheme:dark]"
      >
        <option value="score">{t('filter.sort_best_match')}</option>
        <option value="name">{t('filter.sort_name')}</option>
        {resolvedFilters.map((rf) => (
            <option key={rf.layerId} value={rf.layerId}>
              {t(rf.layer.labelKey)}
            </option>
        ))}
      </select>
      <button
        onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
        className="text-[10px] font-medium text-surface-500 dark:text-surface-400
                   border border-surface-200 dark:border-surface-700/40 rounded px-1 py-0.5
                   hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors"
        title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
      >
        {sortDir === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  ) : null;

  const resultsList = (
    <div className="overflow-y-auto flex-1 min-h-0 pb-safe">
      {ranked.map((item, i) => (
        <button
          key={item.pno}
          onClick={() => onSelect(item.pno, getFeatureCenter(item.feature))}
          className="w-full text-left px-4 py-2 flex items-center gap-3
                     hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors
                     border-b border-surface-100 dark:border-surface-800/30 last:border-0"
          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 52px' }}
        >
          <span className="text-xs font-mono text-surface-500 dark:text-surface-400 w-6 text-right flex-shrink-0">
            {sortDir === 'asc' ? ranked.length - i : i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-surface-800 dark:text-surface-200 truncate">
              {item.name}
            </div>
            {/* Show key filter values */}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {resolvedFilters.map((rf) => {
                const value = item.properties[rf.layer.property] as number | null;
                if (value == null) return null;
                return (
                  <span
                    key={rf.layerId}
                    className="text-[10px] text-surface-500 dark:text-surface-400 tabular-nums"
                  >
                    {t(rf.layer.labelKey)}: {rf.layer.format(value)}
                  </span>
                );
              })}
            </div>
          </div>
        </button>
      ))}

      {/* DT-3: while the on-demand national dataset is still loading (`data` null
          on ?city=all with a filter active), `ranked` is empty because the query
          hasn't run yet — show a loading placeholder, not a contradictory
          "0 results, clear your filters" under the "still loading" banner. */}
      {filters.length > 0 && ranked.length === 0 && isAggregate && !data && (
        <div className="px-4 py-8 text-center text-sm text-surface-500 dark:text-surface-400" role="status">
          {t('filter.national_loading')}
        </div>
      )}

      {filters.length > 0 && ranked.length === 0 && !(isAggregate && !data) && (
        <div className="px-4 py-8 text-center flex flex-col items-center gap-3">
          <FilterEmptyIllustration className="opacity-60" />
          <p className="text-sm text-surface-500 dark:text-surface-400">
            {t('filter.no_match')}
          </p>
          <button
            onClick={() => onFiltersChange([])}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                       bg-brand-500/10 dark:bg-brand-600/15 text-brand-700 dark:text-brand-300
                       hover:bg-brand-500/20 dark:hover:bg-brand-600/25 transition-colors"
          >
            {t('filter.clear_all')}
          </button>
        </div>
      )}

      {filters.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-surface-500 dark:text-surface-400">
          {t('filter.empty')}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop: panel on left side. DT-5: offset below the search bar (also top-14
          left-4) so the opaque panel no longer draws directly on top of it. */}
      <div className="hidden md:flex absolute top-28 left-4 z-20 w-80 max-h-[calc(100vh-9rem)] flex-col
                      rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md
                      border border-surface-200 dark:border-surface-700/40 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-700/40 flex-shrink-0">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {t('filter.title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors"
            aria-label={t('aria.close')}
          >
            <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {aggregateBanner}

        {/* PO-5: Filter presets */}
        {filters.length === 0 && (
          <div className="flex-shrink-0 px-3 py-2 space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {t('filter.presets')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {FILTER_PRESETS.map((preset) => (
                <button
                  key={preset.labelKey}
                  onClick={() => { trackEvent('apply-preset', { preset: preset.labelKey }); onFiltersChange(preset.criteria); }}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                             bg-brand-500/10 dark:bg-brand-600/15 text-brand-700 dark:text-brand-300
                             hover:bg-brand-500/20 dark:hover:bg-brand-600/25 transition-colors"
                >
                  {t(preset.labelKey)}
                </button>
              ))}
              {savedPresets.map((preset, i) => (
                <div key={`saved-${i}`} className="flex items-center gap-0.5">
                  <button
                    onClick={() => { trackEvent('apply-saved-preset'); onFiltersChange(preset.criteria); }}
                    className="px-2.5 py-1.5 rounded-l-lg text-[11px] font-medium
                               bg-surface-100 dark:bg-surface-800/60 text-surface-700 dark:text-surface-200
                               hover:bg-surface-200 dark:hover:bg-surface-700/60 transition-colors"
                  >
                    {preset.name}
                  </button>
                  {onRemovePreset && (
                    <button
                      onClick={() => onRemovePreset(i)}
                      className="px-1 py-1.5 rounded-r-lg text-[11px]
                                 bg-surface-100 dark:bg-surface-800/60 text-surface-400
                                 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 transition-colors"
                      aria-label={t('filter.remove')}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Save current filter as preset (DT-3: inline field, not a native prompt()) */}
        {filters.length > 0 && onSavePreset && (
          <div className="flex-shrink-0 px-3 py-1.5">
            <SavePresetInline onSave={(name) => onSavePreset(name, filters)} />
          </div>
        )}

        {/* Filter criteria */}
        {filters.length > 0 && (
          <div className="flex-shrink-0 max-h-[40vh] overflow-y-auto">
            {filters.map((criterion, i) => (
              <FilterRow
                key={criterion.layerId}
                criterion={criterion}
                onChange={(c) => handleUpdateFilter(i, c)}
                onRemove={() => handleRemoveFilter(i)}
                scopeFeatures={scopeFeatures}
              />
            ))}
          </div>
        )}
        <div className="flex-shrink-0 p-2">
          <AddFilterDropdown filters={filters} onAdd={handleAddFilter} />
        </div>

        {/* Sort bar + result count */}
        {sortBar}

        {/* Results list */}
        {resultsList}
      </div>

      {/* Mobile: bottom sheet */}
      <div className="md:hidden">
        {/* Backdrop */}
        <div
          className="fixed inset-0 z-30 bg-black/20 dark:bg-black/40"
          onClick={onClose}
        />

        {/* Sheet */}
        <div
          ref={sheetRef}
          role="dialog"
          aria-label={t('filter.title')}
          className="fixed bottom-0 left-0 right-0 z-40
                     bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                     border-t border-surface-200 dark:border-surface-800/50
                     shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl
                     flex flex-col"
          style={{
            height: sheetHeight,
            transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
          }}
        >
          {/* Drag handle */}
          <button
            type="button"
            onClick={cycleSnap}
            aria-expanded={snap !== 'peek'}
            aria-label={t('aria.expand_sheet')}
            className="flex w-full items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none flex-shrink-0
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 rounded-t-2xl"
            onTouchStart={sheetHandlers.onTouchStart}
            onTouchMove={sheetHandlers.onTouchMove}
            onTouchEnd={sheetHandlers.onTouchEnd}
            onTouchCancel={sheetHandlers.onTouchCancel}
          >
            <div className="w-10 h-1.5 rounded-full bg-surface-300 dark:bg-surface-600" />
          </button>

          <div className="px-4 py-2 border-b border-surface-200 dark:border-surface-700/40 flex items-center justify-between flex-shrink-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {t('filter.title')}
            </h3>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-400"
              aria-label={t('aria.close')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {aggregateBanner}

          {/* PO-5: Filter presets (mobile) */}
          {filters.length === 0 && (
            <div className="flex-shrink-0 px-3 py-2 space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                {t('filter.presets')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {FILTER_PRESETS.map((preset) => (
                  <button
                    key={preset.labelKey}
                    onClick={() => { trackEvent('apply-preset', { preset: preset.labelKey }); onFiltersChange(preset.criteria); }}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                               bg-brand-500/10 dark:bg-brand-600/15 text-brand-700 dark:text-brand-300
                               hover:bg-brand-500/20 dark:hover:bg-brand-600/25 transition-colors"
                  >
                    {t(preset.labelKey)}
                  </button>
                ))}
                {savedPresets.map((preset, i) => (
                  <div key={`saved-m-${i}`} className="flex items-center gap-0.5">
                    <button
                      onClick={() => { trackEvent('apply-saved-preset'); onFiltersChange(preset.criteria); }}
                      className="px-2.5 py-1.5 rounded-l-lg text-[11px] font-medium
                                 bg-surface-100 dark:bg-surface-800/60 text-surface-700 dark:text-surface-200
                                 hover:bg-surface-200 dark:hover:bg-surface-700/60 transition-colors"
                    >
                      {preset.name}
                    </button>
                    {onRemovePreset && (
                      <button
                        onClick={() => onRemovePreset(i)}
                        className="px-1 py-1.5 rounded-r-lg text-[11px]
                                   bg-surface-100 dark:bg-surface-800/60 text-surface-400
                                   hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 transition-colors"
                        aria-label={t('filter.remove')}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save current filter as preset (mobile; DT-3: inline field, not prompt()) */}
          {filters.length > 0 && onSavePreset && (
            <div className="flex-shrink-0 px-3 py-1.5">
              <SavePresetInline onSave={(name) => onSavePreset(name, filters)} />
            </div>
          )}

          {/* Filter criteria */}
          {filters.length > 0 && (
            <div className="flex-shrink-0 max-h-[35vh] overflow-y-auto">
              {filters.map((criterion, i) => (
                <FilterRow
                  key={criterion.layerId}
                  criterion={criterion}
                  onChange={(c) => handleUpdateFilter(i, c)}
                  onRemove={() => handleRemoveFilter(i)}
                  scopeFeatures={scopeFeatures}
                />
              ))}
            </div>
          )}
          <div className="flex-shrink-0 p-2">
            <AddFilterDropdown filters={filters} onAdd={handleAddFilter} />
          </div>

          {/* Results */}
          {filters.length > 0 && (
            <>
              {sortBar}
              <div className="px-4 py-1 flex-shrink-0 flex items-center justify-end">
                <button
                  onClick={() => setMobileResultsOpen(!mobileResultsOpen)}
                  className="text-[10px] font-medium text-brand-600 dark:text-brand-400"
                >
                  {mobileResultsOpen ? t('filter.hide_results') : t('filter.show_results')}
                </button>
              </div>
              {mobileResultsOpen && resultsList}
            </>
          )}
        </div>
      </div>
    </>
  );
});
FilterPanel.displayName = 'FilterPanel';

