import React, { useSyncExternalStore } from 'react';
import { Tooltip } from './Tooltip';
import { getTooltipSnapshot, subscribeTooltip, type TooltipData } from '../utils/tooltipStore';
import type { LayerConfig } from '../utils/colorScales';
import { t, useI18nVersion } from '../utils/i18n';
import { parseSchools } from '../utils/formatting';

// SSR/prerender-safe: useSyncExternalStore requires a server snapshot
// to avoid crashes during server-side rendering (scripts/prerender.mjs).
const getServerSnapshot = (): TooltipData | null => null;

interface TooltipOverlayProps {
  /** When true (neighborhood selected), the tooltip is hidden */
  hidden: boolean;
  effectiveLayer: LayerConfig;
  metroAverage: number | undefined;
}

/**
 * Self-contained tooltip renderer that subscribes to the tooltip external store.
 * Only this component re-renders on mouse move — the parent App is unaffected.
 */
export const TooltipOverlay: React.FC<TooltipOverlayProps> = React.memo(({ hidden, effectiveLayer, metroAverage }) => {
  useI18nVersion();
  const tooltip = useSyncExternalStore(subscribeTooltip, getTooltipSnapshot, getServerSnapshot);

  if (!tooltip || hidden) return null;

  // QW-8: over a fine-grained grid cell, show the cell's own value (labeled) instead of
  // the postal aggregate. Suppress the postal "vs avg" comparison and per-school detail,
  // which only make sense for the postal feature.
  const isGridCell = tooltip.gridValue != null;

  // Surface per-school detail when the school_quality layer is active so the
  // hover preview shows which lukios produced the aggregate score. MapLibre
  // serializes complex props to JSON strings, so normalize before passing on.
  const schools =
    !isGridCell && effectiveLayer.property === 'school_quality_score'
      ? parseSchools(tooltip.props.schools)
      : null;

  return (
    <Tooltip
      x={tooltip.x}
      y={tooltip.y}
      name={tooltip.props.nimi || tooltip.props.pno}
      value={isGridCell ? (tooltip.gridValue as number) : (tooltip.props[effectiveLayer.property] as number | null)}
      layer={effectiveLayer}
      metroAverage={isGridCell ? undefined : metroAverage}
      schools={schools}
      cellLabel={isGridCell ? t('tooltip.cell_value') : undefined}
    />
  );
});

TooltipOverlay.displayName = 'TooltipOverlay';
