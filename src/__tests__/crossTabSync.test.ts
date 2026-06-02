import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavorites } from '../hooks/useFavorites';

/**
 * PO-5b: a change written to localStorage in another tab fires a `storage` event
 * in this one; the hook should adopt it so favorites stay consistent across tabs.
 */
describe('cross-tab sync (PO-5b)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('useFavorites adopts a favorite added in another tab', () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.isFavorite('00100')).toBe(false);

    act(() => {
      localStorage.setItem('naapurustot-favorites', JSON.stringify(['00100']));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'naapurustot-favorites',
          newValue: JSON.stringify(['00100']),
        }),
      );
    });

    expect(result.current.isFavorite('00100')).toBe(true);
  });

  it('ignores storage events for unrelated keys', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'some-other-key', newValue: 'x' }),
      );
    });
    expect(result.current.favorites).toEqual([]);
  });
});
