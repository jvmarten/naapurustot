import type { NeighborhoodProperties } from './metrics';

/**
 * Lightweight external store for tooltip state.
 *
 * Keeps tooltip data outside of React's component tree so that mouse-move
 * events (which fire at ~60 Hz) only re-render the small TooltipOverlay
 * component instead of the entire App tree. Before this change, every
 * mousemove called setState in App, triggering re-renders of heavy children
 * like NeighborhoodPanel, ComparisonPanel, and FilterPanel.
 */

export interface TooltipData {
  props: NeighborhoodProperties;
  x: number;
  y: number;
}

let current: TooltipData | null = null;
const listeners = new Set<() => void>();

export function getTooltipSnapshot(): TooltipData | null {
  return current;
}

export function setTooltipData(data: TooltipData | null): void {
  if (current === data) return;
  current = data;
  for (const l of listeners) l();
}

export function subscribeTooltip(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
