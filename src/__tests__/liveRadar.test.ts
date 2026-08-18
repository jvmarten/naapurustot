import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  closeReel,
  createReel,
  fetchRadarFrame,
  radarFrameAt,
  radarInRange,
  radarRequestSize,
  radarUrl,
  reelAbsent,
  reelCovers,
  reelPeek,
  reelPending,
  reelPick,
  reelPlan,
  reelPut,
  reelRetarget,
  RADAR_ABSENT_RETRY_MS,
  RADAR_STEP_MS,
  RADAR_TOLERANCE_MS,
  type RadarFrame,
} from '../live/radar';
import type { Bbox } from '../live/shadows';

/**
 * The radar composite.
 *
 * The first raster feed on /live/, and every trap in it is a trap that fails
 * QUIETLY rather than loudly, which is what these tests are about.
 *
 * FMI answers an instant it does not hold with HTTP 200 and a text/xml
 * ServiceException, so an unguarded reader gets a "successful" response that is
 * not an image. WMS 1.3.0 reads an EPSG:4326 bbox as lat,lon and an EPSG:3857
 * one as x,y, and getting either wrong returns a perfectly valid picture of the
 * wrong place. And the frame carries its OWN instant, minutes behind the
 * playhead that asked for it — so the two rules about what may be drawn under
 * which clock are the difference between a stated lag and a silent lie.
 *
 * The reel is the second half. It is what lets the layer answer a MOVING clock,
 * and the failures it has to be held to are the ones the single-slot design
 * shipped: a scrub that blanked the map, a plan that re-probed the same missing
 * instants forever, and a state machine that reported "FMI has not published
 * this yet" over an archive FMI certainly holds.
 */

const HELSINKI: Bbox = { south: 60.1, west: 24.8, north: 60.3, east: 25.1 };
const WIDER: Bbox = { south: 60.0, west: 24.7, north: 60.4, east: 25.2 };
const SIZE = { width: 64, height: 64 };

/** An image response, with the content type the real service sends. */
function imageResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/png' }),
    blob: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' })),
  };
}

/** FMI's answer for an instant outside the mosaic: 200, and not an image. */
function exceptionResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/xml;charset=UTF-8' }),
    text: () =>
      Promise.resolve(
        '<ServiceExceptionReport><ServiceException code="InvalidDimensionValue" locator="time"/></ServiceExceptionReport>',
      ),
  };
}

afterEach(() => vi.unstubAllGlobals());

/** A frame with a countable bitmap, so eviction can be observed closing it. */
function frameAt(at: number, bbox: Bbox = HELSINKI, side = 4): RadarFrame {
  const image = { width: side, height: side, close: vi.fn() } as unknown as ImageBitmap;
  return { image, at, x0: 0, y0: 0, x1: 1, y1: 1, bbox };
}

