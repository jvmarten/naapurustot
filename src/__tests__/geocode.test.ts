import { describe, it, expect, vi, beforeEach } from 'vitest';
import { geocodeAddress } from '../utils/geocode';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

describe('geocodeAddress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for queries shorter than 3 characters', async () => {
    expect(await geocodeAddress('')).toEqual([]);
    expect(await geocodeAddress('ab')).toEqual([]);
  });

  it('returns results from Digitransit API', async () => {
    const mockResponse = {
      features: [
        {
          properties: { label: 'Mannerheimintie 1, Helsinki' },
          geometry: { coordinates: [24.94, 60.17] },
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const results = await geocodeAddress('Mannerheimintie');
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Mannerheimintie 1, Helsinki');
    expect(results[0].coordinates).toEqual([24.94, 60.17]);
  });

  it('returns empty array on non-ok HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const results = await geocodeAddress('nonexistent_xyz_place');
    expect(results).toEqual([]);
  });

  it('returns empty array on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
    const results = await geocodeAddress('fetch_error_test_query');
    expect(results).toEqual([]);
  });

  it('caches results for same query (case-insensitive)', async () => {
    const mockResponse = {
      features: [
        {
          properties: { label: 'Test Place' },
          geometry: { coordinates: [24.9, 60.2] },
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    // First call triggers fetch
    await geocodeAddress('cache_test_unique');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call with same query (different case) should use cache
    await geocodeAddress('CACHE_TEST_UNIQUE');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('handles API response with no features gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    const results = await geocodeAddress('empty_features_test');
    expect(results).toEqual([]);
  });

  it('sends correct boundary parameters to constrain to Helsinki metro', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: [] }),
    } as Response);

    await geocodeAddress('boundary_test_query');
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('boundary.rect.min_lon=19.5');
    expect(url).toContain('boundary.rect.max_lon=31.5');
    expect(url).toContain('boundary.rect.min_lat=59.5');
    expect(url).toContain('boundary.rect.max_lat=70.5');
  });
});
