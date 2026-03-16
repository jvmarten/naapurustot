import React from 'react';
import { getLayerById, type LayerId } from '../utils/colorScales';
import { t } from '../utils/i18n';

interface LegendProps {
  layerId: LayerId;
}

export const Legend: React.FC<LegendProps> = ({ layerId }) => {
  const layer = getLayerById(layerId);

  return (
    <div className="absolute bottom-8 left-4 z-10">
      <div className="rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl px-4 py-3">
        <div className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-2">
          {t(layer.labelKey)}
        </div>
        <div className="flex items-center gap-0">
          {layer.colors.map((color, i) => (
            <div key={i} className="w-6 h-3 first:rounded-l last:rounded-r" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-surface-500">{layer.format(layer.stops[0])}</span>
          <span className="text-[10px] text-surface-500">{layer.format(layer.stops[layer.stops.length - 1])}</span>
        </div>
      </div>
    </div>
  );
};
