import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  readInitialUrlState,
  buildViewportShareUrl,
  useSyncUrlState,
  URL_SCHEMA_VERSION,
} from '../hooks/useUrlState';
import { getDefaultWeights, getPersonaWeights, detectPersona } from '../utils/qualityIndex';

// Helper to set query params in jsdom
function setSearch(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState(null, '', url.toString());
}

describe('readInitialUrlState — CF-1 extended state', () => {
  beforeEach(() => {
    window.location.hash = '';
    setSearch('');
  });

  it('parses scope, year, colorblind and lang', () => {
    setSearch('?scope=region&year=2022&cb=protanopia&lang=en');
    const s = readInitialUrlState();
    expect(s.scope).toBe('region');
    expect(s.year).toBe(2022);
    expect(s.colorblind).toBe('protanopia');
    expect(s.lang).toBe('en');
  });

  it('rejects invalid extended params', () => {
    setSearch('?scope=bogus&year=99&cb=nope&lang=de');
    const s = readInitialUrlState();
    expect(s.scope).toBeNull();
    expect(s.year).toBeNull();
    expect(s.colorblind).toBeNull();
    expect(s.lang).toBeNull();
  });

  it('defaults extended state to null when absent', () => {
    setSearch('?pno=00100');
    const s = readInitialUrlState();
    expect(s.scope).toBeNull();
    expect(s.year).toBeNull();
    expect(s.colorblind).toBeNull();
    expect(s.lang).toBeNull();
  });

  it('QW-3: accepts a region id as pno (region deep link) and rejects a bogus one', () => {
    setSearch('?pno=helsinki_metro');
    expect(readInitialUrlState().pno).toBe('helsinki_metro');
    setSearch('?pno=00100'); // 5-digit postal code still accepted
    expect(readInitialUrlState().pno).toBe('00100');
    setSearch('?pno=not_a_region');
    expect(readInitialUrlState().pno).toBeNull();
  });
});

describe('readInitialUrlState — CF-1 weights / isochrone / viewport, QW-2 shortlist', () => {
  beforeEach(() => {
    window.location.hash = '';
    setSearch('');
  });

  it('parses a persona id into its full weight set', () => {
    setSearch('?qp=family');
    const s = readInitialUrlState();
    expect(s.weights).not.toBeNull();
    expect(detectPersona(s.weights!)).toBe('family');
  });

  it('ignores the default persona and unknown personas', () => {
    setSearch('?qp=default');
    expect(readInitialUrlState().weights).toBeNull();
    setSearch('?qp=not_a_persona');
    expect(readInitialUrlState().weights).toBeNull();
  });

  it('parses a custom weight diff onto the defaults', () => {
    setSearch('?qw=safety:40,income:0');
    const s = readInitialUrlState();
    expect(s.weights).not.toBeNull();
    const def = getDefaultWeights();
    expect(s.weights!.safety).toBe(40);
    expect(s.weights!.income).toBe(0);
    // untouched factors keep their default weight
    expect(s.weights!.air_quality).toBe(def.air_quality);
  });

  it('drops unknown factor ids and out-of-range weights in qw', () => {
    setSearch('?qw=not_a_factor:50,safety:9999');
    const s = readInitialUrlState();
    const def = getDefaultWeights();
    expect(s.weights!.safety).toBe(def.safety); // 9999 rejected → stays default
    expect((s.weights as Record<string, number>).not_a_factor).toBeUndefined();
  });

  it('round-trips a persona through getPersonaWeights/detectPersona', () => {
    const w = getPersonaWeights('student');
    expect(detectPersona(w)).toBe('student');
  });

  it('parses a valid isochrone and rejects a bad one', () => {
    setSearch('?iso=transit~30');
    expect(readInitialUrlState().isochrone).toEqual({ mode: 'transit', budget: 30 });
    setSearch('?iso=car~30'); // car not a supported mode yet
    expect(readInitialUrlState().isochrone).toBeNull();
    setSearch('?iso=walk~9999'); // over the budget cap
    expect(readInitialUrlState().isochrone).toBeNull();
  });

  it('parses a viewport and clamps an out-of-bounds one to null', () => {
    setSearch('?v=24.94~60.17~12');
    expect(readInitialUrlState().viewport).toEqual({ center: [24.94, 60.17], zoom: 12 });
    setSearch('?v=200~200~12'); // off-world
    expect(readInitialUrlState().viewport).toBeNull();
  });

  it('parses the shortlist as validated 5-digit pnos', () => {
    setSearch('?sl=00100.00200.bogus.20100');
    expect(readInitialUrlState().shortlist).toEqual(['00100', '00200', '20100']);
  });

  it('buildViewportShareUrl appends v only when a viewport is given', () => {
    setSearch('?pno=00100');
    expect(buildViewportShareUrl(null)).toBe(window.location.href);
    const withV = buildViewportShareUrl({ center: [24.94, 60.17], zoom: 11 });
    expect(withV).toContain('v=24.94');
    expect(withV).toContain('pno=00100');
  });
});

