import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Map } from './components/Map';
import { LayerSelector } from './components/LayerSelector';
import { NeighborhoodPanel } from './components/NeighborhoodPanel';
import { ComparisonPanel } from './components/ComparisonPanel';
import { SearchBar } from './components/SearchBar';
import { Tooltip } from './components/Tooltip';
import { Legend } from './components/Legend';
import { ThemeToggle } from './components/ThemeToggle';
import { ErrorBanner } from './components/ErrorBanner';
import { RankingTable } from './components/RankingTable';
import { useMapData } from './hooks/useMapData';
import { useSelectedNeighborhood } from './hooks/useSelectedNeighborhood';
import { type LayerId, getLayerById } from './utils/colorScales';
import { readInitialUrlState, useSyncUrlState } from './hooks/useUrlState';
import type { NeighborhoodProperties } from './utils/metrics';
import { t, getLang, setLang, type Lang } from './utils/i18n';

const initialUrl = readInitialUrlState();

const App: React.FC = () => {
  const { data, loading, error, metroAverages, retry } = useMapData();
  const { selected, select, deselect, pinned, pin, unpin, clearPinned } = useSelectedNeighborhood();
  const [activeLayer, setActiveLayer] = useState<LayerId>(initialUrl.layer ?? 'median_income');
  const [tooltip, setTooltip] = useState<{
    props: NeighborhoodProperties;
    x: number;
    y: number;
  } | null>(null);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [showRanking, setShowRanking] = useState(false);
  const restoredPno = useRef(false);

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
    },
    [select],
  );

  const handleSearch = useCallback(
    (pno: string, center: [number, number]) => {
      setFlyTarget(center);
      if (data) {
        const feature = data.features.find((f) => f.properties?.pno === pno);
        if (feature?.properties) {
          select(feature.properties as NeighborhoodProperties);
        }
      }
    },
    [data, select],
  );

  const toggleLang = useCallback(() => {
    const next = lang === 'fi' ? 'en' : 'fi';
    setLang(next);
    setLangState(next);
  }, [lang]);

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

      {/* Brand mark */}
      <div className="absolute top-3 md:top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <h1 className="text-base md:text-lg font-display font-bold text-surface-800/90 dark:text-white/90 tracking-tight">
          naapurustot<span className="text-brand-500 dark:text-brand-400">.fi</span>
        </h1>
      </div>

      {/* Theme toggle — desktop: top-right offset, mobile: top-right compact row */}
      <div className="absolute top-3 md:top-4 right-[4.5rem] md:right-[20.5rem] z-10">
        <ThemeToggle />
      </div>

      {/* Language toggle */}
      <button
        onClick={toggleLang}
        className="absolute top-3 md:top-4 right-14 md:right-[17rem] z-10
                   px-3 py-2 md:py-1.5 rounded-lg bg-white/90 dark:bg-surface-900/90 backdrop-blur-md
                   border border-surface-200 dark:border-surface-700/40 text-xs font-semibold text-surface-600 dark:text-surface-300
                   hover:text-surface-900 dark:hover:text-white hover:bg-white dark:hover:bg-surface-800/80
                   transition-all shadow-lg uppercase tracking-wider min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                   flex items-center justify-center"
      >
        {lang === 'fi' ? 'EN' : 'FI'}
      </button>

      {/* Search */}
      <SearchBar data={data} onSelect={handleSearch} />

      {/* Ranking toggle */}
      <button
        onClick={() => setShowRanking((v) => !v)}
        className={`absolute top-4 left-[19.5rem] z-10 px-3 py-2.5 rounded-xl backdrop-blur-md
                   border shadow-2xl text-xs font-semibold transition-all
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

      {/* Ranking table */}
      {showRanking && (
        <RankingTable
          data={data}
          activeLayer={activeLayer}
          onSelect={handleSearch}
          onClose={() => setShowRanking(false)}
        />
      )}

      {/* Layer selector */}
      <LayerSelector activeLayer={activeLayer} onLayerChange={setActiveLayer} />

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

      {/* Neighborhood detail panel */}
      {selected && (
        <NeighborhoodPanel
          data={selected}
          metroAverages={metroAverages}
          onClose={deselect}
          onPin={pin}
          isPinned={pinned.some((p) => p.pno === selected.pno)}
          pinCount={pinned.length}
        />
      )}

      {/* Comparison panel */}
      <ComparisonPanel pinned={pinned} onUnpin={unpin} onClear={clearPinned} />

      {/* Attribution footer */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 hidden md:block">
        <p className="text-[10px] text-surface-600/70 dark:text-surface-500/70">{t('footer.attribution')}</p>
      </div>
    </div>
  );
};

export default App;
