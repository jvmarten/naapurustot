/**
 * Regression test for the "all cities" view leaking postal-code borders.
 *
 * Bug:
 *   Switching the city dropdown to "All Finland" left visible internal
 *   postal-code lines on each metro area outline. The fix for the earlier
 *   "stale region data leak" commit (78521838) cleared `data` synchronously
 *   when regionId changed, which pushed the preloadUnion trigger past the
 *   first paint of the all-cities view — buildMetroAreaFeatures ran with the
 *   fallback (MultiPolygon concatenation, which preserves internal borders)
 *   before @turf/union finished loading.
 *
 * What we assert:
 *   The all-cities union preload effect fires as soon as cityFilter flips to
 *   'all'. It must NOT gate on `data`. Including `data` in the dep array
 *   reintroduces the flash of postal-code borders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { preloadUnionMock } = vi.hoisted(() => ({
  preloadUnionMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../utils/metroAreas', async (importActual) => {
  const actual = await importActual<typeof import('../utils/metroAreas')>();
  return { ...actual, preloadUnion: preloadUnionMock };
});

import { useAllCitiesUnionPreload } from '../hooks/useAllCitiesUnionPreload';

describe('useAllCitiesUnionPreload', () => {
  beforeEach(() => {
    preloadUnionMock.mockClear();
  });

  it('does not call preloadUnion while cityFilter is a specific region', () => {
    renderHook(({ city }) => useAllCitiesUnionPreload(city), {
      initialProps: { city: 'helsinki_metro' },
    });
    expect(preloadUnionMock).not.toHaveBeenCalled();
  });

  it('fires preloadUnion as soon as cityFilter becomes "all", regardless of data state', () => {
    // Mirrors the App-level transition: cityFilter goes from a region to 'all'.
    // At that instant, useMapData has already wiped `data` to null (via the
    // render-phase reset added in commit 78521838). The preload must still
    // fire so the import is in flight while the new dataset is fetching.
    const { rerender } = renderHook(({ city }) => useAllCitiesUnionPreload(city), {
      initialProps: { city: 'helsinki_metro' },
    });
    expect(preloadUnionMock).not.toHaveBeenCalled();

    rerender({ city: 'all' });
    expect(preloadUnionMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire while cityFilter stays "all" across re-renders', () => {
    const { rerender } = renderHook(({ city }) => useAllCitiesUnionPreload(city), {
      initialProps: { city: 'all' },
    });
    expect(preloadUnionMock).toHaveBeenCalledTimes(1);

    rerender({ city: 'all' });
    rerender({ city: 'all' });
    expect(preloadUnionMock).toHaveBeenCalledTimes(1);
  });
});
