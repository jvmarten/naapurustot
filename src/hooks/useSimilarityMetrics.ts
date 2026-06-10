import { useState, useCallback, useMemo } from 'react';
import {
  SIMILARITY_METRIC_KEYS,
  SIMILARITY_WEIGHT_MIN,
  SIMILARITY_WEIGHT_MAX,
  SIMILARITY_WEIGHT_DEFAULT,
} from '../utils/similarity';

const STORAGE_KEY = 'naapurustot-similarity-weights';
/** Legacy CF-6 key: a plain string[] of *selected* metrics (weight implicitly 1). */
const LEGACY_STORAGE_KEY = 'naapurustot-similarity-metrics';

/** Clamp + round a raw weight into the valid [min, max] integer range. */
function clampWeight(v: number): number {
  if (!Number.isFinite(v)) return SIMILARITY_WEIGHT_DEFAULT;
  return Math.min(SIMILARITY_WEIGHT_MAX, Math.max(SIMILARITY_WEIGHT_MIN, Math.round(v)));
}

/** All metrics at the neutral default weight of 1. */
function defaultWeights(): Record<string, number> {
  const w: Record<string, number> = {};
  for (const key of SIMILARITY_METRIC_KEYS) w[key] = SIMILARITY_WEIGHT_DEFAULT;
  return w;
}

/** Normalise a partial/foreign weight map into a full, validated weight map. */
function normalizeWeights(partial: Record<string, number> | null | undefined): Record<string, number> {
  const w = defaultWeights();
  if (!partial) return w;
  for (const key of Object.keys(partial)) {
    if (SIMILARITY_METRIC_KEYS.has(key)) w[key] = clampWeight(partial[key]);
  }
  return w;
}

/** True when every metric still sits at the neutral default weight. */
function isAllDefault(w: Record<string, number>): boolean {
  for (const key of SIMILARITY_METRIC_KEYS) {
    if ((w[key] ?? SIMILARITY_WEIGHT_DEFAULT) !== SIMILARITY_WEIGHT_DEFAULT) return false;
  }
  return true;
}

/** Only the entries that differ from the default — the compact shape persisted/URL-shared. */
function diffWeights(w: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of SIMILARITY_METRIC_KEYS) {
    const v = w[key] ?? SIMILARITY_WEIGHT_DEFAULT;
    if (v !== SIMILARITY_WEIGHT_DEFAULT) out[key] = v;
  }
  return out;
}

function loadWeights(): Record<string, number> {
  // Prefer the CF-5 weight map; migrate a legacy CF-6 selection if that's all we have.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return normalizeWeights(parsed as Record<string, number>);
      }
    }
  } catch {
    /* fall through to legacy / default */
  }
  try {
    const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (rawLegacy) {
      const parsed = JSON.parse(rawLegacy);
      if (Array.isArray(parsed)) {
        const selected = parsed.filter((k) => typeof k === 'string' && SIMILARITY_METRIC_KEYS.has(k));
        if (selected.length > 0) {
          // Selected metrics keep weight 1; everything else is turned off (weight 0).
          const w = defaultWeights();
          for (const key of SIMILARITY_METRIC_KEYS) w[key] = selected.includes(key) ? SIMILARITY_WEIGHT_DEFAULT : 0;
          return w;
        }
      }
    }
  } catch {
    /* fall through to default */
  }
  return defaultWeights();
}

function persist(w: Record<string, number>) {
  try {
    const diff = diffWeights(w);
    if (Object.keys(diff).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
  } catch {
    /* localStorage unavailable — weights still work for this session */
  }
}

/**
 * CF-5: per-metric similarity weights (0–3, default 1), persisted in localStorage
 * and seeded from the share URL when present. A weight of 0 disables a metric, so
 * the on/off chip picker (CF-6) is just the special case weight∈{0,1}.
 *
 * `initialUrlWeights` (only honoured on first mount) lets a shared link override the
 * stored configuration. The hook also exposes the current non-default diff via
 * `urlWeights` so the app can mirror it back into the URL; an all-default config
 * reports `null` so no `simw` param is emitted.
 *
 * At least one metric is always kept at a positive weight so the similarity query
 * never collapses to an empty basis.
 */
export function useSimilarityMetrics(initialUrlWeights?: Record<string, number> | null) {
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    initialUrlWeights ? normalizeWeights(initialUrlWeights) : loadWeights(),
  );

  // CF-6: a shared link seeds the in-memory weights (initial state above) but is
  // NOT written to localStorage — the recipient's stored configuration is only
  // overwritten once they actually change a weight (setWeight/toggle persist). A
  // reload without the link therefore returns to the recipient's own config.

  const setWeight = useCallback((key: string, value: number) => {
    if (!SIMILARITY_METRIC_KEYS.has(key)) return;
    setWeights((prev) => {
      const clamped = clampWeight(value);
      // Never let the last positively-weighted metric drop to 0 — that would leave
      // the similarity query with no basis at all.
      if (clamped === 0) {
        const positives = Object.keys(prev).filter((k) => (prev[k] ?? SIMILARITY_WEIGHT_DEFAULT) > 0);
        if (positives.length === 1 && positives[0] === key) return prev;
      }
      if ((prev[key] ?? SIMILARITY_WEIGHT_DEFAULT) === clamped) return prev;
      const next = { ...prev, [key]: clamped };
      persist(next);
      return next;
    });
  }, []);

  // CF-6 compatibility: a chip toggle is just weight 0 ↔ 1.
  const toggle = useCallback((key: string) => {
    setWeights((prev) => {
      const on = (prev[key] ?? SIMILARITY_WEIGHT_DEFAULT) > 0;
      if (on) {
        const positives = Object.keys(prev).filter((k) => (prev[k] ?? SIMILARITY_WEIGHT_DEFAULT) > 0);
        if (positives.length === 1 && positives[0] === key) return prev; // keep at least one on
      }
      const next = { ...prev, [key]: on ? 0 : SIMILARITY_WEIGHT_DEFAULT };
      persist(next);
      return next;
    });
  }, []);

  // Derived set of currently-active (positively-weighted) metrics, for the picker UI
  // and for filtering the metric list passed to findSimilarNeighborhoods.
  const selected = useMemo(() => {
    const s = new Set<string>();
    for (const key of SIMILARITY_METRIC_KEYS) {
      if ((weights[key] ?? SIMILARITY_WEIGHT_DEFAULT) > 0) s.add(key);
    }
    return s;
  }, [weights]);

  // Only the non-default diff goes to the URL (null when fully default).
  const urlWeights = useMemo(() => (isAllDefault(weights) ? null : diffWeights(weights)), [weights]);

  return { weights, selected, setWeight, toggle, urlWeights };
}
