import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecentNeighborhoods } from '../hooks/useRecentNeighborhoods';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

describe('useRecentNeighborhoods', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('starts with empty recent list', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());
    expect(result.current.recent).toEqual([]);
  });

  it('adds a recent entry', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());

    act(() => result.current.addRecent({ pno: '00100', name: 'Helsinki', center: [24.94, 60.17] }));
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0].pno).toBe('00100');
  });

  it('moves duplicate PNO to the front instead of adding twice', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());

    act(() => result.current.addRecent({ pno: '00100', name: 'Helsinki', center: [24.94, 60.17] }));
    act(() => result.current.addRecent({ pno: '00200', name: 'Espoo', center: [24.66, 60.21] }));
    act(() => result.current.addRecent({ pno: '00100', name: 'Helsinki', center: [24.94, 60.17] }));

    expect(result.current.recent).toHaveLength(2);
    expect(result.current.recent[0].pno).toBe('00100');
    expect(result.current.recent[1].pno).toBe('00200');
  });

  it('limits to 10 entries maximum', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());

    for (let i = 0; i < 12; i++) {
      act(() =>
        result.current.addRecent({
          pno: String(i).padStart(5, '0'),
          name: `Area ${i}`,
          center: [24.9, 60.2],
        }),
      );
    }

    expect(result.current.recent).toHaveLength(10);
    // Most recent entry should be first
    expect(result.current.recent[0].pno).toBe('00011');
  });

  it('persists to sessionStorage', () => {
    const { result } = renderHook(() => useRecentNeighborhoods());

    act(() => result.current.addRecent({ pno: '00100', name: 'Helsinki', center: [24.94, 60.17] }));

    const stored = JSON.parse(sessionStorage.getItem('naapurustot-recent')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].pno).toBe('00100');
  });

  it('loads from sessionStorage on mount', () => {
    sessionStorage.setItem(
      'naapurustot-recent',
      JSON.stringify([{ pno: '00200', name: 'Espoo', center: [24.66, 60.21] }]),
    );

    const { result } = renderHook(() => useRecentNeighborhoods());
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0].pno).toBe('00200');
  });
});
