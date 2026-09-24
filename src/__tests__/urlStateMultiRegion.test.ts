/**
 * Multi-region view — the `city` URL codec in useUrlState.
 *
 * The region selection is a PRIMARY region plus any regions displayed alongside it,
 * carried as one comma list: `city=helsinki_metro,lahti` (primary first). A single id
 * and `all` must keep exactly their pre-multi-region meaning, and a list the writer
 * produces must read back to the same primary + extras. The reader goes through
 * `parseCityParam` (src/utils/regionSet.ts); these tests pin the URL-level contract,
 * including the legacy `#city=` hash path and the shortlist share link.
 *
 * URLs are set with the real `window.history.replaceState` so jsdom's `location`
 * reflects them exactly as a browser would, and the writer's output is read back
 * from `location.search` rather than a mocked call.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  readInitialUrlState,
  useSyncUrlState,
  buildShortlistShareUrl,
} from '../hooks/useUrlState';
import { REGION_IDS } from '../utils/regions';
import type { LayerId } from '../utils/colorScales';

/** Replace the query string (and clear the hash) without navigating. */
function setSearch(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  url.hash = '';
  window.history.replaceState(null, '', url.toString());
}

/** Replace the hash (and clear the query) — a legacy `#city=` bookmark. */
function setHash(hash: string) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = hash;
  window.history.replaceState(null, '', url.toString());
}

/** The decoded `city` value currently in the address bar, or null when absent. */
function cityInUrl(): string | null {
  return new URLSearchParams(window.location.search).get('city');
}

beforeEach(() => {
  setSearch('');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setSearch('');
});

