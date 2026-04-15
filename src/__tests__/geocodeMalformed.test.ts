/**
 * Tests for geocode.ts malformed-response validation.
 *
 * The Digitransit API is external — its response shape can change without
 * notice. Without input validation, a malformed feature (null coords, string
 * coords, missing label) would propagate invalid values into:
 *   - booleanPointInPolygon → crash during neighborhood lookup
 *   - map.flyTo({ center: [NaN, NaN] }) → blank map, silent failure
 *   - The search dropdown UI rendering `undefined`/`null` labels.
 *
 * We test every rejection branch in the feature-validation loop. Each test
 * asserts that one type of bad feature is filtered OUT and a good feature
 * alongside it is kept.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const GOOD = {
  properties: { label: 'Good Place' },
  geometry: { coordinates: [24.9, 60.2] },
};

describe('geocodeAddress — malformed feature rejection', () => {
  let geocodeAddress: typeof import('../utils/geocode').geocodeAddress;

  beforeEach(async () => {
    vi.resetModules();
    // Fresh import to reset the in-module LRU cache
    const mod = await import('../utils/geocode');
    geocodeAddress = mod.geocodeAddress;
    vi.stubGlobal('fetch', vi.fn());
  });

  async function run(features: unknown[]): Promise<Array<{ label: string; coordinates: [number, number] }>> {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features }),
    });
    // Use a unique query each time to avoid cache hits across tests.
    return geocodeAddress(`uniq_${Math.random()}_${Date.now()}`);
  }

  it('rejects null feature entries', async () => {
    const out = await run([null, GOOD]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('Good Place');
  });

  it('rejects non-object feature entries (string, number)', async () => {
    const out = await run(['not an object', 42, GOOD]);
    expect(out).toHaveLength(1);
  });

  it('rejects feature with missing label', async () => {
    const out = await run([
      { properties: {}, geometry: { coordinates: [24.9, 60.2] } },
      GOOD,
    ]);
    expect(out).toHaveLength(1);
  });

  it('rejects feature with non-string label (number or null)', async () => {
    const out = await run([
      { properties: { label: 42 }, geometry: { coordinates: [24.9, 60.2] } },
      { properties: { label: null }, geometry: { coordinates: [24.9, 60.2] } },
      GOOD,
    ]);
    expect(out).toHaveLength(1);
  });

  it('rejects feature with empty-string label', async () => {
    const out = await run([
      { properties: { label: '' }, geometry: { coordinates: [24.9, 60.2] } },
      GOOD,
    ]);
    expect(out).toHaveLength(1);
  });

  it('rejects feature with missing geometry', async () => {
    const out = await run([
      { properties: { label: 'No Geom' } },
      GOOD,
    ]);
    expect(out).toHaveLength(1);
  });

  it('rejects feature with null coordinates', async () => {
    const out = await run([
      { properties: { label: 'Null Coords' }, geometry: { coordinates: null } },
      GOOD,
    ]);
    expect(out).toHaveLength(1);
  });

  it('rejects feature with non-array coordinates (string)', async () => {
    const out = await run([
      { properties: { label: 'Str Coords' }, geometry: { coordinates: '24.9,60.2' } },
      GOOD,
    ]);
    expect(out).toHaveLength(1);
  });

  it('rejects feature with coordinates of length < 2', async () => {
    const out = await run([
      { properties: { label: 'Half Coords' }, geometry: { coordinates: [24.9] } },
      { properties: { label: 'No Coords' }, geometry: { coordinates: [] } },
      GOOD,
    ]);
    expect(out).toHaveLength(1);
  });

  it('rejects feature with non-numeric coordinate values', async () => {
    const out = await run([
      { properties: { label: 'Str Lng' }, geometry: { coordinates: ['24.9', 60.2] } },
      { properties: { label: 'Str Lat' }, geometry: { coordinates: [24.9, '60.2'] } },
      { properties: { label: 'Null Lng' }, geometry: { coordinates: [null, 60.2] } },
      GOOD,
    ]);
    expect(out).toHaveLength(1);
  });

  it('rejects feature with NaN or Infinity coordinate values', async () => {
    // NaN would silently break turf's point-in-polygon check.
    // Infinity would blow up MapLibre's flyTo().
    const out = await run([
      { properties: { label: 'NaN' }, geometry: { coordinates: [NaN, 60.2] } },
      { properties: { label: 'Inf' }, geometry: { coordinates: [Infinity, 60.2] } },
      { properties: { label: '-Inf' }, geometry: { coordinates: [24.9, -Infinity] } },
      GOOD,
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps multiple valid features in response order', async () => {
    const out = await run([
      { properties: { label: 'First' }, geometry: { coordinates: [24.9, 60.2] } },
      null, // malformed in between
      { properties: { label: 'Second' }, geometry: { coordinates: [25.0, 60.3] } },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe('First');
    expect(out[1].label).toBe('Second');
  });

  it('returns empty array when data.features is not an array', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: 'not-an-array' }),
    });
    const out = await geocodeAddress('notarray_test');
    expect(out).toEqual([]);
  });

  it('returns empty array when response body is null', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(null),
    });
    const out = await geocodeAddress('null_body_test');
    expect(out).toEqual([]);
  });
});

describe('geocodeAddress — LRU cache eviction', () => {
  // The in-module cache is capped at 100 entries. On overflow, the oldest
  // entry is evicted. This prevents unbounded memory growth.
  let geocodeAddress: typeof import('../utils/geocode').geocodeAddress;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/geocode');
    geocodeAddress = mod.geocodeAddress;
    vi.stubGlobal('fetch', vi.fn());
  });

  it('evicts oldest entry when cache exceeds 100 entries', async () => {
    // Mock fetch to always resolve successfully
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        features: [{ properties: { label: 'X' }, geometry: { coordinates: [24.9, 60.2] } }],
      }),
    });

    // Fill the cache with 101 unique queries (the 101st forces eviction of the 1st)
    for (let i = 0; i < 101; i++) {
      await geocodeAddress(`query_${i}`);
    }

    const fetchFn = fetch as ReturnType<typeof vi.fn>;
    const callsAfterFill = fetchFn.mock.calls.length;
    expect(callsAfterFill).toBe(101);

    // The oldest entry (query_0) should have been evicted by LRU, so re-fetching it triggers a new call
    await geocodeAddress('query_0');
    expect(fetchFn.mock.calls.length).toBe(callsAfterFill + 1);

    // A middle entry (query_50) should still be cached — no new fetch
    await geocodeAddress('query_50');
    expect(fetchFn.mock.calls.length).toBe(callsAfterFill + 1);
  });

  it('re-access of a cached entry moves it to most-recent position', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        features: [{ properties: { label: 'X' }, geometry: { coordinates: [24.9, 60.2] } }],
      }),
    });

    // Add 100 entries
    for (let i = 0; i < 100; i++) await geocodeAddress(`q_${i}`);
    // Touch query_0 → moves to most-recent
    await geocodeAddress('q_0');
    // Add one more → evicts query_1 (now the oldest, NOT query_0)
    await geocodeAddress('overflow');

    const fetchFn = fetch as ReturnType<typeof vi.fn>;
    const callsBefore = fetchFn.mock.calls.length;

    // q_1 evicted → re-fetches
    await geocodeAddress('q_1');
    expect(fetchFn.mock.calls.length).toBe(callsBefore + 1);

    // q_0 still cached (was touched) → no new fetch
    await geocodeAddress('q_0');
    expect(fetchFn.mock.calls.length).toBe(callsBefore + 1);
  });
});
