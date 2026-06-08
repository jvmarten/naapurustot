import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

import { readInitialUrlState, useSyncUrlState, URL_SCHEMA_VERSION } from '../hooks/useUrlState';
import { renderHook } from '@testing-library/react';

function setUrl(search: string, hash = '') {
  Object.defineProperty(window, 'location', {
    value: { search, hash, pathname: '/' },
    writable: true,
    configurable: true,
  });
}

describe('CF-1 affordability URL param (aff)', () => {
  beforeEach(() => {
    setUrl('');
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  });

  it('parses income-mode affordability', () => {
    setUrl('?aff=i~3000~50');
    const s = readInitialUrlState();
    expect(s.affordability).toEqual({ mode: 'income', amount: 3000, sizeM2: 50 });
  });

  it('parses budget-mode affordability', () => {
    setUrl('?aff=b~1200~40');
    const s = readInitialUrlState();
    expect(s.affordability).toEqual({ mode: 'budget', amount: 1200, sizeM2: 40 });
  });

  it('rejects out-of-range / malformed values', () => {
    setUrl('?aff=i~0~50');
    expect(readInitialUrlState().affordability).toBeNull();
    setUrl('?aff=b~1200~99999');
    expect(readInitialUrlState().affordability).toBeNull();
    setUrl('?aff=x~1200~40');
    expect(readInitialUrlState().affordability).toBeNull();
    setUrl('?aff=garbage');
    expect(readInitialUrlState().affordability).toBeNull();
  });

  it('is clamped (dropped) for a newer-than-current schema version', () => {
    setUrl(`?aff=i~3000~50&_v=${URL_SCHEMA_VERSION + 1}`);
    expect(readInitialUrlState().affordability).toBeNull();
  });

  it('is honoured under the current schema version', () => {
    setUrl(`?aff=b~1200~40&_v=${URL_SCHEMA_VERSION}`);
    expect(readInitialUrlState().affordability).toEqual({ mode: 'budget', amount: 1200, sizeM2: 40 });
  });
});

describe('CF-1 affordability serialization round-trip', () => {
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

  it('writes aff and stamps the schema version, then re-parses identically', () => {
    renderHook(() =>
      useSyncUrlState('00100', 'quality_index', [], 'helsinki_metro', true, {
        affordability: { mode: 'income', amount: 2800, sizeM2: 55 },
      }),
    );
    vi.advanceTimersByTime(150);
    const url = replaceStateSpy.mock.calls.at(-1)![2] as string;
    // URLSearchParams.toString() percent-encodes the `~` separators (same as `iso`).
    expect(decodeURIComponent(url)).toContain('aff=i~2800~55');
    expect(url).toContain(`_v=${URL_SCHEMA_VERSION}`);

    // Round-trip: feed the produced query string back through the parser.
    const search = url.slice(url.indexOf('?'));
    setUrl(search);
    expect(readInitialUrlState().affordability).toEqual({ mode: 'income', amount: 2800, sizeM2: 55 });
  });

  it('omits aff entirely when affordability is null', () => {
    renderHook(() =>
      useSyncUrlState('00100', 'quality_index', [], 'helsinki_metro', true, { affordability: null }),
    );
    vi.advanceTimersByTime(150);
    const url = replaceStateSpy.mock.calls.at(-1)![2] as string;
    expect(url).not.toContain('aff=');
  });
});
