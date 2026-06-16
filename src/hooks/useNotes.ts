import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../utils/api';
import { runSync } from '../utils/syncStatus';
import { addTombstone, clearTombstone, readTombstones } from '../utils/syncTombstones';
import { editedAt, markEdited } from '../utils/syncMeta';

const STORAGE_KEY = 'naapurustot-notes';
// CF-6: pnos whose note the user cleared on this device — skipped on the
// login-merge so a deleted note is not resurrected by the longer-text-wins rule.
const TOMBSTONE_KEY = 'naapurustot-notes-removed';

function loadNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Validate that all values are strings to guard against tampered localStorage
        const result: Record<string, string> = {};
        for (const [key, val] of Object.entries(parsed)) {
          if (/^\d{5}$/.test(key) && typeof val === 'string') result[key] = val;
        }
        return result;
      }
    }
  } catch { /* malformed data or unavailable */ }
  return {};
}

function saveNotes(notes: Record<string, string>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); } catch { /* quota exceeded or unavailable */ }
}

/**
 * QW-5: read a single neighbourhood's saved note straight from localStorage,
 * outside the React hook. Used by the export utilities (export.ts) so a CSV/PDF/
 * GeoJSON/JSON download can fold in the user's own private notes without threading
 * the hook's state through every export call site. Returns '' when none exists.
 */
export function readNote(pno: string): string {
  return loadNotes()[pno] ?? '';
}

/**
 * AC-2: clear this device's local notes and their deletion tombstones from
 * localStorage. Exposed as a standalone function (not just the hook's resetLocal)
 * because notes are written by the conditionally-mounted NeighborhoodPanel, so the
 * App-level logout handler must be able to wipe them even when no useNotes is mounted.
 * Writes no new tombstones, so the SAME user re-syncing on next login is unaffected.
 */
export function resetNotesStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOMBSTONE_KEY);
  } catch { /* localStorage unavailable */ }
}

/** Merge two notes maps.
 *  IN-6: when the same pno exists in both with differing text, last write wins —
 *  this pno's local last-edit time (syncMeta) is compared against the server store's
 *  timestamp. Without a server timestamp, fall back to the old longer-text-wins rule.
 *  CF-6: a server note whose pno the user cleared here (tombstoned, and absent
 *  locally) is skipped so a deleted note is not resurrected. */
function mergeNotes(
  local: Record<string, string>,
  server: Record<string, string>,
  serverUpdatedAtMs: number,
): Record<string, string> {
  const tomb = readTombstones(TOMBSTONE_KEY);
  const merged: Record<string, string> = { ...local };
  const haveServerTs = Number.isFinite(serverUpdatedAtMs);
  for (const [pno, serverText] of Object.entries(server)) {
    const localText = merged[pno];
    if (!localText) {
      if (!tomb.has(pno)) merged[pno] = serverText;
    } else if (localText !== serverText) {
      if (haveServerTs) {
        // Local note older than (or as old as) the server's last write → server wins.
        if (editedAt(`notes:${pno}`) <= serverUpdatedAtMs) merged[pno] = serverText;
      } else if (serverText.length > localText.length) {
        merged[pno] = serverText;
      }
    }
  }
  return merged;
}

/**
 * Manage per-neighborhood user notes (free text).
 * Persists to localStorage always; syncs to server when `userId` is provided (logged in).
 */
