import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFavorites } from '../hooks/useFavorites';
import { api } from '../utils/api';

describe('useFavorites', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      return storage[key] ?? null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      storage[key] = value;
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key: string) => {
      delete storage[key];
    });
  });

  it('starts with an empty favorites list', () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites).toEqual([]);
  });

  it('toggleFavorite adds a neighborhood', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite('00100');
    });

    expect(result.current.favorites).toContain('00100');
    expect(result.current.isFavorite('00100')).toBe(true);
  });

  it('toggleFavorite removes a neighborhood when toggled again', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite('00100');
    });
    expect(result.current.favorites).toContain('00100');

    act(() => {
      result.current.toggleFavorite('00100');
    });
    expect(result.current.favorites).not.toContain('00100');
    expect(result.current.isFavorite('00100')).toBe(false);
  });

  it('isFavorite returns correct boolean', () => {
    const { result } = renderHook(() => useFavorites());

    expect(result.current.isFavorite('00100')).toBe(false);

    act(() => {
      result.current.toggleFavorite('00100');
    });

    expect(result.current.isFavorite('00100')).toBe(true);
    expect(result.current.isFavorite('00200')).toBe(false);
  });

  it('clearFavorites empties the list', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite('00100');
      result.current.toggleFavorite('00200');
      result.current.toggleFavorite('00300');
    });
    expect(result.current.favorites).toHaveLength(3);

    act(() => {
      result.current.clearFavorites();
    });

    expect(result.current.favorites).toEqual([]);
    expect(result.current.isFavorite('00100')).toBe(false);
  });

  it('persists favorites to localStorage', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite('00100');
    });

    const stored = JSON.parse(storage['naapurustot-favorites']);
    expect(stored).toEqual(['00100']);
  });

  it('loads favorites from localStorage on mount', () => {
    storage['naapurustot-favorites'] = JSON.stringify(['00100', '00200']);

    const { result } = renderHook(() => useFavorites());

    expect(result.current.favorites).toEqual(['00100', '00200']);
    expect(result.current.isFavorite('00100')).toBe(true);
  });

  it('handles malformed localStorage data gracefully', () => {
    storage['naapurustot-favorites'] = 'not-valid-json{{{';

    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites).toEqual([]);
  });
});

describe('useFavorites — server sync', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      return storage[key] ?? null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      storage[key] = value;
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key: string) => {
      delete storage[key];
    });
  });

  it('fetches and merges server favorites on login', async () => {
    // Local has 00100, server has 00100 + 00200
    storage['naapurustot-favorites'] = JSON.stringify(['00100']);
    const getFavSpy = vi.spyOn(api, 'getFavorites').mockResolvedValue({
      data: { favorites: ['00100', '00200'] },
    });
    const saveFavSpy = vi.spyOn(api, 'saveFavorites').mockResolvedValue({
      data: { favorites: [] },
    });

    const { result } = renderHook(() => useFavorites('user-123'));

    await waitFor(() => {
      expect(result.current.favorites).toEqual(['00100', '00200']);
    });
    expect(getFavSpy).toHaveBeenCalled();
    // Server already has both, no save needed
    expect(saveFavSpy).not.toHaveBeenCalled();
  });

  it('pushes merged favorites to server when local has extras', async () => {
    // Local has 00300 that server doesn't
    storage['naapurustot-favorites'] = JSON.stringify(['00100', '00300']);
    vi.spyOn(api, 'getFavorites').mockResolvedValue({
      data: { favorites: ['00100', '00200'] },
    });
    const saveFavSpy = vi.spyOn(api, 'saveFavorites').mockResolvedValue({
      data: { favorites: [] },
    });

    const { result } = renderHook(() => useFavorites('user-123'));

    await waitFor(() => {
      expect(result.current.favorites).toEqual(['00100', '00300', '00200']);
    });
    // Merged result differs from server, so it should be pushed
    expect(saveFavSpy).toHaveBeenCalledWith(['00100', '00300', '00200']);
  });

  it('does not fetch from server when userId is null', () => {
    vi.restoreAllMocks();
    // Re-setup localStorage mocks after restoreAllMocks
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      return storage[key] ?? null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      storage[key] = value;
    });
    const getFavSpy = vi.spyOn(api, 'getFavorites').mockResolvedValue({
      data: { favorites: [] },
    });

    renderHook(() => useFavorites(null));
    expect(getFavSpy).not.toHaveBeenCalled();
  });
});
