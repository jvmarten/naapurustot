import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useQualityWeights } from '../hooks/useQualityWeights';
import { getDefaultWeights } from '../utils/qualityIndex';
import { markEdited } from '../utils/syncMeta';
import { api } from '../utils/api';

const WKEY = 'naapurustot-quality-weights';

/**
 * IN-6: cloud-sync conflict resolution for quality weights — timestamp last-write-
 * wins for the diverged case, plus the login-merge race guard that stops the
 * debounced save from pushing the local (default) weights before the merge runs.
 */
describe('useQualityWeights server sync (IN-6)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('adopts server-side custom weights when local is untouched (default)', async () => {
    const serverWeights = { ...getDefaultWeights(), transit: 99 };
    vi.spyOn(api, 'getPreferences').mockResolvedValue({
      data: { filterPresets: [], qualityWeights: serverWeights, updatedAt: new Date().toISOString() },
    });
    const saveSpy = vi.spyOn(api, 'savePreferences').mockResolvedValue({ data: {} as never });

    const { result } = renderHook(() => useQualityWeights('user-1'));

    await waitFor(() => expect(result.current.weights.transit).toBe(99));
    // The default weights must NOT have been pushed up (the login clobber bug).
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('does not push local default weights before the on-login merge resolves (race guard)', async () => {
    // Local is default; server is reached via a promise we control. With the race
    // guard the debounced save must be skipped while the merge is pending.
    let resolveGet!: (v: { data: { filterPresets: never[]; qualityWeights: Record<string, number>; updatedAt: string } }) => void;
    vi.spyOn(api, 'getPreferences').mockReturnValue(
      new Promise((r) => { resolveGet = r; }) as ReturnType<typeof api.getPreferences>,
    );
    const saveSpy = vi.spyOn(api, 'savePreferences').mockResolvedValue({ data: {} as never });

    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useQualityWeights('user-1'));
      // Advance well past the 1 s debounce — nothing should be pushed yet.
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(saveSpy).not.toHaveBeenCalled();

      // Resolve the merge with custom server weights; they get adopted.
      await act(async () => {
        resolveGet({ data: { filterPresets: [], qualityWeights: { ...getDefaultWeights(), transit: 42 }, updatedAt: new Date().toISOString() } });
        await Promise.resolve();
      });
      expect(result.current.weights.transit).toBe(42);
    } finally {
      vi.useRealTimers();
    }
  });

  it('both custom + local edited more recently → keeps local and pushes it up (LWW)', async () => {
    localStorage.setItem(WKEY, JSON.stringify({ ...getDefaultWeights(), transit: 50 }));
    markEdited('weights', Date.now()); // local edited now
    vi.spyOn(api, 'getPreferences').mockResolvedValue({
      data: {
        filterPresets: [],
        qualityWeights: { ...getDefaultWeights(), transit: 10 },
        updatedAt: new Date(Date.now() - 60_000).toISOString(), // server is older
      },
    });
    const saveSpy = vi.spyOn(api, 'savePreferences').mockResolvedValue({ data: {} as never });

    const { result } = renderHook(() => useQualityWeights('user-1'));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect(result.current.weights.transit).toBe(50); // local kept
    expect(saveSpy).toHaveBeenCalledWith({ qualityWeights: expect.objectContaining({ transit: 50 }) });
  });

  it('both custom + server written more recently → adopts server (LWW)', async () => {
    localStorage.setItem(WKEY, JSON.stringify({ ...getDefaultWeights(), transit: 50 }));
    markEdited('weights', Date.now() - 60_000); // local edited a minute ago
    vi.spyOn(api, 'getPreferences').mockResolvedValue({
      data: {
        filterPresets: [],
        qualityWeights: { ...getDefaultWeights(), transit: 10 },
        updatedAt: new Date().toISOString(), // server is newer
      },
    });
    vi.spyOn(api, 'savePreferences').mockResolvedValue({ data: {} as never });

    const { result } = renderHook(() => useQualityWeights('user-1'));

    await waitFor(() => expect(result.current.weights.transit).toBe(10)); // adopted server
  });
});
