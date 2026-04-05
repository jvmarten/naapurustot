import { useState, useCallback, useRef, useEffect } from 'react';

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

/** Manage per-neighborhood user notes (free text), persisted to localStorage. */
export function useNotes() {
  const [notes, setNotes] = useState<Record<string, string>>(loadNotes);
  // Debounce localStorage writes — typing in the textarea triggers setNote on every
  // keystroke, and JSON.stringify + localStorage.setItem is synchronous main-thread work.
  // Batching saves to every 500ms prevents jank during fast typing.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Track latest notes for the debounced save callback (avoids side effects in state updaters)
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // Flush any pending save and clean up on unmount to prevent data loss.
  // Without the flush, a note typed within the last 500ms before navigation would be lost.
  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveNotes(notesRef.current);
    }
  }, []);

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
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNotes(notesRef.current), 500);
  }, []);

  return { getNote, setNote };
}
