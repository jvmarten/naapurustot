import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseTrains, fetchTrains, TRAINS_ENDPOINT, TRAIN_POLL_MS } from '../live/trains';
import { ALL_FEEDS, defaultEnabledFeeds, sanitizeEnabled } from '../live/feeds';

/**
 * The live train feed.
 *
 * The thing worth pinning here is not the happy path — it is that a malformed
 * feature is DROPPED rather than drawn. A train with a missing or swapped
 * coordinate does not fail visibly on a map: it renders a perfectly convincing
 * dot in the Gulf of Guinea, which is worse than showing nothing because it
 * looks like data. Same reasoning as the shadow layer's coverage denominator.
 */

/** One feature in the shape the endpoint actually sends. */
function raw(over: Record<string, unknown> = {}) {
  return {
    accuracy: 4,
    location: { type: 'Point', coordinates: [24.940157, 60.178017] },
    speed: 84,
    trainNumber: 27,
    departureDate: '2026-08-09',
    timestamp: '2026-08-09T11:58:29.000Z',
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseTrains', () => {
  it('reads a train off the live payload shape', () => {
    const [train] = parseTrains([raw()]);
    expect(train).toEqual({
      number: 27,
      // The departure date is kept: the number alone repeats daily, so the pair
      // is what identifies a train to every per-train endpoint (trainDetail.ts).
      date: '2026-08-09',
      lon: 24.940157,
      lat: 60.178017,
      speed: 84,
      at: Date.parse('2026-08-09T11:58:29.000Z'),
    });
  });

  it('throws on a payload that is not an array', () => {
    // Digitraffic answers a bad request with a JSON error OBJECT and HTTP 400,
    // but an object arriving with a 200 must not be read as "no trains running".
    expect(() => parseTrains({ errorMessage: 'Unknown parameter' })).toThrow(/array/);
    expect(() => parseTrains(null)).toThrow(/array/);
  });

  it('drops features with unusable coordinates instead of placing them at null island', () => {
    const trains = parseTrains([
      raw({ location: null }),
      raw({ location: {} }),
      raw({ location: { coordinates: [] } }),
      raw({ location: { coordinates: [24.9] } }),
      raw({ location: { coordinates: ['24.9', '60.1'] } }),
      raw({ location: { coordinates: [Number.NaN, 60.1] } }),
      raw({ location: { coordinates: [24.9, 900] } }),
      raw({ location: { coordinates: [400, 60.1] } }),
    ]);
    expect(trains).toEqual([]);
  });

  it('drops a feature with no train number', () => {
    expect(parseTrains([raw({ trainNumber: undefined })])).toEqual([]);
    expect(parseTrains([raw({ trainNumber: 'IC27' })])).toEqual([]);
  });

  it('keeps a train whose speed or timestamp is missing, as null', () => {
    // A stopped train reports speed 0 and a train with a sick clock still has a
    // position — neither is a reason to leave it off the map. Null is how the
    // renderer knows to skip the speed label and to treat the fix as ageless.
    const [noSpeed] = parseTrains([raw({ speed: undefined })]);
    expect(noSpeed.speed).toBeNull();
    expect(noSpeed.number).toBe(27);

    const [stopped] = parseTrains([raw({ speed: 0 })]);
    expect(stopped.speed).toBe(0);

    const [noTime] = parseTrains([raw({ timestamp: 'not a date' })]);
    expect(noTime.at).toBeNull();
    const [noTime2] = parseTrains([raw({ timestamp: undefined })]);
    expect(noTime2.at).toBeNull();
  });

  it('reads an empty feed as no trains running, not as an error', () => {
    expect(parseTrains([])).toEqual([]);
  });
});

describe('fetchTrains', () => {
  it('identifies the client to Fintraffic, which asks every caller to', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [raw()] });
    vi.stubGlobal('fetch', fetchMock);

    const trains = await fetchTrains();

    expect(trains).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(TRAINS_ENDPOINT);
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['Digitraffic-User']).toMatch(/naapurustot/);
  });

  it('fetches the whole country, with no bbox', async () => {
    // Scoping to the viewport would mean a request per pan for a payload that is
    // 2.4 kB gzipped nationally — see the note at the top of trains.ts.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    await fetchTrains();
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('bbox');
  });

  it('throws on a failed response rather than reporting an empty network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    // "No trains are running" and "we could not ask" have to stay distinguish-
    // able, or a dead endpoint renders as a country with no rail traffic.
    await expect(fetchTrains()).rejects.toThrow(/503/);
  });

  it('passes the abort signal through, so a switched-off layer cancels', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await fetchTrains(controller.signal);
    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBe(controller.signal);
  });
});

describe('the trains feed in the registry', () => {
  const trains = ALL_FEEDS.find((f) => f.id === 'trains');

  it('is live and national', () => {
    expect(trains?.status).toBe('live');
    // The shadow feed is 'urban' because its buildings are one city. This one
    // covers every train in the country, and the sidebar badge must say so.
    expect(trains?.coverage).toBe('national');
  });

  it('survives a round trip through the persisted enabled set', () => {
    // sanitizeEnabled drops ids that are not live, so a feed flipped to 'live'
    // has to actually pass it — otherwise the toggle switches on and nothing
    // responds, which is how a phantom feed happens.
    expect(defaultEnabledFeeds().has('trains')).toBe(true);
    expect(sanitizeEnabled(['trains', 'not_a_feed']).has('trains')).toBe(true);
    expect(sanitizeEnabled(['trains']).has('not_a_feed')).toBe(false);
  });
});

describe('poll rate', () => {
  it('stays polite to a free shared endpoint', () => {
    // Not a style assertion: this is a public API funded by nobody, and the
    // page holds the poll open for as long as the tab is visible.
    expect(TRAIN_POLL_MS).toBeGreaterThanOrEqual(5_000);
  });
});
