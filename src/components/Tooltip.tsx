import React, { useRef, useState, useLayoutEffect } from 'react';
import { getLayerById, type LayerId } from '../utils/colorScales';

interface TooltipProps {
  x: number;
  y: number;
  name: string;
  value: number | null;
  layerId: LayerId;
}

const OFFSET = 12;
const PADDING = 8;

export const Tooltip: React.FC<TooltipProps> = ({ x, y, name, value, layerId }) => {
  const layer = getLayerById(layerId);
  const formatted = value != null ? layer.format(value) : '—';
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: prefer right of cursor, flip left if it overflows
    let left = x + OFFSET;
    if (left + width + PADDING > vw) {
      left = x - OFFSET - width;
    }
    // Clamp so it never goes off the left edge
    left = Math.max(PADDING, left);

    // Vertical: prefer above cursor, flip below if it overflows
    let top = y - OFFSET - height;
    if (top < PADDING) {
      top = y + OFFSET;
    }
    // Clamp so it never goes off the bottom edge
    if (top + height + PADDING > vh) {
      top = vh - height - PADDING;
    }

    setPos({ left, top });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-50 rounded-lg bg-white/95 dark:bg-surface-900/95 px-3 py-2 text-sm shadow-xl backdrop-blur-sm border border-surface-200 dark:border-surface-700/50"
      style={{
        left: pos.left,
        top: pos.top,
      }}
    >
      <div className="font-semibold text-surface-900 dark:text-white">{name}</div>
      <div className="text-surface-600 dark:text-surface-300">
        {formatted}
      </div>
    </div>
  );
};
