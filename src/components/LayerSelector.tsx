import React, { useState, useRef, useEffect } from 'react';
import { LAYERS, type LayerId } from '../utils/colorScales';
import { t } from '../utils/i18n';
import { useBottomSheet } from '../hooks/useBottomSheet';

interface LayerSelectorProps {
  activeLayer: LayerId;
  onLayerChange: (id: LayerId) => void;
  onCustomizeQuality?: () => void;
  isCustomWeights?: boolean;
}

type LayerGroup = {
  labelKey: string;
  ids: LayerId[];
};

const LAYER_GROUPS: LayerGroup[] = [
  { labelKey: 'layers.quality', ids: ['transit_access', 'transit_reachability', 'air_quality'] },
  { labelKey: 'layers.trends', ids: ['income_change', 'population_change', 'unemployment_change'] },
  { labelKey: 'layers.demographics', ids: ['avg_age', 'population_density', 'child_ratio', 'youth_ratio', 'elderly_ratio', 'gender_ratio', 'student_share', 'foreign_lang', 'pensioners', 'single_person_hh', 'single_parent_hh', 'families_with_children', 'avg_household_size'] },
  { labelKey: 'layers.economy', ids: ['median_income', 'unemployment', 'employment_rate', 'education', 'property_price', 'tech_sector_jobs', 'healthcare_workers', 'manufacturing_jobs', 'public_sector_jobs', 'service_sector_jobs'] },
  { labelKey: 'layers.housing', ids: ['ownership', 'rental', 'apt_size', 'detached_houses', 'new_construction'] },
  { labelKey: 'layers.services', ids: ['restaurant_density', 'grocery_access', 'daycare_density', 'school_density', 'healthcare_access'] },
  { labelKey: 'layers.safety', ids: ['crime_rate'] },
  { labelKey: 'layers.mobility', ids: ['cycling_infra', 'ev_charging_density'] },
  { labelKey: 'layers.environment', ids: ['tree_canopy'] },
  { labelKey: 'layers.voting', ids: ['voter_turnout', 'party_diversity'] },
  { labelKey: 'layers.connectivity', ids: ['broadband_coverage'] },
];

