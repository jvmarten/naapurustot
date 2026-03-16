import React from 'react';
import { getLayerById, type LayerId } from '../utils/colorScales';

interface TooltipProps {
  x: number;
  y: number;
  name: string;
  value: number | null;
  layerId: LayerId;
}

export const Tooltip: React.FC<TooltipProps> = ({ x, y, name, value, layerId }) => {
  const layer = getLayerById(layerId);
  const formatted = value != null ? layer.format(value) : '—';

  return (
    <div
      className="pointer-events-none fixed z-50 rounded-lg bg-surface-900/95 px-3 py-2 text-sm shadow-xl backdrop-blur-sm border border-surface-700/50"
      style={{
        left: x + 12,
        top: y - 10,
        transform: 'translateY(-100%)',
      }}
    >
      <div className="font-semibold text-white">{name}</div>
      <div className="text-surface-300">
        {formatted}
      </div>
    </div>
  );
};
