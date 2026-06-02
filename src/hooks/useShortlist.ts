import { useState, useCallback, useMemo, useEffect } from 'react';

const STORAGE_KEY = 'naapurustot-shortlist';

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return parsed;
    }
  } catch {
    /* localStorage unavailable or malformed */
  }
  return [];
}

function save(list: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota exceeded or unavailable */
  }
}

/**
 * QW-2: a durable working set of candidate neighbourhoods for a housing search —
 * distinct from one-tap favorites — persisted in localStorage and consistent across
 * tabs. Backs the "add to shortlist" control and the shortlist tray that opens into
 * the comparison panel.
 */
export function useShortlist() {
  const [shortlist, setShortlist] = useState<string[]>(load);

  useEffect(() => { save(shortlist); }, [shortlist]);

  // Cross-tab consistency (mirrors PO-5b).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setShortlist(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const set = useMemo(() => new Set(shortlist), [shortlist]);
  const isInShortlist = useCallback((pno: string) => set.has(pno), [set]);
  const toggleShortlist = useCallback((pno: string) => {
    setShortlist((prev) => (prev.includes(pno) ? prev.filter((p) => p !== pno) : [...prev, pno]));
  }, []);
  const removeFromShortlist = useCallback((pno: string) => {
    setShortlist((prev) => prev.filter((p) => p !== pno));
  }, []);
  const clearShortlist = useCallback(() => setShortlist([]), []);

  return { shortlist, isInShortlist, toggleShortlist, removeFromShortlist, clearShortlist };
}
