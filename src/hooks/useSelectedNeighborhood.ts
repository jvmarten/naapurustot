import { useState, useCallback } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';

export function useSelectedNeighborhood() {
  const [selected, setSelected] = useState<NeighborhoodProperties | null>(null);

  const select = useCallback((props: NeighborhoodProperties | null) => {
    setSelected(props);
  }, []);

  const deselect = useCallback(() => {
    setSelected(null);
  }, []);

  return { selected, select, deselect };
}
