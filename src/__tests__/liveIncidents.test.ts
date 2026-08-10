import { describe, it, expect } from 'vitest';
import { parseIncidents, INCIDENTS_ENDPOINT, INCIDENT_POLL_MS } from '../live/incidents';

/**
 * Road-incident parsing.
 *
 * The failure mode this guards is the same one the train parser guards: a
 * feature with a missing or swapped coordinate does not fail visibly, it puts a
 * road closure in the Gulf of Guinea. Everything here is about dropping rather
 * than defaulting — an incident drawn in the wrong place is a claim, and a
 * dropped one is only an omission.
 */

/** A minimal feature in the shape Digitraffic actually returns. */
function feature(over: Record<string, unknown> = {}, geometry: unknown = undefined) {
  return {
    geometry: geometry === undefined ? { type: 'Point', coordinates: [24.94, 60.17] } : geometry,
    properties: {
      situationId: 'GUID50123456',
      announcements: [
        {
          language: 'FI',
          title: 'Tie 103, Helsinki. Liikennetiedote.',
          timeAndDuration: { startTime: '2026-08-10T07:31:00Z' },
          locationDetails: { roadAddressLocation: { primaryPoint: { municipality: 'Helsinki' } } },
        },
      ],
      ...over,
    },
  };
}

const wrap = (features: unknown[]) => ({ type: 'FeatureCollection', features });

describe('parseIncidents', () => {
  it('reads a point incident with its road context', () => {
    const [i] = parseIncidents(wrap([feature()]));
    expect(i.id).toBe('GUID50123456');
    expect(i.title).toBe('Tie 103, Helsinki. Liikennetiedote.');
    expect(i.municipality).toBe('Helsinki');
    expect(i.lon).toBeCloseTo(24.94, 5);
    expect(i.lat).toBeCloseTo(60.17, 5);
    expect(i.lines).toEqual([]);
    expect(i.since).toBe(Date.parse('2026-08-10T07:31:00Z'));
  });

  it('keeps a LineString as a line rather than collapsing it to a point', () => {
    // A closure is a STRETCH of road. Reducing it to a marker would draw a ten
    // kilometre closure the same size as a single obstruction.
    const [i] = parseIncidents(
      wrap([
        feature({}, { type: 'LineString', coordinates: [[24.9, 60.1], [24.95, 60.2], [25.0, 60.3]] }),
      ]),
    );
    expect(i.lines).toHaveLength(1);
    expect(i.lines[0]).toHaveLength(3);
    // The anchor is the line's first vertex, so labelling and the viewport test
    // have somewhere real to work from.
    expect(i.lon).toBeCloseTo(24.9, 5);
    expect(i.lat).toBeCloseTo(60.1, 5);
  });

  it('keeps every part of a MultiLineString', () => {
    const [i] = parseIncidents(
      wrap([
        feature({}, {
          type: 'MultiLineString',
          coordinates: [
            [[24.9, 60.1], [24.95, 60.15]],
            [[25.1, 60.3], [25.2, 60.35]],
          ],
        }),
      ]),
    );
    expect(i.lines).toHaveLength(2);
    expect(i.lines[1][1]).toEqual([25.2, 60.35]);
  });

  it('drops features with no usable geometry rather than defaulting to 0,0', () => {
    expect(parseIncidents(wrap([feature({}, null)]))).toHaveLength(0);
    expect(parseIncidents(wrap([feature({}, { type: 'Point', coordinates: [] })]))).toHaveLength(0);
    expect(
      parseIncidents(wrap([feature({}, { type: 'Point', coordinates: ['24.9', '60.1'] })])),
    ).toHaveLength(0);
    // A one-vertex line is not a line.
    expect(
      parseIncidents(wrap([feature({}, { type: 'LineString', coordinates: [[24.9, 60.1]] })])),
    ).toHaveLength(0);
  });

  it('drops out-of-range coordinates, which is what a swapped axis looks like', () => {
    // lat/lon transposed puts 60.17 into the longitude slot — in range — and
    // 24.94 into the latitude, also in range, so this specific guard cannot
    // catch a transposition. What it catches is the garbage that follows one.
    expect(
      parseIncidents(wrap([feature({}, { type: 'Point', coordinates: [600, 60.17] })])),
    ).toHaveLength(0);
    expect(
      parseIncidents(wrap([feature({}, { type: 'Point', coordinates: [24.94, 91] })])),
    ).toHaveLength(0);
  });

  it('drops entries with no id or no title', () => {
    expect(parseIncidents(wrap([feature({ situationId: undefined })]))).toHaveLength(0);
    expect(parseIncidents(wrap([feature({ announcements: [] })]))).toHaveLength(0);
    expect(parseIncidents(wrap([feature({ announcements: [{ title: '   ' }] })]))).toHaveLength(0);
  });

  it('tolerates a missing municipality and an unparseable start time', () => {
    const [i] = parseIncidents(
      wrap([feature({ announcements: [{ language: 'FI', title: 'Liikennetiedote.' }] })]),
    );
    expect(i.municipality).toBeNull();
    expect(i.since).toBeNull();
  });

  it('throws on a response that is not a FeatureCollection', () => {
    // "Nothing is wrong on the roads" and "we could not ask" are different
    // facts; only the first may be drawn as an empty map.
    expect(() => parseIncidents(null)).toThrow();
    expect(() => parseIncidents({})).toThrow();
    expect(() => parseIncidents([])).toThrow();
  });

  it('returns an empty list — not a throw — for a genuinely empty feed', () => {
    expect(parseIncidents(wrap([]))).toEqual([]);
  });
});

describe('incident feed configuration', () => {
  it('asks only for announcements, and only active ones', () => {
    // Roadworks from the same endpoint are 585 features / 1.28 MB against this
    // feed's 8 / 3.4 kB, so the situationType filter is load-bearing, not a
    // preference. Area geometry is excluded for the same reason.
    expect(INCIDENTS_ENDPOINT).toContain('situationType=TRAFFIC_ANNOUNCEMENT');
    expect(INCIDENTS_ENDPOINT).toContain('inactiveHours=0');
    expect(INCIDENTS_ENDPOINT).toContain('includeAreaGeometry=false');
  });

  it('polls far slower than the trains do', () => {
    // An announcement stands for hours; a train moves every second. Polling
    // this at the trains' cadence would be twelve times the requests for data
    // that cannot have changed.
    expect(INCIDENT_POLL_MS).toBeGreaterThanOrEqual(60_000);
  });
});
