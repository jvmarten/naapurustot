import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotes } from '../hooks/useNotes';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

describe('useNotes', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty notes', () => {
    const { result } = renderHook(() => useNotes());
    expect(result.current.getNote('00100')).toBe('');
  });

  it('sets and retrieves a note for a PNO', () => {
    const { result } = renderHook(() => useNotes());

    act(() => result.current.setNote('00100', 'Great neighborhood'));
    expect(result.current.getNote('00100')).toBe('Great neighborhood');
  });

  it('deletes a note when set to empty/whitespace string', () => {
    const { result } = renderHook(() => useNotes());

    act(() => result.current.setNote('00100', 'Something'));
    act(() => result.current.setNote('00100', '  '));
    expect(result.current.getNote('00100')).toBe('');
  });

  it('persists notes to localStorage', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNotes());
    act(() => result.current.setNote('00100', 'Persisted note'));

    // localStorage write is debounced (500ms) to avoid jank during fast typing
    act(() => { vi.advanceTimersByTime(500); });

    const stored = JSON.parse(localStorage.getItem('naapurustot-notes')!);
    expect(stored['00100']).toBe('Persisted note');
    vi.useRealTimers();
  });

  it('loads notes from localStorage on mount', () => {
    localStorage.setItem('naapurustot-notes', JSON.stringify({ '00200': 'Loaded note' }));

    const { result } = renderHook(() => useNotes());
    expect(result.current.getNote('00200')).toBe('Loaded note');
  });

  it('handles corrupted localStorage data gracefully', () => {
    localStorage.setItem('naapurustot-notes', 'not json');

    const { result } = renderHook(() => useNotes());
    expect(result.current.getNote('00100')).toBe('');
  });

  it('handles array in localStorage (invalid format) gracefully', () => {
    localStorage.setItem('naapurustot-notes', JSON.stringify([1, 2, 3]));

    const { result } = renderHook(() => useNotes());
    expect(result.current.getNote('00100')).toBe('');
  });

  it('manages multiple notes independently', () => {
    const { result } = renderHook(() => useNotes());

    act(() => result.current.setNote('00100', 'Note A'));
    act(() => result.current.setNote('00200', 'Note B'));

    expect(result.current.getNote('00100')).toBe('Note A');
    expect(result.current.getNote('00200')).toBe('Note B');

    // Delete one, other remains
    act(() => result.current.setNote('00100', ''));
    expect(result.current.getNote('00100')).toBe('');
    expect(result.current.getNote('00200')).toBe('Note B');
  });
});
