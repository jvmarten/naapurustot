import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { geocodeAddress } from '../utils/geocode';

describe('geocodeAddress — input validation and LRU cache', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for queries shorter than 3 characters', async () => {
    const result = await geocodeAddress('ab');
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns empty array for empty string', async () => {
    const result = await geocodeAddress('');
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates response features and skips malformed entries', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        features: [
          // Valid feature
          { properties: { label: 'Helsinki' }, geometry: { coordinates: [24.94, 60.17] } },
          // Missing label
          { properties: {}, geometry: { coordinates: [24.94, 60.17] } },
          // Missing coordinates
          { properties: { label: 'Test' }, geometry: {} },
          // Non-numeric coordinates
          { properties: { label: 'Test2' }, geometry: { coordinates: ['abc', 60.17] } },
          // Null feature
          null,
          // Infinite coordinates
          { properties: { label: 'Test3' }, geometry: { coordinates: [Infinity, 60.17] } },
        ],
      }),
    });

    const results = await geocodeAddress('Helsinki');
    expect(results.length).toBe(1);
    expect(results[0].label).toBe('Helsinki');
    expect(results[0].coordinates).toEqual([24.94, 60.17]);
  });

  it('returns empty array on fetch failure', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));
    const results = await geocodeAddress('Helsinki test');
    expect(results).toEqual([]);
  });

  it('returns empty array on non-OK response', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false });
    const results = await geocodeAddress('Helsinki test query');
    expect(results).toEqual([]);
  });

  it('uses case-insensitive cache key', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ features: [{ properties: { label: 'Result' }, geometry: { coordinates: [24.94, 60.17] } }] }),
    });

    await geocodeAddress('Helsinki ABC');
    await geocodeAddress('HELSINKI ABC');
    await geocodeAddress('helsinki abc');

    // Only the first call should hit fetch
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('trims whitespace for cache key', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ features: [{ properties: { label: 'Result' }, geometry: { coordinates: [24.94, 60.17] } }] }),
    });

    await geocodeAddress('  Helsinki DEF  ');
    await geocodeAddress('Helsinki DEF');

    // Should be a cache hit on second call (same normalized key)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('includes bounding box in request params', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: [] }),
    });

    await geocodeAddress('Test location here');
    const calledUrl = fetchSpy.mock.calls[0][0] as string;

    expect(calledUrl).toContain('boundary.rect.min_lon');
    expect(calledUrl).toContain('boundary.rect.min_lat');
    expect(calledUrl).toContain('boundary.rect.max_lon');
    expect(calledUrl).toContain('boundary.rect.max_lat');
  });

  it('passes abort signal to fetch', async () => {
    const controller = new AbortController();
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: [] }),
    });

    await geocodeAddress('Test abort signal', controller.signal);

    expect(fetchSpy.mock.calls[0][1]).toHaveProperty('signal', controller.signal);
  });
});
