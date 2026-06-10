import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildShortlistShareUrl,
  readInitialUrlState,
  URL_SCHEMA_VERSION,
} from '../hooks/useUrlState';

function setSearch(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState(null, '', url.toString());
}

describe('CF-11 buildShortlistShareUrl — scoped sl+city link', () => {
  beforeEach(() => {
    setSearch('');
  });

  it('carries ONLY the shortlist and the schema stamp (default city omitted)', () => {
    const url = buildShortlistShareUrl(['00100', '00200'], 'all');
    const params = new URL(url).searchParams;
    expect(params.get('sl')).toBe('00100.00200');
    expect(params.get('_v')).toBe(String(URL_SCHEMA_VERSION));
    expect(params.get('city')).toBeNull();
    // No author state must leak.
    for (const k of ['pno', 'layer', 'filter', 'qw', 'qp', 'iso', 'compare', 'v', 'simw', 'draw']) {
      expect(params.get(k)).toBeNull();
    }
  });

  it('includes a non-default city', () => {
    const url = buildShortlistShareUrl(['00100'], 'turku');
    const params = new URL(url).searchParams;
    expect(params.get('city')).toBe('turku');
    expect(params.get('sl')).toBe('00100');
  });

  it('returns the bare path when the shortlist is empty', () => {
    const url = buildShortlistShareUrl([], 'helsinki_metro');
    expect(new URL(url).search).toBe('');
  });

  it('drops invalid (non 5-digit) pnos', () => {
    const url = buildShortlistShareUrl(['00100', 'abc', '1', '00300'], 'helsinki_metro');
    expect(new URL(url).searchParams.get('sl')).toBe('00100.00300');
  });

  it('round-trips through readInitialUrlState carrying only the shortlist', () => {
    const url = buildShortlistShareUrl(['00100', '00200'], 'turku');
    setSearch(new URL(url).search);
    const s = readInitialUrlState();
    expect(s.shortlist).toEqual(['00100', '00200']);
    expect(s.city).toBe('turku');
    expect(s.pno).toBeNull();
    expect(s.layer).toBeNull();
    expect(s.filters).toEqual([]);
    expect(s.weights).toBeNull();
  });
});
