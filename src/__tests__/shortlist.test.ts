import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShortlist } from '../hooks/useShortlist';

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