describe('readInitialUrlState — city comma list', () => {
  it('reads a two-region list as primary + one extra', () => {
    setSearch('?city=helsinki_metro,lahti');
    const s = readInitialUrlState();
    expect(s.city).toBe('helsinki_metro');
    expect(s.extraCities).toEqual(['lahti']);
  });

  it('keeps list order: the first id is the primary, the rest are extras in order', () => {
    setSearch('?city=lahti,turku,helsinki_metro');
    const s = readInitialUrlState();
    expect(s.city).toBe('lahti');
    expect(s.extraCities).toEqual(['turku', 'helsinki_metro']);
  });

  it('a single region id is unchanged: that city with no extras', () => {
    setSearch('?city=lahti');
    const s = readInitialUrlState();
    expect(s.city).toBe('lahti');
    expect(s.extraCities).toEqual([]);
  });

  it("'all' is the national view with no extras", () => {
    setSearch('?city=all');
    const s = readInitialUrlState();
    expect(s.city).toBe('all');
    expect(s.extraCities).toEqual([]);
  });

  it('an unknown single id resolves to null (the app falls back to its default)', () => {
    setSearch('?city=bogus');
    const s = readInitialUrlState();
    expect(s.city).toBeNull();
    expect(s.extraCities).toEqual([]);
  });

  it('absent or empty city is null with no extras', () => {
    setSearch('');
    expect(readInitialUrlState().city).toBeNull();
    expect(readInitialUrlState().extraCities).toEqual([]);
    setSearch('?city=');
    expect(readInitialUrlState().city).toBeNull();
    expect(readInitialUrlState().extraCities).toEqual([]);
  });

  it('a list of nothing but unknown ids resolves to null', () => {
    setSearch('?city=bogus,nope,,');
    const s = readInitialUrlState();
    expect(s.city).toBeNull();
    expect(s.extraCities).toEqual([]);
  });

  it('a percent-encoded comma parses exactly like a literal one', () => {
    setSearch('?city=helsinki_metro%2Clahti');
    const encoded = readInitialUrlState();
    setSearch('?city=helsinki_metro,lahti');
    const literal = readInitialUrlState();
    expect(encoded.city).toBe('helsinki_metro');
    expect(encoded.extraCities).toEqual(['lahti']);
    expect(encoded.city).toBe(literal.city);
    expect(encoded.extraCities).toEqual(literal.extraCities);
  });

  it('drops unknown ids from the list without discarding the valid ones', () => {
    setSearch('?city=helsinki_metro,bogus,lahti');
    const s = readInitialUrlState();
    expect(s.city).toBe('helsinki_metro');
    expect(s.extraCities).toEqual(['lahti']);
  });

  it('an invalid primary falls through to the next valid id', () => {
    setSearch('?city=bogus,lahti,turku');
    const s = readInitialUrlState();
    expect(s.city).toBe('lahti');
    expect(s.extraCities).toEqual(['turku']);
  });

  it('drops duplicates, keeping first occurrence order', () => {
    setSearch('?city=helsinki_metro,lahti,helsinki_metro,lahti,turku');
    const s = readInitialUrlState();
    expect(s.city).toBe('helsinki_metro');
    expect(s.extraCities).toEqual(['lahti', 'turku']);
  });

  it('a list that repeats only the primary collapses to a single region', () => {
    setSearch('?city=lahti,lahti');
    const s = readInitialUrlState();
    expect(s.city).toBe('lahti');
    expect(s.extraCities).toEqual([]);
  });

  it('empty segments and a trailing comma are ignored', () => {
    setSearch('?city=,helsinki_metro,,lahti,');
    const s = readInitialUrlState();
    expect(s.city).toBe('helsinki_metro');
    expect(s.extraCities).toEqual(['lahti']);
  });

  it("'all' can never be an extra region, and never survives inside a list", () => {
    setSearch('?city=lahti,all');
    const a = readInitialUrlState();
    expect(a.city).toBe('lahti');
    expect(a.extraCities).toEqual([]);

    // Hand-crafted `all,lahti`: 'all' is not a region id, so the fall-through rule
    // promotes lahti rather than showing a national view with an "extra" region.
    setSearch('?city=all,lahti');
    const b = readInitialUrlState();
    expect(b.city).toBe('lahti');
    expect(b.extraCities).toEqual([]);
  });

  it('ids are matched exactly (case- and whitespace-sensitive), like the single-id reader', () => {
    setSearch('?city=helsinki_metro,Lahti,%20lahti');
    const s = readInitialUrlState();
    expect(s.city).toBe('helsinki_metro');
    expect(s.extraCities).toEqual([]);
  });

  it('invariant: extras never contain the primary and hold no duplicates, for every list', () => {
    const lists = [
      'helsinki_metro,lahti,helsinki_metro',
      'lahti,lahti,turku,lahti',
      'turku,tampere,turku,tampere,oulu',
      'bogus,oulu,oulu,bogus,turku',
    ];
    for (const raw of lists) {
      setSearch(`?city=${raw}`);
      const s = readInitialUrlState();
      expect(s.city).not.toBeNull();
      expect(s.extraCities).not.toContain(s.city);
      expect(new Set(s.extraCities).size).toBe(s.extraCities.length);
      for (const id of s.extraCities) expect(REGION_IDS).toContain(id);
    }
  });

  it('holds every region at once, primary first', () => {
    setSearch(`?city=${REGION_IDS.join(',')}`);
    const s = readInitialUrlState();
    expect(s.city).toBe(REGION_IDS[0]);
    expect(s.extraCities).toEqual(REGION_IDS.slice(1));
  });

  it('a multi-region city does not disturb the params around it', () => {
    setSearch('?pno=00100&layer=median_income&compare=00100,15100&city=helsinki_metro,lahti&scope=region');
    const s = readInitialUrlState();
    expect(s.pno).toBe('00100');
    expect(s.layer).toBe('median_income');
    expect(s.compare).toEqual(['00100', '15100']);
    expect(s.city).toBe('helsinki_metro');
    expect(s.extraCities).toEqual(['lahti']);
    // The hook reports the URL faithfully; forcing scope to 'all' in a multi-region
    // view is App's job, not the codec's.
    expect(s.scope).toBe('region');
  });
});

