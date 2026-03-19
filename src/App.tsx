import React, { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Map, DEFAULT_CENTER, DEFAULT_ZOOM } from './components/Map';
import { LayerSelector } from './components/LayerSelector';
import { SearchBar } from './components/SearchBar';
import { Tooltip } from './components/Tooltip';
import { Legend } from './components/Legend';
import { SettingsDropdown } from './components/SettingsDropdown';
import { ToolsDropdown } from './components/ToolsDropdown';
import { ErrorBanner } from './components/ErrorBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { computeMatchingPnos, type FilterCriterion } from './components/FilterPanel';
import { useFilterPresets } from './hooks/useFilterPresets';

// IN-6: Lazy load heavy conditionally-rendered components
const NeighborhoodPanel = lazy(() => import('./components/NeighborhoodPanel').then(m => ({ default: m.NeighborhoodPanel })));
const ComparisonPanel = lazy(() => import('./components/ComparisonPanel').then(m => ({ default: m.ComparisonPanel })));
const RankingTable = lazy(() => import('./components/RankingTable').then(m => ({ default: m.RankingTable })));
const FilterPanel = lazy(() => import('./components/FilterPanel').then(m => ({ default: m.FilterPanel })));
const CustomQualityPanel = lazy(() => import('./components/CustomQualityPanel').then(m => ({ default: m.CustomQualityPanel })));
const NeighborhoodWizard = lazy(() => import('./components/NeighborhoodWizard').then(m => ({ default: m.NeighborhoodWizard })));
const SplitMapView = lazy(() => import('./components/SplitMapView').then(m => ({ default: m.SplitMapView })));
import { bbox } from '@turf/turf';
import { useMapData } from './hooks/useMapData';
import { useFavorites } from './hooks/useFavorites';
import { useNotes } from './hooks/useNotes';
import { useRecentNeighborhoods } from './hooks/useRecentNeighborhoods';
import { useSelectedNeighborhood } from './hooks/useSelectedNeighborhood';
import { type LayerId, type ColorblindType, getLayerById, getColorblindMode, setColorblindMode } from './utils/colorScales';
import { readInitialUrlState, useSyncUrlState } from './hooks/useUrlState';
import type { NeighborhoodProperties } from './utils/metrics';
import { t, getLang, setLang, type Lang } from './utils/i18n';
import { computeQualityIndices, getDefaultWeights, isCustomWeights, type QualityWeights } from './utils/qualityIndex';

const initialUrl = readInitialUrlState();

