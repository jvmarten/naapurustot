import { useState, useCallback } from 'react';
import { SIMILARITY_METRIC_KEYS } from '../utils/similarity';

const STORAGE_KEY = 'naapurustot-similarity-metrics';

function loadSelected(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((k) => typeof k === 'string' && SIMILARITY_METRIC_KEYS.has(k));
        if (valid.length > 0) return new Set(valid);
      }
    }
  } catch {
    /* localStorage unavailable or malformed — fall through to default */
  }
  return new Set(SIMILARITY_METRIC_KEYS); // default: all metrics
}

/**
 * CF-6: the user-selected set of similarity metrics, persisted in localStorage.
 * Defaults to all metrics. At least one metric is always kept selected so the
 * similarity query never has an empty basis.
 */
export function useSimilarityMetrics() {
  const [selected, setSelected] = useState<Set<string>>(loadSelected);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev; // never deselect the last one
        next.delete(key);
      } else {
        next.add(key);
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* localStorage unavailable — selection still works for this session */
      }
      return next;
    });
  }, []);

  return { selected, toggle };
}
