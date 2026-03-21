import { useState, useCallback } from 'react';
import type { FilterCriterion } from '../utils/filterUtils';

const STORAGE_KEY = 'naapurustot-filter-presets';

export interface SavedPreset {
  name: string;
  criteria: FilterCriterion[];
}

function isValidPreset(v: unknown): v is SavedPreset {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  if (typeof p.name !== 'string') return false;
  if (!Array.isArray(p.criteria)) return false;
  return p.criteria.every(
    (c: unknown) => c && typeof c === 'object' && typeof (c as Record<string, unknown>).layerId === 'string'
      && typeof (c as Record<string, unknown>).min === 'number' && typeof (c as Record<string, unknown>).max === 'number',
  );
}

function loadPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(isValidPreset);
    }
  } catch { /* localStorage unavailable or malformed data */ }
  return [];
}

function savePresets(presets: SavedPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch { /* localStorage unavailable */ }
}

/** Manage saved filter presets (named sets of filter criteria), persisted to localStorage. */
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
