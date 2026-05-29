import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../utils/api';

const STORAGE_KEY = 'naapurustot-notes';

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

/** Merge two notes maps. When the same pno exists in both, the longer text wins —
 *  a proxy for "more recently edited" when we don't have per-note timestamps. */
function mergeNotes(local: Record<string, string>, server: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = { ...local };
  for (const [pno, serverText] of Object.entries(server)) {
    const localText = merged[pno];
    if (!localText) {
      merged[pno] = serverText;
    } else if (serverText.length > localText.length) {
      merged[pno] = serverText;
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
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Debounced server save (mirrors useFavorites pattern). 1 s after the last change.
  useEffect(() => {
    if (!userId || fromServerRef.current) {
      fromServerRef.current = false;
      return;
    }
    if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    serverSaveTimerRef.current = setTimeout(() => {
      serverSaveTimerRef.current = null;
      api.saveNotes(notes);
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
      const merged = mergeNotes(notesRef.current, serverNotes);
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
    });
    return () => { cancelled = true; };
  }, [userId]);

  const getNote = useCallback((pno: string): string => notes[pno] ?? '', [notes]);

  const setNote = useCallback((pno: string, text: string) => {
    // Only accept valid 5-digit postal codes as keys
    if (!/^\d{5}$/.test(pno)) return;
    // Limit note length to prevent localStorage quota exhaustion
    const trimmed = text.slice(0, 5000);
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

  return { getNote, setNote };
}
