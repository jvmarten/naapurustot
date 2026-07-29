import React, { useState, useRef, useEffect, useMemo } from 'react';
import { LAYER_MAP, type LayerId } from '../utils/colorScales';
import {
  getCoveragePct,
  isPartialCoverage,
  isLowCoverage,
  formatCoveragePct,
  getMetricSource,
  vintageFreshness,
} from '../utils/metrics';
import { t, useI18nVersion, type Lang } from '../utils/i18n';
import { useBottomSheet } from '../hooks/useBottomSheet';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useBackGesture } from '../hooks/useBackGesture';
import { fold } from '../utils/slug';

/**
 * EM-1: does a layer's translated label match the (already folded) search query?
 * Module-scope so the keyboard-nav flat list and the render path share one
 * definition — they must agree exactly, or arrow keys walk rows that aren't
 * rendered. Accent-folding both sides makes "vaesto"/"aanestys"/"ika" find the
 * ä/ö labels, matching SearchBar and CitySelector.
 */
const labelMatches = (labelKey: string, foldedQuery: string) =>
  !foldedQuery || fold(t(labelKey)).includes(foldedQuery);

interface LayerSelectorProps {
  activeLayer: LayerId;
  onLayerChange: (id: LayerId) => void;
  onCustomizeQuality?: () => void;
  isCustomWeights?: boolean;
  headerSlot?: React.ReactNode;
  /**
   * Mobile-only: kaavat & hankkeet overlay controls, folded into the top of the
   * Layers sheet. On desktop the planning toggle is its own floating panel
   * (App.tsx), so this slot is rendered only in the `md:hidden` mobile sheet to
   * avoid duplication. Null/undefined when the active region has no planning data.
   */
  planningSlot?: React.ReactNode;
  /** Pass current language to trigger re-render on language change */
  lang?: Lang;
  /** MO2: on mobile, suppress the FAB when a full-width panel covers it (desktop dropdown is unaffected). */
  hidden?: boolean;
}

type LayerGroup = {
  labelKey: string;
  ids: LayerId[];
};

const LAYER_GROUPS: LayerGroup[] = [
  { labelKey: 'layers.quality', ids: ['transit_access', 'transit_reachability', 'air_quality', 'walkability'] },
  { labelKey: 'layers.trends', ids: ['income_change', 'population_change', 'population_projection', 'unemployment_change', 'property_price_change', 'crime_index_change'] },
  { labelKey: 'layers.demographics', ids: ['avg_age', 'population_density', 'child_ratio', 'youth_ratio', 'elderly_ratio', 'gender_ratio', 'student_share', 'foreign_lang', 'foreign_lang_municipal', 'pensioners', 'single_person_hh', 'single_parent_hh', 'families_with_children', 'avg_household_size'] },
  { labelKey: 'layers.economy', ids: ['median_income', 'disposable_income', 'low_income', 'job_self_sufficiency', 'unemployment', 'employment_rate', 'education', 'property_price', 'tech_sector_jobs', 'healthcare_workers', 'manufacturing_jobs', 'public_sector_jobs', 'service_sector_jobs'] },
  { labelKey: 'layers.housing', ids: ['ownership', 'rental', 'apt_size', 'living_space', 'detached_houses', 'new_construction', 'construction_activity', 'active_plan_count', 'building_age', 'rental_price', 'price_to_rent'] },
  { labelKey: 'layers.services', ids: ['restaurant_density', 'grocery_access', 'daycare_density', 'school_density', 'healthcare_access', 'school_quality', 'sports_facilities'] },
  { labelKey: 'layers.safety', ids: ['violent_crime', 'property_crime', 'crime_rate', 'traffic_accidents'] },
  { labelKey: 'layers.mobility', ids: ['cycling_infra', 'ev_charging_density'] },
  { labelKey: 'layers.environment', ids: ['tree_canopy', 'water_proximity', 'light_pollution', 'noise_pollution', 'radon', 'flood_risk'] },
  { labelKey: 'layers.health', ids: ['health_index'] },
  { labelKey: 'layers.voting', ids: ['voter_turnout', 'party_diversity', 'political_lean', 'party_kok', 'party_sdp', 'party_ps', 'party_kesk', 'party_vihr', 'party_vas', 'party_rkp'] },
  { labelKey: 'layers.connectivity', ids: ['broadband_coverage'] },
];

