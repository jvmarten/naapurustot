import React, { useRef, useLayoutEffect, useMemo } from 'react';
import type { LayerConfig } from '../utils/colorScales';
import { t } from '../utils/i18n';

interface TooltipProps {
  x: number;
  y: number;
  name: string;
  value: number | null;
  /** Pre-resolved layer config — avoids calling getLayerById at 60Hz on every mousemove */
  layer: LayerConfig;
  metroAverage?: number;
}

const OFFSET = 12;
const PADDING = 8;

export const Tooltip: React.FC<TooltipProps> = ({ x, y, name, value, layer, metroAverage }) => {
  const ref = useRef<HTMLDivElement>(null);

  const { formatted, comparisonText, comparisonClass } = useMemo(() => {
    const fmt = value != null ? layer.format(value) : t('tooltip.no_data');
    let cmpText = '';
    let cmpClass = '';
    if (value != null && metroAverage != null && Math.abs(metroAverage) > 0.1) {
      const diffPct = ((value - metroAverage) / Math.abs(metroAverage)) * 100;
      if (Math.abs(diffPct) >= 1 && Math.abs(diffPct) <= 999) {
        const sign = diffPct > 0 ? '+' : '';
        cmpText = `${diffPct > 0 ? '\u25B2' : '\u25BC'} ${sign}${diffPct.toFixed(0)}% ${t('tooltip.vs_avg')}`;
        const higherIsBetter = layer.higherIsBetter !== false;
        const isPositive = higherIsBetter ? diffPct > 0 : diffPct < 0;
        cmpClass = isPositive ? 'text-emerald-500' : 'text-rose-400';
      }
    }
    return { formatted: fmt, comparisonText: cmpText, comparisonClass: cmpClass };
  }, [value, layer, metroAverage]);

  // Position via direct DOM mutation to avoid a second React render per mousemove.
  // Uses transform instead of left/top so the write doesn't invalidate layout.
  // At 60Hz hover updates, dirtying layout with left/top causes forced reflows
  // when anything else in the frame reads geometry; transform is compositor-only.
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

    el.style.transform = `translate(${left}px,${top}px)`;
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="tooltip-desktop pointer-events-none fixed z-50 rounded-lg bg-white/95 dark:bg-surface-900/95 px-3 py-2 text-sm shadow-xl backdrop-blur-sm border border-surface-200 dark:border-surface-700/50"
      style={{
        left: 0,
        top: 0,
        willChange: 'transform',
      }}
    >
      <div className="font-semibold text-surface-900 dark:text-white">{name}</div>
      <div className={`${value == null ? 'text-surface-400 italic' : 'text-surface-600 dark:text-surface-300'}`}>
        {formatted}
      </div>
      {comparisonText && (
        <div className={`text-xs mt-0.5 ${comparisonClass}`}>
          {comparisonText}
        </div>
      )}
    </div>
  );
};
