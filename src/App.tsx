import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Map, DEFAULT_CENTER, DEFAULT_ZOOM } from './components/Map';
import { LayerSelector } from './components/LayerSelector';
import { NeighborhoodPanel } from './components/NeighborhoodPanel';
import { ComparisonPanel } from './components/ComparisonPanel';
import { SearchBar } from './components/SearchBar';
import { Tooltip } from './components/Tooltip';
import { Legend } from './components/Legend';
import { ThemeToggle } from './components/ThemeToggle';
import { DonateButton } from './components/DonateButton';
import { ErrorBanner } from './components/ErrorBanner';
import { RankingTable } from './components/RankingTable';
import { FilterPanel, computeMatchingPnos, type FilterCriterion } from './components/FilterPanel';
import { CustomQualityPanel } from './components/CustomQualityPanel';
import { NeighborhoodWizard } from './components/NeighborhoodWizard';
import { useMapData } from './hooks/useMapData';
import { useFavorites } from './hooks/useFavorites';
import { useSelectedNeighborhood } from './hooks/useSelectedNeighborhood';
import { type LayerId, getLayerById, getColorblindMode, setColorblindMode } from './utils/colorScales';
import { readInitialUrlState, useSyncUrlState } from './hooks/useUrlState';
import type { NeighborhoodProperties } from './utils/metrics';
import { t, getLang, setLang, type Lang } from './utils/i18n';
import { computeQualityIndices, getDefaultWeights, isCustomWeights, type QualityWeights } from './utils/qualityIndex';

const initialUrl = readInitialUrlState();