export const LayerSelector: React.FC<LayerSelectorProps> = ({ activeLayer, onLayerChange, onCustomizeQuality, isCustomWeights = false }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYER_GROUPS.map((g) => [g.labelKey, true]))
  );
  // PO-3: Layer search filter
  const [layerSearch, setLayerSearch] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // QW-3: Unified bottom sheet drag behavior
  const { isDragging, handlers: sheetHandlers } = useBottomSheet({
    peekHeight: 0,
    halfRatio: 0.7,
    initialSnap: 'half',
    onClose: () => setMobileOpen(false),
  });

  const toggleGroup = (labelKey: string) => {
    setCollapsed((prev) => ({ ...prev, [labelKey]: !prev[labelKey] }));
  };

  // PO-2: Keyboard navigation
  const listRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Build flat list of visible layer IDs for keyboard navigation
  const visibleLayers = LAYER_GROUPS.flatMap((group) =>
    collapsed[group.labelKey] ? [] : group.ids
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!listRef.current?.contains(document.activeElement)) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, visibleLayers.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < visibleLayers.length) {
        e.preventDefault();
        onLayerChange(visibleLayers[focusedIndex]);
        setMobileOpen(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setMobileOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visibleLayers, focusedIndex, onLayerChange]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0) return;
    const el = listRef.current?.querySelector(`[data-layer-index="${focusedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  // PO-3: Filter layers by search query
  const searchQuery = layerSearch.toLowerCase().trim();

  const layerList = (
    <div className="p-2 space-y-1" ref={listRef} role="listbox" aria-label={t('layers.title')}>
      {/* PO-3: Search input */}
      <div className="px-2 pb-2">
        <input
          type="text"
          value={layerSearch}
          onChange={(e) => setLayerSearch(e.target.value)}
          placeholder={t('layers.search_placeholder')}
          className="w-full rounded-lg bg-surface-100 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700/40
                     px-3 py-2 md:py-1.5 text-xs text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500
                     focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30"
        />
      </div>
      {/* Standalone quality index — always visible at the top */}
      {(() => {
        const qLayer = LAYERS.find((l) => l.id === 'quality_index');
        if (!qLayer) return null;
        if (searchQuery && !t(qLayer.labelKey).toLowerCase().includes(searchQuery)) return null;
        const isActive = qLayer.id === activeLayer;
        const showEditBtn = qLayer.id === 'quality_index' && onCustomizeQuality;
        return (
          <div className="flex items-center gap-0.5 mb-1">
            <button
              onClick={() => {
                onLayerChange(qLayer.id);
                setMobileOpen(false);
              }}
              role="option"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`flex-1 text-left px-3 py-2.5 md:py-1.5 rounded-lg text-sm transition-all duration-150 min-h-[44px] md:min-h-0 ${
                isActive
                  ? 'bg-brand-500/15 dark:bg-brand-600/20 text-brand-600 dark:text-brand-300 font-medium'
                  : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60 hover:text-surface-900 dark:hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 md:w-2.5 md:h-2.5 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: isActive ? qLayer.colors[5] || qLayer.colors[3] : '#94a3b8',
                  }}
                />
                {t(qLayer.labelKey)}
              </div>
            </button>
            {showEditBtn && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCustomizeQuality!();
                }}
                className={`flex-shrink-0 p-1.5 rounded-lg transition-colors min-h-[44px] md:min-h-0 min-w-[32px] flex items-center justify-center ${
                  isCustomWeights
                    ? 'text-brand-500 dark:text-brand-400 hover:bg-brand-500/15'
                    : 'text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60'
                }`}
                title={t('custom_quality.button')}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </button>
            )}
          </div>
        );
      })()}
      {LAYER_GROUPS.map((group) => {
        const groupLayers = group.ids
          .map((id) => LAYERS.find((l) => l.id === id))
          .filter(Boolean)
          .filter((layer) => !searchQuery || t(layer!.labelKey).toLowerCase().includes(searchQuery));
        if (groupLayers.length === 0) return null;
        // PO-3: Auto-expand groups when searching
        const isCollapsed = searchQuery ? false : !!collapsed[group.labelKey];
        const hasActiveLayer = group.ids.includes(activeLayer);

        return (
          <div key={group.labelKey}>
            <button
              onClick={() => toggleGroup(group.labelKey)}
              className="w-full flex items-center justify-between px-3 pt-2 pb-1 group cursor-pointer min-h-[44px] md:min-h-0"
            >
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                hasActiveLayer && isCollapsed
                  ? 'text-brand-500 dark:text-brand-400'
                  : 'text-surface-400 dark:text-surface-500'
              }`}>
                {t(group.labelKey)}
              </span>
              <svg
                className={`w-3 h-3 text-surface-400 dark:text-surface-500 transition-transform duration-200 ${
                  isCollapsed ? '-rotate-90' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {!isCollapsed && groupLayers.map((layer) => {
              if (!layer) return null;
              const isActive = layer.id === activeLayer;
              const showEditBtn = layer.id === 'quality_index' && onCustomizeQuality;
              const flatIndex = visibleLayers.indexOf(layer.id);
              const isFocused = flatIndex === focusedIndex;
              return (
                <div key={layer.id} className="flex items-center gap-0.5" data-layer-index={flatIndex}>
                  <button
                    onClick={() => {
                      onLayerChange(layer.id);
                      setMobileOpen(false);
                    }}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    className={`flex-1 text-left px-3 py-2.5 md:py-1.5 rounded-lg text-sm transition-all duration-150 min-h-[44px] md:min-h-0 ${
                      isActive
                        ? 'bg-brand-500/15 dark:bg-brand-600/20 text-brand-600 dark:text-brand-300 font-medium'
                        : isFocused
                          ? 'bg-surface-200 dark:bg-surface-700/60 text-surface-900 dark:text-white ring-2 ring-brand-500/50'
                          : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60 hover:text-surface-900 dark:hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 md:w-2.5 md:h-2.5 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: isActive ? layer.colors[5] || layer.colors[3] : '#94a3b8',
                        }}
                      />
                      {t(layer.labelKey)}
                    </div>
                  </button>
                  {showEditBtn && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCustomizeQuality!();
                      }}
                      className={`flex-shrink-0 p-1.5 rounded-lg transition-colors min-h-[44px] md:min-h-0 min-w-[32px] flex items-center justify-center ${
                        isCustomWeights
                          ? 'text-brand-500 dark:text-brand-400 hover:bg-brand-500/15'
                          : 'text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60'
                      }`}
                      title={t('custom_quality.button')}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {/* Desktop: top-right dropdown */}
      <div className="hidden md:block absolute top-4 right-4 z-10 w-52 max-h-[80vh] overflow-y-auto">
        <div className="rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700/40">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {t('layers.title')}
            </h3>
          </div>
          {layerList}
        </div>
      </div>

      {/* Mobile: bottom-right FAB + swipe-up sheet */}
      <div className="md:hidden">
        {/* FAB trigger */}
        {!mobileOpen && (
          <button
            onClick={() => setMobileOpen(true)}
            className="fixed bottom-8 right-3 z-30 w-14 h-14 rounded-2xl
                       bg-white/95 dark:bg-surface-900/95 backdrop-blur-md
                       border border-surface-200 dark:border-surface-700/40
                       shadow-2xl flex items-center justify-center
                       active:scale-95 transition-transform"
            aria-label={t('layers.title')}
          >
            <div className="flex flex-col items-center gap-0.5">
              <svg className="w-5 h-5 text-surface-600 dark:text-surface-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span className="text-[8px] font-semibold uppercase text-surface-500 dark:text-surface-400 tracking-wider">
                {t('layers.title')}
              </span>
            </div>
          </button>
        )}

        {/* Backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/20 dark:bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sheet */}
        {mobileOpen && (
          <div
            ref={sheetRef}
            className="fixed bottom-0 left-0 right-0 z-40
                       bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                       border-t border-surface-200 dark:border-surface-800/50
                       shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl
                       max-h-[70vh] overflow-hidden"
            style={{
              transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
            }}
          >
            {/* Drag handle */}
            <div
              className="flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
              onTouchStart={sheetHandlers.onTouchStart}
              onTouchMove={sheetHandlers.onTouchMove}
              onTouchEnd={sheetHandlers.onTouchEnd}
            >
              <div className="w-10 h-1.5 rounded-full bg-surface-300 dark:bg-surface-600" />
            </div>

            <div className="px-4 py-2 border-b border-surface-200 dark:border-surface-700/40 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                {t('layers.title')}
              </h3>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-400"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto max-h-[calc(70vh-5rem)] pb-safe">
              {layerList}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