const App: React.FC = () => {
  const { data, loading, error, metroAverages, retry } = useMapData();
  const { selected, select, deselect, pinned, pin, unpin, clearPinned } = useSelectedNeighborhood();
  const [activeLayer, setActiveLayer] = useState<LayerId>(initialUrl.layer ?? 'quality_index');
  const [wizardResultPnos, setWizardResultPnos] = useState<string[]>([]);
  const [tooltip, setTooltip] = useState<{
    props: NeighborhoodProperties;
    x: number;
    y: number;
  } | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ center: [number, number]; zoom?: number; bounds?: [number, number, number, number] } | null>(null);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [showRanking, setShowRanking] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showCustomQuality, setShowCustomQuality] = useState(false);
  const [filters, setFilters] = useState<FilterCriterion[]>([]);
  const [qualityWeights, setQualityWeights] = useState<QualityWeights>(getDefaultWeights);
  const [colorblind, setColorblind] = useState(getColorblindMode);
  const [showWizard, setShowWizard] = useState(false);
  const { presets: savedPresets, addPreset: saveFilterPreset, removePreset: removeFilterPreset } = useFilterPresets();
  const [fillOpacity, setFillOpacity] = useState(() => {
    try {
      const saved = localStorage.getItem('naapurustot-fill-opacity');
      return saved !== null ? Number(saved) : 1;
    } catch { return 1; }
  });
  // QW-4: Split map view state
  const [splitMode, setSplitMode] = useState(false);
  const [secondaryLayer] = useState<LayerId>('median_income');
  const { isFavorite, toggleFavorite } = useFavorites();
  const { getNote, setNote } = useNotes();
  const { recent, addRecent } = useRecentNeighborhoods();
  const restoredPno = useRef(false);
  // Monotonic version counter to force re-renders when quality indices change
  const [qualityVersion, setQualityVersion] = useState(0);
  const [ariaAnnouncement, setAriaAnnouncement] = useState('');
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  // Restore neighborhood selection and pinned comparisons from URL once data is loaded
  useEffect(() => {
    if (!data || restoredPno.current) return;
    restoredPno.current = true;
    if (initialUrl.pno) {
      const feature = data.features.find((f) => f.properties?.pno === initialUrl.pno);
      if (feature?.properties) {
        select(feature.properties as NeighborhoodProperties);
      }
    }
    // QW-3: Restore pinned comparisons from URL
    if (initialUrl.compare && initialUrl.compare.length > 0) {
      for (const pno of initialUrl.compare) {
        const feature = data.features.find((f) => f.properties?.pno === pno);
        if (feature?.properties) {
          pin(feature.properties as NeighborhoodProperties);
        }
      }
    }
  }, [data, select, pin]);

  // Keep URL in sync with current state (including pinned comparisons)
  useSyncUrlState(selected?.pno ?? null, activeLayer, pinned.map((p) => p.pno));

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
      if (data) {
        const feature = data.features.find((f) => f.properties?.pno === pno);
        if (feature?.properties) {
          const props = feature.properties as NeighborhoodProperties;
          select(props);
          addRecent({ pno: props.pno, name: props.nimi || props.pno, center });
          // Use feature bounding box for better zoom fit
          if (feature.geometry) {
            const [minLng, minLat, maxLng, maxLat] = bbox(feature);
            setFlyTarget({ center, bounds: [minLng, minLat, maxLng, maxLat] });
          } else {
            setFlyTarget({ center });
          }
        } else {
          setFlyTarget({ center });
        }
      } else {
        setFlyTarget({ center });
      }
    },
    [data, select, addRecent],
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

  const handleColorblindChange = useCallback((mode: ColorblindType) => {
    setColorblindMode(mode);
    setColorblind(mode);
  }, []);

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

  // IN-5: Dynamic SEO — update document title, meta, and canonical when neighborhood selected
  useEffect(() => {
    const canonical = document.querySelector('link[rel="canonical"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (selected) {
      const qi = selected.quality_index != null ? ` — ${t('panel.quality_index')}: ${selected.quality_index}` : '';
      document.title = `${selected.nimi} (${selected.pno})${qi} | naapurustot.fi`;
      const desc = document.querySelector('meta[name="description"]');
      if (desc) {
        desc.setAttribute('content',
          lang === 'fi'
            ? `${selected.nimi} (${selected.pno}): mediaanitulo, työttömyys, asuntohinnat, palvelut ja 35+ mittaria Helsingin seudun asuinalueen vertailuun.`
            : `${selected.nimi} (${selected.pno}): median income, unemployment, property prices, services and 35+ metrics for Helsinki metro neighborhood comparison.`
        );
      }
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.setAttribute('content', `${selected.nimi} — naapurustot.fi`);
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute('content', `${selected.nimi} (${selected.pno}) — ${t('panel.quality_index')}: ${selected.quality_index ?? '—'}`);
      const pnoUrl = `https://naapurustot.fi/?pno=${selected.pno}`;
      if (canonical) canonical.setAttribute('href', pnoUrl);
      if (ogUrl) ogUrl.setAttribute('content', pnoUrl);
    } else {
      document.title = 'naapurustot — Helsingin seudun naapurustot kartalla | naapurustot.fi';
      const desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute('content', 'naapurustot.fi — vertaile Helsingin, Espoon ja Vantaan naapurustoja ja asuinalueita 35+ mittarilla. Tulotaso, asuntohinnat, palvelut, turvallisuus, joukkoliikenne ja paljon muuta interaktiivisella kartalla.');
      if (canonical) canonical.setAttribute('href', 'https://naapurustot.fi/');
      if (ogUrl) ogUrl.setAttribute('content', 'https://naapurustot.fi/');
    }
  }, [selected, lang]);

  // Dynamic HTML lang attribute for SEO
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // ARIA: announce layer changes
  useEffect(() => {
    const layer = getLayerById(activeLayer);
    setAriaAnnouncement(`${t('aria.layer_changed')} ${t(layer.labelKey)}`);
  }, [activeLayer]);

  // IN-6: Reactive offline detection
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

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
      {/* Map — QW-4: Conditional split view */}
      <ErrorBoundary>
        {splitMode ? (
          <Suspense fallback={null}>
            <SplitMapView
              data={data}
              leftLayer={activeLayer}
              rightLayer={secondaryLayer}
              colorblind={colorblind}
            />
          </Suspense>
        ) : (
          <Map
            data={data}
            activeLayer={activeLayer}
            onHover={handleHover}
            onClick={handleClick}
            flyTo={flyTarget}
            selectedPno={selected?.pno ?? null}
            pinnedPnos={pinned.map((p) => p.pno)}
            filterActive={showFilter && filters.length > 0}
            filterMatchPnos={filterMatchPnos}
            qualityVersion={qualityVersion}
            colorblind={colorblind}
            wizardHighlightPnos={wizardResultPnos}
            fillOpacity={fillOpacity}
          />
        )}
      </ErrorBoundary>

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
            <h1 className="text-xl font-display font-bold text-surface-900 dark:text-white">naapurustot</h1>
            <p className="text-surface-500 dark:text-surface-400 text-sm">{t('loading.title')}</p>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && <ErrorBanner message={error} onRetry={retry} />}

      {/* Brand mark — double-click to reset view, hidden on mobile to avoid overlap */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 hidden md:block">
        <button
          onDoubleClick={handleResetView}
          className="cursor-pointer bg-transparent border-none"
          title={t('map.reset_view')}
        >
          <h1 className="text-lg font-display font-bold text-surface-800/90 dark:text-white/90 tracking-tight">
            naapurustot<span className="text-brand-500 dark:text-brand-400">.fi</span>
          </h1>
        </button>
      </div>

      {/* Top-right controls — two dropdown menus */}
      <div className="absolute top-3 md:top-4 right-3 md:right-[17rem] z-10 flex items-center gap-2">
        <ToolsDropdown
          showFilter={showFilter}
          showRanking={showRanking}
          onToggleFilter={toggleFilter}
          onToggleRanking={toggleRanking}
          onOpenWizard={() => setShowWizard(true)}
          wizardHighlightActive={wizardResultPnos.length > 0}
          onClearWizardHighlight={() => setWizardResultPnos([])}
          splitMode={splitMode}
          onToggleSplitMode={() => setSplitMode((v) => !v)}
        />
        <SettingsDropdown
          colorblind={colorblind}
          onColorblindChange={handleColorblindChange}
          lang={lang}
          onToggleLang={toggleLang}
          fillOpacity={fillOpacity}
          onFillOpacityChange={(v: number) => { try { localStorage.setItem('naapurustot-fill-opacity', String(v)); } catch { /* unavailable */ } setFillOpacity(v); }}
        />
      </div>

      {/* Search */}
      <SearchBar data={data} onSelect={handleSearch} recent={recent} />

      {/* Ranking table */}
      {showRanking && (
        <Suspense fallback={null}>
          <RankingTable
            data={data}
            activeLayer={activeLayer}
            onSelect={handleSearch}
            onClose={() => setShowRanking(false)}
          />
        </Suspense>
      )}

      {/* Filter panel */}
      {showFilter && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <FilterPanel
              data={data}
              filters={filters}
              onFiltersChange={setFilters}
              onSelect={handleSearch}
              onClose={() => setShowFilter(false)}
              savedPresets={savedPresets}
              onSavePreset={saveFilterPreset}
              onRemovePreset={removeFilterPreset}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Layer selector */}
      <LayerSelector
        activeLayer={activeLayer}
        onLayerChange={setActiveLayer}
        onCustomizeQuality={() => setShowCustomQuality((v) => !v)}
        isCustomWeights={isCustomWeights(qualityWeights)}
      />

      {/* Legend — repositioned for mobile */}
      <Legend layerId={activeLayer} colorblind={colorblind} />

      {/* Tooltip — hidden on touch devices via CSS */}
      {tooltip && !selected && (
        <Tooltip
          x={tooltip.x}
          y={tooltip.y}
          name={tooltip.props.nimi || tooltip.props.pno}
          value={tooltip.props[getLayerById(activeLayer).property] as number | null}
          layerId={activeLayer}
          metroAverage={metroAverages[getLayerById(activeLayer).property]}
        />
      )}

      {/* Custom quality sliders panel */}
      {showCustomQuality && (
        <Suspense fallback={null}>
          <CustomQualityPanel
            weights={qualityWeights}
            onChange={handleQualityWeightsChange}
            onClose={() => setShowCustomQuality(false)}
          />
        </Suspense>
      )}

      {/* Neighborhood detail panel */}
      {selected && (
        <ErrorBoundary>
          <Suspense fallback={null}>
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
            note={getNote(selected.pno)}
            onNoteChange={(text) => setNote(selected.pno, text)}
          />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Neighborhood wizard */}
      {showWizard && (
        <Suspense fallback={null}>
        <NeighborhoodWizard
          data={data}
          onSelect={handleSearch}
          onClose={() => setShowWizard(false)}
          onShowOnMap={(pnos) => {
            setWizardResultPnos(pnos);
            setShowWizard(false);
          }}
        />
        </Suspense>
      )}

      {/* Comparison panel */}
      <Suspense fallback={null}>
        <ComparisonPanel pinned={pinned} onUnpin={unpin} onClear={clearPinned} />
      </Suspense>

      {/* IN-6: Offline indicator */}
      {isOffline && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg
                       bg-amber-500/90 text-white text-xs font-medium backdrop-blur-sm">
          {t('offline.indicator')}
        </div>
      )}

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
