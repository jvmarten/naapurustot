import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseObservations,
  observationsUrl,
  fetchObservationSeries,
  fetchForecastSeries,
  SERIES_STEP_MINUTES,
  OBSERVATION_POLL_MS,
} from '../live/observations';

/**
 * FMI observation parsing.
 *
 * Two of these guard failures that do not look like failures. A swapped axis
 * puts every Finnish station in Somalia while the code runs cleanly, and FMI's
 * `NaN` survives `parseFloat` as a number, so an unguarded parse renders labels
 * reading "NaN°" over the map rather than throwing anything.
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
      <BsWfs:ParameterName>t2m</BsWfs:ParameterName>
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

describe('parseObservations', () => {
  it('reads gml:pos as LATITUDE first, not longitude', () => {
    // The single most consequential line in the parser. EPSG:4258 is declared in
    // its authority axis order, so this is "60.30 N, 25.55 E" — reading it the
    // other way round lands the station off the coast of Somalia and nothing in
    // the code complains.
    const [o] = parseObservations(doc(element('60.30373', '25.54916', '17.2')));
    expect(o.lat).toBeCloseTo(60.30373, 5);
    expect(o.lon).toBeCloseTo(25.54916, 5);
    expect(o.celsius).toBeCloseTo(17.2, 5);
    expect(o.at).toBe(Date.parse('2026-08-12T09:30:00Z'));
  });

  it('drops NaN readings instead of plotting them', () => {
    // FMI writes NaN for a station that is present but not reporting, and
    // Number('NaN') is a number. Without the guard the map grows "NaN°" labels.
    expect(parseObservations(doc(element('60.1', '25.0', 'NaN')))).toHaveLength(0);
    expect(parseObservations(doc(element('60.1', '25.0', 'nan')))).toHaveLength(0);
    expect(parseObservations(doc(element('60.1', '25.0', '')))).toHaveLength(0);
  });

  it('keeps only the newest reading per station', () => {
    // Stations do not report in step: most send every ten minutes, some every
    // minute. A window request therefore returns several readings for the same
    // position and the map must show the current one, not an arbitrary one.
    const out = parseObservations(
      doc(
        element('61.0', '25.0', '10.0', '2026-08-12T09:00:00Z'),
        element('61.0', '25.0', '12.5', '2026-08-12T09:20:00Z'),
        element('61.0', '25.0', '11.0', '2026-08-12T09:10:00Z'),
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0].celsius).toBeCloseTo(12.5, 5);
  });

  it('keeps distinct stations apart', () => {
    const out = parseObservations(
      doc(element('61.0', '25.0', '10.0'), element('65.0', '25.5', '8.0')),
    );
    expect(out).toHaveLength(2);
  });

  it('keeps a sub-zero reading, sign intact', () => {
    // On a Finnish map the interesting distinction is either side of zero, which
    // is also where a naive "truthy value" check would drop 0.0 entirely.
    const out = parseObservations(
      doc(element('66.5', '25.7', '-14.3'), element('60.2', '24.9', '0.0')),
    );
    expect(out.map((o) => o.celsius).sort((a, b) => a - b)).toEqual([-14.3, 0]);
  });

  it('drops coordinates outside the globe', () => {
    expect(parseObservations(doc(element('91', '25.0', '5')))).toHaveLength(0);
    expect(parseObservations(doc(element('60.0', '999', '5')))).toHaveLength(0);
  });

  it('drops readings with an unparseable timestamp', () => {
    expect(parseObservations(doc(element('60.1', '25.0', '5', 'not-a-time')))).toHaveLength(0);
  });

  it('throws on a truncated or non-XML response', () => {
    // A parse failure produces a <parsererror> document rather than an
    // exception, so without the explicit check a mangled response would read as
    // "no station in Finland is reporting".
    expect(() => parseObservations('<wfs:FeatureCollection><oops')).toThrow();
    expect(() => parseObservations('not xml at all')).toThrow();
  });

  it('returns an empty list for a well-formed but empty collection', () => {
    expect(parseObservations(doc())).toEqual([]);
  });
});

describe('observation request', () => {
  it('asks for temperature only, over Finland, with a look-back window', () => {
    const url = observationsUrl(Date.parse('2026-08-12T09:30:00Z'));
    expect(url).toContain('storedquery_id=fmi%3A%3Aobservations%3A%3Aweather%3A%3Asimple');
    expect(url).toContain('parameters=t2m');
    expect(url).toContain('bbox=19%2C59%2C32%2C71');
    // 20 minutes back, so a station on a ten-minute cycle is certainly inside it.
    expect(url).toContain('starttime=2026-08-12T09%3A10%3A00Z');
  });

  it('polls no faster than the stations publish', () => {
    // Most FMI stations report every ten minutes; polling faster only
    // re-downloads numbers that cannot have changed.
    expect(OBSERVATION_POLL_MS).toBeGreaterThanOrEqual(300_000);
  });
});

/**
 * The window requests — the ones that made the slider stop waiting on a network.
 *
 * The page fetches a DAY and samples it locally, so what these pin is the shape
 * of that day: both ends stated, a step that keeps it small, and — for the
 * forecast arm — the one stored query in FMI's catalogue that will answer a
 * bbox at the observation network's own coordinates.
 */
