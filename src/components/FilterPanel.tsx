import React, { useState, useMemo, useCallback, useRef } from 'react';
import type { FeatureCollection } from 'geojson';
import { LAYERS, type LayerId, type LayerConfig, getLayerById } from '../utils/colorScales';
import type { NeighborhoodProperties } from '../utils/metrics';
import { t } from '../utils/i18n';
import { useBottomSheet } from '../hooks/useBottomSheet';

export interface FilterCriterion {
  layerId: LayerId;
  min: number;
  max: number;
}

type SortKey = 'score' | 'name' | LayerId;
type SortDir = 'asc' | 'desc';

interface FilterPanelProps {
  data: FeatureCollection | null;
  filters: FilterCriterion[];
  onFiltersChange: (filters: FilterCriterion[]) => void;
  onSelect: (pno: string, center: [number, number]) => void;
  onClose: () => void;
}

/** Get the data range (min stop, max stop) for a layer from its color stops. */
function getLayerRange(layer: LayerConfig): [number, number] {
  return [layer.stops[0], layer.stops[layer.stops.length - 1]];
}

function getCenter(feature: GeoJSON.Feature): [number, number] {
  const geom = feature.geometry;
  if (geom.type === 'Point') return geom.coordinates as [number, number];
  const coords: GeoJSON.Position[] = [];
  function extract(c: GeoJSON.Position | GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][]) {
    if (typeof c[0] === 'number') coords.push(c as GeoJSON.Position);
    else (c as GeoJSON.Position[][]).forEach(extract);
  }
  if ('coordinates' in geom) {
    extract(geom.coordinates as GeoJSON.Position[]);
  }
  const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return [lng, lat];
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
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
}> = ({ min, max, valueMin, valueMax, step, color, onMinChange, onMaxChange }) => {
  const pctMin = ((valueMin - min) / (max - min)) * 100;
  const pctMax = ((valueMax - min) / (max - min)) * 100;

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
        value={valueMin}
        onChange={(e) => {
          const v = Number(e.target.value);
          onMinChange(Math.min(v, valueMax - step));
        }}
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
        value={valueMax}
        onChange={(e) => {
          const v = Number(e.target.value);
          onMaxChange(Math.max(v, valueMin + step));
        }}
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
/* Single filter row                                                  */
/* ------------------------------------------------------------------ */
const FilterRow: React.FC<{
  criterion: FilterCriterion;
  onChange: (c: FilterCriterion) => void;
  onRemove: () => void;
}> = ({ criterion, onChange, onRemove }) => {
  const layer = getLayerById(criterion.layerId);
  const [rangeMin, rangeMax] = getLayerRange(layer);

  // Pick a step that makes sense for the range
  const range = rangeMax - rangeMin;
  const step = range > 1000 ? 100 : range > 100 ? 1 : range > 10 ? 0.5 : 0.01;

  const midColorIdx = Math.floor(layer.colors.length / 2);
  const color = layer.colors[midColorIdx];

  return (
    <div className="px-3 py-2.5 border-b border-surface-100 dark:border-surface-800/30 last:border-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-surface-700 dark:text-surface-200 truncate">
          {t(layer.labelKey)}
        </span>
        <button
          onClick={onRemove}
          className="p-0.5 rounded hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors flex-shrink-0"
          aria-label={t('filter.remove')}
        >
          <svg className="w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <RangeSlider
        min={rangeMin}
        max={rangeMax}
        valueMin={criterion.min}
        valueMax={criterion.max}
        step={step}
        color={color}
        onMinChange={(v) => onChange({ ...criterion, min: v })}
        onMaxChange={(v) => onChange({ ...criterion, max: v })}
      />
      <div className="flex justify-between mt-1 text-[10px] text-surface-500 dark:text-surface-400 tabular-nums">
        <span>{layer.format(criterion.min)}</span>
        <span>{layer.format(criterion.max)}</span>
      </div>
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
  const available = availableLayers(filters);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={available.length === 0}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                   bg-brand-500/10 dark:bg-brand-600/15 text-brand-600 dark:text-brand-300
                   hover:bg-brand-500/20 dark:hover:bg-brand-600/25 transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        {t('filter.add')}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-52 overflow-y-auto
                        rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700/40
                        shadow-xl">
          {available.map((layer) => (
            <button
              key={layer.id}
              onClick={() => {
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
/* PO-5: Filter presets                                               */
/* ------------------------------------------------------------------ */
interface FilterPreset {
  labelKey: string;
  criteria: { layerId: LayerId; min: number; max: number }[];
}

const FILTER_PRESETS: FilterPreset[] = [
  {
    labelKey: 'filter.preset_families',
    criteria: [
      { layerId: 'child_ratio', min: 6, max: 20 },
      { layerId: 'school_quality', min: 5.5, max: 8 },
      { layerId: 'daycare_density', min: 2, max: 20 },
      { layerId: 'green_space', min: 20, max: 90 },
    ],
  },
  {
    labelKey: 'filter.preset_commuters',
    criteria: [
      { layerId: 'transit_access', min: 40, max: 200 },
      { layerId: 'commute_time', min: 10, max: 30 },
      { layerId: 'cycling_infra', min: 20, max: 150 },
    ],
  },
  {
    labelKey: 'filter.preset_affordable',
    criteria: [
      { layerId: 'property_price', min: 1000, max: 4000 },
      { layerId: 'rental_price', min: 10, max: 18 },
    ],
  },
  {
    labelKey: 'filter.preset_premium',
    criteria: [
      { layerId: 'quality_index', min: 60, max: 100 },
      { layerId: 'walkability', min: 60, max: 90 },
      { layerId: 'air_quality', min: 18, max: 30 },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Main FilterPanel                                                   */
/* ------------------------------------------------------------------ */
export const FilterPanel: React.FC<FilterPanelProps> = ({
  data,
  filters,
  onFiltersChange,
  onSelect,
  onClose,
}) => {
  // QW-3: Unified bottom sheet drag behavior
  const sheetRef = useRef<HTMLDivElement>(null);
  const { sheetHeight: _filterSheetHeight, isDragging, handlers: sheetHandlers } = useBottomSheet({
    halfRatio: 0.85,
    initialSnap: 'half',
    onClose,
  });
  const [mobileResultsOpen, setMobileResultsOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Compute matching neighborhoods
  const matchingFeatures = useMemo(() => {
    if (!data || filters.length === 0) return [];

    return data.features.filter((f) => {
      const p = f.properties as NeighborhoodProperties;
      if (!p.he_vakiy || p.he_vakiy <= 0) return false;

      return filters.every((criterion) => {
        const layer = getLayerById(criterion.layerId);
        const value = p[layer.property];
        if (typeof value !== 'number' || value == null) return false;
        return value >= criterion.min && value <= criterion.max;
      });
    });
  }, [data, filters]);

  // Sort matching neighborhoods by how many criteria they score well on
  // Use a simple score: for each criterion, how far into the range (normalized 0-1)
  const ranked = useMemo(() => {
    if (matchingFeatures.length === 0) return [];

    const items = matchingFeatures.map((f) => {
      const p = f.properties as NeighborhoodProperties;
      let score = 0;
      for (const criterion of filters) {
        const layer = getLayerById(criterion.layerId);
        const value = p[layer.property] as number;
        const range = criterion.max - criterion.min;
        if (range > 0) {
          score += (value - criterion.min) / range;
        } else {
          score += 1;
        }
      }
      score /= filters.length;

      return {
        pno: p.pno,
        name: p.nimi || p.pno,
        score,
        center: getCenter(f),
        properties: p,
      };
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      if (sortKey === 'score') return dir * (a.score - b.score);
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name, 'fi');
      // Sort by a specific layer property
      const layer = getLayerById(sortKey as LayerId);
      const va = (a.properties[layer.property] as number) ?? 0;
      const vb = (b.properties[layer.property] as number) ?? 0;
      return dir * (va - vb);
    });

    return items;
  }, [matchingFeatures, filters, sortKey, sortDir]);

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
        {filters.map((criterion) => {
          const layer = getLayerById(criterion.layerId);
          return (
            <option key={criterion.layerId} value={criterion.layerId}>
              {t(layer.labelKey)}
            </option>
          );
        })}
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
    <div className="overflow-y-auto flex-1 min-h-0">
      {ranked.map((item, i) => (
        <button
          key={item.pno}
          onClick={() => onSelect(item.pno, item.center)}
          className="w-full text-left px-4 py-2 flex items-center gap-3
                     hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors
                     border-b border-surface-100 dark:border-surface-800/30 last:border-0"
        >
          <span className="text-xs font-mono text-surface-400 dark:text-surface-500 w-6 text-right flex-shrink-0">
            {sortDir === 'asc' ? ranked.length - i : i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-surface-800 dark:text-surface-200 truncate">
              {item.name}
            </div>
            {/* Show key filter values */}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {filters.map((criterion) => {
                const layer = getLayerById(criterion.layerId);
                const value = item.properties[layer.property] as number | null;
                if (value == null) return null;
                return (
                  <span
                    key={criterion.layerId}
                    className="text-[10px] text-surface-500 dark:text-surface-400 tabular-nums"
                  >
                    {t(layer.labelKey)}: {layer.format(value)}
                  </span>
                );
              })}
            </div>
          </div>
        </button>
      ))}

      {filters.length > 0 && ranked.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-surface-400 dark:text-surface-500">
          {t('filter.no_match')}
        </div>
      )}

      {filters.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-surface-400 dark:text-surface-500">
          {t('filter.empty')}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop: panel on left side */}
      <div className="hidden md:flex absolute top-14 left-4 z-20 w-80 max-h-[calc(100vh-7rem)] flex-col
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
            aria-label="Close filter"
          >
            <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* PO-5: Filter presets */}
        {filters.length === 0 && (
          <div className="flex-shrink-0 px-3 py-2 space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
              {t('filter.presets')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {FILTER_PRESETS.map((preset) => (
                <button
                  key={preset.labelKey}
                  onClick={() => onFiltersChange(preset.criteria)}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                             bg-brand-500/10 dark:bg-brand-600/15 text-brand-600 dark:text-brand-300
                             hover:bg-brand-500/20 dark:hover:bg-brand-600/25 transition-colors"
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
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
          className="fixed bottom-0 left-0 right-0 z-40
                     bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                     border-t border-surface-200 dark:border-surface-800/50
                     shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl
                     max-h-[85vh] flex flex-col"
          style={{
            transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
          }}
        >
          {/* Drag handle */}
          <div
            className="flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
            onTouchStart={sheetHandlers.onTouchStart}
            onTouchMove={sheetHandlers.onTouchMove}
            onTouchEnd={sheetHandlers.onTouchEnd}
          >
            <div className="w-10 h-1.5 rounded-full bg-surface-300 dark:bg-surface-600" />
          </div>

          <div className="px-4 py-2 border-b border-surface-200 dark:border-surface-700/40 flex items-center justify-between flex-shrink-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {t('filter.title')}
            </h3>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-400"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* PO-5: Filter presets (mobile) */}
          {filters.length === 0 && (
            <div className="flex-shrink-0 px-3 py-2 space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
                {t('filter.presets')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {FILTER_PRESETS.map((preset) => (
                  <button
                    key={preset.labelKey}
                    onClick={() => onFiltersChange(preset.criteria)}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                               bg-brand-500/10 dark:bg-brand-600/15 text-brand-600 dark:text-brand-300
                               hover:bg-brand-500/20 dark:hover:bg-brand-600/25 transition-colors"
                  >
                    {t(preset.labelKey)}
                  </button>
                ))}
              </div>
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
                  className="text-[10px] font-medium text-brand-500 dark:text-brand-400"
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
};

/** Compute the set of matching PNOs given data and filters. Used by Map.tsx. */
export function computeMatchingPnos(
  data: FeatureCollection | null,
  filters: FilterCriterion[],
): Set<string> {
  if (!data || filters.length === 0) return new Set();

  const pnos = new Set<string>();
  for (const f of data.features) {
    const p = f.properties as NeighborhoodProperties;
    if (!p.he_vakiy || p.he_vakiy <= 0) continue;

    const matches = filters.every((criterion) => {
      const layer = getLayerById(criterion.layerId);
      const value = p[layer.property];
      if (typeof value !== 'number' || value == null) return false;
      const [rangeMin, rangeMax] = getLayerRange(layer);
      // When slider is at its extreme position, include all values beyond the stop range
      // so neighborhoods with outlier values (e.g. 1.4% when stops start at 2%) aren't excluded
      const minOk = criterion.min <= rangeMin ? true : value >= criterion.min;
      const maxOk = criterion.max >= rangeMax ? true : value <= criterion.max;
      return minOk && maxOk;
    });

    if (matches) pnos.add(p.pno);
  }

  return pnos;
}
