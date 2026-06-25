import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { api } from "../utils/api";
import { runSync } from "../utils/syncStatus";
import { addTombstone, addTombstones, clearTombstone, mergeRespectingTombstones } from "../utils/syncTombstones";

const STORAGE_KEY = "naapurustot-favorites";
// CF-6: items the user explicitly un-favorited on this device — skipped on the
// login-merge so a deletion is not undone by a stale server copy.
const TOMBSTONE_KEY = "naapurustot-favorites-removed";

function readFavorites(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        return parsed;
      }
    }
  } catch {
    // Ignore malformed data
  }
  return [];
}

function writeFavorites(favorites: string[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites)); } catch { /* quota exceeded or unavailable */ }
}

/**
 * Manage a list of favorited neighborhood PNOs.
 * Persists to localStorage always; syncs to server when `userId` is provided (logged in).
 */
export function useFavorites(userId?: string | null) {
  const [favorites, setFavorites] = useState<string[]>(readFavorites);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the current change came from a server fetch (to avoid echoing it back)
  const fromServerRef = useRef(false);
  // IN-6: set on the userId null→id login transition, cleared once the on-login merge
  // resolves; while set the debounced save is skipped so local never pre-empts the merge.
  const loginMergePendingRef = useRef(false);

  // PO-5b: cross-tab sync — adopt favorites changed in another tab, suppressing the
  // server-save echo via fromServerRef.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      fromServerRef.current = true;
      setFavorites(readFavorites());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  // Mirror of favorites so async callbacks can read the latest value without
  // doing impure work inside a state updater (StrictMode double-invokes updaters).
  const favoritesRef = useRef(favorites);

  // Persist to localStorage outside state updaters (updaters must be pure —
  // React StrictMode double-invokes them).
  useEffect(() => {
    favoritesRef.current = favorites;
    writeFavorites(favorites);
  }, [favorites]);

  // Debounced server save
  useEffect(() => {
    // IN-6: defer the save on the null→id login transition until the merge below runs
    // (prevUserIdRef still holds the previous userId — the on-login effect that updates
    // it is declared after this one and runs later in the same commit).
    if (userId && userId !== prevUserIdRef.current) loginMergePendingRef.current = true;

    if (!userId || fromServerRef.current) {
      fromServerRef.current = false;
      return;
    }
    if (loginMergePendingRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      // PO-5: track sync status + retry on failure instead of silently swallowing.
      runSync('favorites', () => api.saveFavorites(favoritesRef.current));
    }, 1000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [favorites, userId]);

  // Flush pending server save on unmount to prevent data loss.
  // Without this, a favorite toggled within the last 1s before navigation would be lost.
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => () => {
    if (saveTimerRef.current && userIdRef.current) {
      clearTimeout(saveTimerRef.current);
      api.saveFavorites(favoritesRef.current);
    }
  }, []);

  // On login (userId becomes truthy): fetch server favorites and merge with local
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;

    // Only fetch when userId transitions to a truthy value
    if (!userId || (prev !== undefined && prev === userId)) return;

    let cancelled = false;
    api.getFavorites().then(({ data }) => {
      if (cancelled || !data) return;
      // Read the latest local state from a ref instead of a state updater — the
      // updater must be pure, and StrictMode double-invokes it which would
      // double-save to the server. The ref is synced by the writeFavorites effect.
      const serverFavs = data.favorites;
      // CF-6: skip server items the user deleted here (tombstoned) so they don't resurrect.
      const merged = mergeRespectingTombstones(favoritesRef.current, serverFavs, TOMBSTONE_KEY);
      // Suppress the debounced re-save for this particular change
      fromServerRef.current = true;
      setFavorites(merged);
      // If merged differs from server, push the merged result back once (outside any
      // updater). Use runSync so a transient failure retries with backoff and surfaces
      // in the sync status, like the debounced save above — a bare call would be lost.
      if (merged.length !== serverFavs.length || !merged.every((v, i) => v === serverFavs[i])) {
        runSync('favorites', () => api.saveFavorites(merged));
      }
    }).finally(() => { loginMergePendingRef.current = false; });
    return () => { cancelled = true; loginMergePendingRef.current = false; };
  }, [userId]);

  // O(1) lookup via Set instead of O(n) Array.includes per call.
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const isFavorite = useCallback(
    (pno: string): boolean => favoriteSet.has(pno),
    [favoriteSet],
  );

  const toggleFavorite = useCallback((pno: string): void => {
    // CF-6: maintain the deletion tombstone outside the (pure) state updater.
    if (favoritesRef.current.includes(pno)) addTombstone(TOMBSTONE_KEY, pno);
    else clearTombstone(TOMBSTONE_KEY, pno);
    setFavorites((prev) =>
      prev.includes(pno) ? prev.filter((p) => p !== pno) : [...prev, pno]
    );
  }, []);

  const clearFavorites = useCallback((): void => {
    addTombstones(TOMBSTONE_KEY, favoritesRef.current);
    setFavorites([]);
  }, []);

  // AC-2: shared-device logout. Drop this device's local copy WITHOUT writing
  // tombstones (those would block the SAME user re-syncing on next login) and
  // clear any EXISTING tombstones (else they'd suppress the NEXT user's matching
  // server items). Suppress the debounced server echo so logging out never pushes
  // an empty list to the still-authenticated session. Distinct from clearFavorites,
  // which is a deliberate "delete my favorites" and so does write tombstones.
  const resetLocal = useCallback((): void => {
    fromServerRef.current = true;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    try { localStorage.removeItem(TOMBSTONE_KEY); } catch { /* ignore */ }
    setFavorites([]);
  }, []);

  return { favorites, isFavorite, toggleFavorite, clearFavorites, resetLocal } as const;
}
