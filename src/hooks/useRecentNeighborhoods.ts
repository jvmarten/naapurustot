import { useState, useCallback, useEffect } from 'react';

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
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: unknown): e is RecentEntry =>
        !!e && typeof e === 'object' && typeof (e as RecentEntry).pno === 'string'
        && typeof (e as RecentEntry).name === 'string' && Array.isArray((e as RecentEntry).center)
        && (e as RecentEntry).center.length === 2
        && typeof (e as RecentEntry).center[0] === 'number' && isFinite((e as RecentEntry).center[0])
        && typeof (e as RecentEntry).center[1] === 'number' && isFinite((e as RecentEntry).center[1]),
    );
  } catch {
    return [];
  }
}

function saveRecent(entries: RecentEntry[]): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* quota exceeded or unavailable */ }
}

/** Track recently searched neighborhoods (max 10), persisted to sessionStorage. */
export function useRecentNeighborhoods() {
  const [recent, setRecent] = useState<RecentEntry[]>(loadRecent);

  // Persist to sessionStorage outside state updaters (updaters must be pure —
  // React StrictMode double-invokes them, which would trigger redundant writes).
  useEffect(() => { saveRecent(recent); }, [recent]);

  const addRecent = useCallback((entry: RecentEntry) => {
    setRecent((prev) => {
      const filtered = prev.filter((e) => e.pno !== entry.pno);
      return [entry, ...filtered].slice(0, MAX_RECENT);
    });
  }, []);

  return { recent, addRecent };
}
