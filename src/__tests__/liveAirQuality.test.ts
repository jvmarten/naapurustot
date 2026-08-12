import { describe, it, expect } from 'vitest';
import {
  parseAirQuality,
  airQualityUrl,
  aqBandKey,
  AQ_COLORS,
  AIR_QUALITY_POLL_MS,
} from '../live/airquality';

/**
 * Air-quality parsing.
 *
 * The shared FMI traps (latitude-first coordinates, published `NaN`, an empty
 * value parsing as zero, a `<parsererror>` document instead of a throw) are
 * covered once in liveObservations.test.ts, since both feeds go through the same
 * parser. What is specific here is the INDEX: it is categorical and rendered as
 * a colour, so a value off the scale is not a worse reading, it is a red dot
 * with nothing behind it.
 */

function element(lat: string, lon: string, value: string, time = '2026-08-12T09:00:00Z') {
  return `
  <wfs:member>
    <BsWfs:BsWfsElement gml:id="e">
      <BsWfs:Location>
        <gml:Point srsName="http://www.opengis.net/def/crs/EPSG/0/4258">
          <gml:pos>${lat} ${lon} </gml:pos>
        </gml:Point>
      </BsWfs:Location>
      <BsWfs:Time>${time}</BsWfs:Time>
      <BsWfs:ParameterName>AQINDEX_PT1H_avg</BsWfs:ParameterName>
      <BsWfs:ParameterValue>${value}</BsWfs:ParameterValue>
    </BsWfs:BsWfsElement>
  </wfs:member>`;
}

const doc = (...m: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"
  xmlns:BsWfs="http://xml.fmi.fi/schema/wfs/2.0">${m.join('')}
</wfs:FeatureCollection>`;

describe('parseAirQuality', () => {
  it('reads an index with latitude first', () => {
    const [s] = parseAirQuality(doc(element('60.1699', '24.9384', '2.0')));
    expect(s.lat).toBeCloseTo(60.1699, 4);
    expect(s.lon).toBeCloseTo(24.9384, 4);
    expect(s.index).toBe(2);
  });

  it('drops values off the published 1-5 scale', () => {
    // The index is rendered as a COLOUR, so an out-of-range value would clamp
    // silently to "very poor" and put a red dot on the map with nothing behind
    // it. That is a fabricated claim about the air, so it is dropped instead.
    expect(parseAirQuality(doc(element('60.1', '25.0', '0')))).toHaveLength(0);
    expect(parseAirQuality(doc(element('60.1', '25.0', '6')))).toHaveLength(0);
    expect(parseAirQuality(doc(element('60.1', '25.0', '-1')))).toHaveLength(0);
    expect(parseAirQuality(doc(element('60.1', '25.0', '99')))).toHaveLength(0);
  });

  it('keeps both ends of the scale', () => {
    const out = parseAirQuality(
      doc(element('60.1', '25.0', '1'), element('61.5', '23.8', '5')),
    );
    expect(out.map((s) => s.index).sort()).toEqual([1, 5]);
  });

  it('keeps the newest reading per station', () => {
    const out = parseAirQuality(
      doc(
        element('60.1', '25.0', '1', '2026-08-12T08:00:00Z'),
        element('60.1', '25.0', '3', '2026-08-12T09:00:00Z'),
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0].index).toBe(3);
  });
});

describe('air quality presentation', () => {
  it('has a colour for every band on the scale', () => {
    // A missing entry would draw `undefined` as a fill, which canvas silently
    // ignores — the station would vanish rather than error.
    for (let band = 1; band <= 5; band++) {
      expect(AQ_COLORS[band], `band ${band}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(Object.values(AQ_COLORS)).size).toBe(5);
  });

  it('names every band, and clamps rather than inventing one', () => {
    expect(aqBandKey(1)).toBe('live.air_quality.band_1');
    expect(aqBandKey(5)).toBe('live.air_quality.band_5');
    // Defensive: the readout takes the worst index seen, and a feed that ever
    // sent 0 or 7 must still name a band rather than an absent key.
    expect(aqBandKey(0)).toBe('live.air_quality.band_1');
    expect(aqBandKey(9)).toBe('live.air_quality.band_5');
    expect(aqBandKey(2.4)).toBe('live.air_quality.band_2');
  });
});

describe('air quality request', () => {
  it('uses the urban network, which is where the stations are', () => {
    // fmi:: has 7 stations nationally, urban:: has 82. See airquality.ts.
    const url = airQualityUrl(Date.parse('2026-08-12T12:00:00Z'));
    expect(url).toContain('urban%3A%3Aobservations%3A%3Aairquality%3A%3Ahourly%3A%3Asimple');
    expect(url).toContain('parameters=AQINDEX_PT1H_avg');
  });

  it('looks back further than the publishing interval', () => {
    // The index is HOURLY. A window shorter than an hour returns only whichever
    // stations happened to publish inside it.
    const url = airQualityUrl(Date.parse('2026-08-12T12:00:00Z'));
    expect(url).toContain('starttime=2026-08-12T09%3A00%3A00Z');
  });

  it('polls no faster than the index can change', () => {
    expect(AIR_QUALITY_POLL_MS).toBeGreaterThanOrEqual(900_000);
  });
});
