import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  radarFrameAt,
  radarInRange,
  radarRequestSize,
  radarUrl,
  fetchRadarFrame,
  RadarUnpublished,
  RADAR_STEP_MS,
  RADAR_TOLERANCE_MS,
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
 */

const HELSINKI: Bbox = { south: 60.1, west: 24.8, north: 60.3, east: 25.1 };

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
  const size = { width: 64, height: 64 };
  const want = Date.UTC(2026, 7, 17, 18, 5, 0);

  /** jsdom has no decoder; the frames themselves are not what is under test. */
  const stubDecoder = () =>
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 64, height: 64 }));

  it('returns the composite stamped with its own instant', async () => {
    stubDecoder();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()));
    const frame = await fetchRadarFrame(HELSINKI, size, want);
    expect(frame?.at).toBe(want);
    expect(frame?.bbox).toEqual(HELSINKI);
  });

  it('walks back past instants FMI answers with an exception, not an image', async () => {
    stubDecoder();
    // The leading edge: 18:05 is asked for a minute or two before it is out.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(exceptionResponse())
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    const frame = await fetchRadarFrame(HELSINKI, size, want);
    expect(frame?.at).toBe(want - RADAR_STEP_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Each attempt names its own instant — one request per step, not a range.
    const asked = fetchMock.mock.calls.map((c) => new URL(c[0] as string).searchParams.get('time'));
    expect(asked).toEqual(['2026-08-17T18:05:00Z', '2026-08-17T18:00:00Z']);
  });

  it('stops at the frame already in hand instead of re-downloading it', async () => {
    stubDecoder();
    const fetchMock = vi.fn().mockResolvedValue(exceptionResponse());
    vi.stubGlobal('fetch', fetchMock);
    const frame = await fetchRadarFrame(HELSINKI, size, want, undefined, want - RADAR_STEP_MS);
    // null is "yours is still the newest" — and the probe for the newer instant
    // above it still went out, because that is the question being asked.
    expect(frame).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an unpublished instant as its own kind of answer', async () => {
    stubDecoder();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(exceptionResponse()));
    await expect(fetchRadarFrame(HELSINKI, size, want)).rejects.toBeInstanceOf(RadarUnpublished);
  });

  it('does not walk further back than the tolerance allows to draw', async () => {
    stubDecoder();
    const fetchMock = vi.fn().mockResolvedValue(exceptionResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchRadarFrame(HELSINKI, size, want)).rejects.toBeInstanceOf(RadarUnpublished);
    expect(fetchMock).toHaveBeenCalledTimes(RADAR_TOLERANCE_MS / RADAR_STEP_MS + 1);
  });

  it('treats a transport failure as a failure, not as a missing frame', async () => {
    stubDecoder();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, headers: new Headers() }));
    await expect(fetchRadarFrame(HELSINKI, size, want)).rejects.not.toBeInstanceOf(RadarUnpublished);
  });
});
