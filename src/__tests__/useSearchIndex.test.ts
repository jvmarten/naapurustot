/**
 * Tests for useSearchIndex — loads the global all-areas index that powers
 * cross-subregion search.
 *
 * Invariants:
 *  - Returns null until the index resolves, then the FeatureCollection.
 *  - Reuses loadAllData (its cache), so it shares the fetch with the
 *    "all cities" view rather than downloading the dataset twice.
 *  - A failed load leaves the hook at null (search falls back to region data)
 *    rather than throwing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../utils/dataLoader', () => ({
  loadAllData: vi.fn(),
}));

import { useSearchIndex } from '../hooks/useSearchIndex';
import { loadAllData } from '../utils/dataLoader';

const loadAllDataMock = loadAllData as unknown as ReturnType<typeof vi.fn>;

const sampleData = {
  type: 'FeatureCollection' as const,
  features: [
    { type: 'Feature' as const, geometry: null, properties: { pno: '20100', nimi: 'Turku', city: 'turku' } },
  ],
};

describe('useSearchIndex', () => {
  beforeEach(() => {
    loadAllDataMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null before the index resolves, then the FeatureCollection', async () => {
    loadAllDataMock.mockResolvedValueOnce({ data: sampleData, metroAverages: {} });

    const { result } = renderHook(() => useSearchIndex());
    expect(result.current).toBeNull();

    await waitFor(() => {
      expect(result.current).toBe(sampleData);
    });
    expect(loadAllDataMock).toHaveBeenCalledTimes(1);
  });

  it('stays null when the load fails (search falls back to region data)', async () => {
    loadAllDataMock.mockRejectedValueOnce(new Error('Failed to load data: 500'));

    const { result } = renderHook(() => useSearchIndex());

    // Give the rejected promise a chance to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBeNull();
  });
});
