import { useState, useCallback } from 'react';

const STORAGE_KEY = 'naapurustot-notes';

function loadNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch { /* malformed data or unavailable */ }
  return {};
}

function saveNotes(notes: Record<string, string>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); } catch { /* quota exceeded or unavailable */ }
}

export function useNotes() {
  const [notes, setNotes] = useState<Record<string, string>>(loadNotes);

  const getNote = useCallback((pno: string): string => notes[pno] ?? '', [notes]);

  const setNote = useCallback((pno: string, text: string) => {
    setNotes((prev) => {
      const next = { ...prev };
      if (text.trim()) {
        next[pno] = text;
      } else {
        delete next[pno];
      }
      saveNotes(next);
      return next;
    });
  }, []);

  return { getNote, setNote };
}
