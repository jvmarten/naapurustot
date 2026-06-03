import React from 'react';
import { getLayerById, type LayerId, type LayerConfig } from '../utils/colorScales';
import { t, useI18nVersion, type Lang } from '../utils/i18n';
import { getGridInfo } from '../hooks/useGridData';
import { getMetricSource } from '../utils/metrics';

interface LegendProps {
  layerId: LayerId;
  colorblind?: string;
  /** When provided, overrides the static layer config (used for region-scoped color scales) */
  layerConfig?: LayerConfig;
  /** Pass current language to trigger re-render on language change */
  lang?: Lang;
}

// colorblind prop triggers re-render when mode changes (getLayerById reads global state)
export const Legend: React.FC<LegendProps> = React.memo(({ layerId, colorblind: _colorblind, layerConfig, lang: _lang }) => {
  useI18nVersion();
  const layer = layerConfig ?? getLayerById(layerId);

  // Show only first and last tick values
  const n = layer.stops.length;
  const tickIndices = [0, n - 1];

  // IN-1: when the active layer has a fine-grained grid dataset, surface its
  // coverage scope so a "regional" (e.g. Helsinki-only) grid is visibly limited
  // rather than silently masquerading as full-map resolution.
  const grid = getGridInfo(layerId);

  // PO-2: badge layers whose value is a proxy/derived model rather than a direct
  // measurement. Data freshness (vintage) is intentionally NOT shown here — it
  // lives in the settings menu ("data last updated") and the data-sources page,
  // so the on-map legend stays clean and uncluttered.
  const src = getMetricSource(layer.property);

  return (
    <div className="fixed md:absolute bottom-5 md:bottom-8 left-3 md:left-4 z-10">
      <div className="rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl px-4 py-3">
        <div className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-2">
          {t(layer.labelKey)}
        </div>
        <div className="flex items-center gap-0">
          {layer.colors.map((color, i) => (
            <div key={i} className="w-6 h-3 first:rounded-l last:rounded-r" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="flex justify-between mt-1.5" style={{ width: `${layer.colors.length * 24}px` }}>
          {tickIndices.map((idx) => (
            <span
              key={idx}
              className="text-[10px] text-surface-500"
            >
              {layer.format(layer.stops[idx])}
            </span>
          ))}
        </div>
        {grid && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-surface-400 dark:text-surface-500">
            <span aria-hidden="true">▦</span>
            <span>{t(grid.scope === 'national' ? 'grid.scope_national' : 'grid.scope_regional')}</span>
          </div>
        )}
        {src?.isProxy && (
          <div className="mt-2 flex items-center text-[10px]">
            <span className="inline-flex items-center rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide
                             bg-amber-400/15 text-amber-600 dark:text-amber-400 border border-amber-400/30">
              {t('data.estimate')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