const closed = (frame: RadarFrame) => (frame.image.close as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0;

describe('radarFrameAt', () => {
  it('floors onto the published five-minute grid', () => {
    const t = Date.UTC(2026, 7, 17, 18, 3, 47, 500);
    expect(radarFrameAt(t)).toBe(Date.UTC(2026, 7, 17, 18, 0, 0));
  });

  it('leaves an instant already on the grid alone', () => {
    const t = Date.UTC(2026, 7, 17, 18, 5, 0);
    expect(radarFrameAt(t)).toBe(t);
  });

  it('steps by exactly one interval between adjacent frames', () => {
    const a = radarFrameAt(Date.UTC(2026, 7, 17, 18, 4, 59));
    const b = radarFrameAt(Date.UTC(2026, 7, 17, 18, 5, 1));
    expect(b - a).toBe(RADAR_STEP_MS);
  });
});

describe('radarInRange', () => {
  const when = Date.UTC(2026, 7, 17, 18, 4, 0);

  it('accepts a composite the playhead has reached', () => {
    expect(radarInRange(when - 60_000, when)).toBe(true);
  });

  it('refuses one from the playhead’s future', () => {
    // The page's one unforgivable statement: a picture nobody had yet, drawn
    // under a clock that has not got to it.
    expect(radarInRange(when + 1, when)).toBe(false);
  });

  it('refuses one older than the tolerance', () => {
    expect(radarInRange(when - RADAR_TOLERANCE_MS, when)).toBe(true);
    expect(radarInRange(when - RADAR_TOLERANCE_MS - 1, when)).toBe(false);
  });
});

describe('radarUrl', () => {
  const url = radarUrl(HELSINKI, { width: 400, height: 300 }, Date.UTC(2026, 7, 17, 18, 0));
  const q = new URL(url).searchParams;

  it('asks the open WMS for the national composite as a transparent PNG', () => {
    expect(url.startsWith('https://openwms.fmi.fi/geoserver/Radar/wms?')).toBe(true);
    expect(q.get('layers')).toBe('suomi_dbz_eureffin');
    expect(q.get('format')).toBe('image/png');
    expect(q.get('transparent')).toBe('true');
    expect(q.get('request')).toBe('GetMap');
  });

  it('sends the time on the grid, without milliseconds', () => {
    // GeoServer matches the mosaic's own index; a fractional second is not on it.
    expect(q.get('time')).toBe('2026-08-17T18:00:00Z');
  });

  it('sends a Web Mercator bbox as minx,miny,maxx,maxy', () => {
    expect(q.get('crs')).toBe('EPSG:3857');
    const [minx, miny, maxx, maxy] = (q.get('bbox') ?? '').split(',').map(Number);
    expect(maxx).toBeGreaterThan(minx);
    expect(maxy).toBeGreaterThan(miny);
    // Helsinki: ~24.8-25.1 E is ~2.76-2.79 Mm of easting, ~60.1-60.3 N is
    // ~8.42-8.47 Mm of northing. A lat/lon axis swap lands in the Gulf of
    // Guinea and still returns a valid image, which is the failure being pinned.
    expect(minx).toBeGreaterThan(2_700_000);
    expect(maxx).toBeLessThan(2_850_000);
    expect(miny).toBeGreaterThan(8_350_000);
    expect(maxy).toBeLessThan(8_550_000);
  });
});

describe('radarRequestSize', () => {
  it('follows the ground box’s aspect, not the canvas’s', () => {
    // Mercator stretches north-south with latitude, so a box that is 0.3° wide
    // and 0.2° tall is NOT 3:2 on the map. Requesting the canvas's shape is how
    // a frame lands stretched.
    const { width, height } = radarRequestSize(HELSINKI, 4_000_000);
    expect(width / height).toBeGreaterThan(0.6);
    expect(width / height).toBeLessThan(1.1);
  });

  it('never asks for more pixels than the composite has cells', () => {
    // A street-zoom camera would happily ask for a 1400 px image of a 2 km box.
    // The composite's cells are 500 m, so GeoServer would resample one cell into
    // a few hundred pixels and charge for them.
    const street: Bbox = { south: 60.16, west: 24.93, north: 60.18, east: 24.96 };
    const { width } = radarRequestSize(street, 400_000_000);
    // ~1.7 km across at 500 m a cell is a handful of pixels; the floor holds it
    // at 16 rather than letting it collapse.
    expect(width).toBeLessThanOrEqual(20);
  });

  it('caps a national view so a large display cannot ask for the world', () => {
    const finland: Bbox = { south: 59.5, west: 19, north: 70.2, east: 31.7 };
    const { width, height } = radarRequestSize(finland, 100_000_000, 800);
    expect(width).toBeLessThanOrEqual(800);
    expect(height).toBeLessThanOrEqual(800);
  });
});

describe('fetchRadarFrame', () => {
  const want = Date.UTC(2026, 7, 17, 18, 5, 0);

  /** jsdom has no decoder; the frames themselves are not what is under test. */
  const stubDecoder = () =>
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 64, height: 64 }));

  it('returns the composite stamped with its own instant', async () => {
    stubDecoder();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()));
    const frame = await fetchRadarFrame(HELSINKI, SIZE, want);
    expect(frame?.at).toBe(want);
    expect(frame?.bbox).toEqual(HELSINKI);
  });

  it('asks for exactly the instant it was given, once', async () => {
    stubDecoder();
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    await fetchRadarFrame(HELSINKI, SIZE, want);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The walk-back used to live in here and re-probed the same missing instants
    // on every camera nudge; it is `reelPlan`'s job now, where the reel can
    // remember what it has already been told.
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('time')).toBe(
      '2026-08-17T18:05:00Z',
    );
  });

  it('reports an instant FMI has no composite for as null, not as an error', async () => {
    stubDecoder();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(exceptionResponse()));
    // "There is no 18:05 yet" is an answer. Throwing here is what made the page
    // print "could not load the radar" over a service that is working.
    await expect(fetchRadarFrame(HELSINKI, SIZE, want)).resolves.toBeNull();
  });

  it('treats a transport failure as a failure, not as a missing frame', async () => {
    stubDecoder();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, headers: new Headers() }));
    await expect(fetchRadarFrame(HELSINKI, SIZE, want)).rejects.toThrow(/503/);
  });
});

