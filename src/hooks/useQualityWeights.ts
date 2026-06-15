import { useState, useCallback, useEffect, useRef } from 'react';
import { getDefaultWeights, isCustomWeights, type QualityWeights } from '../utils/qualityIndex';
import { api } from '../utils/api';
import { runSync } from '../utils/syncStatus';
import { editedAt, markEdited } from '../utils/syncMeta';

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
  // CF-6: true while the current weights are a transient seed from a shared link —
  // shown for this session but never written to localStorage or pushed to the
  // server until the recipient actually edits them. Cleared on any real edit or
  // when the user's own server-side weights are adopted on login.
  const seededRef = useRef(false);

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
  // IN-6: set on the userId null→id login transition and cleared once the on-login
  // merge resolves. While set, the debounced save is skipped so the local value is
  // never pushed before the merge decides the winner.
  const loginMergePendingRef = useRef(false);

  // Persist to localStorage on change (cheap, no debounce needed — setter is debounced upstream).
  // CF-6: a shared-link seed is held in memory only — not written until the user edits.
  useEffect(() => {
    weightsRef.current = weights;
    if (!seededRef.current) saveWeights(weights);
  }, [weights]);

  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Debounced server save
  useEffect(() => {
    // IN-6: on the null→id login transition, defer saving until the on-login merge
    // (below) picks the winner — otherwise this would push the local (possibly
    // DEFAULT) weights and the server ON CONFLICT would clobber the user's custom
    // server-side weights before the merge ran. prevUserIdRef still holds the
    // previous userId here because the on-login effect that updates it is declared
    // after this one and runs later in the same commit.
    if (userId && userId !== prevUserIdRef.current) loginMergePendingRef.current = true;

    if (!userId || fromServerRef.current) {
      fromServerRef.current = false;
      return;
    }
    // CF-6: never push a shared-link seed to the account.
    if (seededRef.current) return;
    if (loginMergePendingRef.current) return;
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
      // CF-6: a seed doesn't count as local customisation — the user's own server
      // weights take precedence over a shared link, and a seed is never pushed up.
      const localCustom = !seededRef.current && isCustomWeights(weightsRef.current);
      const adoptServer = () => {
        const merged = { ...getDefaultWeights(), ...serverWeights };
        seededRef.current = false; // adopted weights are owned and must persist
        fromServerRef.current = true;
        setWeightsState(merged);
      };
      if (serverCustom && !localCustom) {
        // Adopt server-side custom weights — local hasn't been touched here.
        adoptServer();
      } else if (localCustom && !serverCustom) {
        // Push local custom weights up — server hasn't been touched yet.
        api.savePreferences({ qualityWeights: weightsRef.current });
      } else if (serverCustom && localCustom) {
        // IN-6: both sides diverged — resolve by last-write-wins, comparing the
        // server row's timestamp against this device's last local edit of the
        // weights. No reliable server timestamp → leave local as-is (prior rule).
        const serverMs = data.updatedAt ? Date.parse(data.updatedAt) : NaN;
        if (Number.isFinite(serverMs)) {
          if (editedAt('weights') > serverMs) {
            api.savePreferences({ qualityWeights: weightsRef.current });
          } else {
            adoptServer();
          }
        }
      }
      // If both default: leave local as-is.
    }).finally(() => { loginMergePendingRef.current = false; });
    return () => { cancelled = true; loginMergePendingRef.current = false; };
  }, [userId]);

  const setWeights = useCallback((next: QualityWeights) => {
    seededRef.current = false; // an explicit edit makes the weights owned + persisted
    markEdited('weights'); // IN-6: record the local edit time for LWW conflict merges
    setWeightsState(next);
  }, []);

  // CF-6: apply weights from a shared link for this session only (no persistence
  // until the user edits them via setWeights).
  const seedWeights = useCallback((next: QualityWeights) => {
    seededRef.current = true;
    setWeightsState(next);
  }, []);

  return { weights, setWeights, seedWeights };
}
