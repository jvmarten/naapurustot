import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseSealevel,
  parseSealevelReadings,
  sealevelUrl,
  sealevelSeriesUrl,
  fetchSealevelSeries,
  formatSealevelCm,
  createSealevelTimeline,
  mergeSealevel,
  sampleSealevelTimeline,
  SEALEVEL_TOLERANCE_MS,
  SEALEVEL_POLL_MS,
  type SealevelReading,
} from '../live/sealevel';

/**
 * Sea-level parsing, which is where this feed earns its own module rather than
 * the scalar temperature one: a reading is up to THREE parameters that must come
 * from ONE gauge and ONE instant, or the panel pairs a level with a temperature
 * from a different hour. Only the water level is required; the other two are
 * optional extras. Every fmi.ts rejection is made per parameter.
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

/** One gauge at one instant: the three parameters, as FMI's mareograph query sends them. */
function gauge(
  lat: string,
  lon: string,
  level: string,
  n2000: string,
  temp: string,
  time = '2026-08-21T10:00:00Z',
) {
  return (
    element('WATLEV', level, lat, lon, time) +
    element('WLEVN2K_PT1S_INSTANT', n2000, lat, lon, time) +
    element('TW_PT1H_AVG', temp, lat, lon, time)
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

describe('parseSealevel', () => {
  it('pairs the three parameters into one reading, latitude first', () => {
    const [s] = parseSealevel(doc(gauge('60.15363', '24.95622', '138', '349', '13.0')));
    expect(s.lat).toBeCloseTo(60.15363, 5);
    expect(s.lon).toBeCloseTo(24.95622, 5);
    expect(s.level).toBeCloseTo(138, 5);
    expect(s.n2000).toBeCloseTo(349, 5);
    expect(s.temp).toBeCloseTo(13.0, 5);
    expect(s.at).toBe(Date.parse('2026-08-21T10:00:00Z'));
  });

  it('drops the whole reading when there is no water level', () => {
    // The level is what the map draws; an N2000 height or a temperature alone is
    // not a sea-level mark.
    const xml = doc(
      element('WLEVN2K_PT1S_INSTANT', '349', '60.0', '25.0', '2026-08-21T10:00:00Z') +
        element('TW_PT1H_AVG', '13.0', '60.0', '25.0', '2026-08-21T10:00:00Z'),
    );
    expect(parseSealevel(xml)).toHaveLength(0);
  });

  it('keeps the reading when only the level is present', () => {
    const [s] = parseSealevel(
      doc(element('WATLEV', '150', '60.0', '25.0', '2026-08-21T10:00:00Z')),
    );
    expect(s.level).toBeCloseTo(150, 5);
    expect(s.n2000).toBeNull();
    expect(s.temp).toBeNull();
  });

  it('keeps a negative (below-mean) level rather than treating it as absent', () => {
    // Below theoretical mean water is a real, common state — low water — and the
    // sign is the whole point. Zero must not be conjured from an empty element,
    // but a genuine negative is a measurement.
    const [s] = parseSealevel(doc(gauge('60.0', '25.0', '-84', '120', '12.0')));
    expect(s.level).toBeCloseTo(-84, 5);
  });

  it('drops a NaN or empty extra without dropping the reading', () => {
    // Number('NaN') and Number('') are both traps — the second is 0, a fabricated
    // measurement. A bad temperature drops the temperature, not the reading.
    const [a] = parseSealevel(doc(gauge('60.0', '25.0', '138', 'NaN', '13.0')));
    expect(a.n2000).toBeNull();
    expect(a.temp).toBeCloseTo(13.0, 5);
    const [b] = parseSealevel(doc(gauge('60.0', '25.0', '138', '349', '')));
    expect(b.n2000).toBeCloseTo(349, 5);
    expect(b.temp).toBeNull();
  });

  it('drops a gauge whose level is NaN or empty entirely', () => {
    expect(parseSealevel(doc(gauge('60.0', '25.0', 'NaN', '349', '13.0')))).toHaveLength(0);
    expect(parseSealevel(doc(gauge('60.0', '25.0', '', '349', '13.0')))).toHaveLength(0);
  });

  it('keeps only the newest instant per gauge', () => {
    const out = parseSealevel(
      doc(
        gauge('60.0', '25.0', '182', '380', '13.0', '2026-08-21T09:00:00Z'),
        gauge('60.0', '25.0', '167', '365', '13.2', '2026-08-21T10:00:00Z'),
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0].level).toBeCloseTo(167, 5);
    expect(out[0].at).toBe(Date.parse('2026-08-21T10:00:00Z'));
  });

  it('keeps distinct gauges apart', () => {
    const out = parseSealevel(
      doc(gauge('60.0', '25.0', '138', '349', '13.0'), gauge('65.0', '24.5', '167', '238', '15.2')),
    );
    expect(out).toHaveLength(2);
  });

  it('drops coordinates outside the globe', () => {
    expect(parseSealevel(doc(gauge('91', '25.0', '138', '349', '13')))).toHaveLength(0);
    expect(parseSealevel(doc(gauge('60.0', '999', '138', '349', '13')))).toHaveLength(0);
  });

  it('throws on a truncated or non-XML response', () => {
    expect(() => parseSealevel('<wfs:FeatureCollection><oops')).toThrow();
    expect(() => parseSealevel('not xml at all')).toThrow();
  });

  it('returns an empty list for a well-formed but empty collection', () => {
    expect(parseSealevel(doc())).toEqual([]);
  });

  it('keeps every instant in a strip rather than the newest', () => {
    const out = parseSealevelReadings(
      doc(
        gauge('60.0', '25.0', '182', '380', '13.0', '2026-08-21T06:00:00Z'),
        gauge('60.0', '25.0', '167', '365', '13.2', '2026-08-21T07:00:00Z'),
      ),
    );
    expect(out.map((s) => s.level)).toEqual([182, 167]);
  });
});

describe('sea level request', () => {
  it('asks for all three mareograph parameters over Finland, with a look-back window', () => {
    const url = sealevelUrl(Date.parse('2026-08-21T10:00:00Z'));
    expect(url).toContain('storedquery_id=fmi%3A%3Aobservations%3A%3Amareograph%3A%3Asimple');
    expect(url).toContain('parameters=WATLEV%2CWLEVN2K_PT1S_INSTANT%2CTW_PT1H_AVG');
    expect(url).toContain('bbox=19%2C59%2C32%2C71');
    // 90 minutes back — longer than the hourly publish cycle, so the newest
    // reading is always in the window. Unbounded (live) has no endtime.
    expect(url).toContain('starttime=2026-08-21T08%3A30%3A00Z');
    expect(url).not.toContain('endtime=');
  });

  it('closes both ends for an archive request', () => {
    const url = sealevelUrl(Date.parse('2026-08-21T10:00:00Z'), true);
    expect(url).toContain('endtime=2026-08-21T10%3A00%3A00Z');
  });

  it('asks for a bounded day at hourly steps for the series', () => {
    const url = sealevelSeriesUrl(
      Date.parse('2026-08-21T00:00:00Z'),
      Date.parse('2026-08-22T00:00:00Z'),
    );
    expect(url).toContain('starttime=2026-08-21T00%3A00%3A00Z');
    expect(url).toContain('endtime=2026-08-22T00%3A00%3A00Z');
    expect(url).toContain('timestep=60');
    expect(url).toContain('parameters=WATLEV%2CWLEVN2K_PT1S_INSTANT%2CTW_PT1H_AVG');
  });

  it('looks back further than the hourly publish cycle', () => {
    // The gauges report hourly, so a look-back shorter than an hour can miss a
    // gauge entirely — the specific failure the ten-minute station feeds avoid.
    const url = sealevelUrl(Date.parse('2026-08-21T10:00:00Z'));
    const start = decodeURIComponent(url.match(/starttime=([^&]+)/)![1]);
    expect(Date.parse('2026-08-21T10:00:00Z') - Date.parse(start)).toBeGreaterThan(60 * 60_000);
  });

  it('polls no faster than the gauges publish', () => {
    expect(SEALEVEL_POLL_MS).toBeGreaterThanOrEqual(300_000);
  });
});

describe('fetchSealevelSeries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws rather than reporting an empty sea when the service is unreachable', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response),
    );
    return expect(
      fetchSealevelSeries(Date.parse('2026-08-21T00:00:00Z'), Date.parse('2026-08-22T00:00:00Z')),
    ).rejects.toThrow();
  });
});

