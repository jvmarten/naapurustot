import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock i18n to prevent issues
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

import { readInitialUrlState, useSyncUrlState } from '../hooks/useUrlState';
import { renderHook } from '@testing-library/react';

function setUrl(search: string, hash = '') {
  Object.defineProperty(window, 'location', {
    value: { search, hash, pathname: '/' },
    writable: true,
  });
}

describe('readInitialUrlState — deep edge cases', () => {
  beforeEach(() => {
    setUrl('');
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  });

  it('handles PNO with leading zeros', () => {
    setUrl('?pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('rejects PNO that is too short', () => {
    setUrl('?pno=0010');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('rejects PNO that is too long', () => {
    setUrl('?pno=001000');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('rejects non-numeric PNO', () => {
    setUrl('?pno=abcde');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('accepts valid layer ID', () => {
    setUrl('?layer=median_income');
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('rejects invalid layer ID', () => {
    setUrl('?layer=nonexistent_layer');
    const state = readInitialUrlState();
    expect(state.layer).toBeNull();
  });

  it('parses multiple compare PNOs', () => {
    setUrl('?compare=00100,00200,00300');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('filters out invalid PNOs from compare list', () => {
    setUrl('?compare=00100,invalid,00200');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });

  it('returns empty compare for empty compare param', () => {
    setUrl('?compare=');
    const state = readInitialUrlState();
    expect(state.compare).toEqual([]);
  });

  it('parses all params together', () => {
    setUrl('?pno=00100&layer=unemployment&compare=00200,00300');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('unemployment');
    expect(state.compare).toEqual(['00200', '00300']);
  });

  it('falls back to hash params for legacy URLs', () => {
    setUrl('', '#pno=00100&layer=median_income');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
  });

  it('prefers query params over hash params when both present', () => {
    setUrl('?pno=00200', '#pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00200');
  });

  it('migrates hash params to query params', () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    setUrl('', '#pno=00100&layer=median_income');
    readInitialUrlState();
    expect(replaceStateSpy).toHaveBeenCalled();
  });

  it('handles XSS attempt in PNO gracefully', () => {
    setUrl('?pno=<script>');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('handles SQL injection attempt in layer gracefully', () => {
    setUrl("?layer='; DROP TABLE--");
    const state = readInitialUrlState();
    expect(state.layer).toBeNull();
  });
});

describe('useSyncUrlState', () => {
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

  it('writes pno to URL', () => {
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState('00100', 'quality_index'));
    vi.advanceTimersByTime(150);
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    expect(lastCall[2]).toBe('/?pno=00100');
  });

  it('writes layer to URL when not quality_index', () => {
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState(null, 'median_income'));
    vi.advanceTimersByTime(150);
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    expect(lastCall[2]).toBe('/?layer=median_income');
  });

  it('omits layer from URL when it is quality_index (default)', () => {
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState('00100', 'quality_index'));
    vi.advanceTimersByTime(150);
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    const url = lastCall[2] as string;
    expect(url).not.toContain('layer=');
  });

  it('writes compare PNOs to URL', () => {
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState(null, 'quality_index', ['00200', '00300']));
    vi.advanceTimersByTime(150);
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    expect(lastCall[2]).toBe('/?compare=00200%2C00300');
  });

  it('omits city from URL when it is helsinki_metro (default)', () => {
    // Set search to something non-empty so writeUrl actually calls replaceState
    Object.defineProperty(window, 'location', {
      value: { search: '?city=helsinki_metro', hash: '', pathname: '/' },
      writable: true,
      configurable: true,
    });
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState(null, 'quality_index', [], 'helsinki_metro'));
    vi.advanceTimersByTime(150);
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    const url = lastCall[2] as string;
    expect(url).not.toContain('city=');
  });

  it('writes city to URL when set to turku', () => {
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState(null, 'quality_index', [], 'turku'));
    vi.advanceTimersByTime(150);
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    expect(lastCall[2]).toBe('/?city=turku');
  });

  it('writes city to URL when set to all', () => {
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState(null, 'quality_index', [], 'all'));
    vi.advanceTimersByTime(150);
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    expect(lastCall[2]).toBe('/?city=all');
  });

  it('produces clean URL when no state is set', () => {
    // Set search to something non-empty so writeUrl actually calls replaceState
    Object.defineProperty(window, 'location', {
      value: { search: '?pno=00100', hash: '', pathname: '/' },
      writable: true,
      configurable: true,
    });
    replaceStateSpy.mockClear();
    renderHook(() => useSyncUrlState(null, 'quality_index', []));
    vi.advanceTimersByTime(150);
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    expect(lastCall[2]).toBe('/');
  });
});
