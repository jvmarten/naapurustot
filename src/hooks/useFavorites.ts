import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { api } from "../utils/api";

const STORAGE_KEY = "naapurustot-favorites";

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

/** Merge two favorites arrays, preserving order of `base` and appending new items from `other`. */
function mergeFavorites(base: string[], other: string[]): string[] {
  const set = new Set(base);
  const merged = [...base];
  for (const pno of other) {
    if (!set.has(pno)) {
      merged.push(pno);
      set.add(pno);
    }
  }
  return merged;
}

/**
 * Manage a list of favorited neighborhood PNOs.
 * Persists to localStorage always; syncs to server when `userId` is provided (logged in).
 */
export function useFavorites(userId?: string | null) {
  const [favorites, setFavorites] = useState<string[]>(readFavorites);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the favorites array reference set by the server merge — if the current
  // favorites identity matches this ref, skip the debounced save to avoid echoing
  // server data back. Using the array reference (not a boolean) prevents a race
  // where a user toggle batched with the server merge would be silently dropped.
  const serverSetRef = useRef<string[] | null>(null);
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
    if (!userId || favorites === serverSetRef.current) {
      serverSetRef.current = null;
      return;
    }
    serverSetRef.current = null;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.saveFavorites(favorites);
    }, 1000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [favorites, userId]);

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
      const merged = mergeFavorites(favoritesRef.current, serverFavs);
      // Store the reference so the save effect can skip echoing this back
      serverSetRef.current = merged;
      setFavorites(merged);
      // If merged differs from server, push the merged result back once (outside any updater).
      if (merged.length !== serverFavs.length || !merged.every((v, i) => v === serverFavs[i])) {
        api.saveFavorites(merged);
      }
    });
    return () => { cancelled = true; };
  }, [userId]);

  // O(1) lookup via Set instead of O(n) Array.includes per call.
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const isFavorite = useCallback(
    (pno: string): boolean => favoriteSet.has(pno),
    [favoriteSet],
  );

  const toggleFavorite = useCallback((pno: string): void => {
    setFavorites((prev) =>
      prev.includes(pno) ? prev.filter((p) => p !== pno) : [...prev, pno]
    );
  }, []);

  const clearFavorites = useCallback((): void => {
    setFavorites([]);
  }, []);

  return { favorites, isFavorite, toggleFavorite, clearFavorites } as const;
}
