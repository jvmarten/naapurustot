import { useState, useCallback, useEffect, useRef } from 'react';
import { getDefaultWeights, isCustomWeights, type QualityWeights } from '../utils/qualityIndex';
import { api } from '../utils/api';
import { runSync } from '../utils/syncStatus';

const STORAGE_KEY = 'naapurustot-quality-weights';

function isValidWeights(v: unknown): v is QualityWeights {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k !== 'string' || !/^[a-z0-9_]{1,50}$/.test(k)) return false;
    if (typeof val !== 'number' || !isFinite(val)) return false;
    if (val < -100 || val > 100) return false;
  }
  return true;
}

function loadWeights(): QualityWeights {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidWeights(parsed)) {
        // Merge with defaults so newly-added factors get their default weight.
        return { ...getDefaultWeights(), ...parsed };
      }
    }
  } catch { /* localStorage unavailable or malformed data */ }
  return getDefaultWeights();
}

function saveWeights(weights: QualityWeights): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(weights)); } catch { /* unavailable */ }
}

/** Manage the user's custom quality-index weights.
 *  Persists to localStorage always; syncs to server when `userId` is provided. */
export function useQualityWeights(userId?: string | null) {
  const [weights, setWeightsState] = useState<QualityWeights>(loadWeights);
  const weightsRef = useRef(weights);
  const fromServerRef = useRef(false);

  // PO-5b: cross-tab sync — adopt quality weights changed in another tab,
  // suppressing the server-save echo via fromServerRef.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      fromServerRef.current = true;
      setWeightsState(loadWeights());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const userIdRef = useRef(userId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist to localStorage on change (cheap, no debounce needed — setter is debounced upstream)
  useEffect(() => {
    weightsRef.current = weights;
    saveWeights(weights);
  }, [weights]);

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
      runSync('weights', () => api.savePreferences({ qualityWeights: weightsRef.current }));
    }, 1000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [weights, userId]);

  // Flush pending save on unmount
  useEffect(() => () => {
    if (saveTimerRef.current && userIdRef.current) {
      clearTimeout(saveTimerRef.current);
      api.savePreferences({ qualityWeights: weightsRef.current });
    }
  }, []);

  // On login: fetch server weights — if local is default and server has custom, adopt server.
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (!userId || (prev !== undefined && prev === userId)) return;

    let cancelled = false;
    api.getPreferences().then(({ data }) => {
      if (cancelled || !data) return;
      const serverWeights = data.qualityWeights;
      if (!isValidWeights(serverWeights)) return;
      const serverCustom = isCustomWeights(serverWeights as QualityWeights);
      const localCustom = isCustomWeights(weightsRef.current);
      if (serverCustom && !localCustom) {
        // Adopt server-side custom weights — local hasn't been touched here.
        const merged = { ...getDefaultWeights(), ...serverWeights };
        fromServerRef.current = true;
        setWeightsState(merged);
      } else if (localCustom && !serverCustom) {
        // Push local custom weights up — server hasn't been touched yet.
        api.savePreferences({ qualityWeights: weightsRef.current });
      }
      // If both custom or both default: leave local as-is (no clear winner without timestamps).
    });
    return () => { cancelled = true; };
  }, [userId]);

  const setWeights = useCallback((next: QualityWeights) => {
    setWeightsState(next);
  }, []);

  return { weights, setWeights };
}
