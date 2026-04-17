import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../utils/api', () => ({
  api: {
    saveFavorites: vi.fn().mockResolvedValue({}),
    getFavorites: vi.fn().mockResolvedValue({ data: { favorites: [] } }),
  },
}));

describe('useFavorites', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads favorites from localStorage on mount', async () => {
    localStorage.setItem('naapurustot-favorites', JSON.stringify(['00100', '00200']));

    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites());

    expect(result.current.favorites).toEqual(['00100', '00200']);
  });

  it('returns empty array for malformed localStorage data', async () => {
    localStorage.setItem('naapurustot-favorites', '{invalid json');

    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites());

    expect(result.current.favorites).toEqual([]);
  });

  it('returns empty array when localStorage has non-array', async () => {
    localStorage.setItem('naapurustot-favorites', '"just a string"');

    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites());

    expect(result.current.favorites).toEqual([]);
  });

  it('returns empty array when localStorage array has non-string elements', async () => {
    localStorage.setItem('naapurustot-favorites', JSON.stringify([1, 2, 3]));

    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites());

    expect(result.current.favorites).toEqual([]);
  });

  it('toggleFavorite adds a new PNO', async () => {
    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites());

    act(() => result.current.toggleFavorite('00100'));

    expect(result.current.favorites).toEqual(['00100']);
    expect(result.current.isFavorite('00100')).toBe(true);
  });

  it('toggleFavorite removes an existing PNO', async () => {
    localStorage.setItem('naapurustot-favorites', JSON.stringify(['00100', '00200']));

    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites());

    act(() => result.current.toggleFavorite('00100'));

    expect(result.current.favorites).toEqual(['00200']);
    expect(result.current.isFavorite('00100')).toBe(false);
  });

  it('clearFavorites empties the list', async () => {
    localStorage.setItem('naapurustot-favorites', JSON.stringify(['00100', '00200']));

    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites());

    act(() => result.current.clearFavorites());

    expect(result.current.favorites).toEqual([]);
  });

  it('persists changes to localStorage', async () => {
    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites());

    act(() => result.current.toggleFavorite('00100'));

    expect(JSON.parse(localStorage.getItem('naapurustot-favorites')!)).toEqual(['00100']);
  });

  it('isFavorite returns false for non-favorite PNO', async () => {
    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites());

    expect(result.current.isFavorite('99999')).toBe(false);
  });
});

describe('useFavorites — mergeFavorites logic', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('merges server favorites with local favorites on login', async () => {
    localStorage.setItem('naapurustot-favorites', JSON.stringify(['00100']));

    const { api } = await import('../utils/api');
    (api.getFavorites as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { favorites: ['00200', '00300'] },
    });

    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites('user-123'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.favorites).toContain('00100');
    expect(result.current.favorites).toContain('00200');
    expect(result.current.favorites).toContain('00300');
  });

  it('deduplicates when server and local share the same PNO', async () => {
    localStorage.setItem('naapurustot-favorites', JSON.stringify(['00100', '00200']));

    const { api } = await import('../utils/api');
    (api.getFavorites as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { favorites: ['00200', '00300'] },
    });

    const { useFavorites } = await import('../hooks/useFavorites');
    const { result } = renderHook(() => useFavorites('user-456'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const pno200Count = result.current.favorites.filter(p => p === '00200').length;
    expect(pno200Count).toBe(1);
  });
});
