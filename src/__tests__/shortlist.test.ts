import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useShortlist } from '../hooks/useShortlist';
import { api } from '../utils/api';

describe('useShortlist (QW-2)', () => {
  afterEach(() => localStorage.clear());

  it('toggles membership and persists to localStorage', () => {
    const { result } = renderHook(() => useShortlist());
    expect(result.current.isInShortlist('00100')).toBe(false);
    act(() => result.current.toggleShortlist('00100'));
    expect(result.current.isInShortlist('00100')).toBe(true);
    expect(localStorage.getItem('naapurustot-shortlist')).toContain('00100');
    act(() => result.current.toggleShortlist('00100'));
    expect(result.current.isInShortlist('00100')).toBe(false);
  });

  it('removes a single entry and clears all', () => {
    const { result } = renderHook(() => useShortlist());
    act(() => {
      result.current.toggleShortlist('00100');
      result.current.toggleShortlist('00200');
    });
    expect(result.current.shortlist).toEqual(['00100', '00200']);
    act(() => result.current.removeFromShortlist('00100'));
    expect(result.current.shortlist).toEqual(['00200']);
    act(() => result.current.clearShortlist());
    expect(result.current.shortlist).toEqual([]);
  });
});

describe('useShortlist — server sync (QW-2b)', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => storage[key] ?? null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      storage[key] = value;
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key: string) => {
      delete storage[key];
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('fetches and merges the server shortlist on login', async () => {
    storage['naapurustot-shortlist'] = JSON.stringify(['00100']);
    const getSpy = vi.spyOn(api, 'getShortlist').mockResolvedValue({ data: { shortlist: ['00100', '00200'] } });
    const saveSpy = vi.spyOn(api, 'saveShortlist').mockResolvedValue({ data: { shortlist: [] } });

    const { result } = renderHook(() => useShortlist('user-123'));

    await waitFor(() => expect(result.current.shortlist).toEqual(['00100', '00200']));
    expect(getSpy).toHaveBeenCalled();
    // Server already has both entries → no push needed.
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('pushes the merged shortlist to the server when local has extras', async () => {
    storage['naapurustot-shortlist'] = JSON.stringify(['00100', '00300']);
    vi.spyOn(api, 'getShortlist').mockResolvedValue({ data: { shortlist: ['00100', '00200'] } });
    const saveSpy = vi.spyOn(api, 'saveShortlist').mockResolvedValue({ data: { shortlist: [] } });

    const { result } = renderHook(() => useShortlist('user-123'));

    await waitFor(() => expect(result.current.shortlist).toEqual(['00100', '00300', '00200']));
    expect(saveSpy).toHaveBeenCalledWith(['00100', '00300', '00200']);
  });

  it('does not fetch from the server when userId is null', () => {
    const getSpy = vi.spyOn(api, 'getShortlist').mockResolvedValue({ data: { shortlist: [] } });
    renderHook(() => useShortlist(null));
    expect(getSpy).not.toHaveBeenCalled();
  });
});