const App: React.FC = () => {
  const { data, loading, error, metroAverages, retry } = useMapData();
  const { selected, select, deselect, pinned, pin, unpin, clearPinned } = useSelectedNeighborhood();
  const [activeLayer, setActiveLayer] = useState<LayerId>(initialUrl.layer ?? 'quality_index');
  const [tooltip, setTooltip] = useState<{
    props: NeighborhoodProperties;
    x: number;
    y: number;
  } | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ center: [number, number]; zoom?: number } | null>(null);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [showRanking, setShowRanking] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showCustomQuality, setShowCustomQuality] = useState(false);
  const [filters, setFilters] = useState<FilterCriterion[]>([]);
  const [qualityWeights, setQualityWeights] = useState<QualityWeights>(getDefaultWeights);
  const [colorblind, setColorblind] = useState(getColorblindMode);
  const [showWizard, setShowWizard] = useState(false);
  const { isFavorite, toggleFavorite } = useFavorites();
  const restoredPno = useRef(false);
  // Monotonic version counter to force re-renders when quality indices change
  const [qualityVersion, setQualityVersion] = useState(0);
  const [ariaAnnouncement, setAriaAnnouncement] = useState('');

  // Restore neighborhood selection from URL once data is loaded
  useEffect(() => {
    if (!data || restoredPno.current || !initialUrl.pno) return;
    restoredPno.current = true;
    const feature = data.features.find((f) => f.properties?.pno === initialUrl.pno);
    if (feature?.properties) {
      select(feature.properties as NeighborhoodProperties);
    }
  }, [data, select]);

  // Keep URL in sync with current state
  useSyncUrlState(selected?.pno ?? null, activeLayer);

  // Recompute quality indices when custom weights change
  const handleQualityWeightsChange = useCallback(
    (newWeights: QualityWeights) => {
      setQualityWeights(newWeights);
      if (data) {
        computeQualityIndices(data.features, newWeights);
        setQualityVersion((v) => v + 1);
        // Update selected neighborhood if it exists
        if (selected) {
          const feature = data.features.find((f) => f.properties?.pno === selected.pno);
          if (feature?.properties) {
            select(feature.properties as NeighborhoodProperties);
          }
        }
      }
    },
    [data, selected, select],
  );

  const handleHover = useCallback(
    (props: NeighborhoodProperties | null, x: number, y: number) => {
      if (props) {
        setTooltip({ props, x, y });
      } else {
        setTooltip(null);
      }
    },
    [],
  );

  const handleClick = useCallback(
    (props: NeighborhoodProperties) => {
      select(props);
      setAriaAnnouncement(`${t('aria.neighborhood_selected')}: ${props.nimi}`);
    },
    [select],
  );

  const handleSearch = useCallback(
    (pno: string, center: [number, number]) => {
      setFlyTarget({ center });
      if (data) {
        const feature = data.features.find((f) => f.properties?.pno === pno);
        if (feature?.properties) {
          select(feature.properties as NeighborhoodProperties);
        }
      }
    },
    [data, select],
  );

  const handleResetView = useCallback(() => {
    deselect();
    setFlyTarget({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
  }, [deselect]);

  const toggleLang = useCallback(() => {
    const next = lang === 'fi' ? 'en' : 'fi';
    setLang(next);
    setLangState(next);
  }, [lang]);

  const toggleColorblind = useCallback(() => {
    const next = !colorblind;
    setColorblindMode(next);
    setColorblind(next);
  }, [colorblind]);

  // Compute matching neighborhood PNOs for filter-aware map rendering
  const filterMatchPnos = useMemo(
    () => (showFilter ? computeMatchingPnos(data, filters) : new Set<string>()),
    [data, filters, showFilter],
  );

  // Close ranking when opening filter and vice versa
  const toggleFilter = useCallback(() => {
    setShowFilter((v) => {
      if (!v) setShowRanking(false);
      return !v;
    });
  }, []);

  const toggleRanking = useCallback(() => {
    setShowRanking((v) => {
      if (!v) setShowFilter(false);
      return !v;
    });
  }, []);

  // IN-5: Dynamic SEO — update document title and meta when neighborhood selected
  useEffect(() => {
    if (selected) {
      const qi = selected.quality_index != null ? ` — ${t('panel.quality_index')}: ${selected.quality_index}` : '';
      document.title = `${selected.nimi} (${selected.pno})${qi} | Naapurustot.fi`;
      const desc = document.querySelector('meta[name="description"]');
      if (desc) {
        desc.setAttribute('content',
          lang === 'fi'
            ? `${selected.nimi} (${selected.pno}): mediaanitulo, työttömyys, asuntohinnat, palvelut ja 35+ mittaria Helsingin seudun asuinalueen vertailuun.`
            : `${selected.nimi} (${selected.pno}): median income, unemployment, property prices, services and 35+ metrics for Helsinki metro neighborhood comparison.`
        );
      }
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.setAttribute('content', `${selected.nimi} — Naapurustot.fi`);
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute('content', `${selected.nimi} (${selected.pno}) — ${t('panel.quality_index')}: ${selected.quality_index ?? '—'}`);
    } else {
      document.title = 'Naapurustot.fi — Helsinki Metro Neighborhood Explorer';
      const desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute('content', 'Vertaile Helsingin seudun asuinalueita 35+ mittarilla: tulotaso, asuntohinnat, palvelut, joukkoliikenne, turvallisuus ja paljon muuta.');
    }
  }, [selected, lang]);

  // ARIA: announce layer changes
  useEffect(() => {
    const layer = getLayerById(activeLayer);
    setAriaAnnouncement(`${t('aria.layer_changed')} ${t(layer.labelKey)}`);
  }, [activeLayer]);

  // QW-4: Escape to close topmost panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showWizard) { setShowWizard(false); return; }
      if (selected) { deselect(); return; }
      if (showCustomQuality) { setShowCustomQuality(false); return; }
      if (showFilter) { setShowFilter(false); return; }
      if (showRanking) { setShowRanking(false); return; }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, showCustomQuality, showFilter, showRanking, showWizard, deselect]);

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      {/* Map */}
      <Map
        data={data}
        activeLayer={activeLayer}
        onHover={handleHover}
        onClick={handleClick}
        flyTo={flyTarget}
        pinnedPnos={pinned.map((p) => p.pno)}
        filterActive={showFilter && filters.length > 0}
        filterMatchPnos={filterMatchPnos}
        qualityVersion={qualityVersion}
      />

      {/* Skeleton / shimmer loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-surface-950/80 backdrop-blur-sm">
          <div className="text-center space-y-4">
            {/* Shimmer placeholder blocks */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-48 h-5 rounded-md bg-surface-200 dark:bg-surface-700 animate-pulse" />
              <div className="w-32 h-3 rounded-md bg-surface-200 dark:bg-surface-700 animate-pulse" />
              <div className="w-10 h-10 rounded-full bg-surface-200 dark:bg-surface-700 animate-pulse mt-2" />
            </div>
            <h1 className="text-xl font-display font-bold text-surface-900 dark:text-white">Naapurustot</h1>
            <p className="text-surface-500 dark:text-surface-400 text-sm">{t('loading.title')}</p>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && <ErrorBanner message={error} onRetry={retry} />}

      {/* Brand mark — double-click to reset view */}
      <div className="absolute top-3 md:top-4 left-1/2 -translate-x-1/2 z-10">
        <button
          onDoubleClick={handleResetView}
          className="cursor-pointer bg-transparent border-none"
          title={t('map.reset_view')}
        >
          <h1 className="text-base md:text-lg font-display font-bold text-surface-800/90 dark:text-white/90 tracking-tight">
            naapurustot<span className="text-brand-500 dark:text-brand-400">.fi</span>
          </h1>
        </button>
      </div>

      {/* Top-right controls — flex row to prevent mobile overlap */}
      <div className="absolute top-3 md:top-4 right-3 md:right-[17rem] z-10 flex items-center gap-1.5">
        {/* Wizard toggle */}
        <button
          onClick={() => setShowWizard(true)}
          className="flex px-3 py-2.5 rounded-xl backdrop-blur-md
                     border shadow-2xl text-xs font-semibold transition-all items-center justify-center
                     min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                     bg-white/90 dark:bg-surface-900/90 border-surface-200 dark:border-surface-700/40 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white hover:bg-white dark:hover:bg-surface-800/80"
          aria-label={t('wizard.open')}
          title={t('wizard.open')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </button>
        {/* Filter toggle */}
        <button
          onClick={toggleFilter}
          className={`flex px-3 py-2.5 rounded-xl backdrop-blur-md
                     border shadow-2xl text-xs font-semibold transition-all items-center justify-center
                     min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                     ${showFilter
                       ? 'bg-brand-500/15 dark:bg-brand-600/20 border-brand-500/30 dark:border-brand-500/30 text-brand-600 dark:text-brand-300'
                       : 'bg-white/90 dark:bg-surface-900/90 border-surface-200 dark:border-surface-700/40 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white hover:bg-white dark:hover:bg-surface-800/80'
                     }`}
          aria-label={t('filter.toggle')}
          title={t('filter.toggle')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
        </button>
        {/* Ranking toggle */}
        <button
          onClick={toggleRanking}
          className={`flex px-3 py-2.5 rounded-xl backdrop-blur-md
                     border shadow-2xl text-xs font-semibold transition-all items-center justify-center
                     min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                     ${showRanking
                       ? 'bg-brand-500/15 dark:bg-brand-600/20 border-brand-500/30 dark:border-brand-500/30 text-brand-600 dark:text-brand-300'
                       : 'bg-white/90 dark:bg-surface-900/90 border-surface-200 dark:border-surface-700/40 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white hover:bg-white dark:hover:bg-surface-800/80'
                     }`}
          aria-label={t('ranking.toggle')}
          title={t('ranking.toggle')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9M3 12h5m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
        </button>
        {/* Colorblind mode toggle */}
        <button
          onClick={toggleColorblind}
          className={`flex px-3 py-2.5 rounded-xl backdrop-blur-md
                     border shadow-2xl text-xs font-semibold transition-all items-center justify-center
                     min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                     ${colorblind
                       ? 'bg-brand-500/15 dark:bg-brand-600/20 border-brand-500/30 dark:border-brand-500/30 text-brand-600 dark:text-brand-300'
                       : 'bg-white/90 dark:bg-surface-900/90 border-surface-200 dark:border-surface-700/40 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white hover:bg-white dark:hover:bg-surface-800/80'
                     }`}
          aria-label={t('settings.colorblind')}
          title={t('settings.colorblind')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>
        <span className="hidden md:contents"><DonateButton /></span>
        <ThemeToggle />
        <button
          onClick={toggleLang}
          className="px-3 py-2 md:py-1.5 rounded-lg bg-white/90 dark:bg-surface-900/90 backdrop-blur-md
                     border border-surface-200 dark:border-surface-700/40 text-xs font-semibold text-surface-600 dark:text-surface-300
                     hover:text-surface-900 dark:hover:text-white hover:bg-white dark:hover:bg-surface-800/80
                     transition-all shadow-lg uppercase tracking-wider min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                     flex items-center justify-center"
        >
          {lang === 'fi' ? 'EN' : 'FI'}
        </button>
      </div>

      {/* Search */}
      <SearchBar data={data} onSelect={handleSearch} />

      {/* Ranking table */}
      {showRanking && (
        <RankingTable
          data={data}
          activeLayer={activeLayer}
          onSelect={handleSearch}
          onClose={() => setShowRanking(false)}
        />
      )}

      {/* Filter panel */}
      {showFilter && (
        <FilterPanel
          data={data}
          filters={filters}
          onFiltersChange={setFilters}
          onSelect={handleSearch}
          onClose={() => setShowFilter(false)}
        />
      )}

      {/* Layer selector */}
      <LayerSelector
        activeLayer={activeLayer}
        onLayerChange={setActiveLayer}
        onCustomizeQuality={() => setShowCustomQuality((v) => !v)}
        isCustomWeights={isCustomWeights(qualityWeights)}
      />

      {/* Legend — repositioned for mobile */}
      <Legend layerId={activeLayer} />

      {/* Tooltip — hidden on touch devices via CSS */}
      {tooltip && !selected && (
        <Tooltip
          x={tooltip.x}
          y={tooltip.y}
          name={tooltip.props.nimi || tooltip.props.pno}
          value={tooltip.props[getLayerById(activeLayer).property] as number | null}
          layerId={activeLayer}
        />
      )}

      {/* Custom quality sliders panel */}
      {showCustomQuality && (
        <CustomQualityPanel
          weights={qualityWeights}
          onChange={handleQualityWeightsChange}
          onClose={() => setShowCustomQuality(false)}
        />
      )}

      {/* Neighborhood detail panel */}
      {selected && (
        <NeighborhoodPanel
          data={selected}
          metroAverages={metroAverages}
          onClose={deselect}
          onPin={pin}
          onUnpin={unpin}
          isPinned={pinned.some((p) => p.pno === selected.pno)}
          pinCount={pinned.length}
          onCustomize={() => setShowCustomQuality((v) => !v)}
          isCustomWeights={isCustomWeights(qualityWeights)}
          allFeatures={data?.features}
          onFlyTo={(center) => setFlyTarget({ center })}
          isFavorite={isFavorite(selected.pno)}
          onToggleFavorite={() => toggleFavorite(selected.pno)}
        />
      )}

      {/* Neighborhood wizard */}
      {showWizard && (
        <NeighborhoodWizard
          data={data}
          onSelect={handleSearch}
          onClose={() => setShowWizard(false)}
        />
      )}

      {/* Comparison panel */}
      <ComparisonPanel pinned={pinned} onUnpin={unpin} onClear={clearPinned} />

      {/* Attribution footer */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 hidden md:block">
        <p className="text-[10px] text-surface-600/70 dark:text-surface-500/70">{t('footer.attribution')}</p>
      </div>

      {/* ARIA live region for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {ariaAnnouncement}
      </div>
    </div>
  );
};

export default App;
