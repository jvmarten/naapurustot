import React from 'react';
import { getLayerById, type LayerId, type LayerConfig } from '../utils/colorScales';
import { t, type Lang } from '../utils/i18n';

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
  const layer = layerConfig ?? getLayerById(layerId);

  // Show only first and last tick values
  const n = layer.stops.length;
  const tickIndices = [0, n - 1];

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
      </div>
    </div>
  );
});
