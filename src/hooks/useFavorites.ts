import { useState, useCallback, useMemo, useEffect } from "react";

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

/** Manage a list of favorited neighborhood PNOs, persisted to localStorage. */
export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(readFavorites);

  // Persist to localStorage outside state updaters (updaters must be pure —
  // React StrictMode double-invokes them).
  useEffect(() => { writeFavorites(favorites); }, [favorites]);

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
