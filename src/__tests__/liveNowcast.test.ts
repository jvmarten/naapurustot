import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchNowcastFrame,
  fetchNowcastRun,
  nowcastUrl,
  type NowcastRun,
} from '../live/nowcast';
import {
  createReel,
  reelPending,
  reelPlan,
  RADAR_STEP_MS,
  RADAR_TOLERANCE_MS,
} from '../live/radar';
import type { Bbox } from '../live/shadows';

/**
 * The rain forecast — MET Norway's Nordic radar nowcast.
 *
 * The second publisher on this layer, and everything pinned here is a way the
 * seam between the two could quietly become a lie. A run that has not been
 * published answers HTTP 500 with a Tomcat HTML page; an instant past the run's
 * horizon answers HTTP 400 with a proper ServiceException; and ncWMS SNAPS a
 * requested time to its nearest step, so an unquantised drag would fetch a
 * different URL per pixel for byte-identical pictures.
 *
 * The rule none of it may break: a forecast is never drawn over an instant a
 * measurement can speak for. That is `reelPlan`'s job and it is pinned at the
 * bottom of this file.
 */

const HELSINKI: Bbox = { south: 60.1, west: 24.8, north: 60.3, east: 25.1 };
const SIZE = { width: 64, height: 64 };
const ANALYSIS = Date.UTC(2026, 7, 18, 7, 15, 0);
const RUN: NowcastRun = {
  analysis: ANALYSIS,
  from: ANALYSIS,
  to: ANALYSIS + 115 * 60_000,
};

function xmlResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/xml;charset=UTF-8' }),
    text: () => Promise.resolve(body),
  };
}

/** What THREDDS answers for a run whose file is not on disk. */
function tomcat500() {
  return {
    ok: false,
    status: 500,
    headers: new Headers({ 'content-type': 'text/html;charset=utf-8' }),
    text: () => Promise.resolve('<!doctype html><html><title>HTTP Status 500</title>'),
  };
}

/**
 * Capabilities as ncWMS actually pretty-prints them.
 *
 * The extent sits on its own indented line, which is not cosmetic: `Date.parse`
 * of `"\n            2026-08-18T07:40:00.000Z"` is NaN rather than a date, and
 * that made every run in the walk look unpublished and the forecast half of the
 * layer report "could not load" against a service answering 200. Reproduced
 * against the live document before it was fixed, which is why the whitespace is
 * here verbatim rather than tidied away.
 */
function capabilities(from: string, to: string) {
  return xmlResponse(
    `<WMS_Capabilities>\n  <Layer>\n    <Name>lwe_precipitation_rate</Name>\n` +
      `    <Dimension name="time" units="ISO8601" multipleValues="true" current="true"\n` +
      `               default="${to}">\n            ${from}/${to}/PT5M\n        </Dimension>\n` +
      `  </Layer>\n</WMS_Capabilities>`,
  );
}

function imageResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/png' }),
    blob: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' })),
  };
}

const stubDecoder = () =>
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 64, height: 64 }));

afterEach(() => vi.unstubAllGlobals());

describe('nowcastUrl', () => {
  const url = nowcastUrl(RUN, HELSINKI, { width: 400, height: 300 }, ANALYSIS + 30 * 60_000);
  const q = new URL(url).searchParams;

  it('names the run’s own file, stamped with its analysis instant', () => {
    expect(url.startsWith('https://thredds.met.no/thredds/wms/radarnowcasting/')).toBe(true);
    // There is no `latest` alias — it answers 500 — so the filename IS how a run
    // is addressed, and getting the stamp wrong is a 500 rather than an error.
    expect(url).toContain('nordiclcc-1000.20260818T071500Z.nc?');
    expect(q.get('layers')).toBe('lwe_precipitation_rate');
  });

  it('draws nothing below the threshold for measurable rain', () => {
    // ncWMS paints EVERY value including zero unless told otherwise, and a rain
    // layer that fills the map with "no rain" is not a map.
    expect(q.get('belowmincolor')).toBe('transparent');
    expect(q.get('colorscalerange')).toBe('0.1,20');
    expect(q.get('logscale')).toBe('true');
    expect(q.get('abovemaxcolor')).toBe('extend');
  });

  it('asks for MET’s own precipitation palette', () => {
    // The publisher has already decided how their field reads, and theirs is
    // nothing like FMI's cyan dBZ ramp — which is what tells the two halves of
    // this layer apart without inventing anything here.
    expect(q.get('styles')).toBe('default-scalar/metnoprecipitation');
  });

  it('sends a Web Mercator bbox, not a lat/lon one', () => {
    expect(q.get('crs')).toBe('EPSG:3857');
    const [minx, , maxx] = (q.get('bbox') ?? '').split(',').map(Number);
    expect(minx).toBeGreaterThan(2_700_000);
    expect(maxx).toBeLessThan(2_850_000);
  });

  it('sends the instant on the five-minute grid', () => {
    expect(q.get('time')).toBe('2026-08-18T07:45:00.000Z');
  });
});

