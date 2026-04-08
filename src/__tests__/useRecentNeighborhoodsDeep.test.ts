/**
 * Tests for useRecentNeighborhoods hook.
 *
 * This hook manages recently-searched neighborhoods in sessionStorage.
 * Bugs here cause lost search history or crashes from malformed data.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecentNeighborhoods, type RecentEntry } from '../hooks/useRecentNeighborhoods';

beforeEach(() => {
  sessionStorage.clear();
});

function makeEntry(pno: string, name = `Area ${pno}`): RecentEntry {
  return { pno, name, center: [24.94, 60.17] };
}

describe('useRecentNeighborhoods', () => {
  it('starts empty when sessionStorage is empty', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());
    expect(result.current.recent).toEqual([]);
  });

  it('adds a recent entry', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());
    act(() => result.current.addRecent(makeEntry('00100')));
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0].pno).toBe('00100');
  });

  it('prepends new entries (most recent first)', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());
    act(() => result.current.addRecent(makeEntry('00100')));
    act(() => result.current.addRecent(makeEntry('00200')));
    expect(result.current.recent[0].pno).toBe('00200');
    expect(result.current.recent[1].pno).toBe('00100');
  });

  it('deduplicates: re-adding same PNO moves it to front', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());
    act(() => result.current.addRecent(makeEntry('00100')));
    act(() => result.current.addRecent(makeEntry('00200')));
    act(() => result.current.addRecent(makeEntry('00100', 'Updated Name')));
    expect(result.current.recent).toHaveLength(2);
    expect(result.current.recent[0].pno).toBe('00100');
    expect(result.current.recent[0].name).toBe('Updated Name');
  });

  it('enforces maximum of 10 entries', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());
    for (let i = 0; i < 15; i++) {
      act(() => result.current.addRecent(makeEntry(String(i).padStart(5, '0'))));
    }
    expect(result.current.recent).toHaveLength(10);
    // Most recent should be the last added
    expect(result.current.recent[0].pno).toBe('00014');
  });

  it('persists to sessionStorage', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());
    act(() => result.current.addRecent(makeEntry('00100')));
    const stored = JSON.parse(sessionStorage.getItem('naapurustot-recent')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].pno).toBe('00100');
  });

  it('restores from sessionStorage on mount', () => {
    sessionStorage.setItem('naapurustot-recent', JSON.stringify([makeEntry('00100')]));
    const { result } = renderHook(() => useRecentNeighborhoods());
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0].pno).toBe('00100');
  });

  it('handles malformed sessionStorage data gracefully', () => {
    sessionStorage.setItem('naapurustot-recent', 'not-json');
    const { result } = renderHook(() => useRecentNeighborhoods());
    expect(result.current.recent).toEqual([]);
  });

  it('filters out invalid entries from sessionStorage', () => {
    sessionStorage.setItem('naapurustot-recent', JSON.stringify([
      makeEntry('00100'),
      { pno: '00200' }, // missing name and center
      { pno: '00300', name: 'Test', center: [NaN, 60] }, // NaN in center
      makeEntry('00400'),
    ]));
    const { result } = renderHook(() => useRecentNeighborhoods());
    expect(result.current.recent).toHaveLength(2);
    expect(result.current.recent[0].pno).toBe('00100');
    expect(result.current.recent[1].pno).toBe('00400');
  });

  it('handles non-array sessionStorage data', () => {
    sessionStorage.setItem('naapurustot-recent', JSON.stringify({ pno: '00100' }));
    const { result } = renderHook(() => useRecentNeighborhoods());
    expect(result.current.recent).toEqual([]);
  });
});
