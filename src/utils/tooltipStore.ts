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

/** Current tooltip state: the hovered neighborhood's properties and cursor position. */
export interface TooltipData {
  props: NeighborhoodProperties;
  /** Cursor X position (viewport pixels). */
  x: number;
  /** Cursor Y position (viewport pixels). */
  y: number;
}

let current: TooltipData | null = null;
const listeners = new Set<() => void>();

/** Get the current tooltip state. For use with useSyncExternalStore's getSnapshot. */
export function getTooltipSnapshot(): TooltipData | null {
  return current;
}

/** Update tooltip state and notify all subscribers. Pass null to hide the tooltip. */
export function setTooltipData(data: TooltipData | null): void {
  if (current === data) return;
  current = data;
  listeners.forEach(l => l());
}

/** Subscribe to tooltip changes. Returns an unsubscribe function. For use with useSyncExternalStore. */
export function subscribeTooltip(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
