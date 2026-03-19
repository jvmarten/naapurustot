import React from 'react';
import { getLayerById, type LayerId } from '../utils/colorScales';
import { t } from '../utils/i18n';

interface LegendProps {
  layerId: LayerId;
  colorblind?: string;
}

// colorblind prop triggers re-render when mode changes (getLayerById reads global state)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const Legend: React.FC<LegendProps> = ({ layerId, colorblind }) => {
  const layer = getLayerById(layerId);

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
};