describe('readInitialUrlState — legacy #city= hash', () => {
  it('a single id in the hash still works', () => {
    setHash('#city=tampere');
    const s = readInitialUrlState();
    expect(s.city).toBe('tampere');
    expect(s.extraCities).toEqual([]);
  });

  it('migrates the hash to a query string that reads back the same', () => {
    setHash('#city=tampere');
    readInitialUrlState();
    expect(window.location.hash).toBe('');
    expect(cityInUrl()).toBe('tampere');
    const again = readInitialUrlState();
    expect(again.city).toBe('tampere');
    expect(again.extraCities).toEqual([]);
  });

  it('a comma list in the hash is read as primary + extras, and survives migration', () => {
    setHash('#pno=00100&city=helsinki_metro,lahti');
    const s = readInitialUrlState();
    expect(s.pno).toBe('00100');
    expect(s.city).toBe('helsinki_metro');
    expect(s.extraCities).toEqual(['lahti']);

    expect(window.location.hash).toBe('');
    const again = readInitialUrlState();
    expect(again.pno).toBe('00100');
    expect(again.city).toBe('helsinki_metro');
    expect(again.extraCities).toEqual(['lahti']);
  });

  it('an unknown id in the hash resolves to null', () => {
    setHash('#city=bogus');
    const s = readInitialUrlState();
    expect(s.city).toBeNull();
    expect(s.extraCities).toEqual([]);
  });
});

describe('useSyncUrlState — writing a multi-region city', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('writes a region list that round-trips through readInitialUrlState', () => {
    renderHook(() => useSyncUrlState(null, 'quality_index', [], 'helsinki_metro,lahti', true));
    vi.advanceTimersByTime(100);

    expect(cityInUrl()).toBe('helsinki_metro,lahti');
    const s = readInitialUrlState();
    expect(s.city).toBe('helsinki_metro');
    expect(s.extraCities).toEqual(['lahti']);
  });

  it('is debounced: nothing is written before the 100 ms timer fires', () => {
    renderHook(() => useSyncUrlState(null, 'quality_index', [], 'helsinki_metro,lahti', true));
    vi.advanceTimersByTime(99);
    expect(cityInUrl()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(cityInUrl()).toBe('helsinki_metro,lahti');
  });

  it('does not write while not ready (the initial list survives for restoration)', () => {
    setSearch('?city=helsinki_metro,lahti');
    renderHook(() => useSyncUrlState(null, 'quality_index', [], 'all', false));
    vi.advanceTimersByTime(500);
    const s = readInitialUrlState();
    expect(s.city).toBe('helsinki_metro');
    expect(s.extraCities).toEqual(['lahti']);
  });

  it('round-trips a three-region list with pno, layer and pins alongside it', () => {
    renderHook(() =>
      useSyncUrlState('15100', 'median_income', ['00100', '15100'], 'lahti,helsinki_metro,turku', true),
    );
    vi.advanceTimersByTime(100);
    const s = readInitialUrlState();
    expect(s.pno).toBe('15100');
    expect(s.layer).toBe('median_income');
    expect(s.compare).toEqual(['00100', '15100']);
    expect(s.city).toBe('lahti');
    expect(s.extraCities).toEqual(['helsinki_metro', 'turku']);
  });

  it("omits 'all' entirely — going back to the national view clears the city param", () => {
    setSearch('?city=helsinki_metro,lahti');
    renderHook(() => useSyncUrlState(null, 'quality_index', [], 'all', true));
    vi.advanceTimersByTime(100);
    expect(new URLSearchParams(window.location.search).has('city')).toBe(false);
    expect(window.location.search).toBe('');
    const s = readInitialUrlState();
    expect(s.city).toBeNull();
    expect(s.extraCities).toEqual([]);
  });

  it("omits 'all' alongside other params too", () => {
    renderHook(() => useSyncUrlState('00100', 'median_income', [], 'all', true));
    vi.advanceTimersByTime(100);
    const params = new URLSearchParams(window.location.search);
    expect(params.has('city')).toBe(false);
    expect(params.get('pno')).toBe('00100');
  });

  it('follows the selection as regions are added and removed', () => {
    const { rerender } = renderHook(
      ({ city }: { city: string }) => useSyncUrlState(null, 'quality_index', [], city, true),
      { initialProps: { city: 'helsinki_metro' } },
    );
    vi.advanceTimersByTime(100);
    expect(readInitialUrlState()).toMatchObject({ city: 'helsinki_metro', extraCities: [] });

    rerender({ city: 'helsinki_metro,lahti' });
    vi.advanceTimersByTime(100);
    expect(readInitialUrlState()).toMatchObject({ city: 'helsinki_metro', extraCities: ['lahti'] });

    rerender({ city: 'helsinki_metro,lahti,turku' });
    vi.advanceTimersByTime(100);
    expect(readInitialUrlState()).toMatchObject({ city: 'helsinki_metro', extraCities: ['lahti', 'turku'] });

    // Removing the primary promotes the first extra (regionReducer) → the key changes order.
    rerender({ city: 'lahti,turku' });
    vi.advanceTimersByTime(100);
    expect(readInitialUrlState()).toMatchObject({ city: 'lahti', extraCities: ['turku'] });

    rerender({ city: 'all' });
    vi.advanceTimersByTime(100);
    expect(cityInUrl()).toBeNull();
  });

  it('coalesces rapid changes into one write of the final value', () => {
    const spy = vi.spyOn(window.history, 'replaceState');
    const { rerender } = renderHook(
      ({ city }: { city: string }) => useSyncUrlState(null, 'quality_index', [], city, true),
      { initialProps: { city: 'helsinki_metro' } },
    );
    rerender({ city: 'helsinki_metro,lahti' });
    rerender({ city: 'helsinki_metro,lahti,turku' });
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(readInitialUrlState()).toMatchObject({ city: 'helsinki_metro', extraCities: ['lahti', 'turku'] });
  });

  it('does not rewrite the URL once it already holds the same list', () => {
    const spy = vi.spyOn(window.history, 'replaceState');
    const layer: LayerId = 'quality_index';
    const { rerender } = renderHook(
      ({ city }: { city: string }) => useSyncUrlState(null, layer, [], city, true),
      { initialProps: { city: 'helsinki_metro,lahti' } },
    );
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);

    // Same string again (and a new-but-equal compare array would behave the same):
    // the serialized URL matches location.search, so there is no churn.
    rerender({ city: 'helsinki_metro,lahti' });
    vi.advanceTimersByTime(500);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a hand-typed literal-comma link is normalised at most once, then stays stable', () => {
    setSearch('?city=helsinki_metro,lahti');
    const spy = vi.spyOn(window.history, 'replaceState');
    const { rerender } = renderHook(
      ({ pins }: { pins: string[] }) => useSyncUrlState(null, 'quality_index', pins, 'helsinki_metro,lahti', true),
      { initialProps: { pins: [] as string[] } },
    );
    vi.advanceTimersByTime(100);
    const writesAfterFirst = spy.mock.calls.length;
    expect(writesAfterFirst).toBeLessThanOrEqual(1);
    expect(readInitialUrlState()).toMatchObject({ city: 'helsinki_metro', extraCities: ['lahti'] });

    // A fresh (reference-unequal) pins array re-runs the effect; it must not write again.
    rerender({ pins: [] });
    vi.advanceTimersByTime(100);
    expect(spy.mock.calls.length).toBe(writesAfterFirst);
  });
});

