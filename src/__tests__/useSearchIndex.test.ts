/**
 * Tests for useSearchIndex — loads the lightweight all-areas index that powers
 * cross-subregion search.
 *
 * Invariants:
 *  - CF-8: loads the small dedicated search index (loadSearchIndex), NOT the ~10.6 MB
 *    national set, so search works on the slim all-Finland landing without bloating it.
 *  - `index` is null until the fetch resolves, then the FeatureCollection.
 *  - UX ER-1: a failed load sets `failed` (it used to be swallowed by an empty catch,
 *    leaving the hook null forever behind a permanent fake "Ladataan…"), and `retry`
 *    re-fetches. Search still falls back to region data when there is any.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../utils/dataLoader', () => ({
  loadSearchIndex: vi.fn(),
}));

import { useSearchIndex } from '../hooks/useSearchIndex';
import { loadSearchIndex } from '../utils/dataLoader';

const loadSearchIndexMock = loadSearchIndex as unknown as ReturnType<typeof vi.fn>;

const sampleIndex = {
  type: 'FeatureCollection' as const,
  features: [
    { type: 'Feature' as const, geometry: null, properties: { pno: '20100', nimi: 'Turku', namn: 'Åbo', city: 'turku' } },
  ],
};

describe('useSearchIndex', () => {
  beforeEach(() => {
    loadSearchIndexMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the search index eagerly: null before it resolves, then the FeatureCollection', async () => {
    loadSearchIndexMock.mockResolvedValueOnce(sampleIndex);

    const { result } = renderHook(() => useSearchIndex());
    expect(result.current.index).toBeNull();
    expect(result.current.failed).toBe(false);

    await waitFor(() => {
      expect(result.current.index).toBe(sampleIndex);
    });
    expect(loadSearchIndexMock).toHaveBeenCalledTimes(1);
  });

  it('ER-1: reports the failure instead of staying silently null forever', async () => {
    loadSearchIndexMock.mockRejectedValueOnce(new Error('Failed to load search index: 500'));

    const { result } = renderHook(() => useSearchIndex());

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    expect(result.current.index).toBeNull();
  });

  it('ER-1: retry() re-fetches and recovers', async () => {
    loadSearchIndexMock
      .mockRejectedValueOnce(new Error('Failed to load search index: 500'))
      .mockResolvedValueOnce(sampleIndex);

    const { result } = renderHook(() => useSearchIndex());
    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });

    act(() => { result.current.retry(); });

    await waitFor(() => {
      expect(result.current.index).toBe(sampleIndex);
    });
    expect(result.current.failed).toBe(false);
    expect(loadSearchIndexMock).toHaveBeenCalledTimes(2);
  });
});
