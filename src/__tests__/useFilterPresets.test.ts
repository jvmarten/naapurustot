import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFilterPresets } from '../hooks/useFilterPresets';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

describe('useFilterPresets', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty presets', () => {
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toEqual([]);
  });

  it('adds a preset with name and criteria', () => {
    const { result } = renderHook(() => useFilterPresets());
    const criteria = [{ layerId: 'median_income' as const, min: 20000, max: 50000 }];

    act(() => result.current.addPreset('High income areas', criteria));

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe('High income areas');
    expect(result.current.presets[0].criteria).toEqual(criteria);
  });

  it('removes a preset by index', () => {
    const { result } = renderHook(() => useFilterPresets());

    act(() => result.current.addPreset('Preset A', [{ layerId: 'median_income' as const, min: 0, max: 100 }]));
    act(() => result.current.addPreset('Preset B', [{ layerId: 'unemployment' as const, min: 0, max: 10 }]));
    act(() => result.current.removePreset(0));

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe('Preset B');
  });

  it('persists to localStorage on add', () => {
    const { result } = renderHook(() => useFilterPresets());

    act(() => result.current.addPreset('Saved', [{ layerId: 'education' as const, min: 30, max: 80 }]));

    const stored = JSON.parse(localStorage.getItem('naapurustot-filter-presets')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Saved');
  });

  it('persists to localStorage on remove', () => {
    const { result } = renderHook(() => useFilterPresets());

    act(() => result.current.addPreset('A', [{ layerId: 'median_income' as const, min: 0, max: 100 }]));
    act(() => result.current.addPreset('B', [{ layerId: 'unemployment' as const, min: 0, max: 10 }]));
    act(() => result.current.removePreset(0));

    const stored = JSON.parse(localStorage.getItem('naapurustot-filter-presets')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('B');
  });

  it('loads presets from localStorage on mount', () => {
    localStorage.setItem(
      'naapurustot-filter-presets',
      JSON.stringify([{ name: 'Pre-existing', criteria: [{ layerId: 'crime_rate', min: 0, max: 50 }] }]),
    );

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe('Pre-existing');
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('naapurustot-filter-presets', '{invalid json');

    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toEqual([]);
  });
});
