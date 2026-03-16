import { useState, useCallback } from "react";

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(readFavorites);

  const isFavorite = useCallback(
    (pno: string): boolean => favorites.includes(pno),
    [favorites],
  );

  const toggleFavorite = useCallback((pno: string): void => {
    setFavorites((prev) => {
      const next = prev.includes(pno)
        ? prev.filter((p) => p !== pno)
        : [...prev, pno];
      writeFavorites(next);
      return next;
    });
  }, []);

  const clearFavorites = useCallback((): void => {
    writeFavorites([]);
    setFavorites([]);
  }, []);

  return { favorites, isFavorite, toggleFavorite, clearFavorites } as const;
}
