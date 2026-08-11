/**
 * Guards the similarity-metric registry and the legacy-key migration.
 *
 * The similarity metrics are keyed by GeoJSON property name, and those keys are
 * persisted — in localStorage and in already-shared `simw=` links. Renaming one
 * (foreign_language_pct → foreign_language_est_pct, the 2020 measurement → the latest
 * year's estimate) therefore silently rewrites user configuration unless every read
 * path resolves the old key. Nothing else in the suite imports
 * AVAILABLE_SIMILARITY_METRICS, so a half-finished rename used to ship fully green:
 * a picker chip that toggles, never persists, and contributes nothing to distance.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  AVAILABLE_SIMILARITY_METRICS,
  SIMILARITY_METRIC_KEYS,
  LEGACY_SIMILARITY_METRIC_ALIASES,
  canonicalSimilarityMetric,
  SIMILARITY_WEIGHT_DEFAULT,
} from '../utils/similarity';
import { useSimilarityMetrics } from '../hooks/useSimilarityMetrics';
import { readInitialUrlState } from '../hooks/useUrlState';
import dataSources from '../data/data_sources.json';

const WEIGHTS_KEY = 'naapurustot-similarity-weights';
const LEGACY_KEY = 'naapurustot-similarity-metrics';

function setSearch(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState(null, '', url.toString());
}

describe('similarity metric registry', () => {
  it('every picker entry is a scored metric (catches a one-sided rename)', () => {
    const orphans = AVAILABLE_SIMILARITY_METRICS
      .map((m) => m.key as string)
      .filter((k) => !SIMILARITY_METRIC_KEYS.has(k));
    expect(
      orphans,
      `AVAILABLE_SIMILARITY_METRICS keys missing from SIMILARITY_METRICS: ${orphans.join(', ')}`,
    ).toHaveLength(0);
  });

  it('every scored metric is offered in the picker', () => {
    const offered = new Set(AVAILABLE_SIMILARITY_METRICS.map((m) => m.key as string));
    const hidden = [...SIMILARITY_METRIC_KEYS].filter((k) => !offered.has(k));
    expect(hidden, `scored but not selectable: ${hidden.join(', ')}`).toHaveLength(0);
  });

  it('scores the foreign-language axis on the latest estimate, not the 2020 column', () => {
    expect(SIMILARITY_METRIC_KEYS.has('foreign_language_est_pct')).toBe(true);
    expect(SIMILARITY_METRIC_KEYS.has('foreign_language_pct')).toBe(false);
  });
});

describe('canonicalSimilarityMetric', () => {
  it('maps the renamed key to its current name', () => {
    expect(canonicalSimilarityMetric('foreign_language_pct')).toBe('foreign_language_est_pct');
  });

  it('passes a current key through unchanged', () => {
    expect(canonicalSimilarityMetric('hr_mtu')).toBe('hr_mtu');
  });

  it('rejects a key that names no metric', () => {
    expect(canonicalSimilarityMetric('not_a_metric')).toBeNull();
    // Inherited Object members must not resolve as aliases.
    expect(canonicalSimilarityMetric('constructor')).toBeNull();
    expect(canonicalSimilarityMetric('toString')).toBeNull();
  });
});

describe('persisted weights survive the rename', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('honours a legacy key in the stored weight map', () => {
    // "off" for this metric. Dropping the key would restore the default of 1 —
    // inverting the preference rather than merely losing it.
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify({ foreign_language_pct: 0 }));
    const { result } = renderHook(() => useSimilarityMetrics());
    expect(result.current.weights.foreign_language_est_pct).toBe(0);
    expect(result.current.selected.has('foreign_language_est_pct')).toBe(false);
  });

  it('lets the current key win when a stored map holds both', () => {
    localStorage.setItem(
      WEIGHTS_KEY,
      JSON.stringify({ foreign_language_pct: 0, foreign_language_est_pct: 3 }),
    );
    expect(renderHook(() => useSimilarityMetrics()).result.current.weights.foreign_language_est_pct).toBe(3);
    // …and in the opposite key order, so the result cannot depend on Object.keys order.
    localStorage.setItem(
      WEIGHTS_KEY,
      JSON.stringify({ foreign_language_est_pct: 3, foreign_language_pct: 0 }),
    );
    expect(renderHook(() => useSimilarityMetrics()).result.current.weights.foreign_language_est_pct).toBe(3);
  });

  it('honours a legacy key in the older array-shaped selection', () => {
    // This shape turns off everything it does not list, so a dropped key disables a
    // metric the user had ON — the opposite failure to the weight-map case.
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['hr_mtu', 'foreign_language_pct']));
    const { result } = renderHook(() => useSimilarityMetrics());
    expect(result.current.weights.foreign_language_est_pct).toBe(SIMILARITY_WEIGHT_DEFAULT);
    expect(result.current.selected.has('foreign_language_est_pct')).toBe(true);
    expect(result.current.selected.has('crime_index')).toBe(false);
  });

  it('keeps a sole-legacy array selection instead of discarding it', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['foreign_language_pct']));
    const { result } = renderHook(() => useSimilarityMetrics());
    expect(result.current.selected.has('foreign_language_est_pct')).toBe(true);
    expect(result.current.selected.size).toBe(1);
  });

  it('still ignores a key that names no metric at all', () => {
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify({ not_a_metric: 0 }));
    const { result } = renderHook(() => useSimilarityMetrics());
    expect(result.current.weights.not_a_metric).toBeUndefined();
  });
});

/**
 * scripts/*.mjs cannot import from src/, so scripts/prerender.mjs carries its own copy
 * of the similarity axis list for the static cross-region mesh. No CI job compared the
 * two, which is exactly how that copy went on scoring a column the app had retired.
 *
 * The two lists are NOT meant to be equal — the script uses a deliberately narrower,
 * higher-coverage basis and includes he_kika, which the app does not score — so
 * asserting set equality would be wrong. These are the invariants that do hold.
 */
