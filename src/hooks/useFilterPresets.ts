import { useState, useCallback, useEffect, useRef } from 'react';
import type { FilterCriterion } from '../utils/filterUtils';
import { LAYERS } from '../utils/colorScales';
import { runSync } from '../utils/syncStatus';
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

/** Stable signature so identical presets dedupe but same-name/different-criteria ones survive. */
function presetSig(p: SavedPreset): string {
  return JSON.stringify([p.name, p.criteria]);
}

/** Merge presets by (name + criteria) — local order preserved, server-only presets appended.
 *  Deduping by name alone silently dropped a server copy that shared a name with a
 *  locally-edited preset (the common cross-device edit case), losing the user's update. */
function mergePresets(local: SavedPreset[], server: SavedPreset[]): SavedPreset[] {
  const seen = new Set(local.map(presetSig));
  const merged = [...local];
  for (const p of server) {
    const sig = presetSig(p);
    if (!seen.has(sig)) {
      merged.push(p);
      seen.add(sig);
    }
  }
  return merged;
}

/** Order-independent content signature, for deciding whether to push the merge back. */
function canonicalize(presets: SavedPreset[]): string {
  return JSON.stringify(
    [...presets]
      .map((p) => ({
        name: p.name,
        criteria: [...p.criteria]
          .map((c) => ({ layerId: c.layerId, min: c.min, max: c.max }))
          .sort((a, b) => (a.layerId < b.layerId ? -1 : a.layerId > b.layerId ? 1 : a.min - b.min)),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  );
}

/** Manage saved filter presets (named sets of filter criteria).
 *  Persists to localStorage always; syncs to server when `userId` is provided (logged in). */
export function useFilterPresets(userId?: string | null) {
  const [presets, setPresets] = useState<SavedPreset[]>(loadPresets);
  const presetsRef = useRef(presets);
  const fromServerRef = useRef(false);

  // PO-5b: cross-tab sync — adopt filter presets changed in another tab,
  // suppressing the server-save echo via fromServerRef.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      fromServerRef.current = true;
      setPresets(loadPresets());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
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
      // PO-5: track sync status + retry on failure instead of silently swallowing.
      runSync('presets', () => api.savePreferences({ filterPresets: presetsRef.current }));
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
      // Push back if the merged set differs from the server in name OR criteria
      // (content-aware, order-independent) — a name-only positional check missed
      // diverged criteria and spuriously fired on mere reordering.
      const differs = canonicalize(merged) !== canonicalize(serverPresets);
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