/**
 * PO-2/PO-3: pre-click honesty signals on a layer row — surfaces sparse coverage,
 * municipal→postal proxies, and stale vintages BEFORE the user selects a layer and
 * watches the map turn mostly gray (e.g. transit ~6%, school quality ~10%). All three
 * derive from the existing build_metadata / data_sources helpers (zero new data).
 * Returns null when a layer is full-coverage, directly measured, and fresh, so the
 * common case stays visually clean. Caller must call useI18nVersion() (LayerSelector
 * does) so the t() titles re-render on a language switch.
 */
const LayerSignals: React.FC<{ property: string }> = ({ property }) => {
  const coverage = getCoveragePct(property);
  const partial = isPartialCoverage(property);
  const low = isLowCoverage(property);
  const src = getMetricSource(property);
  const proxy = src?.isProxy ?? false;
  const fresh = vintageFreshness(src?.year);
  const stale = fresh?.isStale ?? false;
  if (!partial && !proxy && !stale) return null;

  const coverageTitle =
    coverage != null
      ? t(low ? 'layer_signal.low_coverage' : 'layer_signal.partial_coverage').replace('{pct}', formatCoveragePct(coverage))
      : '';
  const staleTitle = fresh
    ? t('layer_signal.stale').replace('{year}', String(fresh.latest)).replace('{years}', String(fresh.yearsAgo))
    : '';

  return (
    <span className="ml-auto flex items-center gap-1 shrink-0 pl-1">
      {partial && coverage != null && (
        <span
          title={coverageTitle}
          aria-label={coverageTitle}
          className={`text-[9px] font-semibold tabular-nums px-1 py-px rounded ${
            low
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : 'bg-surface-200/70 dark:bg-surface-700/50 text-surface-500 dark:text-surface-400'
          }`}
        >
          {formatCoveragePct(coverage)}%
        </span>
      )}
      {proxy && (
        <span
          title={t('layer_signal.proxy')}
          aria-label={t('layer_signal.proxy')}
          className="text-[11px] leading-none font-semibold text-surface-500 dark:text-surface-400"
        >
          {'≈'}
        </span>
      )}
      {stale && fresh && (
        <span title={staleTitle} aria-label={staleTitle} className="text-amber-500/90 dark:text-amber-400/90 flex items-center">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>
      )}
    </span>
  );
};