// ─── CF-9: drawn / selected-areas analysis area in the share URL ─────────────
describe('readInitialUrlState — CF-9 draw param (parse)', () => {
  beforeEach(() => {
    window.location.hash = '';
    setSearch('');
  });

  it('defaults draw to null when absent', () => {
    setSearch('?pno=00100');
    expect(readInitialUrlState().draw).toBeNull();
  });

  it('parses a select-areas pno list', () => {
    setSearch('?draw=s:00100.00200.00300');
    expect(readInitialUrlState().draw).toEqual({
      mode: 'select',
      pnos: ['00100', '00200', '00300'],
    });
  });

  it('drops invalid pnos from a select-areas list', () => {
    setSearch('?draw=s:00100.bogus.1234.00200');
    expect(readInitialUrlState().draw).toEqual({ mode: 'select', pnos: ['00100', '00200'] });
  });

  it('rejects a select-areas list with no valid pnos', () => {
    setSearch('?draw=s:bogus.1234');
    expect(readInitialUrlState().draw).toBeNull();
  });

  it('parses a free-hand polygon vertex list', () => {
    setSearch('?draw=p:24.94~60.17_24.95~60.18_24.96~60.16');
    expect(readInitialUrlState().draw).toEqual({
      mode: 'polygon',
      vertices: [
        [24.94, 60.17],
        [24.95, 60.18],
        [24.96, 60.16],
      ],
    });
  });

  it('rejects a polygon with fewer than 3 vertices', () => {
    setSearch('?draw=p:24.94~60.17_24.95~60.18');
    expect(readInitialUrlState().draw).toBeNull();
  });

  it('clamps off-world polygon vertices on parse (Finland bbox)', () => {
    // Middle vertex is off-world (200,200) and is silently dropped, leaving 3 valid
    // vertices that still form a polygon; an out-of-bbox vertex never survives.
    setSearch('?draw=p:24.94~60.17_200~200_24.95~60.18_24.96~60.16');
    const d = readInitialUrlState().draw;
    expect(d).toEqual({
      mode: 'polygon',
      vertices: [
        [24.94, 60.17],
        [24.95, 60.18],
        [24.96, 60.16],
      ],
    });
  });

  it('rejects a polygon left with <3 vertices after bbox clamping', () => {
    setSearch('?draw=p:24.94~60.17_200~200_24.95~60.18');
    expect(readInitialUrlState().draw).toBeNull();
  });

  it('caps a polygon at 60 vertices', () => {
    const verts: string[] = [];
    for (let i = 0; i < 80; i++) verts.push(`${(24 + i * 0.001).toFixed(5)}~60.17`);
    setSearch(`?draw=p:${verts.join('_')}`);
    const d = readInitialUrlState().draw;
    expect(d?.mode).toBe('polygon');
    expect(d && d.mode === 'polygon' ? d.vertices.length : 0).toBe(60);
  });

  it('rejects garbage draw values', () => {
    for (const bad of ['', 'x', 'garbage', 'p:', 's:', 'q:00100', '00100', 'p:abc~def']) {
      setSearch(`?draw=${encodeURIComponent(bad)}`);
      expect(readInitialUrlState().draw).toBeNull();
    }
  });

  it('is version-gated: a newer-schema draw param is clamped to null', () => {
    setSearch(`?pno=00100&draw=s:00100.00200&_v=${URL_SCHEMA_VERSION + 1}`);
    const s = readInitialUrlState();
    expect(s.pno).toBe('00100'); // primitive survives
    expect(s.draw).toBeNull(); // structured draw is clamped
  });
});