describe('buildShortlistShareUrl — multi-region city', () => {
  it('carries the region list so the recipient opens the same regions', () => {
    const url = buildShortlistShareUrl(['00100'], 'helsinki_metro,lahti');
    const params = new URL(url).searchParams;
    expect(params.get('sl')).toBe('00100');
    expect(params.get('city')).toBe('helsinki_metro,lahti');

    setSearch(new URL(url).search);
    const s = readInitialUrlState();
    expect(s.shortlist).toEqual(['00100']);
    expect(s.city).toBe('helsinki_metro');
    expect(s.extraCities).toEqual(['lahti']);
    // Still a minimal link: no author selection or layer leaks in.
    expect(s.pno).toBeNull();
    expect(s.layer).toBeNull();
  });

  it("omits the city for the national 'all' view", () => {
    const url = buildShortlistShareUrl(['00100', '15100'], 'all');
    const params = new URL(url).searchParams;
    expect(params.has('city')).toBe(false);
    setSearch(new URL(url).search);
    const s = readInitialUrlState();
    expect(s.shortlist).toEqual(['00100', '15100']);
    expect(s.city).toBeNull();
    expect(s.extraCities).toEqual([]);
  });

  it('an empty shortlist yields the bare link regardless of the region list', () => {
    const url = buildShortlistShareUrl([], 'helsinki_metro,lahti');
    expect(new URL(url).search).toBe('');
  });
});
