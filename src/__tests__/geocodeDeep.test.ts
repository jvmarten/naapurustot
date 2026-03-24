import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('geocodeAddress — deep edge cases', () => {
  let geocodeAddress: (query: string) => Promise<import('../utils/geocode').GeocodeResult[]>;

  beforeEach(async () => {
    vi.resetModules();
    // Fresh import to reset cache
    const mod = await import('../utils/geocode');
    geocodeAddress = mod.geocodeAddress;
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns empty for 1-character query', async () => {
    expect(await geocodeAddress('a')).toEqual([]);
  });

  it('returns empty for 2-character query', async () => {
    expect(await geocodeAddress('ab')).toEqual([]);
  });

  it('returns results for 3-character query', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          features: [
            {
              properties: { label: 'Abc 1' },
              geometry: { coordinates: [24.9, 60.2] },
            },
          ],
        }),
    });
    const results = await geocodeAddress('abc');
    expect(results.length).toBe(1);
    expect(results[0].label).toBe('Abc 1');
  });

  it('returns empty array on fetch failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
    const results = await geocodeAddress('test query');
    expect(results).toEqual([]);
  });

  it('returns empty array on non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false });
    const results = await geocodeAddress('test query');
    expect(results).toEqual([]);
  });

  it('caches results (case-insensitive)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          features: [
            {
              properties: { label: 'Test' },
              geometry: { coordinates: [24.9, 60.2] },
            },
          ],
        }),
    });

    await geocodeAddress('Helsinki');
    await geocodeAddress('helsinki');
    await geocodeAddress('HELSINKI');

    // Should have only called fetch once
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('handles response with no features property', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const results = await geocodeAddress('unknown place');
    expect(results).toEqual([]);
  });

  it('handles whitespace in query (trims for cache key)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          features: [
            {
              properties: { label: 'Test' },
              geometry: { coordinates: [24.9, 60.2] },
            },
          ],
        }),
    });

    await geocodeAddress('  Helsinki  ');
    await geocodeAddress('helsinki');

    // Trimmed queries should match cache
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends correct boundary parameters', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: [] }),
    });

    await geocodeAddress('Mannerheimintie');

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('boundary.rect.min_lon=22.0');
    expect(url).toContain('boundary.rect.max_lon=25.3');
    expect(url).toContain('boundary.rect.min_lat=60.1');
    expect(url).toContain('boundary.rect.max_lat=60.6');
    expect(url).toContain('size=5');
    expect(url).toContain('lang=fi');
  });
});
