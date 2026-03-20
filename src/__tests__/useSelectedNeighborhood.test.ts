import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectedNeighborhood } from '../hooks/useSelectedNeighborhood';
import type { NeighborhoodProperties } from '../utils/metrics';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

function makeProps(pno: string): NeighborhoodProperties {
  return { pno, nimi: `Area ${pno}`, namn: `Area ${pno}` } as NeighborhoodProperties;
}

describe('useSelectedNeighborhood', () => {
  it('starts with no selection and no pinned items', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    expect(result.current.selected).toBeNull();
    expect(result.current.pinned).toEqual([]);
  });

  it('selects and deselects a neighborhood', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    const props = makeProps('00100');

    act(() => result.current.select(props));
    expect(result.current.selected).toBe(props);

    act(() => result.current.deselect());
    expect(result.current.selected).toBeNull();
  });

  it('pins up to 3 neighborhoods', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());

    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.pin(makeProps('00200')));
    act(() => result.current.pin(makeProps('00300')));
    expect(result.current.pinned).toHaveLength(3);

    // Fourth pin should be rejected (max 3)
    act(() => result.current.pin(makeProps('00400')));
    expect(result.current.pinned).toHaveLength(3);
    expect(result.current.pinned.map((p) => p.pno)).toEqual(['00100', '00200', '00300']);
  });

  it('does not pin duplicates', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());

    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.pin(makeProps('00100')));
    expect(result.current.pinned).toHaveLength(1);
  });

  it('unpins a specific neighborhood by PNO', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());

    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.pin(makeProps('00200')));
    act(() => result.current.unpin('00100'));

    expect(result.current.pinned).toHaveLength(1);
    expect(result.current.pinned[0].pno).toBe('00200');
  });

  it('clears all pinned neighborhoods', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());

    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.pin(makeProps('00200')));
    act(() => result.current.clearPinned());

    expect(result.current.pinned).toEqual([]);
  });

  it('unpin is a no-op for non-pinned PNO', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());

    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.unpin('99999'));
    expect(result.current.pinned).toHaveLength(1);
  });
});