/**
 * The resolved run is cached module-side for NOWCAST_RUN_TTL_MS, so these cases
 * hand it wall clocks more than ten minutes apart. Reusing one `now` across two
 * of them would test the cache rather than the walk.
 */
describe('fetchNowcastRun', () => {
  const now = ANALYSIS + 7 * 60_000;

  it('walks back to the newest run that is actually published', async () => {
    // Measured publication latency is about seven minutes, so the run named by
    // the current five-minute step is routinely still a 500.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tomcat500())
      .mockResolvedValueOnce(
        capabilities('2026-08-18T07:15:00.000Z', '2026-08-18T09:10:00.000Z'),
      );
    vi.stubGlobal('fetch', fetchMock);
    const run = await fetchNowcastRun(now);
    expect(run.analysis).toBe(ANALYSIS);
    expect(run.to).toBe(Date.UTC(2026, 7, 18, 9, 10, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const asked = fetchMock.mock.calls.map((c) => (c[0] as string).match(/\.(\d{8}T\d{6}Z)\.nc/)?.[1]);
    expect(asked).toEqual(['20260818T072000Z', '20260818T071500Z']);
  });

  it('takes the horizon from the run rather than assuming it', async () => {
    // A hard-coded +115 minutes would keep asking for steps a shortened run does
    // not hold, and every one of those is an HTTP 400.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(capabilities('2026-08-18T07:15:00.000Z', '2026-08-18T08:00:00.000Z')),
    );
    const run = await fetchNowcastRun(now + 20 * 60_000);
    expect(run.to).toBe(Date.UTC(2026, 7, 18, 8, 0, 0));
  });

  it('gives up rather than walking the whole morning', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tomcat500());
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchNowcastRun(now + 60 * 60_000)).rejects.toThrow(/no published run/);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(7);
  });
});

describe('fetchNowcastFrame', () => {
  it('marks the frame as a forecast and stamps it with its analysis', async () => {
    stubDecoder();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()));
    const frame = await fetchNowcastFrame(RUN, HELSINKI, SIZE, ANALYSIS + 30 * 60_000);
    expect(frame?.forecast).toBe(true);
    expect(frame?.runAt).toBe(ANALYSIS);
    expect(frame?.at).toBe(ANALYSIS + 30 * 60_000);
  });

  it('refuses an instant past the run’s horizon without asking', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchNowcastFrame(RUN, HELSINKI, SIZE, RUN.to + RADAR_STEP_MS)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a refused instant as an answer, not as a failure', async () => {
    // 400 is the run declining a time outside its window; 500 is its file having
    // rotated out from under us. Neither deserves "could not load the radar".
    for (const status of [400, 500]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status, headers: new Headers() }),
      );
      await expect(
        fetchNowcastFrame(RUN, HELSINKI, SIZE, ANALYSIS + 10 * 60_000),
      ).resolves.toBeNull();
    }
  });

  it('treats any other transport failure as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, headers: new Headers() }),
    );
    await expect(
      fetchNowcastFrame(RUN, HELSINKI, SIZE, ANALYSIS + 10 * 60_000),
    ).rejects.toThrow(/503/);
  });
});

describe('the seam between the two publishers', () => {
  const now = ANALYSIS + 7 * 60_000;
  const reelAt = () => createReel(HELSINKI, SIZE, 1000);

  it('asks for nothing past now until a run has been resolved', () => {
    const reel = reelAt();
    const ahead = now + 40 * 60_000;
    expect(reelPlan(reel, ahead, now, 1)).toEqual([]);
    expect(reelPending(reel, ahead, now)).toBe(false);
  });

  it('reaches the forecast’s horizon once one is set, and no further', () => {
    const reel = reelAt();
    reel.horizon = RUN.to;
    const ahead = now + 40 * 60_000;
    const plan = reelPlan(reel, ahead, now, 1);
    expect(plan.length).toBeGreaterThan(0);
    expect(Math.max(...plan)).toBeLessThanOrEqual(RUN.to);
    // Past the run's end the layer is empty and says so, rather than asking MET
    // to confirm that it does not forecast the day after tomorrow.
    expect(reelPlan(reel, RUN.to + RADAR_TOLERANCE_MS + RADAR_STEP_MS, now, 1)).toEqual([]);
  });

  it('never asks the forecast for a minute a measurement can speak for', () => {
    // The run's window opens at its own analysis, which is in the PAST — MET has
    // a picture of 07:15 and so does FMI. The overlap is never used: everything
    // at or before now goes to the measurement, which is the raster form of
    // "a measurement beats a forecast outright".
    const reel = reelAt();
    reel.horizon = RUN.to;
    const past = reelPlan(reel, now, now, -1).filter((at) => at > now);
    expect(past).toEqual([]);
    expect(RUN.from).toBeLessThan(now);
  });
});