describe('window requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  const capture = (xml: string) => {
    const fn = vi.fn(
      async (_input: RequestInfo | URL) =>
        ({ ok: true, text: async () => xml }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  const from = Date.parse('2026-08-12T00:00:00Z');
  const to = Date.parse('2026-08-13T00:00:00Z');

  it('asks for a bounded day at hourly steps, not for an instant', () => {
    // Measured against the live service: a national day at hourly steps is 1,528
    // readings and ~20 kB gzipped — less than four of the single-instant
    // requests it replaces, and a full-day drag used to be able to ask for 288.
    const fn = capture(doc(element('60.1', '25.0', '17.2')));
    void fetchObservationSeries(from, to);
    const url = String(fn.mock.calls[0][0]);
    expect(url).toContain('starttime=2026-08-12T00%3A00%3A00Z');
    expect(url).toContain('endtime=2026-08-13T00%3A00%3A00Z');
    expect(url).toContain(`timestep=${SERIES_STEP_MINUTES}`);
    expect(url).toContain('storedquery_id=fmi%3A%3Aobservations%3A%3Aweather%3A%3Asimple');
  });

  it('keeps every reading in the window rather than the newest per station', () => {
    // The opposite of the live poll's job. A collapsed strip would leave the
    // clock with one value for the whole day, which is where "you have to stop
    // the slider before it tells you anything" came from in the first place.
    const fn = capture(
      doc(
        element('61.0', '25.0', '10.0', '2026-08-12T06:00:00Z'),
        element('61.0', '25.0', '12.5', '2026-08-12T07:00:00Z'),
        element('61.0', '25.0', '14.0', '2026-08-12T08:00:00Z'),
      ),
    );
    return fetchObservationSeries(from, to).then((list) => {
      expect(fn).toHaveBeenCalledOnce();
      expect(list.map((o) => o.celsius)).toEqual([10, 12.5, 14]);
    });
  });

  it('takes the forecast from the collection evaluated at the observation stations', () => {
    // `fmi::forecast::edited::…::point::simple` answers a bbox with
    // numberReturned="0"; this one does not, and it is evaluated at the same
    // coordinates the measurements come from — which is what lets one station
    // carry a measured morning and a forecast evening in a single series.
    const fn = capture(doc(element('60.1', '25.0', '17.2')));
    void fetchForecastSeries(from, to);
    const url = String(fn.mock.calls[0][0]);
    expect(url).toContain('storedquery_id=ecmwf%3A%3Aforecast%3A%3Asurface%3A%3Aobsstations');
    expect(url).toContain('parameters=Temperature');
    expect(url).toContain('bbox=19%2C59%2C32%2C71');
  });

  it('flags every forecast value at the boundary, once', () => {
    // So nothing downstream has to remember which fetch a number came from. A
    // value that reached the map without this is a prediction drawn in the same
    // ink as a reading, which is the one thing this page must never do.
    capture(doc(element('60.1', '25.0', '17.2'), element('61.0', '25.0', '15.0')));
    return fetchForecastSeries(from, to).then((list) => {
      expect(list).toHaveLength(2);
      expect(list.every((o) => o.forecast === true)).toBe(true);
    });
  });

  it('throws rather than reporting an empty sky when the service is unreachable', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response),
    );
    return expect(fetchObservationSeries(from, to)).rejects.toThrow();
  });
});
