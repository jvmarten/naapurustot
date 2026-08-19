import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseWind,
  parseWindReadings,
  windUrl,
  windSeriesUrl,
  fetchWindSeries,
  windCompassKey,
  createWindTimeline,
  mergeWind,
  sampleWindTimeline,
  WIND_CALM_MS,
  WIND_TOLERANCE_MS,
  WIND_POLL_MS,
  type WindReading,
} from '../live/wind';

/**
 * Wind parsing, which is where this feed differs from the temperature one it
 * otherwise mirrors: a reading is THREE parameters that must come from ONE
 * measured instant, or the arrow drawn from them is a fabrication. So the parse
 * reads `ParameterName` — which the scalar reader ignores — and pairs speed,
 * direction and gust by station and time before it will emit anything.
 */

function element(name: string, value: string, lat: string, lon: string, time: string) {
  return `
  <wfs:member>
    <BsWfs:BsWfsElement gml:id="e">
      <BsWfs:Location>
        <gml:Point srsName="http://www.opengis.net/def/crs/EPSG/0/4258">
          <gml:pos>${lat} ${lon} </gml:pos>
        </gml:Point>
      </BsWfs:Location>
      <BsWfs:Time>${time}</BsWfs:Time>
      <BsWfs:ParameterName>${name}</BsWfs:ParameterName>
      <BsWfs:ParameterValue>${value}</BsWfs:ParameterValue>
    </BsWfs:BsWfsElement>
  </wfs:member>`;
}

/** One station at one instant: the three wind parameters, as FMI sends them. */
function station(
  lat: string,
  lon: string,
  ws: string,
  wd: string,
  wg: string,
  time = '2026-08-12T09:30:00Z',
) {
  return (
    element('ws_10min', ws, lat, lon, time) +
    element('wd_10min', wd, lat, lon, time) +
    element('wg_10min', wg, lat, lon, time)
  );
}

