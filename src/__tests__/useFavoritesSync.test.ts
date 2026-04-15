/**
 * Tests for useFavorites debounced server-sync behavior.
 *
 * The hook syncs favorites to the server 1 second after the last local change.
 * This is the only path through which logged-in users' favorites cross the
 * device boundary. Bugs here:
 *   - No debounce → every toggle hits the server (rate-limit hell, slow UI)
 *   - Stale closure → wrong list saved (data corruption across devices)
 *   - Server response triggers another save → infinite loop, server-side rate limits
 *   - Sync fires when not logged in → 401 spam, broken anonymous mode
 *   - On unmount during pending save → request still fires after navigation
 *
 * Existing favorites tests cover login fetch+merge. We target the OTHER
 * direction: local change → debounced server PUT.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavorites } from '../hooks/useFavorites';
import { api } from '../utils/api';

describe('useFavorites — debounced server save', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    // Default: never trigger fetch on mount (no userId).
    vi.spyOn(api, 'saveFavorites').mockResolvedValue({ data: { favorites: [] } });
    vi.spyOn(api, 'getFavorites').mockResolvedValue({ data: { favorites: [] } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does NOT call api.saveFavorites when no userId (anonymous mode)', () => {
    const saveSpy = api.saveFavorites as ReturnType<typeof vi.fn>;
    const { result } = renderHook(() => useFavorites(undefined));

    act(() => result.current.toggleFavorite('00100'));
    act(() => { vi.advanceTimersByTime(2000); });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('debounces save: rapid changes within 1s only result in ONE server call', async () => {
    const saveSpy = api.saveFavorites as ReturnType<typeof vi.fn>;
    const { result } = renderHook(() => useFavorites('user-1'));

    // Wait for the initial getFavorites() effect to settle so it doesn't
    // race with our toggle measurements.
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    saveSpy.mockClear();

    // Fire 5 rapid toggles within the debounce window
    act(() => result.current.toggleFavorite('00100'));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => result.current.toggleFavorite('00200'));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => result.current.toggleFavorite('00300'));
    act(() => { vi.advanceTimersByTime(200); });

    // Still inside the 1000ms window since the last change.
    expect(saveSpy).not.toHaveBeenCalled();

    // Cross the threshold
    act(() => { vi.advanceTimersByTime(1000); });

    // Exactly ONE save with the FINAL state (not 5 saves).
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenLastCalledWith(['00100', '00200', '00300']);
  });

  it('saves the latest list, not a stale snapshot', async () => {
    // Regression guard: if the debounced save ever closed over an old `favorites`
    // value (state-updater purity violation) we'd see [00100] saved instead of
    // [00100, 00200].
    const saveSpy = api.saveFavorites as ReturnType<typeof vi.fn>;
    const { result } = renderHook(() => useFavorites('user-1'));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    saveSpy.mockClear();

    act(() => result.current.toggleFavorite('00100'));
    act(() => result.current.toggleFavorite('00200'));
    act(() => { vi.advanceTimersByTime(1000); });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toEqual(['00100', '00200']);
  });

  it('does NOT echo a server-fetched value back to the server when merged equals server (would loop)', async () => {
    // On mount with userId, getFavorites() runs and merges into local. The
    // hook sets a `fromServerRef` flag to suppress the debounced save for
    // that particular update. Without it, every login with local∩server==server
    // would PUT the same list back for no reason — a bandwidth waste that
    // compounds across every browser tab and every login.
    const saveSpy = api.saveFavorites as ReturnType<typeof vi.fn>;
    // Local has the EXACT same favorites as server → merged equals local equals server
    localStorage.setItem('naapurustot-favorites', JSON.stringify(['00100', '00200']));
    (api.getFavorites as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { favorites: ['00100', '00200'] },
    });

    renderHook(() => useFavorites('user-1'));
    // Let getFavorites resolve (microtasks) BEFORE the debounced save timer
    // can fire on the initial mount.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.runAllTimersAsync(); });

    // Because the merged list matches server exactly, the "push back once"
    // branch is skipped and fromServerRef suppresses the debounced echo.
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('cancels pending save on unmount (no zombie network request)', async () => {
    const saveSpy = api.saveFavorites as ReturnType<typeof vi.fn>;
    const { result, unmount } = renderHook(() => useFavorites('user-1'));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    saveSpy.mockClear();

    act(() => result.current.toggleFavorite('00100'));
    // Pending timer (save would fire at +1000ms)
    unmount();

    act(() => { vi.advanceTimersByTime(2000); });

    // Save never fired — the cleanup function cleared the timer.
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('persists to localStorage immediately (not debounced)', () => {
    // localStorage write must NOT be debounced — closing the tab in the gap
    // between toggle and save would silently drop the change.
    const { result } = renderHook(() => useFavorites('user-1'));
    act(() => result.current.toggleFavorite('00100'));

    const stored = JSON.parse(localStorage.getItem('naapurustot-favorites')!);
    expect(stored).toEqual(['00100']);
  });
});

describe('useFavorites — login transition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.spyOn(api, 'saveFavorites').mockResolvedValue({ data: { favorites: [] } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('triggers a server fetch only when userId transitions from undefined to truthy', async () => {
    const getSpy = vi.spyOn(api, 'getFavorites').mockResolvedValue({
      data: { favorites: ['00500'] },
    });

    // Mount logged out
    const { rerender } = renderHook(({ uid }: { uid: string | null }) => useFavorites(uid), {
      initialProps: { uid: null },
    });

    expect(getSpy).not.toHaveBeenCalled();

    // Log in
    rerender({ uid: 'user-1' });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(getSpy).toHaveBeenCalledTimes(1);

    // Re-render with the same userId — no second fetch.
    rerender({ uid: 'user-1' });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('handles getFavorites returning an error gracefully (no merge, no crash)', async () => {
    const getSpy = vi.spyOn(api, 'getFavorites').mockResolvedValue({
      error: 'Not authenticated',
    });
    localStorage.setItem('naapurustot-favorites', JSON.stringify(['00100']));

    const { result } = renderHook(() => useFavorites('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(getSpy).toHaveBeenCalled();
    // Local state preserved when server fetch fails.
    expect(result.current.favorites).toEqual(['00100']);
  });
});
