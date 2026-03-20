import { useState, useCallback } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';

const MAX_PINNED = 3;

/**
 * Manages the currently selected neighborhood and up to 3 pinned comparisons.
 * Selection state is synced to URL query params by the parent (App.tsx).
 */
export function useSelectedNeighborhood() {
  const [selected, setSelected] = useState<NeighborhoodProperties | null>(null);
  const [pinned, setPinned] = useState<NeighborhoodProperties[]>([]);

  const select = useCallback((props: NeighborhoodProperties | null) => {
    setSelected(props);
  }, []);

  const deselect = useCallback(() => {
    setSelected(null);
  }, []);

  const pin = useCallback((props: NeighborhoodProperties) => {
    setPinned((prev) => {
      if (prev.some((p) => p.pno === props.pno)) return prev;
      if (prev.length >= MAX_PINNED) return prev;
      return [...prev, props];
    });
  }, []);

  const unpin = useCallback((pno: string) => {
    setPinned((prev) => prev.filter((p) => p.pno !== pno));
  }, []);

  const clearPinned = useCallback(() => {
    setPinned([]);
  }, []);

  return { selected, select, deselect, pinned, pin, unpin, clearPinned };
}