function doc(...members: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection
  xmlns:wfs="http://www.opengis.net/wfs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"
  xmlns:BsWfs="http://xml.fmi.fi/schema/wfs/2.0">${members.join('')}
</wfs:FeatureCollection>`;
}

describe('parseWind', () => {
  it('pairs the three parameters into one reading, latitude first', () => {
    const [w] = parseWind(doc(station('60.30373', '25.54916', '6.4', '210', '9.1')));
    expect(w.lat).toBeCloseTo(60.30373, 5);
    expect(w.lon).toBeCloseTo(25.54916, 5);
    expect(w.speed).toBeCloseTo(6.4, 5);
    expect(w.dir).toBeCloseTo(210, 5);
    expect(w.gust).toBeCloseTo(9.1, 5);
    expect(w.at).toBe(Date.parse('2026-08-12T09:30:00Z'));
  });

  it('drops the whole reading when there is no speed', () => {
    // A direction without a speed is not an arrow. Only the speed is required;
    // the reading cannot exist without it.
    const xml = doc(
      element('wd_10min', '180', '61.0', '25.0', '2026-08-12T09:30:00Z') +
        element('wg_10min', '5.0', '61.0', '25.0', '2026-08-12T09:30:00Z'),
    );
    expect(parseWind(xml)).toHaveLength(0);
  });

  it('reports no bearing when the wind is calm, keeping the speed', () => {
    // Below the calm threshold a direction is reading meaning into noise, so it
    // is nulled even though FMI sent a number — but the station still reports,
    // as a calm one.
    const [w] = parseWind(doc(station('61.0', '25.0', '0.2', '90', 'NaN')));
    expect(w.speed).toBeCloseTo(0.2, 5);
    expect(w.speed).toBeLessThan(WIND_CALM_MS);
    expect(w.dir).toBeNull();
    expect(w.gust).toBeNull();
  });

  it('keeps a due-north bearing rather than reading zero as absent', () => {
    // wd_10min of 0 is a real direction (north); the absence is a null, never a
    // zero, or a northerly gale would be drawn as calm.
    const [w] = parseWind(doc(station('61.0', '25.0', '7.0', '0', '10.0')));
    expect(w.dir).toBe(0);
  });

  it('drops a NaN or empty parameter without dropping the reading', () => {
    // Number('NaN') and Number('') are both traps — the second is 0, a fabricated
    // measurement. A bad gust drops the gust; a bad direction drops the direction.
    const [a] = parseWind(doc(station('61.0', '25.0', '5.0', 'NaN', '8.0')));
    expect(a.dir).toBeNull();
    expect(a.gust).toBeCloseTo(8.0, 5);
    const [b] = parseWind(doc(station('61.0', '25.0', '5.0', '120', '')));
    expect(b.dir).toBeCloseTo(120, 5);
    expect(b.gust).toBeNull();
  });

  it('drops a station whose speed is NaN entirely', () => {
    expect(parseWind(doc(station('61.0', '25.0', 'NaN', '120', '8.0')))).toHaveLength(0);
    expect(parseWind(doc(station('61.0', '25.0', '', '120', '8.0')))).toHaveLength(0);
  });

  it('keeps only the newest instant per station', () => {
    const out = parseWind(
      doc(
        station('61.0', '25.0', '4.0', '90', '6.0', '2026-08-12T09:00:00Z'),
        station('61.0', '25.0', '7.0', '110', '9.0', '2026-08-12T09:20:00Z'),
        station('61.0', '25.0', '5.0', '100', '7.0', '2026-08-12T09:10:00Z'),
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0].speed).toBeCloseTo(7.0, 5);
    expect(out[0].at).toBe(Date.parse('2026-08-12T09:20:00Z'));
  });

  it('keeps distinct stations apart', () => {
    const out = parseWind(
      doc(station('61.0', '25.0', '4.0', '90', '6.0'), station('65.0', '25.5', '8.0', '270', '11.0')),
    );
    expect(out).toHaveLength(2);
  });

  it('drops coordinates outside the globe', () => {
    expect(parseWind(doc(station('91', '25.0', '5', '90', '6')))).toHaveLength(0);
    expect(parseWind(doc(station('60.0', '999', '5', '90', '6')))).toHaveLength(0);
  });

  it('throws on a truncated or non-XML response', () => {
    expect(() => parseWind('<wfs:FeatureCollection><oops')).toThrow();
    expect(() => parseWind('not xml at all')).toThrow();
  });

  it('returns an empty list for a well-formed but empty collection', () => {
    expect(parseWind(doc())).toEqual([]);
  });

  it('keeps every instant in a strip rather than the newest', () => {
    // The window request feeds the timeline, which needs the whole day, not the
    // one value the live poll collapses to.
    const out = parseWindReadings(
      doc(
        station('61.0', '25.0', '4.0', '90', '6.0', '2026-08-12T06:00:00Z'),
        station('61.0', '25.0', '7.0', '110', '9.0', '2026-08-12T07:00:00Z'),
      ),
    );
    expect(out.map((w) => w.speed)).toEqual([4, 7]);
  });
});

describe('wind request', () => {
  it('asks for all three wind parameters over Finland, with a look-back window', () => {
    const url = windUrl(Date.parse('2026-08-12T09:30:00Z'));
    expect(url).toContain('storedquery_id=fmi%3A%3Aobservations%3A%3Aweather%3A%3Asimple');
    expect(url).toContain('parameters=ws_10min%2Cwd_10min%2Cwg_10min');
    expect(url).toContain('bbox=19%2C59%2C32%2C71');
    // 20 minutes back; unbounded (live) has no endtime — see fmi.ts.
    expect(url).toContain('starttime=2026-08-12T09%3A10%3A00Z');
    expect(url).not.toContain('endtime=');
  });

  it('closes both ends for an archive request', () => {
    const url = windUrl(Date.parse('2026-08-12T09:30:00Z'), true);
    expect(url).toContain('endtime=2026-08-12T09%3A30%3A00Z');
  });

  it('asks for a bounded day at hourly steps for the series', () => {
    const url = windSeriesUrl(
      Date.parse('2026-08-12T00:00:00Z'),
      Date.parse('2026-08-13T00:00:00Z'),
    );
    expect(url).toContain('starttime=2026-08-12T00%3A00%3A00Z');
    expect(url).toContain('endtime=2026-08-13T00%3A00%3A00Z');
    expect(url).toContain('timestep=60');
    expect(url).toContain('parameters=ws_10min%2Cwd_10min%2Cwg_10min');
  });

  it('polls no faster than the stations publish', () => {
    expect(WIND_POLL_MS).toBeGreaterThanOrEqual(300_000);
  });
});

describe('fetchWindSeries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws rather than reporting an empty sky when the service is unreachable', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response),
    );
    return expect(
      fetchWindSeries(Date.parse('2026-08-12T00:00:00Z'), Date.parse('2026-08-13T00:00:00Z')),
    ).rejects.toThrow();
  });
});

describe('wind timeline', () => {
  const r = (at: string, speed: number, dir: number | null, gust: number | null): WindReading => ({
    lon: 25,
    lat: 61,
    at: Date.parse(at),
    speed,
    dir,
    gust,
  });

  it('samples the nearest instant within tolerance, speed and direction together', () => {
    const tl = createWindTimeline();
    mergeWind(tl, [
      r('2026-08-12T09:00:00Z', 4, 90, 6),
      r('2026-08-12T10:00:00Z', 7, 110, 9),
    ]);
    const [s] = sampleWindTimeline(tl, Date.parse('2026-08-12T09:50:00Z'), WIND_TOLERANCE_MS);
    // 09:50 is nearer 10:00, and the speed and direction come from that one
    // instant — never a 10:00 speed under a 09:00 bearing.
    expect(s.speed).toBe(7);
    expect(s.dir).toBe(110);
    expect(s.at).toBe(Date.parse('2026-08-12T10:00:00Z'));
  });

  it('breaks a tie towards the earlier sample', () => {
    const tl = createWindTimeline();
    mergeWind(tl, [
      r('2026-08-12T09:00:00Z', 4, 90, 6),
      r('2026-08-12T10:00:00Z', 7, 110, 9),
    ]);
    const [s] = sampleWindTimeline(tl, Date.parse('2026-08-12T09:30:00Z'), WIND_TOLERANCE_MS);
    expect(s.at).toBe(Date.parse('2026-08-12T09:00:00Z'));
  });

  it('drops a station whose nearest reading is beyond tolerance', () => {
    const tl = createWindTimeline();
    mergeWind(tl, [r('2026-08-12T09:00:00Z', 4, 90, 6)]);
    // Two hours away, past the 45-minute tolerance: absence, not a stale arrow.
    expect(
      sampleWindTimeline(tl, Date.parse('2026-08-12T11:00:00Z'), WIND_TOLERANCE_MS),
    ).toHaveLength(0);
  });

  it('keeps one entry per instant on a re-merge of the same window', () => {
    const tl = createWindTimeline();
    mergeWind(tl, [r('2026-08-12T09:00:00Z', 4, 90, 6)]);
    mergeWind(tl, [r('2026-08-12T09:00:00Z', 5, 95, 7)]);
    const series = [...tl.stations.values()][0];
    expect(series.samples).toHaveLength(1);
    expect(series.samples[0].speed).toBe(5);
  });
});

describe('windCompassKey', () => {
  it('names the eight points and rounds to the nearest', () => {
    expect(windCompassKey(0)).toBe('live.wind.dir.n');
    expect(windCompassKey(45)).toBe('live.wind.dir.ne');
    expect(windCompassKey(90)).toBe('live.wind.dir.e');
    expect(windCompassKey(200)).toBe('live.wind.dir.s'); // nearest to 180
    expect(windCompassKey(315)).toBe('live.wind.dir.nw');
    // 360 wraps back to north rather than overflowing the table.
    expect(windCompassKey(360)).toBe('live.wind.dir.n');
    expect(windCompassKey(359)).toBe('live.wind.dir.n');
  });

  it('says variable when there is no bearing', () => {
    expect(windCompassKey(null)).toBe('live.wind.dir.variable');
  });
});
