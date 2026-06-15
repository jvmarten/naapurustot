import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotes } from '../hooks/useNotes';
import { markEdited } from '../utils/syncMeta';
import { api } from '../utils/api';

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

/**
 * IN-6: per-note timestamp last-write-wins on login, plus the login-merge race
 * guard that stops the debounced save from pushing local notes before the merge.
 */
describe('useNotes server sync (IN-6)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('replaces a local note when the server note is newer than the local edit (LWW)', async () => {
    localStorage.setItem('naapurustot-notes', JSON.stringify({ '00100': 'old local' }));
    markEdited('notes:00100', Date.now() - 60_000); // local edited a minute ago
    vi.spyOn(api, 'getNotes').mockResolvedValue({
      data: { notes: { '00100': 'newer server' }, updatedAt: new Date().toISOString() },
    });
    vi.spyOn(api, 'saveNotes').mockResolvedValue({ data: { notes: {} } });

    const { result } = renderHook(() => useNotes('user-1'));

    await waitFor(() => expect(result.current.getNote('00100')).toBe('newer server'));
  });

  it('keeps the local note when it was edited more recently than the server (LWW)', async () => {
    localStorage.setItem('naapurustot-notes', JSON.stringify({ '00100': 'fresh local' }));
    markEdited('notes:00100', Date.now()); // edited now
    const getSpy = vi.spyOn(api, 'getNotes').mockResolvedValue({
      data: { notes: { '00100': 'stale server' }, updatedAt: new Date(Date.now() - 60_000).toISOString() },
    });
    const saveSpy = vi.spyOn(api, 'saveNotes').mockResolvedValue({ data: { notes: {} } });

    const { result } = renderHook(() => useNotes('user-1'));

    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.getNote('00100')).toBe('fresh local');
    // Local wins → the merged (local) text is pushed back up.
    expect(saveSpy).toHaveBeenCalledWith({ '00100': 'fresh local' });
  });

  it('does not push local notes before the on-login merge resolves (race guard)', async () => {
    localStorage.setItem('naapurustot-notes', JSON.stringify({ '00100': 'local only' }));
    let resolveGet!: (v: { data: { notes: Record<string, string>; updatedAt: string } }) => void;
    vi.spyOn(api, 'getNotes').mockReturnValue(
      new Promise((r) => { resolveGet = r; }) as ReturnType<typeof api.getNotes>,
    );
    const saveSpy = vi.spyOn(api, 'saveNotes').mockResolvedValue({ data: { notes: {} } });

    vi.useFakeTimers();
    try {
      renderHook(() => useNotes('user-1'));
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(saveSpy).not.toHaveBeenCalled();
      await act(async () => {
        resolveGet({ data: { notes: {}, updatedAt: new Date().toISOString() } });
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