export function useNotes(userId?: string | null) {
  const [notes, setNotes] = useState<Record<string, string>>(loadNotes);
  // Debounce localStorage writes — typing in the textarea triggers setNote on every
  // keystroke, and JSON.stringify + localStorage.setItem is synchronous main-thread work.
  // Batching saves to every 500ms prevents jank during fast typing.
  const localSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const serverSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track latest notes for the debounced save callback (avoids side effects in state updaters)
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // Track whether the current change came from a server fetch (to avoid echoing it back)
  const fromServerRef = useRef(false);

  // PO-5b: cross-tab sync — adopt notes changed in another tab, suppressing the
  // server-save echo via fromServerRef.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      fromServerRef.current = true;
      setNotes(loadNotes());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  // IN-6: set on the userId null→id login transition, cleared once the on-login merge
  // resolves; while set the debounced save is skipped so local never pre-empts the merge.
  const loginMergePendingRef = useRef(false);

  // Debounced server save (mirrors useFavorites pattern). 1 s after the last change.
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
    if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    serverSaveTimerRef.current = setTimeout(() => {
      serverSaveTimerRef.current = null;
      // PO-5: track sync status + retry on failure instead of silently swallowing.
      runSync('notes', () => api.saveNotes(notesRef.current));
    }, 1000);
    return () => { if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current); };
  }, [notes, userId]);

  // Flush any pending save and clean up on unmount to prevent data loss.
  // Without the flush, a note typed within the last 500ms before navigation would be lost.
  useEffect(() => () => {
    if (localSaveTimerRef.current) {
      clearTimeout(localSaveTimerRef.current);
      saveNotes(notesRef.current);
    }
    if (serverSaveTimerRef.current && userIdRef.current) {
      clearTimeout(serverSaveTimerRef.current);
      api.saveNotes(notesRef.current);
    }
  }, []);

  // On login: fetch server notes and merge with local
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (!userId || (prev !== undefined && prev === userId)) return;

    let cancelled = false;
    api.getNotes().then(({ data }) => {
      if (cancelled || !data) return;
      const serverNotes = data.notes;
      const serverMs = data.updatedAt ? Date.parse(data.updatedAt) : NaN;
      const merged = mergeNotes(notesRef.current, serverNotes, serverMs);
      fromServerRef.current = true;
      setNotes(merged);
      // Persist the server-merged result to localStorage immediately. Unlike the
      // per-keystroke path this is a one-off write (no jank concern), and without
      // it a reload before the user next types would lose the merged server notes.
      notesRef.current = merged;
      saveNotes(merged);
      // If merged differs from server, push merged back once.
      const serverKeys = Object.keys(serverNotes);
      const mergedKeys = Object.keys(merged);
      const differs =
        mergedKeys.length !== serverKeys.length ||
        mergedKeys.some((k) => merged[k] !== serverNotes[k]);
      if (differs) {
        api.saveNotes(merged);
      }
    }).finally(() => { loginMergePendingRef.current = false; });
    return () => { cancelled = true; loginMergePendingRef.current = false; };
  }, [userId]);

  const getNote = useCallback((pno: string): string => notes[pno] ?? '', [notes]);

  const setNote = useCallback((pno: string, text: string) => {
    // Only accept valid 5-digit postal codes as keys
    if (!/^\d{5}$/.test(pno)) return;
    // Limit note length to prevent localStorage quota exhaustion
    const trimmed = text.slice(0, 5000);
    // CF-6: a cleared note is a deletion (tombstone it); writing text is a re-add.
    if (trimmed.trim()) {
      clearTombstone(TOMBSTONE_KEY, pno);
      markEdited(`notes:${pno}`); // IN-6: record per-note edit time for LWW conflict merges
    } else {
      addTombstone(TOMBSTONE_KEY, pno);
    }
    setNotes((prev) => {
      const next = { ...prev };
      if (trimmed.trim()) {
        next[pno] = trimmed;
      } else {
        delete next[pno];
      }
      return next;
    });
    // Debounce localStorage writes outside the state updater — state updaters
    // must be pure (no side effects). React StrictMode double-invokes updaters,
    // which would schedule duplicate timers if setTimeout lived inside.
    clearTimeout(localSaveTimerRef.current);
    localSaveTimerRef.current = setTimeout(() => {
      // Clear the ref once the write lands so the unmount flush's truthiness
      // guard doesn't see a stale timer id and repeat the write redundantly.
      localSaveTimerRef.current = undefined;
      saveNotes(notesRef.current);
    }, 500);
  }, []);

  // AC-2: shared-device logout — drop this device's local notes WITHOUT writing
  // tombstones, and clear existing ones so they don't suppress the next user's
  // server notes. Notes are especially sensitive (free text), so leaving them on the
  // device — and merging them into the next account's cloud store — is a privacy leak.
  // Suppress the debounced server echo so logout never overwrites the live session.
  const resetLocal = useCallback((): void => {
    fromServerRef.current = true;
    if (localSaveTimerRef.current) { clearTimeout(localSaveTimerRef.current); localSaveTimerRef.current = undefined; }
    resetNotesStorage();
    notesRef.current = {};
    setNotes({});
  }, []);

  return { getNote, setNote, resetLocal };
}
