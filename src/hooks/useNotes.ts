import { useState, useCallback } from 'react';

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
          if (typeof val === 'string') result[key] = val;
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

  const getNote = useCallback((pno: string): string => notes[pno] ?? '', [notes]);

  const setNote = useCallback((pno: string, text: string) => {
    // Validate PNO format (5-digit Finnish postal code)
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
      saveNotes(next);
      return next;
    });
  }, []);

  return { getNote, setNote };
}