describe('sea level timeline', () => {
  const r = (at: string, level: number, n2000: number | null, temp: number | null): SealevelReading => ({
    lon: 25,
    lat: 61,
    at: Date.parse(at),
    level,
    n2000,
    temp,
  });

  it('samples the nearest instant within tolerance, all three fields together', () => {
    const tl = createSealevelTimeline();
    mergeSealevel(tl, [
      r('2026-08-21T09:00:00Z', 182, 380, 13.0),
      r('2026-08-21T10:00:00Z', 167, 365, 13.2),
    ]);
    const [s] = sampleSealevelTimeline(tl, Date.parse('2026-08-21T09:50:00Z'), SEALEVEL_TOLERANCE_MS);
    expect(s.level).toBe(167);
    expect(s.n2000).toBe(365);
    expect(s.temp).toBe(13.2);
    expect(s.at).toBe(Date.parse('2026-08-21T10:00:00Z'));
  });

  it('breaks a tie towards the earlier sample', () => {
    const tl = createSealevelTimeline();
    mergeSealevel(tl, [
      r('2026-08-21T09:00:00Z', 182, 380, 13.0),
      r('2026-08-21T10:00:00Z', 167, 365, 13.2),
    ]);
    const [s] = sampleSealevelTimeline(tl, Date.parse('2026-08-21T09:30:00Z'), SEALEVEL_TOLERANCE_MS);
    expect(s.at).toBe(Date.parse('2026-08-21T09:00:00Z'));
  });

  it('drops a gauge whose nearest reading is beyond tolerance', () => {
    const tl = createSealevelTimeline();
    mergeSealevel(tl, [r('2026-08-21T09:00:00Z', 182, 380, 13.0)]);
    // Three hours away, past the one-hour tolerance: absence, not a stale number.
    expect(
      sampleSealevelTimeline(tl, Date.parse('2026-08-21T12:00:00Z'), SEALEVEL_TOLERANCE_MS),
    ).toHaveLength(0);
  });

  it('keeps one entry per instant on a re-merge of the same window', () => {
    const tl = createSealevelTimeline();
    mergeSealevel(tl, [r('2026-08-21T09:00:00Z', 182, 380, 13.0)]);
    mergeSealevel(tl, [r('2026-08-21T09:00:00Z', 180, 378, 13.1)]);
    const series = [...tl.stations.values()][0];
    expect(series.samples).toHaveLength(1);
    expect(series.samples[0].level).toBe(180);
  });
});

describe('formatSealevelCm', () => {
  it('shows a signed centimetre value from the published millimetres', () => {
    expect(formatSealevelCm(167)).toBe('+17');
    expect(formatSealevelCm(138)).toBe('+14');
  });

  it('uses a real minus sign (U+2212) for below-mean levels', () => {
    // -84 mm rounds to -8 cm, shown with a typographic minus rather than a hyphen.
    const MINUS = String.fromCharCode(0x2212);
    expect(formatSealevelCm(-84)).toBe(`${MINUS}8`);
    expect(formatSealevelCm(-231)).toBe(`${MINUS}23`);
    expect(formatSealevelCm(-84).startsWith('-')).toBe(false); // not an ASCII hyphen
  });

  it('rounds to whole centimetres and shows an unsigned zero', () => {
    expect(formatSealevelCm(4)).toBe('0');
    expect(formatSealevelCm(-4)).toBe('0');
    expect(formatSealevelCm(0)).toBe('0');
  });
});
