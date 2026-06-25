import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { runSync } from '../utils/syncStatus';
import { addTombstone, addTombstones, clearTombstone, mergeRespectingTombstones } from '../utils/syncTombstones';

const STORAGE_KEY = 'naapurustot-shortlist';
// CF-6: shortlist entries the user explicitly removed on this device — skipped on
// the login-merge so a removal is not undone by a stale server copy.
const TOMBSTONE_KEY = 'naapurustot-shortlist-removed';

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
  // IN-6: set on the userId null→id login transition, cleared once the on-login merge
  // resolves; while set the debounced save is skipped so local never pre-empts the merge.
  const loginMergePendingRef = useRef(false);

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
      // CF-6: skip server items the user removed here (tombstoned) so they don't resurrect.
      const merged = mergeRespectingTombstones(shortlistRef.current, serverList, TOMBSTONE_KEY);
      // Suppress the debounced re-save for this particular change.
      fromServerRef.current = true;
      setShortlist(merged);
      // If merged differs from the server, push it back once. Use runSync so a
      // transient failure retries with backoff and surfaces in the sync status.
      if (merged.length !== serverList.length || !merged.every((v, i) => v === serverList[i])) {
        runSync('shortlist', () => api.saveShortlist(merged));
      }
    }).finally(() => { loginMergePendingRef.current = false; });
    return () => { cancelled = true; loginMergePendingRef.current = false; };
  }, [userId]);

  const set = useMemo(() => new Set(shortlist), [shortlist]);
  const isInShortlist = useCallback((pno: string) => set.has(pno), [set]);
  const toggleShortlist = useCallback((pno: string) => {
    // CF-6: keep the deletion tombstone in step with the toggle (outside the updater).
    if (shortlistRef.current.includes(pno)) addTombstone(TOMBSTONE_KEY, pno);
    else clearTombstone(TOMBSTONE_KEY, pno);
    setShortlist((prev) => (prev.includes(pno) ? prev.filter((p) => p !== pno) : [...prev, pno]));
  }, []);
  const removeFromShortlist = useCallback((pno: string) => {
    addTombstone(TOMBSTONE_KEY, pno);
    setShortlist((prev) => prev.filter((p) => p !== pno));
  }, []);
  const clearShortlist = useCallback(() => {
    addTombstones(TOMBSTONE_KEY, shortlistRef.current);
    setShortlist([]);
  }, []);
  // AC-2: shared-device logout — see useFavorites.resetLocal. Drops the local list
  // without writing tombstones, clears existing ones, and suppresses the server echo.
  const resetLocal = useCallback(() => {
    fromServerRef.current = true;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    try { localStorage.removeItem(TOMBSTONE_KEY); } catch { /* ignore */ }
    setShortlist([]);
  }, []);
  // QW-2: adopt postal codes from a shared URL without clobbering the local list.
  // CF-6: importing a shared list is an explicit re-add, so clear any tombstones.
  const mergeIntoShortlist = useCallback((pnos: string[]) => {
    const valid = pnos.filter((p) => /^\d{5}$/.test(p));
    if (valid.length === 0) return;
    for (const p of valid) clearTombstone(TOMBSTONE_KEY, p);
    setShortlist((prev) => {
      const seen = new Set(prev);
      const merged = [...prev];
      for (const p of valid) if (!seen.has(p)) { merged.push(p); seen.add(p); }
      return merged;
    });
  }, []);

  return { shortlist, isInShortlist, toggleShortlist, removeFromShortlist, clearShortlist, mergeIntoShortlist, resetLocal };
}