const scriptSource = Object.values(
  import.meta.glob('../../scripts/prerender.mjs', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
)[0];

function similarMetricsMirror(): string[] {
  const block = scriptSource.match(/const SIMILAR_METRICS = \[([\s\S]*?)\n\];/);
  if (!block) return [];
  // Strip line comments first: the entries are quoted, and so is nothing else here.
  const body = block[1].replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

describe('scripts/prerender.mjs SIMILAR_METRICS mirror', () => {
  const mirror = similarMetricsMirror();

  it('is parseable (the guard below is worthless if this silently finds nothing)', () => {
    expect(scriptSource, 'scripts/prerender.mjs not readable as raw text').toBeTruthy();
    expect(mirror.length).toBeGreaterThan(4);
  });

  it('scores only registered metrics', () => {
    const registered = dataSources.metrics as Record<string, unknown>;
    const unknown = mirror.filter((k) => !(k in registered));
    expect(
      unknown,
      `scripts/prerender.mjs SIMILAR_METRICS names unregistered columns: ${unknown.join(', ')}`,
    ).toHaveLength(0);
  });

  it('scores no column the app has retired', () => {
    // The invariant that would have caught this drift, and will catch the next one:
    // renaming a similarity metric adds an alias entry, and the static mesh must move
    // with it rather than keeping the superseded column.
    const retired = mirror.filter((k) => LEGACY_SIMILARITY_METRIC_ALIASES.has(k));
    expect(
      retired,
      `scripts/prerender.mjs still scores retired column(s): ${retired
        .map((k) => `${k} -> ${LEGACY_SIMILARITY_METRIC_ALIASES.get(k)}`)
        .join(', ')}`,
    ).toHaveLength(0);
  });
});

describe('shared simw links survive the rename', () => {
  // Both hooks: each case must be independent of what ran before it, not merely tidy
  // after itself — these are the guard for a migration, so ordering must not matter.
  beforeEach(() => setSearch(''));
  afterEach(() => setSearch(''));

  it('decodes a legacy key from an already-shared link', () => {
    setSearch('?simw=foreign_language_pct:0');
    expect(readInitialUrlState().simWeights).toEqual({ foreign_language_est_pct: 0 });
  });

  it('does not collapse a sole-legacy link to null', () => {
    // A null decode makes the app fall back to the recipient's own stored weights, so
    // the link would silently render someone else's configuration as if it were shared.
    setSearch('?simw=foreign_language_pct:2');
    expect(readInitialUrlState().simWeights).not.toBeNull();
  });

  it('still drops an unknown key', () => {
    setSearch('?simw=not_a_metric:0');
    expect(readInitialUrlState().simWeights).toBeNull();
  });
});
