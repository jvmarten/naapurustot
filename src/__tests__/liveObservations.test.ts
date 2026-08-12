import { describe, it, expect } from 'vitest';
import {
  parseObservations,
  observationsUrl,
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