describe('the reel', () => {
  const noon = Date.UTC(2026, 7, 17, 12, 0, 0);
  const reelAt = () => createReel(WIDER, SIZE, 1000);

  it('picks the newest composite within tolerance of the playhead', () => {
    const reel = reelAt();
    reelPut(reel, frameAt(noon - 2 * RADAR_STEP_MS));
    reelPut(reel, frameAt(noon - RADAR_STEP_MS));
    expect(reelPick(reel, noon)?.at).toBe(noon - RADAR_STEP_MS);
  });

  it('never picks a composite from the playhead’s future', () => {
    const reel = reelAt();
    reelPut(reel, frameAt(noon + RADAR_STEP_MS));
    expect(reelPick(reel, noon)).toBeNull();
  });

  it('never picks one older than the tolerance', () => {
    const reel = reelAt();
    reelPut(reel, frameAt(noon - RADAR_TOLERANCE_MS - RADAR_STEP_MS));
    expect(reelPick(reel, noon)).toBeNull();
  });

  it('holds a whole scrub, so moving the clock back costs nothing', () => {
    // THE FAILURE THIS EXISTS FOR. One slot meant a backwards drag blanked the
    // map on its very first step, because a frame ahead of the playhead may not
    // be drawn — and then had to re-download what it had just thrown away.
    const reel = reelAt();
    for (let i = 0; i < 6; i++) reelPut(reel, frameAt(noon - i * RADAR_STEP_MS));
    for (let i = 0; i < 6; i++) {
      const when = noon - i * RADAR_STEP_MS;
      expect(reelPick(reel, when)?.at).toBe(when);
      expect(reelPlan(reel, when, noon)).toEqual([]);
    }
  });

  it('peeks without disturbing the eviction order it reports on', () => {
    const reel = reelAt();
    reelPut(reel, frameAt(noon));
    expect(reelPeek(reel, noon)?.at).toBe(noon);
    expect(reel.shown).toBeNull();
    expect(reelPick(reel, noon)?.at).toBe(noon);
    expect(reel.shown).toBe(noon);
  });

  it('evicts by least recently drawn, and closes what it evicts', () => {
    // A 4x4 frame is 64 decoded bytes, so a 150-byte budget holds two.
    const reel = createReel(WIDER, SIZE, 1000, 150, 64);
    const oldest = frameAt(noon - 2 * RADAR_STEP_MS);
    const middle = frameAt(noon - RADAR_STEP_MS);
    reelPut(reel, oldest);
    reelPut(reel, middle);
    reelPick(reel, noon - RADAR_STEP_MS);
    reelPut(reel, frameAt(noon));
    expect(closed(oldest)).toBe(true);
    expect(closed(middle)).toBe(false);
    expect(reel.entries.size).toBe(2);
    expect(reel.bytes).toBeLessThanOrEqual(reel.budget);
  });

  it('never evicts the frame currently on screen', () => {
    const reel = createReel(WIDER, SIZE, 1000, 1, 64);
    const shown = frameAt(noon - RADAR_STEP_MS);
    reelPut(reel, shown);
    reelPick(reel, noon);
    reelPut(reel, frameAt(noon));
    expect(closed(shown)).toBe(false);
  });

  it('plans the walk back from the playhead and stops at what it holds', () => {
    const reel = reelAt();
    reelPut(reel, frameAt(noon - 2 * RADAR_STEP_MS));
    // 12:00 and 11:55 are unknown; 11:50 is in hand and ends the walk, because
    // it is the picture that will be drawn if nothing newer arrives.
    expect(reelPlan(reel, noon, noon)).toEqual([noon, noon - RADAR_STEP_MS]);
  });

  it('asks each missing instant once instead of re-probing it forever', () => {
    const reel = reelAt();
    const learned = noon + 20 * 60_000;
    reelAbsent(reel, noon, learned);
    reelAbsent(reel, noon - RADAR_STEP_MS, learned);
    // Both are more than the tolerance old at the moment they were refused, so
    // the answer cannot change: a composite absent fifteen minutes after its own
    // instant is a radar outage or the far end of the seven-day archive.
    expect(reelPlan(reel, noon, learned)).toEqual([
      noon - 2 * RADAR_STEP_MS,
      noon - 3 * RADAR_STEP_MS,
    ]);
  });

  it('asks the leading edge again, because that answer does change', () => {
    // 12:00 refused at 12:01 is the scan not being out yet, not an outage.
    const reel = reelAt();
    reelAbsent(reel, noon, noon + 60_000);
    expect(reelPlan(reel, noon, noon + 90_000)).not.toContain(noon);
    expect(reelPlan(reel, noon, noon + 60_000 + RADAR_ABSENT_RETRY_MS)).toContain(noon);
  });

  it('prefetches ahead only when the playhead is moving forward', () => {
    const reel = reelAt();
    reelPut(reel, frameAt(noon));
    const now = noon + 60 * 60_000;
    expect(reelPlan(reel, noon, now, 1, 2)).toEqual([
      noon + RADAR_STEP_MS,
      noon + 2 * RADAR_STEP_MS,
    ]);
    expect(reelPlan(reel, noon, now, 0, 2)).toEqual([]);
  });

  it('asks for nothing at all when the clock is past what FMI can hold', () => {
    // Scrubbing into tomorrow used to walk the whole tolerance at every
    // five-minute step, four requests at a time, all answered
    // InvalidDimensionValue.
    const reel = reelAt();
    const tomorrow = noon + 24 * 3600_000;
    expect(reelPlan(reel, tomorrow, noon, 1)).toEqual([]);
    expect(reelPending(reel, tomorrow, noon)).toBe(false);
  });

  it('never asks for an instant later than now', () => {
    const reel = reelAt();
    expect(reelPlan(reel, noon, noon, 1, 2).every((at) => at <= noon)).toBe(true);
  });

  it('tells “we have not asked yet” apart from “the publisher has nothing”', () => {
    // The single-slot design printed the second sentence for both, over an
    // archive FMI certainly holds. Same split as feed invariant 14, one level up.
    const reel = reelAt();
    expect(reelPending(reel, noon, noon)).toBe(true);
    for (let i = 0; i <= RADAR_TOLERANCE_MS / RADAR_STEP_MS; i++) {
      reelAbsent(reel, noon - i * RADAR_STEP_MS, noon);
    }
    expect(reelPending(reel, noon, noon)).toBe(false);
  });

  it('stops being pending the moment a frame in range is in hand', () => {
    const reel = reelAt();
    reelPut(reel, frameAt(noon - RADAR_STEP_MS));
    expect(reelPending(reel, noon, noon)).toBe(true);
    reelPut(reel, frameAt(noon));
    expect(reelPending(reel, noon, noon)).toBe(false);
  });

  it('keeps the frame on screen across a camera change and drops the rest', () => {
    const reel = reelAt();
    const shown = frameAt(noon);
    const other = frameAt(noon - RADAR_STEP_MS);
    reelPut(reel, shown);
    reelPut(reel, other);
    reelPick(reel, noon);
    reelRetarget(reel, HELSINKI, SIZE, 4000);
    expect(closed(other)).toBe(true);
    expect(closed(shown)).toBe(false);
    // It still draws — on its own ground, through paintRadar's affine — but it
    // no longer counts as held, so the new cut is asked for.
    expect(reelPeek(reel, noon)?.at).toBe(noon);
    expect(reelPlan(reel, noon, noon)).toContain(noon);
  });

  it('reuses a cut for a pan inside the padding and for any zoom out', () => {
    const reel = createReel(WIDER, SIZE, 1000);
    expect(reelCovers(reel, HELSINKI, 1000)).toBe(true);
    expect(reelCovers(reel, HELSINKI, 400)).toBe(true);
    // A zoom IN past the resolution the frame was cut at is a new cut.
    expect(reelCovers(reel, HELSINKI, 2000)).toBe(false);
    // Ground the frame does not cover is a new cut however close the zoom is.
    expect(reelCovers(reel, { south: 59, west: 24.8, north: 60.3, east: 25.1 }, 1000)).toBe(false);
  });

  it('releases every decoded bitmap when the feed goes off', () => {
    const reel = reelAt();
    const frames = [frameAt(noon), frameAt(noon - RADAR_STEP_MS)];
    for (const f of frames) reelPut(reel, f);
    closeReel(reel);
    expect(frames.every(closed)).toBe(true);
    expect(reel.entries.size).toBe(0);
    expect(reel.bytes).toBe(0);
  });
});
