/**
 * CF-8: useAllCitiesAggregates loads the prebuilt region_aggregates.json for the
 * all-Finland first paint, only while the all-cities view is active, with an
 * error/retry surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../utils/dataLoader', () => ({
  loadAllAggregates: vi.fn(),
}));

import { useAllCitiesAggregates } from '../hooks/useAllCitiesAggregates';
import { loadAllAggregates } from '../utils/dataLoader';

const loadAggMock = loadAllAggregates as unknown as ReturnType<typeof vi.fn>;
const sample = { national: { he_vakiy: 100 }, regions: { helsinki_metro: { he_vakiy: 50 } } };

describe('useAllCitiesAggregates', () => {
  beforeEach(() => loadAggMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('does not fetch unless the all-cities view is active', async () => {
    const { result } = renderHook(({ city }) => useAllCitiesAggregates(city), {
      initialProps: { city: 'helsinki_metro' },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(loadAggMock).not.toHaveBeenCalled();
    expect(result.current.aggregates).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('loads the aggregates when cityFilter is "all"', async () => {
    loadAggMock.mockResolvedValueOnce(sample);
    const { result } = renderHook(() => useAllCitiesAggregates('all'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.aggregates).toBe(sample));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
    expect(loadAggMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error and recovers on retry', async () => {
    loadAggMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useAllCitiesAggregates('all'));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.aggregates).toBeNull();

    loadAggMock.mockResolvedValueOnce(sample);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.aggregates).toBe(sample));
    expect(result.current.error).toBe(false);
  });
});
