import { useState, useCallback, useEffect } from 'react';
import type { FilterCriterion } from '../utils/filterUtils';
import { LAYERS } from '../utils/colorScales';

const STORAGE_KEY = 'naapurustot-filter-presets';

const VALID_LAYER_IDS = new Set<string>(LAYERS.map((l) => l.id));

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
    (c: unknown) => {
      if (!c || typeof c !== 'object') return false;
      const r = c as Record<string, unknown>;
      if (typeof r.layerId !== 'string' || !VALID_LAYER_IDS.has(r.layerId)) return false;
      if (typeof r.min !== 'number' || typeof r.max !== 'number') return false;
      if (!isFinite(r.min) || !isFinite(r.max)) return false;
      if (r.min > r.max) return false;
      return true;
    },
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
      if (prev.length >= 50) return prev;
      return [...prev, { name, criteria }];
    });
  }, []);

  const removePreset = useCallback((index: number) => {
    setPresets((prev) => {
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Persist to localStorage outside state updaters (updaters must be pure —
  // React StrictMode double-invokes them, which would write twice).
  useEffect(() => {
    savePresets(presets);
  }, [presets]);

  return { presets, addPreset, removePreset };
}
