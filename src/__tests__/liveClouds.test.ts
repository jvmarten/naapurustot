import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  cloudsUrl,
  cloudsSeriesUrl,
  fetchClouds,
  fetchCloudSeries,
  formatOktas,
  isObscured,
  oktaKey,
  CLOUD_POLL_MS,
  CLOUD_TOLERANCE_MS,
  SERIES_STEP_MINUTES,
} from '../live/clouds';

/**
 * The cloud-cover feed reuses fmi.ts wholesale — the axis-first, NaN-dropping,
 * empty-is-not-zero parse is pinned by liveObservations and the fmi tests, and is
 * not re-litigated here. What is this feed's own is the parameter it asks for, the
 * okta vocabulary it puts on the reading, and that it fetches an FmiReading whose
 * value IS the okta count so the scalar timeline takes it unchanged.
 */

function element(lat: string, lon: string, value: string, time = '2026-08-12T09:30:00Z') {
  return `
  <wfs:member>
    <BsWfs:BsWfsElement gml:id="e">
      <BsWfs:Location>
        <gml:Point srsName="http://www.opengis.net/def/crs/EPSG/0/4258">
          <gml:pos>${lat} ${lon} </gml:pos>
        </gml:Point>
      </BsWfs:Location>
      <BsWfs:Time>${time}</BsWfs:Time>
      <BsWfs:ParameterName>n_man</BsWfs:ParameterName>
      <BsWfs:ParameterValue>${value}</BsWfs:ParameterValue>
    </BsWfs:BsWfsElement>
  </wfs:member>`;
}

function doc(...members: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection
  xmlns:wfs="http://www.opengis.net/wfs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"
  xmlns:BsWfs="http://xml.fmi.fi/schema/wfs/2.0">${members.join('')}
</wfs:FeatureCollection>`;
}

describe('cloud request URLs', () => {
  it('asks for cloud amount only, over Finland, with a look-back window', () => {
    const url = cloudsUrl(Date.parse('2026-08-12T09:30:00Z'));
    expect(url).toContain('storedquery_id=fmi%3A%3Aobservations%3A%3Aweather%3A%3Asimple');
    // n_man — cloud amount in oktas — not t2m. The one thing this feed does not
    // share with the temperature layer that rides the same query.
    expect(url).toContain('parameters=n_man');
    expect(url).toContain('bbox=19%2C59%2C32%2C71');
    // 20 minutes back, like temperature — automated stations report every ten.
    expect(url).toContain('starttime=2026-08-12T09%3A10%3A00Z');
  });

  it('leaves the live window open-ended and closes an archive one', () => {
    // The same rule as every FMI feed: live lets FMI decide where "now" is, an
    // archive request states both ends so a past instant is reproducible.
    expect(cloudsUrl(Date.parse('2026-08-12T09:30:00Z'), false)).not.toContain('endtime=');
    expect(cloudsUrl(Date.parse('2026-08-12T09:30:00Z'), true)).toContain(
      'endtime=2026-08-12T09%3A30%3A00Z',
    );
  });

  it('asks for a bounded day at hourly steps for the slider to sample', () => {
    const url = cloudsSeriesUrl(
      Date.parse('2026-08-12T00:00:00Z'),
      Date.parse('2026-08-13T00:00:00Z'),
    );
    expect(url).toContain('starttime=2026-08-12T00%3A00%3A00Z');
    expect(url).toContain('endtime=2026-08-13T00%3A00%3A00Z');
    expect(url).toContain(`timestep=${SERIES_STEP_MINUTES}`);
    expect(url).toContain('parameters=n_man');
  });
});

describe('fetchClouds', () => {
  afterEach(() => vi.unstubAllGlobals());

  const capture = (xml: string, ok = true, status = 200) => {
    const fn = vi.fn(
      async () => ({ ok, status, text: async () => xml }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  it('returns one okta reading per station, the newest, value unchanged', () => {
    // A cloud reading IS an FmiReading — its value is the okta count, so the
    // scalar timeline can take it with no reshaping. Newest-per-station is fmi.ts's
    // job; this pins that the value survives as the eighths the station published.
    capture(
      doc(
        element('61.0', '25.0', '3', '2026-08-12T09:00:00Z'),
        element('61.0', '25.0', '5', '2026-08-12T09:20:00Z'),
      ),
    );
    return fetchClouds().then((list) => {
      expect(list).toHaveLength(1);
      expect(list[0].value).toBe(5);
      expect(list[0].lat).toBeCloseTo(61.0, 5);
    });
  });

  it('keeps a clear sky (0 oktas) rather than dropping it', () => {
    // 0 is a real, common reading here — the clearest sky — and the exact value a
    // truthy check would silently discard. fmi.ts rejects an EMPTY element as a
    // fabricated zero but keeps an explicit "0".
    capture(doc(element('60.2', '24.9', '0')));
    return fetchClouds().then((list) => {
      expect(list).toHaveLength(1);
      expect(list[0].value).toBe(0);
    });
  });

  it('throws rather than reporting a clear sky when the service is unreachable', () => {
    capture('', false, 503);
    return expect(fetchClouds()).rejects.toThrow();
  });

  it('keeps every reading in the window for the series request', () => {
    const fn = capture(
      doc(
        element('61.0', '25.0', '2', '2026-08-12T06:00:00Z'),
        element('61.0', '25.0', '6', '2026-08-12T07:00:00Z'),
        element('61.0', '25.0', '8', '2026-08-12T08:00:00Z'),
      ),
    );
    return fetchCloudSeries(
      Date.parse('2026-08-12T00:00:00Z'),
      Date.parse('2026-08-13T00:00:00Z'),
    ).then((list) => {
      expect(fn).toHaveBeenCalledOnce();
      expect(list.map((r) => r.value)).toEqual([2, 6, 8]);
    });
  });
});

describe('okta vocabulary', () => {
  it('names the WMO sky-cover bands across the whole range', () => {
    expect(oktaKey(0)).toBe('live.clouds.band_clear');
    expect(oktaKey(1)).toBe('live.clouds.band_few');
    expect(oktaKey(2)).toBe('live.clouds.band_few');
    expect(oktaKey(3)).toBe('live.clouds.band_scattered');
    expect(oktaKey(4)).toBe('live.clouds.band_scattered');
    expect(oktaKey(5)).toBe('live.clouds.band_broken');
    expect(oktaKey(7)).toBe('live.clouds.band_broken');
    expect(oktaKey(8)).toBe('live.clouds.band_overcast');
    // 9 is the code-table's "sky obscured", not a ninth eighth.
    expect(oktaKey(9)).toBe('live.clouds.band_obscured');
    expect(isObscured(9)).toBe(true);
    expect(isObscured(8)).toBe(false);
  });

  it('formats the fraction and clamps an obscured 9 to the observable range', () => {
    expect(formatOktas(0)).toBe('0/8');
    expect(formatOktas(5)).toBe('5/8');
    expect(formatOktas(8)).toBe('8/8');
    // 9 (obscured) must not print "9/8".
    expect(formatOktas(9)).toBe('8/8');
  });
});

describe('cloud feed timing', () => {
  it('polls no faster than the stations publish, with a 45-minute sample tolerance', () => {
    expect(CLOUD_POLL_MS).toBeGreaterThanOrEqual(300_000);
    expect(CLOUD_TOLERANCE_MS).toBe(45 * 60_000);
  });
});
