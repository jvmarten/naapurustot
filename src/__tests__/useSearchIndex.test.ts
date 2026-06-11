/**
 * Tests for useSearchIndex — loads the lightweight all-areas index that powers
 * cross-subregion search.
 *
 * Invariants:
 *  - CF-8: loads the small dedicated search index (loadSearchIndex), NOT the ~10.6 MB
 *    national set, so search works on the slim all-Finland landing without bloating it.
 *  - Returns null until the index resolves, then the FeatureCollection.
 *  - A failed load leaves the hook at null (search falls back to region data)
 *    rather than throwing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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
    expect(result.current).toBeNull();

    await waitFor(() => {
      expect(result.current).toBe(sampleIndex);
    });
    expect(loadSearchIndexMock).toHaveBeenCalledTimes(1);
  });

  it('stays null when the load fails (search falls back to region data)', async () => {
    loadSearchIndexMock.mockRejectedValueOnce(new Error('Failed to load search index: 500'));

    const { result } = renderHook(() => useSearchIndex());

    // Give the rejected promise a chance to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBeNull();
  });
});
