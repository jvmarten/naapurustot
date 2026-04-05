/**
 * Tests for uncovered branches in useFilterPresets.ts (lines 15-26).
 *
 * The isValidPreset function guards against malformed localStorage data.
 * Without these tests, corrupt/malicious localStorage could crash the app
 * or produce invalid filter state. These branches had 73% coverage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFilterPresets } from '../hooks/useFilterPresets';
import type { FilterCriterion } from '../utils/filterUtils';

describe('useFilterPresets — validation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads empty array when localStorage is empty', () => {
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toEqual([]);
  });

  it('adds and retrieves a valid preset', () => {
    const { result } = renderHook(() => useFilterPresets());
    const criteria: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 50000 },
    ];

    act(() => result.current.addPreset('My Filter', criteria));
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe('My Filter');
    expect(result.current.presets[0].criteria).toEqual(criteria);
  });

  it('removes a preset by index', () => {
    const { result } = renderHook(() => useFilterPresets());
    const criteria: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 50000 },
    ];

    act(() => result.current.addPreset('Filter 1', criteria));
    act(() => result.current.addPreset('Filter 2', criteria));
    expect(result.current.presets).toHaveLength(2);

    act(() => result.current.removePreset(0));
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe('Filter 2');
  });

  it('persists presets to localStorage', () => {
    const { result } = renderHook(() => useFilterPresets());
    const criteria: FilterCriterion[] = [
      { layerId: 'unemployment', min: 0, max: 10 },
    ];

    act(() => result.current.addPreset('Saved', criteria));

    const stored = JSON.parse(localStorage.getItem('naapurustot-filter-presets')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Saved');
  });

  it('rejects presets with invalid layerId from localStorage', () => {
    localStorage.setItem('naapurustot-filter-presets', JSON.stringify([
      { name: 'Bad Preset', criteria: [{ layerId: 'nonexistent_layer', min: 0, max: 10 }] },
    ]));

    const { result } = renderHook(() => useFilterPresets());
    // Invalid layerId should be filtered out
    expect(result.current.presets).toHaveLength(0);
  });

  it('rejects presets with non-numeric min/max', () => {
    localStorage.setItem('naapurustot-filter-presets', JSON.stringify([
      { name: 'Bad', criteria: [{ layerId: 'median_income', min: 'zero', max: 10 }] },
    ]));

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(0);
  });

  it('rejects presets with NaN or Infinity min/max', () => {
    localStorage.setItem('naapurustot-filter-presets', JSON.stringify([
      { name: 'NaN', criteria: [{ layerId: 'median_income', min: null, max: 10 }] },
    ]));

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(0);
  });

  it('rejects presets where min > max', () => {
    localStorage.setItem('naapurustot-filter-presets', JSON.stringify([
      { name: 'Inverted', criteria: [{ layerId: 'median_income', min: 50000, max: 20000 }] },
    ]));

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(0);
  });

  it('rejects presets with missing name', () => {
    localStorage.setItem('naapurustot-filter-presets', JSON.stringify([
      { criteria: [{ layerId: 'median_income', min: 0, max: 10 }] },
    ]));

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(0);
  });

  it('rejects presets with non-array criteria', () => {
    localStorage.setItem('naapurustot-filter-presets', JSON.stringify([
      { name: 'Bad', criteria: 'not-an-array' },
    ]));

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(0);
  });

  it('rejects non-object preset entries', () => {
    localStorage.setItem('naapurustot-filter-presets', JSON.stringify([
      'just a string',
      42,
      null,
    ]));

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(0);
  });

  it('handles corrupt JSON in localStorage gracefully', () => {
    localStorage.setItem('naapurustot-filter-presets', '{{{corrupt');

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toEqual([]);
  });

  it('keeps valid presets and filters out invalid ones', () => {
    localStorage.setItem('naapurustot-filter-presets', JSON.stringify([
      { name: 'Valid', criteria: [{ layerId: 'median_income', min: 20000, max: 50000 }] },
      { name: 'Invalid Layer', criteria: [{ layerId: 'fake', min: 0, max: 10 }] },
      { name: 'Also Valid', criteria: [{ layerId: 'unemployment', min: 0, max: 15 }] },
    ]));

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(2);
    expect(result.current.presets[0].name).toBe('Valid');
    expect(result.current.presets[1].name).toBe('Also Valid');
  });

  it('accepts preset with empty criteria array', () => {
    localStorage.setItem('naapurustot-filter-presets', JSON.stringify([
      { name: 'Empty Filter', criteria: [] },
    ]));

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].criteria).toEqual([]);
  });

  it('rejects criterion with null/undefined layerId', () => {
    localStorage.setItem('naapurustot-filter-presets', JSON.stringify([
      { name: 'Null Layer', criteria: [{ layerId: null, min: 0, max: 10 }] },
    ]));

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(0);
  });
});