describe('readInitialUrlState (query params)', () => {
  beforeEach(() => {
    window.location.hash = '';
    setSearch('');
  });

  it('extracts pno from query params', () => {
    setSearch('?pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('extracts layer from query params', () => {
    setSearch('?layer=median_income');
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('extracts compare param as comma-separated PNOs', () => {
    setSearch('?compare=00100,00200,00300');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('extracts all params together', () => {
    setSearch('?pno=00100&layer=quality_index&compare=00200,00300');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('quality_index');
    expect(state.compare).toEqual(['00200', '00300']);
  });

  it('validates 5-digit PNO format and rejects invalid values', () => {
    setSearch('?pno=1234');
    expect(readInitialUrlState().pno).toBeNull();

    setSearch('?pno=123456');
    expect(readInitialUrlState().pno).toBeNull();

    setSearch('?pno=abcde');
    expect(readInitialUrlState().pno).toBeNull();

    setSearch('?pno=0010a');
    expect(readInitialUrlState().pno).toBeNull();
  });

  it('validates layer IDs and rejects invalid values', () => {
    setSearch('?layer=invalid_layer');
    expect(readInitialUrlState().layer).toBeNull();

    setSearch('?layer=');
    expect(readInitialUrlState().layer).toBeNull();
  });

  it('filters invalid PNOs from compare param', () => {
    setSearch('?compare=00100,abc,00200,1234,00300');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('returns empty compare array when param is absent', () => {
    setSearch('?pno=00100');
    const state = readInitialUrlState();
    expect(state.compare).toEqual([]);
  });

  it('returns all nulls/empty for empty URL', () => {
    setSearch('');
    window.location.hash = '';
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
  });
});

describe('readInitialUrlState (city param)', () => {
  beforeEach(() => {
    window.location.hash = '';
    setSearch('');
  });

  it('returns null city when no city param (defaults to the all-Finland view in App)', () => {
    setSearch('');
    const state = readInitialUrlState();
    expect(state.city).toBeNull();
  });

  it('accepts helsinki_metro as explicit city param', () => {
    setSearch('?city=helsinki_metro');
    const state = readInitialUrlState();
    expect(state.city).toBe('helsinki_metro');
  });

  it('accepts turku as city param', () => {
    setSearch('?city=turku');
    const state = readInitialUrlState();
    expect(state.city).toBe('turku');
  });

  it('accepts all as city param', () => {
    setSearch('?city=all');
    const state = readInitialUrlState();
    expect(state.city).toBe('all');
  });

  it('accepts tampere as city param', () => {
    setSearch('?city=tampere');
    const state = readInitialUrlState();
    expect(state.city).toBe('tampere');
  });

  it('accepts valid region city param', () => {
    setSearch('?city=oulu');
    const state = readInitialUrlState();
    expect(state.city).toBe('oulu');
  });

  it('rejects invalid city param', () => {
    setSearch('?city=invalid_city');
    const state = readInitialUrlState();
    expect(state.city).toBeNull();
  });
});

describe('readInitialUrlState (legacy hash fallback)', () => {
  beforeEach(() => {
    window.location.hash = '';
    setSearch('');
  });

  it('falls back to hash params for backwards compatibility', () => {
    window.location.hash = '#pno=00100&layer=median_income';
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
  });

  it('prefers query params over hash params', () => {
    setSearch('?pno=00200');
    window.location.hash = '#pno=00100';
    const state = readInitialUrlState();
    expect(state.pno).toBe('00200');
  });
});

// ─── IN-3: share-URL schema version tag + migration / clamp guard ────────────
describe('readInitialUrlState — IN-3 schema version parsing', () => {
  beforeEach(() => {
    window.location.hash = '';
    setSearch('');
  });

  it('exposes a stable current schema version constant', () => {
    expect(URL_SCHEMA_VERSION).toBe(2);
    expect(Number.isInteger(URL_SCHEMA_VERSION)).toBe(true);
  });

  it('round-trips structured params tagged with the current version (_v=2)', () => {
    setSearch(`?pno=00100&qp=family&sl=00100.00200&iso=transit~30&_v=${URL_SCHEMA_VERSION}`);
    const s = readInitialUrlState();
    // Current version → every structured decoder runs normally.
    expect(s.pno).toBe('00100');
    expect(detectPersona(s.weights!)).toBe('family');
    expect(s.shortlist).toEqual(['00100', '00200']);
    expect(s.isochrone).toEqual({ mode: 'transit', budget: 30 });
  });

  it('parses legacy links with no version tag as v1 (full back-compat)', () => {
    // No _v at all — every link shipped before IN-3.
    setSearch('?pno=00100&qp=student&sl=00100.00300&filter=median_income~25000~40000');
    const s = readInitialUrlState();
    expect(s.pno).toBe('00100');
    expect(detectPersona(s.weights!)).toBe('student');
    expect(s.shortlist).toEqual(['00100', '00300']);
    expect(s.filters).toEqual([{ layerId: 'median_income', min: 25000, max: 40000 }]);
  });

  it('treats a garbage version tag as legacy and still parses structured params', () => {
    // Hand-mangled / non-numeric / sub-1 versions must not blank the state.
    for (const bad of ['abc', '', '0', '-3', '2.5', 'NaN']) {
      setSearch(`?pno=00100&qp=family&_v=${encodeURIComponent(bad)}`);
      const s = readInitialUrlState();
      expect(s.pno).toBe('00100');
      expect(detectPersona(s.weights!)).toBe('family');
    }
  });

  it('clamps structured params from a NEWER schema while keeping stable primitives', () => {
    // A link from a future build (_v greater than current): its structured encodings
    // may have changed, so they are dropped rather than mis-decoded; primitives stay.
    setSearch(`?pno=00100&city=turku&layer=median_income&scope=region&qp=family&iso=transit~30&sl=00100.00200&filter=median_income~25000~40000&_v=${URL_SCHEMA_VERSION + 1}`);
    const s = readInitialUrlState();
    // Stable, self-validating primitives are honoured.
    expect(s.pno).toBe('00100');
    expect(s.city).toBe('turku');
    expect(s.layer).toBe('median_income');
    expect(s.scope).toBe('region');
    // Structured/version-sensitive params are clamped to absent.
    expect(s.weights).toBeNull();
    expect(s.isochrone).toBeNull();
    expect(s.shortlist).toEqual([]);
    expect(s.filters).toEqual([]);
    expect(s.viewport).toBeNull();
  });

  it('still clamps a newer-version viewport param', () => {
    setSearch(`?pno=00100&v=24.94~60.17~12&_v=${URL_SCHEMA_VERSION + 5}`);
    const s = readInitialUrlState();
    expect(s.pno).toBe('00100');
    expect(s.viewport).toBeNull();
  });
});

describe('useSyncUrlState — IN-3 schema version stamping', () => {
  let replaceStateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    replaceStateSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { search: '', hash: '', pathname: '/' },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.history, 'replaceState', {
      value: replaceStateSpy,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function lastUrl(): string {
    const calls = replaceStateSpy.mock.calls;
    return calls[calls.length - 1][2] as string;
  }

  it('does NOT stamp the version for plain primitive-only links', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?pno=99999', hash: '', pathname: '/' },
      writable: true,
      configurable: true,
    });
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState('00100', 'median_income', ['00200'], 'turku'));
    vi.advanceTimersByTime(150);
    const url = lastUrl();
    expect(url).toContain('pno=00100');
    expect(url).toContain('layer=median_income');
    expect(url).not.toContain('_v=');
  });

  it('stamps _v with the current version when a structured param is present', () => {
    replaceStateSpy.mockClear();
    renderHook(() =>
      useSyncUrlState('00100', 'quality_index', [], 'helsinki_metro', true, {
        shortlist: ['00100', '00200'],
      }),
    );
    vi.advanceTimersByTime(150);
    const url = lastUrl();
    expect(url).toContain('sl=00100.00200');
    expect(url).toContain(`_v=${URL_SCHEMA_VERSION}`);
  });

  it('keeps an empty URL clean (no version tag)', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?pno=00100', hash: '', pathname: '/' },
      writable: true,
      configurable: true,
    });
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState(null, 'quality_index', []));
    vi.advanceTimersByTime(150);
    expect(lastUrl()).toBe('/');
  });

  it('keeps a plain English home view clean — lang only, never wp or _v', () => {
    // Regression (URL pollution): a wizard priority profile saved in localStorage must
    // never be broadcast into the address bar on a plain load. The profile is a private
    // local preference that does not change the default map view, so it is no longer a
    // URL-sync extra at all — a normal home visit carries only honest, view-reflecting
    // state (here the chosen language), and so never triggers the structured `_v` tag.
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState(null, 'quality_index', [], 'all', true, { lang: 'en' }));
    vi.advanceTimersByTime(150);
    const url = lastUrl();
    expect(url).toContain('lang=en');
    expect(url).not.toContain('wp=');
    expect(url).not.toContain('_v=');
  });
});

