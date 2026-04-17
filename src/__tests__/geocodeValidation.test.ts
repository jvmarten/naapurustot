import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocodeAddress } from '../utils/geocode';

describe('geocodeAddress — response validation', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('rejects features with missing label', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { properties: {}, geometry: { coordinates: [24.94, 60.17] } },
          { properties: { label: 'Valid' }, geometry: { coordinates: [24.95, 60.18] } },
        ],
      }),
    } as Response);

    const results = await geocodeAddress('Helsinki test addr');
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Valid');
  });

  it('rejects features with null coordinates', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { properties: { label: 'No coords' }, geometry: { coordinates: null } },
          { properties: { label: 'Valid' }, geometry: { coordinates: [24.95, 60.18] } },
        ],
      }),
    } as Response);

    const results = await geocodeAddress('Helsinki null coords');
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Valid');
  });

  it('rejects features with non-numeric coordinates', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { properties: { label: 'String coords' }, geometry: { coordinates: ['abc', 'def'] } },
          { properties: { label: 'Valid' }, geometry: { coordinates: [24.95, 60.18] } },
        ],
      }),
    } as Response);

    const results = await geocodeAddress('Helsinki string coords');
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Valid');
  });

  it('rejects features with NaN coordinates', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { properties: { label: 'NaN coords' }, geometry: { coordinates: [NaN, 60.18] } },
        ],
      }),
    } as Response);

    const results = await geocodeAddress('Helsinki NaN coords');
    expect(results).toHaveLength(0);
  });

  it('rejects features with Infinity coordinates', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { properties: { label: 'Inf coords' }, geometry: { coordinates: [Infinity, 60.18] } },
        ],
      }),
    } as Response);

    const results = await geocodeAddress('Helsinki inf coords');
    expect(results).toHaveLength(0);
  });

  it('rejects features with too-short coordinate arrays', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { properties: { label: 'Short array' }, geometry: { coordinates: [24.95] } },
        ],
      }),
    } as Response);

    const results = await geocodeAddress('Helsinki short array');
    expect(results).toHaveLength(0);
  });

  it('rejects features with empty label', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { properties: { label: '' }, geometry: { coordinates: [24.95, 60.18] } },
        ],
      }),
    } as Response);

    const results = await geocodeAddress('Helsinki empty label');
    expect(results).toHaveLength(0);
  });

  it('rejects non-object features', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [null, undefined, 42, 'string', { properties: { label: 'Valid' }, geometry: { coordinates: [24.95, 60.18] } }],
      }),
    } as Response);

    const results = await geocodeAddress('Helsinki non-objects');
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Valid');
  });

  it('handles missing features array', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ type: 'FeatureCollection' }),
    } as Response);

    const results = await geocodeAddress('Helsinki no features');
    expect(results).toHaveLength(0);
  });

  it('handles missing geometry object', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { properties: { label: 'No geometry' } },
        ],
      }),
    } as Response);

    const results = await geocodeAddress('Helsinki no geom');
    expect(results).toHaveLength(0);
  });
});

describe('geocodeAddress — LRU cache eviction', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('evicts oldest entry when cache exceeds 100 entries', async () => {
    let callCount = 0;
    fetchSpy.mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({
          features: [
            { properties: { label: `Result ${callCount}` }, geometry: { coordinates: [24.95, 60.18] } },
          ],
        }),
      } as Response;
    });

    for (let i = 0; i < 102; i++) {
      await geocodeAddress(`unique query number ${i} with padding`);
    }

    const initialCalls = callCount;

    await geocodeAddress('unique query number 101 with padding');
    expect(callCount).toBe(initialCalls);

    await geocodeAddress('unique query number 0 with padding');
    expect(callCount).toBe(initialCalls + 1);
  });
});

describe('geocodeAddress — short queries', () => {
  it('returns empty array for queries shorter than 3 characters', async () => {
    expect(await geocodeAddress('')).toEqual([]);
    expect(await geocodeAddress('ab')).toEqual([]);
  });

  it('makes request for queries of exactly 3 characters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ features: [] }),
    } as Response);

    await geocodeAddress('abc');
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('geocodeAddress — error handling', () => {
  it('returns empty array on network error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
    const results = await geocodeAddress('Helsinki network err test');
    expect(results).toEqual([]);
    fetchSpy.mockRestore();
  });

  it('returns empty array on non-ok response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);
    const results = await geocodeAddress('Helsinki server err test');
    expect(results).toEqual([]);
    fetchSpy.mockRestore();
  });

  it('returns empty array on abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    const results = await geocodeAddress('Helsinki abort test', controller.signal);
    expect(results).toEqual([]);
    fetchSpy.mockRestore();
  });
});
