import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DetailPanel } from '../live/DetailPanel';
import type { Train } from '../live/trains';
import type { Incident } from '../live/incidents';

/**
 * The panel behind a click on a marker.
 *
 * What is pinned here is not the layout — it is the set of things the panel is
 * forbidden to say. Each of these has an obvious wrong implementation that would
 * look completely convincing on screen:
 *
 *  - a train with no measured fix at the scrubbed instant must say so, not
 *    interpolate between the fixes either side of it;
 *  - a future temperature must be labelled a forecast, and must come from FMI's
 *    model rather than from the last measurement lying around;
 *  - a station's timetable must merge its arrival and departure rows, or a
 *    twelve-stop journey reads as twenty-four.
 */

const TRAIN: Train = {
  number: 27,
  date: '2026-08-12',
  lon: 24.94,
  lat: 60.17,
  speed: 84,
  at: Date.parse('2026-08-12T09:00:00Z'),
};

/** Fake the two rail endpoints and FMI, by URL. */
function stubFetch(handlers: Record<string, unknown>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [fragment, body] of Object.entries(handlers)) {
      if (url.includes(fragment)) {
        return {
          ok: true,
          json: async () => body,
          text: async () => String(body),
        } as unknown as Response;
      }
    }
    throw new Error(`unstubbed fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const timetable = [
  {
    commercialStop: true,
    trainStopping: true,
    type: 'DEPARTURE',
    stationShortCode: 'HKI',
    scheduledTime: '2026-08-12T08:00:00.000Z',
    actualTime: '2026-08-12T08:00:30.000Z',
    differenceInMinutes: 0,
    commercialTrack: '7',
    cancelled: false,
  },
  {
    commercialStop: true,
    trainStopping: true,
    type: 'ARRIVAL',
    stationShortCode: 'TPE',
    scheduledTime: '2026-08-12T09:40:00.000Z',
    differenceInMinutes: 4,
    cancelled: false,
  },
  {
    commercialStop: true,
    trainStopping: true,
    type: 'DEPARTURE',
    stationShortCode: 'TPE',
    scheduledTime: '2026-08-12T09:42:00.000Z',
    differenceInMinutes: 4,
    cancelled: false,
  },
  // An operational passing point — not a place anybody can get off.
  {
    commercialStop: false,
    type: 'ARRIVAL',
    stationShortCode: 'JJ',
    scheduledTime: '2026-08-12T09:10:00.000Z',
  },
];

const track = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    location: { type: 'Point', coordinates: [24.9 + i / 100, 60.1] },
    timestamp: new Date(Date.parse(from) + i * 5_000).toISOString(),
    speed: 90,
    trainNumber: 27,
    departureDate: '2026-08-12',
  }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DetailPanel — a train', () => {
  it('shows the identity, the merged timetable and the measured track', async () => {
    stubFetch({
      '/metadata/stations': [
        { stationShortCode: 'HKI', stationName: 'Helsinki' },
        { stationShortCode: 'TPE', stationName: 'Tampere' },
      ],
      '/trains/2026-08-12/27': [
        {
          trainNumber: 27,
          trainType: 'IC',
          trainCategory: 'Long-distance',
          commuterLineID: '',
          operatorShortCode: 'vr',
          cancelled: false,
          timeTableRows: timetable,
        },
      ],
      '/train-locations/2026-08-12/27': track('2026-08-12T08:00:00Z', 20),
    });

    render(
      <DetailPanel
        selection={{ kind: 'train', item: TRAIN }}
        when={new Date(Date.parse('2026-08-12T08:00:30Z'))}
        onClose={() => {}}
        onTrack={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText(/IC/)).toBeTruthy());
    expect(screen.getByText('Helsinki')).toBeTruthy();
    // Merged: Tampere's arrival and departure are ONE row, and the operational
    // passing point is not a row at all.
    expect(screen.getAllByText('Tampere')).toHaveLength(1);
    expect(screen.queryByText('JJ')).toBeNull();
    expect(screen.getByText(/20/)).toBeTruthy();
  });

  it('hands the measured track up to the map', async () => {
    stubFetch({
      '/metadata/stations': [],
      '/trains/': [{ trainNumber: 27, timeTableRows: [] }],
      '/train-locations/': track('2026-08-12T08:00:00Z', 5),
    });
    const onTrack = vi.fn();
    render(
      <DetailPanel
        selection={{ kind: 'train', item: TRAIN }}
        when={new Date(Date.parse('2026-08-12T08:00:00Z'))}
        onClose={() => {}}
        onTrack={onTrack}
      />,
    );
    // The MAP draws the route and positions the dot from it — the panel is only
    // where the fetch happens to live.
    await waitFor(() => expect(onTrack).toHaveBeenCalled());
    expect(onTrack.mock.calls[0][0]).toHaveLength(5);
  });

  it('says there is no measured position rather than inventing one', async () => {
    stubFetch({
      '/metadata/stations': [],
      '/trains/': [{ trainNumber: 27, timeTableRows: [] }],
      '/train-locations/': track('2026-08-12T08:00:00Z', 5),
    });

    render(
      <DetailPanel
        selection={{ kind: 'train', item: TRAIN }}
        // Two hours after the last fix in the track. A dead-reckoned dot here
        // would be a position nobody measured — the exact thing trains.ts
        // refuses to draw forwards, refused backwards too.
        when={new Date(Date.parse('2026-08-12T10:00:00Z'))}
        onClose={() => {}}
        onTrack={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText('Ei mitattua sijaintia')).toBeTruthy());
  });

  it('survives a train the position feed gave no departure date for', () => {
    // Nothing can be fetched without the pair, so the panel shows what the
    // position feed knows and stops — it must not fire a request for
    // `/trains/null/27`.
    const fn = stubFetch({});
    render(
      <DetailPanel
        selection={{ kind: 'train', item: { ...TRAIN, date: null } }}
        when={new Date()}
        onClose={() => {}}
        onTrack={() => {}}
      />,
    );
    expect(fn).not.toHaveBeenCalled();
    expect(screen.getByText(/84 km\/h/)).toBeTruthy();
  });
});

describe('DetailPanel — a weather station', () => {
  const station = { lon: 24.94, lat: 60.17, celsius: 18.3, at: Date.parse('2026-08-12T09:00:00Z') };

  it('shows the measurement and asks for no forecast at a past instant', () => {
    const fn = stubFetch({});
    render(
      <DetailPanel
        selection={{ kind: 'observation', item: station }}
        when={new Date(Date.parse('2026-08-12T09:00:00Z'))}
        onClose={() => {}}
        onTrack={() => {}}
      />,
    );
    expect(screen.getByText('18.3 °C')).toBeTruthy();
    expect(fn).not.toHaveBeenCalled();
  });

  it('fetches FMI\'s point forecast for a future instant and labels it as one', async () => {
    const xml = `<?xml version="1.0"?><wfs:FeatureCollection
      xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"
      xmlns:BsWfs="http://xml.fmi.fi/schema/wfs/2.0"><wfs:member><BsWfs:BsWfsElement>
      <BsWfs:Location><gml:Point><gml:pos>60.16990 24.93840</gml:pos></gml:Point></BsWfs:Location>
      <BsWfs:Time>2026-08-13T15:00:00Z</BsWfs:Time>
      <BsWfs:ParameterName>Temperature</BsWfs:ParameterName>
      <BsWfs:ParameterValue>15.3</BsWfs:ParameterValue>
      </BsWfs:BsWfsElement></wfs:member></wfs:FeatureCollection>`;
    const fn = vi.fn(
      async (input: RequestInfo | URL) =>
        ({ ok: true, url: String(input), text: async () => xml }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fn);

    render(
      <DetailPanel
        selection={{ kind: 'observation', item: station }}
        when={new Date(Date.parse('2026-08-13T15:00:00Z'))}
        onClose={() => {}}
        onTrack={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText('15.3 °C')).toBeTruthy());
    // A POINT query, because the forecast stored query refuses a bbox — which is
    // also why the map layer itself never shows future values.
    expect(String(fn.mock.calls[0][0])).toContain('latlon=60.1700%2C24.9400');
    expect(String(fn.mock.calls[0][0])).toContain('forecast');
    // And it must never be mistakable for a reading.
    expect(screen.getByText(/ei mittaus/)).toBeTruthy();
  });
});

describe('DetailPanel — a road announcement', () => {
  const incident: Incident = {
    id: 'GUID1',
    title: 'Tie 1835, Salo. Liikennetiedote.',
    municipality: 'Salo',
    lon: 23.1,
    lat: 60.4,
    lines: [],
    since: Date.parse('2026-08-12T08:05:00Z'),
    until: Date.parse('2026-08-12T09:05:00Z'),
    notes: ['Lauttaliikenne keskeytetään huoltotyön ajaksi'],
  };

  it('reproduces the published wording and states the validity window', () => {
    render(
      <DetailPanel
        selection={{ kind: 'incident', item: incident }}
        when={new Date(Date.parse('2026-08-12T08:30:00Z'))}
        onClose={() => {}}
        onTrack={() => {}}
      />,
    );
    expect(screen.getByText('Tie 1835, Salo. Liikennetiedote.')).toBeTruthy();
    expect(screen.getByText('Lauttaliikenne keskeytetään huoltotyön ajaksi')).toBeTruthy();
    expect(screen.getByText('Salo')).toBeTruthy();
  });

  it('says "until further notice" rather than leaving an open end blank', () => {
    render(
      <DetailPanel
        selection={{ kind: 'incident', item: { ...incident, until: null } }}
        when={new Date()}
        onClose={() => {}}
        onTrack={() => {}}
      />,
    );
    expect(screen.getByText(/toistaiseksi/)).toBeTruthy();
  });
});
