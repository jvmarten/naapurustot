import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { runSync } from '../utils/syncStatus';

const STORAGE_KEY = 'naapurustot-shortlist';

function readShortlist(): string[] {
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

function writeShortlist(list: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota exceeded or unavailable */
  }
}

/** Merge two shortlist arrays, preserving order of `base` and appending new items from `other`. */
function mergeShortlist(base: string[], other: string[]): string[] {
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
 * QW-2: a durable working set of candidate neighbourhoods for a housing search —
 * distinct from one-tap favorites — backing the "add to shortlist" control and the
 * shortlist tray that opens into the comparison panel.
 *
 * QW-2b: persists to localStorage always and syncs to the server when `userId` is
 * provided (signed in), mirroring useFavorites — fetch+merge on login, debounced
 * save with retry via syncStatus, cross-tab adoption, and an unmount flush.
 */
export function useShortlist(userId?: string | null) {
  const [shortlist, setShortlist] = useState<string[]>(readShortlist);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the current change came from a server fetch / another tab (to
  // avoid echoing it straight back to the server).
  const fromServerRef = useRef(false);

  // PO-5b: cross-tab consistency — adopt a shortlist changed in another tab,
  // suppressing the server-save echo via fromServerRef.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      fromServerRef.current = true;
      setShortlist(readShortlist());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Mirror of state so async callbacks read the latest value without doing impure
  // work inside a state updater (StrictMode double-invokes updaters).
  const shortlistRef = useRef(shortlist);
  useEffect(() => {
    shortlistRef.current = shortlist;
    writeShortlist(shortlist);
  }, [shortlist]);

  // Debounced server save.
  useEffect(() => {
    if (!userId || fromServerRef.current) {
      fromServerRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      // PO-5: track sync status + retry on failure instead of silently swallowing.
      runSync('shortlist', () => api.saveShortlist(shortlistRef.current));
    }, 1000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [shortlist, userId]);

  // Flush a pending server save on unmount so a change made within the last second
  // before navigation is not lost.
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => () => {
    if (saveTimerRef.current && userIdRef.current) {
      clearTimeout(saveTimerRef.current);
      api.saveShortlist(shortlistRef.current);
    }
  }, []);

  // On login (userId becomes truthy): fetch the server shortlist and merge with local.
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (!userId || (prev !== undefined && prev === userId)) return;

    let cancelled = false;
    api.getShortlist().then(({ data }) => {
      if (cancelled || !data) return;
      const serverList = data.shortlist;
      const merged = mergeShortlist(shortlistRef.current, serverList);
      // Suppress the debounced re-save for this particular change.
      fromServerRef.current = true;
      setShortlist(merged);
      // If merged differs from the server, push it back once.
      if (merged.length !== serverList.length || !merged.every((v, i) => v === serverList[i])) {
        api.saveShortlist(merged);
      }
    });
    return () => { cancelled = true; };
  }, [userId]);

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
