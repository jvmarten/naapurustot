import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavorites } from '../hooks/useFavorites';

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
