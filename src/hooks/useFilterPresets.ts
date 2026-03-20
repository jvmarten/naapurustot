import { useState, useCallback } from 'react';
import type { FilterCriterion } from '../utils/filterUtils';

const STORAGE_KEY = 'naapurustot-filter-presets';

export interface SavedPreset {
  name: string;
  criteria: FilterCriterion[];
}

function loadPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* localStorage unavailable or malformed data */ }
  return [];
}

function savePresets(presets: SavedPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch { /* localStorage unavailable */ }
}

export function useFilterPresets() {
  const [presets, setPresets] = useState<SavedPreset[]>(loadPresets);

  const addPreset = useCallback((name: string, criteria: FilterCriterion[]) => {
    setPresets((prev) => {
      const next = [...prev, { name, criteria }];
      savePresets(next);
      return next;
    });
  }, []);

  const removePreset = useCallback((index: number) => {
    setPresets((prev) => {
      const next = prev.filter((_, i) => i !== index);
      savePresets(next);
      return next;
    });
  }, []);

  return { presets, addPreset, removePreset };
}
