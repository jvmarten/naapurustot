import React, { useSyncExternalStore } from 'react';
import { Tooltip } from './Tooltip';
import { getTooltipSnapshot, subscribeTooltip } from '../utils/tooltipStore';
import type { LayerId, LayerConfig } from '../utils/colorScales';

interface TooltipOverlayProps {
  /** When true (neighborhood selected), the tooltip is hidden */
  hidden: boolean;
  activeLayer: LayerId;
  effectiveLayer: LayerConfig;
  metroAverage: number | undefined;
}

/**
 * Self-contained tooltip renderer that subscribes to the tooltip external store.
 * Only this component re-renders on mouse move — the parent App is unaffected.
 */
export const TooltipOverlay: React.FC<TooltipOverlayProps> = React.memo(({ hidden, activeLayer, effectiveLayer, metroAverage }) => {
  const tooltip = useSyncExternalStore(subscribeTooltip, getTooltipSnapshot);

  if (!tooltip || hidden) return null;

  return (
    <Tooltip
      x={tooltip.x}
      y={tooltip.y}
      name={tooltip.props.nimi || tooltip.props.pno}
      value={tooltip.props[effectiveLayer.property] as number | null}
      layerId={activeLayer}
      metroAverage={metroAverage}
    />
  );
});

TooltipOverlay.displayName = 'TooltipOverlay';
