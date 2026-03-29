import { describe, it, expect, vi, beforeEach } from 'vitest';
import { geocodeAddress } from '../utils/geocode';

function mockFetchResponse(features: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ features }),
  });
}

function makeFeature(label: string, lng: number, lat: number) {
  return {
    properties: { label },
    geometry: { coordinates: [lng, lat] },
  };
}

describe('geocodeAddress — LRU cache eviction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('evicts oldest cache entry when cache exceeds 100 entries', async () => {
    // Fill the cache with 100 unique queries, each returning a distinct result
    const fetchSpy = mockFetchResponse([makeFeature('Result', 24.9, 60.2)]);
    globalThis.fetch = fetchSpy;

    // Make 100 unique queries to fill the cache
    for (let i = 0; i < 100; i++) {
      await geocodeAddress(`query-${String(i).padStart(4, '0')}`);
    }

    // Reset the mock to track new calls
    fetchSpy.mockClear();

    // Query the first entry — it should still be cached (LRU moves it to end)
    await geocodeAddress('query-0000');
    // No new fetch should have been made (cache hit)
    expect(fetchSpy).not.toHaveBeenCalled();

    // Now add a 101st entry — this should evict the oldest (query-0001, since query-0000 was just accessed)
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ features: [makeFeature('New', 25.0, 60.3)] }),
    });
    await geocodeAddress('query-new-entry');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // query-0001 should have been evicted — fetching it again should make a new call
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ features: [makeFeature('Refetch', 25.1, 60.4)] }),
    });
    await geocodeAddress('query-0001');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('LRU moves accessed entries to most-recent position', async () => {
    const fetchSpy = mockFetchResponse([makeFeature('R', 24.9, 60.2)]);
    globalThis.fetch = fetchSpy;

    // Fill cache with entries
    for (let i = 0; i < 100; i++) {
      await geocodeAddress(`lru-${String(i).padStart(4, '0')}`);
    }
    fetchSpy.mockClear();

    // Access the first entry to move it to most-recent
    await geocodeAddress('lru-0000');
    expect(fetchSpy).not.toHaveBeenCalled(); // still cached

    // Add two new entries → should evict lru-0001 and lru-0002 (not lru-0000)
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ features: [makeFeature('New', 25.0, 60.3)] }),
    });
    await geocodeAddress('lru-new-a');
    await geocodeAddress('lru-new-b');

    fetchSpy.mockClear();

    // lru-0000 should still be cached
    await geocodeAddress('lru-0000');
    expect(fetchSpy).not.toHaveBeenCalled();

    // lru-0001 should have been evicted
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ features: [makeFeature('Evicted', 25.0, 60.3)] }),
    });
    await geocodeAddress('lru-0001');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
