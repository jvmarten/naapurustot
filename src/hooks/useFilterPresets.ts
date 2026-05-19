import { useState, useCallback, useEffect, useRef } from 'react';
import type { FilterCriterion } from '../utils/filterUtils';
import { LAYERS } from '../utils/colorScales';
import { api } from '../utils/api';

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

/** Merge presets by name — local order preserved, server-only names appended. */
function mergePresets(local: SavedPreset[], server: SavedPreset[]): SavedPreset[] {
  const localNames = new Set(local.map((p) => p.name));
  const merged = [...local];
  for (const p of server) {
    if (!localNames.has(p.name)) {
      merged.push(p);
      localNames.add(p.name);
    }
  }
  return merged;
}

/** Manage saved filter presets (named sets of filter criteria).
 *  Persists to localStorage always; syncs to server when `userId` is provided (logged in). */
export function useFilterPresets(userId?: string | null) {
  const [presets, setPresets] = useState<SavedPreset[]>(loadPresets);
  const presetsRef = useRef(presets);
  const fromServerRef = useRef(false);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const userIdRef = useRef(userId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    presetsRef.current = presets;
    savePresets(presets);
  }, [presets]);

  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Debounced server save
  useEffect(() => {
    if (!userId || fromServerRef.current) {
      fromServerRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      api.savePreferences({ filterPresets: presets });
    }, 1000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [presets, userId]);

  // Flush pending save on unmount to prevent data loss
  useEffect(() => () => {
    if (saveTimerRef.current && userIdRef.current) {
      clearTimeout(saveTimerRef.current);
      api.savePreferences({ filterPresets: presetsRef.current });
    }
  }, []);

  // On login: fetch server presets and merge with local
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (!userId || (prev !== undefined && prev === userId)) return;

    let cancelled = false;
    api.getPreferences().then(({ data }) => {
      if (cancelled || !data) return;
      const serverPresets = Array.isArray(data.filterPresets)
        ? (data.filterPresets as unknown[]).filter(isValidPreset)
        : [];
      const merged = mergePresets(presetsRef.current, serverPresets);
      fromServerRef.current = true;
      setPresets(merged);
      // Push back if merged differs from server
      const differs =
        merged.length !== serverPresets.length ||
        merged.some((p, i) => p.name !== serverPresets[i]?.name);
      if (differs) {
        api.savePreferences({ filterPresets: merged });
      }
    });
    return () => { cancelled = true; };
  }, [userId]);

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

  return { presets, addPreset, removePreset };
}