describe('buildViewportShareUrl — IN-3 schema version stamping', () => {
  it('stamps _v alongside the structured viewport param', () => {
    // The preceding useSyncUrlState block swaps window.location for a plain object
    // without an href; restore a real, href-bearing location (with the pno search)
    // so buildViewportShareUrl can build a URL from it.
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/?pno=00100'),
      writable: true,
      configurable: true,
    });
    const url = buildViewportShareUrl({ center: [24.94, 60.17], zoom: 11 });
    expect(url).toContain('v=24.94');
    expect(url).toContain(`_v=${URL_SCHEMA_VERSION}`);
  });
});

// ─── CF-9: serialize side via useSyncUrlState (kept LAST: swaps window.location
//     for a plain object, which would break setSearch in later describes) ──────
describe('useSyncUrlState — CF-9 draw param (serialize + round-trip)', () => {
  let replaceStateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    replaceStateSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { search: '', hash: '', pathname: '/' },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.history, 'replaceState', {
      value: replaceStateSpy,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function lastUrl(): string {
    const calls = replaceStateSpy.mock.calls;
    return calls[calls.length - 1][2] as string;
  }

  // Parse a freshly serialized URL without setSearch (window.location is a plain
  // object here): point window.location at a real URL carrying the produced query.
  function parseProducedUrl(producedUrl: string) {
    const search = new URL(producedUrl, 'http://localhost').search;
    Object.defineProperty(window, 'location', {
      value: new URL(`http://localhost/${search}`),
      writable: true,
      configurable: true,
    });
    return readInitialUrlState();
  }

  it('serializes a select-areas selection and stamps the version', () => {
    replaceStateSpy.mockClear();
    renderHook(() =>
      useSyncUrlState('00100', 'quality_index', [], 'helsinki_metro', true, {
        draw: { mode: 'select', pnos: ['00100', '00200', '00300'] },
      }),
    );
    vi.advanceTimersByTime(150);
    const url = lastUrl();
    expect(url).toContain('draw=s%3A00100.00200.00300'); // ':' is percent-encoded
    expect(url).toContain(`_v=${URL_SCHEMA_VERSION}`);
  });

  it('round-trips a select-areas selection through serialize → parse', () => {
    replaceStateSpy.mockClear();
    renderHook(() =>
      useSyncUrlState('00100', 'quality_index', [], 'helsinki_metro', true, {
        draw: { mode: 'select', pnos: ['00100', '00200'] },
      }),
    );
    vi.advanceTimersByTime(150);
    expect(parseProducedUrl(lastUrl()).draw).toEqual({ mode: 'select', pnos: ['00100', '00200'] });
  });

  it('round-trips a free-hand polygon through serialize → parse (quantized to 5dp)', () => {
    replaceStateSpy.mockClear();
    renderHook(() =>
      useSyncUrlState('00100', 'quality_index', [], 'helsinki_metro', true, {
        draw: {
          mode: 'polygon',
          vertices: [
            [24.941234, 60.171567],
            [24.951111, 60.181111],
            [24.961, 60.161],
          ],
        },
      }),
    );
    vi.advanceTimersByTime(150);
    expect(parseProducedUrl(lastUrl()).draw).toEqual({
      mode: 'polygon',
      vertices: [
        [24.94123, 60.17157],
        [24.95111, 60.18111],
        [24.961, 60.161],
      ],
    });
  });

  it('does not write a draw param when no area is active', () => {
    // Start from a search that differs from the state being written so a
    // replaceState actually fires; the produced URL must carry pno but no draw.
    Object.defineProperty(window, 'location', {
      value: { search: '?pno=99999', hash: '', pathname: '/' },
      writable: true,
      configurable: true,
    });
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState('00100', 'quality_index', [], 'helsinki_metro', true, { draw: null }));
    vi.advanceTimersByTime(150);
    const url = lastUrl();
    expect(url).toContain('pno=00100');
    expect(url).not.toContain('draw=');
  });
});
