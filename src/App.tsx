import React, { useState, useCallback } from 'react';
import { Map } from './components/Map';
import { LayerSelector } from './components/LayerSelector';
import { NeighborhoodPanel } from './components/NeighborhoodPanel';
import { SearchBar } from './components/SearchBar';
import { Tooltip } from './components/Tooltip';
import { Legend } from './components/Legend';
import { ThemeToggle } from './components/ThemeToggle';
import { useMapData } from './hooks/useMapData';
import { useSelectedNeighborhood } from './hooks/useSelectedNeighborhood';
import type { LayerId } from './utils/colorScales';
import type { NeighborhoodProperties } from './utils/metrics';
import { t, getLang, setLang, type Lang } from './utils/i18n';

const App: React.FC = () => {
  const { data, loading, error, metroAverages } = useMapData();
  const { selected, select, deselect } = useSelectedNeighborhood();
  const [activeLayer, setActiveLayer] = useState<LayerId>('median_income');
  const [tooltip, setTooltip] = useState<{
    props: NeighborhoodProperties;
    x: number;
    y: number;
  } | null>(null);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [lang, setLangState] = useState<Lang>(getLang());

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

  const handleSearch = useCallback((_pno: string, center: [number, number]) => {
    setFlyTarget(center);
  }, []);

  const toggleLang = useCallback(() => {
    const next = lang === 'fi' ? 'en' : 'fi';
    setLang(next);
    setLangState(next);
  }, [lang]);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-100 dark:bg-surface-950">
        <div className="text-center">
          <h1 className="text-2xl font-display font-bold text-surface-900 dark:text-white mb-2">Naapurustot</h1>
          <p className="text-surface-500 dark:text-surface-400 mb-4">Failed to load neighborhood data</p>
          <p className="text-rose-600 dark:text-rose-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      {/* Map */}
      <Map
        data={data}
        activeLayer={activeLayer}
        onHover={handleHover}
        onClick={handleClick}
        flyTo={flyTarget}
      />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-surface-950/80 backdrop-blur-sm">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-display font-bold text-surface-900 dark:text-white">Naapurustot</h1>
            <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">Loading neighborhood data…</p>
          </div>
        </div>
      )}

      {/* Brand mark */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <h1 className="text-lg font-display font-bold text-surface-800/90 dark:text-white/90 tracking-tight">
          naapurustot<span className="text-brand-500 dark:text-brand-400">.fi</span>
        </h1>
      </div>

      {/* Theme toggle */}
      <div className="absolute top-4 right-[20.5rem] z-10">
        <ThemeToggle />
      </div>

      {/* Language toggle */}
      <button
        onClick={toggleLang}
        className="absolute top-4 right-[17rem] z-10 px-3 py-1.5 rounded-lg bg-white/90 dark:bg-surface-900/90 backdrop-blur-md
                   border border-surface-200 dark:border-surface-700/40 text-xs font-semibold text-surface-600 dark:text-surface-300
                   hover:text-surface-900 dark:hover:text-white hover:bg-white dark:hover:bg-surface-800/80
                   transition-all shadow-lg uppercase tracking-wider"
      >
        {lang === 'fi' ? 'EN' : 'FI'}
      </button>

      {/* Search */}
      <SearchBar data={data} onSelect={handleSearch} />

      {/* Layer selector */}
      <LayerSelector activeLayer={activeLayer} onLayerChange={setActiveLayer} />

      {/* Legend */}
      <Legend layerId={activeLayer} />

      {/* Tooltip */}
      {tooltip && !selected && (
        <Tooltip
          x={tooltip.x}
          y={tooltip.y}
          name={tooltip.props.nimi || tooltip.props.pno}
          value={tooltip.props[
            activeLayer === 'median_income' ? 'hr_mtu' :
            activeLayer === 'unemployment' ? 'unemployment_rate' :
            activeLayer === 'education' ? 'higher_education_rate' :
            activeLayer === 'foreign_lang' ? 'foreign_language_pct' :
            activeLayer === 'avg_age' ? 'he_kika' :
            'pensioner_share'
          ] as number | null}
          layerId={activeLayer}
        />
      )}

      {/* Neighborhood detail panel */}
      {selected && (
        <NeighborhoodPanel data={selected} metroAverages={metroAverages} onClose={deselect} />
      )}

      {/* Attribution footer */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
        <p className="text-[10px] text-surface-600/70 dark:text-surface-500/70">{t('footer.attribution')}</p>
      </div>
    </div>
  );
};

export default App;