export const LayerSelector: React.FC<LayerSelectorProps> = React.memo(({ activeLayer, onLayerChange, onCustomizeQuality, isCustomWeights = false, headerSlot, planningSlot, lang: _lang, hidden }) => {
  useI18nVersion();
  // M5: instant sheet snap when the user prefers reduced motion.
  const reducedMotion = useReducedMotion();
  // C4: collapse every group EXCEPT the one holding the active layer, so at
  // least one set of layers is visible on first paint (and users land near the
  // metric they're already viewing) instead of an all-collapsed wall of headers.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(LAYER_GROUPS.map((g) => [g.labelKey, !g.ids.includes(activeLayer)]))
  );
  // PO-3: Layer search filter
  const [layerSearch, setLayerSearch] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  // MO-3: make the mobile Layers sheet back-dismissable (Android Back / iOS edge-swipe),
  // matching the neighborhood/filter/ranking sheets — its only other dismissal was a
  // keyboard Escape, useless on touch.
  useBackGesture(mobileOpen, () => setMobileOpen(false));
  // C4: desktop panel starts expanded so the 59 layers are discoverable without
  // a first click into the minimized pill.
  const [minimized, setMinimized] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // QW-3: Unified bottom sheet drag behavior
  const { sheetHeight, isDragging, snap, cycleSnap, handlers: sheetHandlers } = useBottomSheet({
    initialSnap: 'half',
    halfRatio: 0.7,
    onClose: () => setMobileOpen(false),
  });

  const toggleGroup = (labelKey: string) => {
    setCollapsed((prev) => ({ ...prev, [labelKey]: !prev[labelKey] }));
  };

  // PO-2: Keyboard navigation
  const listRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // PO-3: normalized search query. Declared above visibleLayers because the
  // keyboard-nav flat list must mirror the render path's visibility rules.
  // EM-1: fold() (not toLowerCase) so "vaesto", "aanestys" and "ika" match the
  // Finnish labels containing ä/ö — SearchBar and CitySelector already do this,
  // and a plain lowercase compare made diacritic-free typing match nothing.
  const searchQuery = fold(layerSearch.trim());
  // EM-1: quality_index renders above the groups and belongs to none of them, so
  // the "nothing matched" check has to account for it separately.
  const qualityIndexLabelKey = LAYER_MAP.get('quality_index')?.labelKey;
  const qualityIndexMatches = !!qualityIndexLabelKey && labelMatches(qualityIndexLabelKey, searchQuery);

  // Build flat list of visible layer IDs for keyboard navigation. Mirrors the
  // render path exactly: groups force-expand while searching, and each id must
  // pass the same label-substring filter — otherwise arrow keys/Enter would walk
  // rows that aren't rendered (or skip rows that are) during an active search.
  const visibleLayers = useMemo(
    () =>
      LAYER_GROUPS.flatMap((group) => {
        const isCollapsed = searchQuery ? false : !!collapsed[group.labelKey];
        if (isCollapsed) return [];
        return group.ids.filter((id) => {
          const layer = LAYER_MAP.get(id);
          return layer ? labelMatches(layer.labelKey, searchQuery) : false;
        });
      }),
    [collapsed, searchQuery],
  );

  // Read frequently-changing values from refs to avoid re-registering
  // the keydown listener on every arrow key press or group expand/collapse.
  const focusedIndexRef = useRef(focusedIndex);
  const visibleLayersRef = useRef(visibleLayers);
  const onLayerChangeRef = useRef(onLayerChange);
  const mobileOpenRef = useRef(mobileOpen);
  useEffect(() => { focusedIndexRef.current = focusedIndex; }, [focusedIndex]);
  useEffect(() => { visibleLayersRef.current = visibleLayers; }, [visibleLayers]);
  useEffect(() => { onLayerChangeRef.current = onLayerChange; }, [onLayerChange]);
  useEffect(() => { mobileOpenRef.current = mobileOpen; }, [mobileOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!listRef.current?.contains(document.activeElement)) return;
      const vl = visibleLayersRef.current;
      const fi = focusedIndexRef.current;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, vl.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && fi >= 0 && fi < vl.length) {
        e.preventDefault();
        onLayerChangeRef.current(vl[fi]);
        setMobileOpen(false);
      } else if (e.key === 'Escape') {
        // Only consume Escape when the mobile sheet is actually open. stopPropagation
        // does NOT stop other listeners on the same target (window), so use
        // stopImmediatePropagation to keep the App-level Escape handler from also
        // firing on the same press (which would e.g. deselect a neighborhood).
        // On desktop the sheet is never open, so Escape falls through to App as before.
        if (mobileOpenRef.current) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setMobileOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // AY-1: scroll the focused item into view AND move real DOM focus to it, so a
  // screen reader announces each layer's name + aria-pressed while arrowing. A
  // visual-only ring (the old behavior) left the AT cursor stranded and 58/59
  // buttons were tabIndex=-1. focusedIndex only becomes ≥0 via arrow keys, so this
  // never steals focus when the panel merely opens.
  useEffect(() => {
    if (focusedIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-layer-index="${focusedIndex}"] button`);
    el?.scrollIntoView({ block: 'nearest' });
    el?.focus();
  }, [focusedIndex]);

  // AY-1: a filtered list renumbers the flat index, so drop the roving highlight
  // when the search query changes rather than leaving it on a now-wrong row.
  useEffect(() => { setFocusedIndex(-1); }, [searchQuery]);

  // A11y: a labelled group of toggle buttons, not a role="listbox" — the container
  // also holds a search input and collapsible group headers, which a listbox's
  // content model forbids (axe critical, surfaced once C4 made the panel default to
  // expanded). Arrow-key roving nav uses data-layer-index, so it's unaffected;
  // selection is conveyed via aria-pressed on each layer button.
  const layerList = (
    <div className="p-2 space-y-1" ref={listRef} role="group" aria-label={t('layers.title')}>
      {/* PO-3: Search input */}
      <div className="px-2 pb-2 relative">
        <input
          type="text"
          value={layerSearch}
          onChange={(e) => setLayerSearch(e.target.value)}
          placeholder={t('layers.search_placeholder')}
          className="w-full rounded-lg bg-surface-100 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700/40
                     px-3 pr-7 py-2 md:py-1.5 text-xs text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500
                     focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30"
        />
        {layerSearch && (
          <button
            onClick={() => setLayerSearch('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-surface-500 dark:text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700/60 transition-colors"
            aria-label={t('search.clear')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {/* Standalone quality index — always visible at the top */}
      {(() => {
        const qLayer = LAYER_MAP.get('quality_index');
        if (!qLayer) return null;
        if (!labelMatches(qLayer.labelKey, searchQuery)) return null;
        const isActive = qLayer.id === activeLayer;
        const showEditBtn = qLayer.id === 'quality_index' && onCustomizeQuality;
        return (
          <div className="flex items-center gap-0.5 mb-1">
            <button
              onClick={() => {
                onLayerChange(qLayer.id);
                setMobileOpen(false);
              }}
              aria-pressed={isActive}
              // Always Tab-reachable: quality_index is not part of any LAYER_GROUP,
              // so it is absent from the arrow-key flat list. Without tabIndex=0 it
              // is unreachable by keyboard whenever it is not the active layer.
              tabIndex={0}
              className={`flex-1 text-left px-3 py-2.5 md:py-1.5 rounded-lg text-sm transition-all duration-150 min-h-[44px] md:min-h-0 ${
                isActive
                  ? 'bg-brand-500/15 dark:bg-brand-600/20 text-brand-700 dark:text-brand-300 font-medium'
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
                className={`flex-shrink-0 ${isActive ? 'px-2' : 'p-1.5'} gap-1 rounded-lg transition-colors min-h-[44px] md:min-h-0 min-w-[32px] flex items-center justify-center ${
                  isCustomWeights
                    ? 'text-brand-600 dark:text-brand-400 hover:bg-brand-500/15'
                    : 'text-surface-500 dark:text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60'
                }`}
                title={t('custom_quality.button')}
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                {/* DX-5: surface the verb when QI is active, so the per-dimension weighting
                    tool isn't fronted by an unlabeled icon (matches the in-panel button). */}
                {isActive && <span className="text-[10px] font-semibold whitespace-nowrap">{t('custom_quality.button')}</span>}
              </button>
            )}
          </div>
        );
      })()}
      {LAYER_GROUPS.map((group) => {
        const groupLayers = group.ids
          .map((id) => LAYER_MAP.get(id))
          .filter(Boolean)
          .filter((layer) => labelMatches(layer!.labelKey, searchQuery));
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
                  ? 'text-brand-600 dark:text-brand-400'
                  : 'text-surface-500 dark:text-surface-400'
              }`}>
                {t(group.labelKey)}
              </span>
              <svg
                className={`w-3 h-3 text-surface-500 dark:text-surface-400 transition-transform duration-200 ${
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
              const flatIndex = visibleLayers.indexOf(layer.id);
              const isFocused = flatIndex === focusedIndex;
              return (
                <div key={layer.id} className="flex items-center gap-0.5" data-layer-index={flatIndex}>
                  <button
                    onClick={() => {
                      onLayerChange(layer.id);
                      setMobileOpen(false);
                    }}
                    aria-pressed={isActive}
                    // AY-1: roving tabindex — the keyboard-focused row (or the active
                    // layer when nothing is roving) is the single Tab stop.
                    tabIndex={flatIndex === focusedIndex || (focusedIndex < 0 && isActive) ? 0 : -1}
                    className={`flex-1 text-left px-3 py-2.5 md:py-1.5 rounded-lg text-sm transition-all duration-150 min-h-[44px] md:min-h-0 ${
                      isActive
                        ? 'bg-brand-500/15 dark:bg-brand-600/20 text-brand-700 dark:text-brand-300 font-medium'
                        : isFocused
                          ? 'bg-surface-200 dark:bg-surface-700/60 text-surface-900 dark:text-white ring-2 ring-brand-500/50'
                          : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60 hover:text-surface-900 dark:hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-3 h-3 md:w-2.5 md:h-2.5 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: isActive ? layer.colors[5] || layer.colors[3] : '#94a3b8',
                        }}
                      />
                      <span className="truncate min-w-0">{t(layer.labelKey)}</span>
                      <LayerSignals property={layer.property} />
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
      {/* EM-1: every group returns null when nothing matches, which rendered the
          panel body as pure empty space below the input — on mobile, a text box
          over blank white with no way to tell whether the query missed or the app
          broke. The clear-search X above is the escape hatch; this is the
          explanation. `visibleLayers` already mirrors the render path's filter,
          and quality_index is checked separately because it sits outside every
          LAYER_GROUP. */}
      {searchQuery && visibleLayers.length === 0 && !qualityIndexMatches && (
        <div className="px-3 py-6 text-center" role="status">
          <p className="text-xs text-surface-500 dark:text-surface-400">
            {t('layers.no_matches').replace('{query}', layerSearch.trim())}
          </p>
          <button
            onClick={() => setLayerSearch('')}
            className="mt-2 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline min-h-[44px] md:min-h-0"
          >
            {t('layers.clear_search')}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop: top-right dropdown */}
      {/* pointer-events-none on the wrapper lets map drags pass through the empty
          area below the (short) headerSlot down to the (tall) panel's height —
          the two real children opt back in via pointer-events-auto. */}
      <div data-tour-id="layers" className={`hidden md:flex items-start gap-1.5 absolute top-[3.5rem] right-4 z-10 pointer-events-none ${minimized ? 'w-auto' : ''}`}>
        {headerSlot}
        <div className={`pointer-events-auto rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden ${minimized ? 'w-auto' : 'w-52 max-h-[80vh] overflow-y-auto'}`}>
          <button
            onClick={() => setMinimized((prev) => !prev)}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 cursor-pointer hover:bg-surface-100/50 dark:hover:bg-surface-800/30 transition-colors"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {t('layers.title')}
            </h3>
            <svg
              className={`w-3 h-3 text-surface-500 dark:text-surface-400 transition-transform duration-200 ${minimized ? '-rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!minimized && layerList}
        </div>
      </div>

      {/* Mobile: bottom-right FAB + swipe-up sheet */}
      <div className="md:hidden">
        {/* FAB trigger — MO2: also suppressed when a full-width panel covers it */}
        {!mobileOpen && !hidden && (
          <button
            data-tour-id="layers"
            onClick={() => setMobileOpen(true)}
            className="fixed bottom-[calc(2rem+env(safe-area-inset-bottom))] right-3 z-30 w-14 h-14 rounded-2xl
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

        {/* Backdrop — hidden in peek mode so the map stays interactive */}
        {mobileOpen && snap !== 'peek' && (
          <div
            className="fixed inset-0 z-30 bg-black/20 dark:bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sheet */}
        {mobileOpen && (
          <div
            ref={sheetRef}
            role="dialog"
            aria-label={t('layers.title')}
            className="fixed bottom-0 left-0 right-0 z-40
                       bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                       border-t border-surface-200 dark:border-surface-800/50
                       shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl
                       flex flex-col overflow-hidden"
            style={{
              height: `${sheetHeight}px`,
              transition: (isDragging || reducedMotion) ? 'none' : 'height 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
            }}
          >
            {/* Drag handle */}
            <button
              type="button"
              onClick={cycleSnap}
              aria-expanded={snap !== 'peek'}
              aria-label={t('aria.expand_sheet')}
              className="flex w-full items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 rounded-t-2xl"
              onTouchStart={sheetHandlers.onTouchStart}
              onTouchMove={sheetHandlers.onTouchMove}
              onTouchEnd={sheetHandlers.onTouchEnd}
              onTouchCancel={sheetHandlers.onTouchCancel}
            >
              <div className="w-10 h-1.5 rounded-full bg-surface-300 dark:bg-surface-600" />
            </button>

            <div className="px-4 py-2 border-b border-surface-200 dark:border-surface-700/40 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                {t('layers.title')}
              </h3>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-400"
                aria-label={t('aria.close')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 pb-safe">
              {/* kaavat & hankkeet overlay — mobile equivalent of the desktop
                  floating PlanningControls panel; only present for regions that
                  have planning geometry. Sits above the layer list so it's
                  discoverable on open rather than buried under 59 layers. */}
              {planningSlot && (
                <div className="px-3 pt-3 pb-1 border-b border-surface-200 dark:border-surface-800/50">
                  {planningSlot}
                </div>
              )}
              {layerList}
            </div>
          </div>
        )}
      </div>
    </>
  );
});
