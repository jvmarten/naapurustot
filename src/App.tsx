import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Map, DEFAULT_CENTER, DEFAULT_ZOOM } from './components/Map';
import { LayerSelector } from './components/LayerSelector';
import { NeighborhoodPanel } from './components/NeighborhoodPanel';
import { ComparisonPanel } from './components/ComparisonPanel';
import { SearchBar } from './components/SearchBar';
import { Tooltip } from './components/Tooltip';
import { Legend } from './components/Legend';
import { SettingsDropdown } from './components/SettingsDropdown';
import { ToolsDropdown } from './components/ToolsDropdown';
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
      document.title = 'Naapurustot — Helsingin seudun naapurustot kartalla | Naapurustot.fi';
      const desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute('content', 'Naapurustot.fi — vertaile Helsingin, Espoon ja Vantaan naapurustoja ja asuinalueita 35+ mittarilla. Tulotaso, asuntohinnat, palvelut, turvallisuus, joukkoliikenne ja paljon muuta interaktiivisella kartalla.');
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

      {/* Top-right controls — two dropdown menus */}
      <div className="absolute top-3 md:top-4 right-3 md:right-[17rem] z-10 flex items-center gap-1.5">
        <ToolsDropdown
          showFilter={showFilter}
          showRanking={showRanking}
          onToggleFilter={toggleFilter}
          onToggleRanking={toggleRanking}
          onOpenWizard={() => setShowWizard(true)}
        />
        <SettingsDropdown
          colorblind={colorblind}
          onToggleColorblind={toggleColorblind}
          lang={lang}
          onToggleLang={toggleLang}
        />
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
