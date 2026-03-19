import { useState, useCallback } from 'react';

const MAX_RECENT = 10;
const STORAGE_KEY = 'naapurustot-recent';

export interface RecentEntry {
  pno: string;
  name: string;
  center: [number, number];
}

function loadRecent(): RecentEntry[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(entries: RecentEntry[]): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function useRecentNeighborhoods() {
  const [recent, setRecent] = useState<RecentEntry[]>(loadRecent);

  const addRecent = useCallback((entry: RecentEntry) => {
    setRecent((prev) => {
      const filtered = prev.filter((e) => e.pno !== entry.pno);
      const next = [entry, ...filtered].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
  }, []);

  return { recent, addRecent };
}
