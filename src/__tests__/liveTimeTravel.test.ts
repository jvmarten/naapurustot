import { describe, it, expect } from 'vitest';
import {
  recordSnapshot,
  snapshotAt,
  trackedRuns,
  nearestRun,
  trainRecordAt,
  TRACK_SPACING_MS,
  TRACK_WINDOW_MS,
  type TrainSnapshot,
} from '../live/trainHistory';
import { activeAt, parseIncidents } from '../live/incidents';
import { observationsUrl } from '../live/observations';
import { airQualityUrl } from '../live/airquality';
import {
  fixAt,
  FIX_TOLERANCE_MS,
  parseTimetable,
  parseTrack,
  type TrainFix,
} from '../live/trainDetail';
import { pickFeature } from '../live/pick';
import { ALL_FEEDS } from '../live/feeds';
import type { Train } from '../live/trains';

/**
 * Time travel on /live/.
 *
 * The page has one clock and every feed answers for it. What these tests pin is
 * the boundary each feed refuses to cross — because the failure mode is not a
 * crash, it is a map that looks perfectly plausible while showing the present
 * under a past timestamp. Every case below is a place where the tempting
 * implementation produces exactly that.
 */

const train = (n: number, at: number): Train => ({
  number: n,
  date: '2026-08-12',
  lon: 24.9 + n / 1000,
  lat: 60.1,
  speed: 80,
  at,
});

describe('recorded train history', () => {
  it('thins to the retention spacing rather than keeping every poll', () => {
    const buf: TrainSnapshot[] = [];
    const t0 = Date.parse('2026-08-12T09:00:00Z');
    // The poll is every 5 s; keeping all of them is ~6 MB an hour of retained
    // objects for a tab someone leaves open.
    for (let i = 0; i < 60; i++) recordSnapshot(buf, t0 + i * 5_000, [train(1, t0)]);
    expect(buf.length).toBeLessThanOrEqual(Math.ceil((60 * 5_000) / TRACK_SPACING_MS) + 1);
    expect(buf.length).toBeGreaterThan(4);
  });

  it('drops snapshots older than the window', () => {
    const buf: TrainSnapshot[] = [];
    const t0 = Date.parse('2026-08-12T09:00:00Z');
    recordSnapshot(buf, t0, [train(1, t0)]);
    recordSnapshot(buf, t0 + TRACK_WINDOW_MS + 60_000, [train(2, t0)]);
    expect(buf).toHaveLength(1);
    expect(buf[0].trains[0].number).toBe(2);
  });

  it('resets when the clock goes backwards', () => {
    // A resumed laptop or an NTP step. Appending out of order would leave the
    // buffer unsorted, and every lookup here binary-searches it.
    const buf: TrainSnapshot[] = [];
    const t0 = Date.parse('2026-08-12T09:00:00Z');
    recordSnapshot(buf, t0, [train(1, t0)]);
    recordSnapshot(buf, t0 - 600_000, [train(2, t0)]);
    expect(buf).toHaveLength(1);
    expect(buf[0].at).toBe(t0 - 600_000);
  });

  it('answers with the nearest snapshot, and only within tolerance', () => {
    const buf: TrainSnapshot[] = [];
    const t0 = Date.parse('2026-08-12T09:00:00Z');
    for (let i = 0; i < 10; i++) recordSnapshot(buf, t0 + i * TRACK_SPACING_MS, [train(i, t0)]);

    const mid = t0 + 4 * TRACK_SPACING_MS;
    expect(snapshotAt(buf, mid + 2_000)?.at).toBe(mid);
    expect(snapshotAt(buf, mid - 2_000)?.at).toBe(mid);

    // OUTSIDE THE RECORDING IS A GAP, NOT THE NEAREST EDGE. Returning the last
    // snapshot for a scrub to 03:00 would draw this morning's positions under a
    // clock reading 03:00 — the one thing the recording exists to prevent.
    expect(snapshotAt(buf, t0 - 3_600_000)).toBeNull();
    expect(snapshotAt(buf, t0 + 3_600_000)).toBeNull();
    expect(snapshotAt([], t0)).toBeNull();
  });

  /** An uninterrupted stretch of polling, as `recordSnapshot` would retain it. */
  function record(buf: TrainSnapshot[], from: number, count: number) {
    for (let i = 0; i < count; i++) recordSnapshot(buf, from + i * TRACK_SPACING_MS, []);
    return from + (count - 1) * TRACK_SPACING_MS;
  }

  it('reports how far the recording reaches', () => {
    const buf: TrainSnapshot[] = [];
    const t0 = Date.parse('2026-08-12T09:00:00Z');
    expect(trackedRuns(buf)).toEqual([]);
    expect(nearestRun(buf, t0)).toBeNull();
    const last = record(buf, t0, 6);
    expect(trackedRuns(buf)).toEqual([{ from: t0, to: last }]);
  });

  it('breaks the recording at a gap rather than claiming across it', () => {
    // The readout used to print the buffer's first and last instants as one
    // span — in the same breath as telling the reader that an instant INSIDE it
    // was not recorded. The gap here is the ordinary one: polling stops while
    // the tab is hidden, so a few minutes in another tab produces exactly this.
    const buf: TrainSnapshot[] = [];
    const t0 = Date.parse('2026-08-12T09:00:00Z');
    const firstEnd = record(buf, t0, 6);
    const afterGap = t0 + 20 * 60_000;
    const secondEnd = record(buf, afterGap, 6);

    const runs = trackedRuns(buf);
    expect(runs).toEqual([
      { from: t0, to: firstEnd },
      { from: afterGap, to: secondEnd },
    ]);
  });

  it('keeps an uninterrupted stretch whole, at the spacing polling produces', () => {
    // The counterpart of the case above, and the one that stops the gap rule
    // being drawn so tightly that ordinary polling looks like a broken record:
    // consecutive retained snapshots are TRACK_SPACING_MS apart by construction.
    const buf: TrainSnapshot[] = [];
    const t0 = Date.parse('2026-08-12T09:00:00Z');
    record(buf, t0, 40);
    expect(trackedRuns(buf)).toHaveLength(1);
  });

  it('names the stretch nearest the clock, and how many there are', () => {
    const buf: TrainSnapshot[] = [];
    const t0 = Date.parse('2026-08-12T09:00:00Z');
    const firstEnd = record(buf, t0, 6);
    const afterGap = t0 + 20 * 60_000;
    record(buf, afterGap, 6);

    // A clock inside the hole picks whichever side it is closer to.
    expect(nearestRun(buf, firstEnd + 60_000)).toMatchObject({ from: t0, to: firstEnd, runs: 2 });
    expect(nearestRun(buf, afterGap - 60_000)).toMatchObject({ from: afterGap, runs: 2 });
  });
});

describe('road announcements at an instant', () => {
  const wrap = (
    id: string,
    startTime: string | null,
    endTime: string | null,
  ) => ({
    geometry: { type: 'Point', coordinates: [24.9, 60.1] },
    properties: {
      situationId: id,
      announcements: [
        {
          title: `T ${id}`,
          timeAndDuration: {
            ...(startTime ? { startTime } : {}),
            ...(endTime ? { endTime } : {}),
          },
        },
      ],
    },
  });

  const feed = parseIncidents({
    features: [
      wrap('past', '2026-08-12T05:00:00Z', '2026-08-12T06:00:00Z'),
      wrap('now', '2026-08-12T08:00:00Z', '2026-08-12T12:00:00Z'),
      wrap('open', '2026-08-12T08:00:00Z', null),
      wrap('planned', '2026-08-13T08:00:00Z', '2026-08-13T12:00:00Z'),
      wrap('undated', null, null),
    ],
  });

  const at = (iso: string) => activeAt(feed, Date.parse(iso)).map((i) => i.id).sort();

  it('reads the validity the publisher stated, in both directions', () => {
    // The endpoint is asked for recently-expired announcements too, so a scrub
    // backwards finds them — and a planned closure published for tomorrow is
    // Fintraffic's own plan, not a prediction of ours.
    expect(at('2026-08-12T05:30:00Z')).toEqual(['past', 'undated']);
    expect(at('2026-08-12T09:00:00Z')).toEqual(['now', 'open', 'undated']);
    expect(at('2026-08-13T09:00:00Z')).toEqual(['open', 'planned', 'undated']);
  });

  it('keeps an announcement with no stated end in effect once it starts', () => {
    expect(at('2026-08-12T07:00:00Z')).not.toContain('open');
    expect(at('2026-09-01T00:00:00Z')).toContain('open');
  });

  it('parses the end time and the published feature lines', () => {
    const withNotes = parseIncidents({
      features: [
        {
          geometry: { type: 'Point', coordinates: [24.9, 60.1] },
          properties: {
            situationId: 'x',
            announcements: [
              {
                title: 'Tie 1835, Salo. Liikennetiedote.',
                features: [{ name: 'Lauttaliikenne keskeytetään' }, { name: '  ' }, {}],
                timeAndDuration: {
                  startTime: '2026-08-12T08:05:00Z',
                  endTime: '2026-08-12T09:05:00Z',
                },
              },
            ],
          },
        },
      ],
    });
    expect(withNotes[0].until).toBe(Date.parse('2026-08-12T09:05:00Z'));
    // Blank and missing names are dropped rather than rendered as empty bullets.
    expect(withNotes[0].notes).toEqual(['Lauttaliikenne keskeytetään']);
  });
});

describe('FMI archive requests', () => {
  const at = Date.parse('2026-08-12T09:30:00Z');

  it('leaves the window open-ended for the live case', () => {
    // Sending `endtime` here would hand the newest readings to the VISITOR'S
    // clock: a browser four minutes slow would silently cut off everything
    // published since, and the map would show a stale frame with no way to tell.
    const url = observationsUrl(at);
    expect(url).toContain('starttime=');
    expect(url).not.toContain('endtime=');
  });

  it('closes the window at both ends for an archive request', () => {
    const url = observationsUrl(at, true);
    expect(url).toContain('endtime=2026-08-12T09%3A30%3A00Z');
    // The look-back is preserved, or a station on a ten-minute cycle has no
    // reading inside the window at all.
    expect(url).toContain('starttime=2026-08-12T09%3A10%3A00Z');
  });

  it('does the same for air quality, on its own three-hour window', () => {
    const url = airQualityUrl(at, true);
    expect(url).toContain('endtime=2026-08-12T09%3A30%3A00Z');
    expect(url).toContain('starttime=2026-08-12T06%3A30%3A00Z');
  });
});

describe('one train, fetched', () => {
  const names = new Map([
    ['HKI', 'Helsinki'],
    ['PSL', 'Pasila'],
    ['TPE', 'Tampere'],
  ]);

  const row = (over: Record<string, unknown>) => ({
    commercialStop: true,
    cancelled: false,
    stationShortCode: 'HKI',
    scheduledTime: '2026-08-12T03:54:00.000Z',
    differenceInMinutes: 0,
    ...over,
  });

  it('merges the arrival and departure rows of one stop', () => {
    // The feed emits a row per EVENT, so a through station appears twice.
    // Listing both would make a twelve-stop journey read as twenty-four.
    const stops = parseTimetable(
      [
        row({ type: 'DEPARTURE', stationShortCode: 'HKI', commercialTrack: '7' }),
        row({ type: 'ARRIVAL', stationShortCode: 'PSL', scheduledTime: '2026-08-12T03:59:00.000Z' }),
        row({
          type: 'DEPARTURE',
          stationShortCode: 'PSL',
          scheduledTime: '2026-08-12T04:01:00.000Z',
          differenceInMinutes: 2,
        }),
      ],
      names,
    );
    expect(stops).toHaveLength(2);
    expect(stops[1].name).toBe('Pasila');
    expect(stops[1].arrival).toBe(Date.parse('2026-08-12T03:59:00.000Z'));
    expect(stops[1].departure).toBe(Date.parse('2026-08-12T04:01:00.000Z'));
    expect(stops[1].lateMinutes).toBe(2);
  });

  it('keeps a station visited twice as two stops', () => {
    // A circular service returns to where it started. Merging by station code
    // rather than by adjacency would collapse the two into one and lose half
    // the journey.
    const stops = parseTimetable(
      [
        row({ type: 'DEPARTURE', stationShortCode: 'HKI' }),
        row({ type: 'ARRIVAL', stationShortCode: 'TPE' }),
        row({ type: 'DEPARTURE', stationShortCode: 'TPE' }),
        row({ type: 'ARRIVAL', stationShortCode: 'HKI' }),
      ],
      names,
    );
    expect(stops.map((s) => s.code)).toEqual(['HKI', 'TPE', 'HKI']);
  });

  it('drops the operational rows a passenger cannot use', () => {
    // Train 1's timetable is 140 rows and 24 commercial ones; the rest are
    // junctions and signal points.
    const stops = parseTimetable(
      [row({ type: 'ARRIVAL' }), { ...row({ type: 'ARRIVAL' }), commercialStop: false }],
      names,
    );
    expect(stops).toHaveLength(1);
  });

  it('falls back to the station code when the register is unavailable', () => {
    const stops = parseTimetable([row({ type: 'ARRIVAL' })], new Map());
    expect(stops[0].name).toBe('HKI');
  });

  it('sorts a measured track oldest-first and drops unusable fixes', () => {
    const track = parseTrack([
      { location: { coordinates: [29.77, 62.6] }, timestamp: '2026-08-12T08:33:52.000Z', speed: 0 },
      { location: { coordinates: [29.5, 62.4] }, timestamp: '2026-08-12T08:30:00.000Z', speed: 90 },
      { location: null, timestamp: '2026-08-12T08:31:00.000Z' },
      { location: { coordinates: [400, 62.4] }, timestamp: '2026-08-12T08:32:00.000Z' },
      { location: { coordinates: [29.6, 62.5] }, timestamp: 'not a time' },
    ]);
    expect(track.map((f) => f.at)).toEqual([
      Date.parse('2026-08-12T08:30:00.000Z'),
      Date.parse('2026-08-12T08:33:52.000Z'),
    ]);
  });

  it('answers a scrubbed instant with a measured fix, or with nothing', () => {
    const base = Date.parse('2026-08-12T08:00:00Z');
    const track = parseTrack(
      Array.from({ length: 12 }, (_, i) => ({
        location: { coordinates: [24.9 + i / 100, 60.1] },
        timestamp: new Date(base + i * 5_000).toISOString(),
        speed: 100,
      })),
    );
    // Within a fix's reach: a real reported position.
    expect(fixAt(track, base + 27_000)?.at).toBe(base + 25_000);
    // Beyond it: NOTHING. A tunnel, a yard, or a train that had not departed —
    // none of which is a reason to draw a plausible dot. This is the same rule
    // trains.ts applies forwards, applied backwards.
    expect(fixAt(track, base - 600_000)).toBeNull();
    expect(fixAt([], base)).toBeNull();
  });
});

describe('picking a marker', () => {
  // A 1:1 projection, so screen pixels are lon/lat and the geometry is readable.
  const project = (lon: number, lat: number) => ({ x: lon, y: lat });

  it('returns the nearest marker within its grab radius', () => {
    const hit = pickFeature(
      { x: 100, y: 100 },
      { trains: [{ lon: 300, lat: 300 }, { lon: 104, lat: 100 }] },
      project,
    );
    expect(hit).toEqual({ kind: 'train', index: 1 });
  });

  it('returns nothing for empty map', () => {
    expect(pickFeature({ x: 0, y: 0 }, { trains: [{ lon: 500, lat: 500 }] }, project)).toBeNull();
    expect(pickFeature({ x: 0, y: 0 }, {}, project)).toBeNull();
  });

  it('prefers the smaller mark when two coincide', () => {
    // A temperature label is 14 px of text written across a 4.5 px train dot.
    // Picking in paint order would make the train unselectable whenever a
    // station reading happened to land on it.
    const hit = pickFeature(
      { x: 100, y: 100 },
      { trains: [{ lon: 100, lat: 100 }], observations: [{ lon: 100, lat: 100 }] },
      project,
    );
    expect(hit?.kind).toBe('train');
  });

  it('still prefers a clearly closer mark of a lower-priority kind', () => {
    const hit = pickFeature(
      { x: 100, y: 100 },
      { trains: [{ lon: 110, lat: 100 }], observations: [{ lon: 100, lat: 100 }] },
      project,
    );
    expect(hit?.kind).toBe('observation');
  });

  it('tests a closure along its whole length, not just its anchor', () => {
    // A closure can be ten kilometres long. Testing only the anchor would make
    // the other 9.99 km of it dead to the pointer — which is the same reason
    // the renderer draws it as a line rather than as a dot.
    const incident = {
      lon: 0,
      lat: 0,
      lines: [[[0, 0], [400, 0]] as [number, number][]],
    };
    expect(pickFeature({ x: 250, y: 3 }, { incidents: [incident] }, project)).toEqual({
      kind: 'incident',
      index: 0,
    });
    expect(pickFeature({ x: 250, y: 90 }, { incidents: [incident] }, project)).toBeNull();
  });
});

describe('the feed registry states how far each feed can be scrubbed', () => {
  it('gives every feed a time model', () => {
    // The sidebar and the readout both branch on this, and a feed that arrives
    // without one would silently inherit whatever the UI defaults to — which is
    // how a measured layer ends up frozen under a past clock.
    for (const feed of ALL_FEEDS) {
      expect(['computed', 'archive', 'forecast', 'recorded', 'schedule', 'validity']).toContain(
        feed.time,
      );
    }
  });

  it('does not claim history the source cannot serve', () => {
    const byId = new Map(ALL_FEEDS.map((f) => [f.id, f.time]));
    expect(byId.get('shadows')).toBe('computed');
    expect(byId.get('sun_position')).toBe('computed');
    // Digitraffic publishes the latest fix nationally and position history one
    // train at a time, so the national layer's measured past is only what this
    // session recorded — and outside that window it falls back to Fintraffic's
    // published timetable, drawn as a plan rather than as a fix.
    expect(byId.get('trains')).toBe('schedule');
    // FMI's stored queries answer for any past window given an endtime, and
    // ECMWF publishes a forecast at those same stations for the future half.
    expect(byId.get('observations')).toBe('forecast');
    // Archive only, and deliberately: FMI's air-quality forecast is point-only
    // and answers NaN for the index, so there is nothing national to draw.
    expect(byId.get('air_quality')).toBe('archive');
    expect(byId.get('road_incidents')).toBe('validity');
  });

  it('gives every time model a label in every locale', async () => {
    // The sidebar prints `live.time_model.<model>` on each row, so a model added
    // to the union without its three strings renders as a raw key — which is
    // how the one line explaining a feed's reach turns into noise.
    const models = new Set(ALL_FEEDS.map((f) => f.time));
    const dicts = await Promise.all(
      ['en', 'fi-extra', 'sv'].map(
        (l) =>
          import(`../locales/${l}.json`) as Promise<{ default: Record<string, string> }>,
      ),
    );
    for (const model of models) {
      for (const dict of dicts) {
        expect(dict.default[`live.time_model.${model}`]).toBeTruthy();
      }
    }
  });
});

/**
 * One ladder for the ring and the rows beside it.
 *
 * The map's selection ring resolved a scrubbed train through recorded snapshot
 * then published timetable; the detail panel kept the object the pointer landed
 * on. So scrubbing moved the mark while the panel went on printing "measured at
 * 08:45:12 · 97 km/h" from the click — two instants side by side, both drawn as
 * measurements, with nothing saying they were different instants. That is the
 * failure `snapshotAt` exists to prevent, one panel further in.
 *
 * `trainRecordAt` is now the single definition both walk.
 */
describe('the selected train, resolved for the clock', () => {
  const t0 = Date.parse('2026-08-12T09:00:00Z');
  const selected = train(1, t0);
  const other = train(2, t0);
  /** Same train, a later report. */
  const later: Train = { ...selected, lon: 25.4, at: t0 + 600_000, speed: 120 };
  const planned: Train = { ...selected, lon: 26.1, at: t0 + 1_200_000, speed: null };

  it('follows the live poll rather than the click', () => {
    const at = trainRecordAt(selected, {
      live: true,
      current: [other, later],
      snapshot: null,
      scheduled: [],
    });
    expect(at?.at).toBe(later.at);
    expect(at?.speed).toBe(120);
  });

  it('keeps the last reported fix when a train leaves the live feed', () => {
    // Arrived and gone is the journey ending, not the page knowing less — and
    // the ring does the same, so the two must not diverge here.
    const at = trainRecordAt(selected, {
      live: true,
      current: [other],
      snapshot: null,
      scheduled: [],
    });
    expect(at).toBe(selected);
  });

  it('prefers this session’s recorded snapshot to the timetable', () => {
    const at = trainRecordAt(selected, {
      live: false,
      current: [],
      snapshot: { trains: [other, later] },
      scheduled: [planned],
    });
    expect(at?.at).toBe(later.at);
  });

  it('falls back to the published timetable when nothing was recorded', () => {
    const at = trainRecordAt(selected, {
      live: false,
      current: [],
      snapshot: null,
      scheduled: [other, planned],
    });
    expect(at?.lon).toBe(planned.lon);
  });

  it('answers null when neither can speak for the instant', () => {
    // The panel closes and the ring draws nothing — the same absence, in both
    // places. Any non-null answer here is a position nobody reported.
    expect(
      trainRecordAt(selected, { live: false, current: [], snapshot: null, scheduled: [] }),
    ).toBeNull();
    expect(
      trainRecordAt(selected, {
        live: false,
        current: [later],
        snapshot: { trains: [other] },
        scheduled: [other],
      }),
      'the live poll must not leak into a scrubbed answer',
    ).toBeNull();
  });

  it('does not confuse two runs of the same train number on different dates', () => {
    const yesterday: Train = { ...selected, date: '2026-08-11', lon: 27.7 };
    const at = trainRecordAt(selected, {
      live: false,
      current: [],
      snapshot: { trains: [yesterday] },
      scheduled: [],
    });
    expect(at).toBeNull();
  });
});

/**
 * The route line and the dot have to disappear over the same instants.
 *
 * `paintSelection` used to run a chord straight across every hole in the
 * measured track, while the dot went through `fixAt` and correctly refused —
 * so the map drew a route through ground the train did not cross, in the same
 * ink as the measured part, directly under a docstring claiming that "where the
 * record has a hole the map draws nothing rather than a plausible position".
 *
 * The line now breaks at `2 × FIX_TOLERANCE_MS`, and that factor is derived
 * rather than chosen: inside a gap of G the furthest any instant can sit from
 * the nearer fix is G/2, so the dot vanishes somewhere in the gap exactly when
 * G/2 exceeds the tolerance. This pins the derivation, because the painter's
 * threshold and the tolerance can otherwise drift apart silently — the line
 * would then bridge a gap the dot refuses, or break over one it answers for,
 * and neither shows up in any other test.
 */
describe('the drawn route agrees with the drawn dot', () => {
  const base = Date.parse('2026-08-12T09:00:00Z');
  const twoFixes = (gapMs: number): TrainFix[] => [
    { at: base, lon: 24.9, lat: 60.1, speed: 80 },
    { at: base + gapMs, lon: 25.1, lat: 60.2, speed: 80 },
  ];
  /** What the painter asks: is this gap wide enough to break the line? */
  const lineBreaks = (gapMs: number) => gapMs > 2 * FIX_TOLERANCE_MS;
  /** What the map asks at the worst instant in the gap: is there a dot? */
  const dotVanishes = (gapMs: number) =>
    fixAt(twoFixes(gapMs), base + gapMs / 2) === null;

  it('breaks the line over exactly the gaps that have no dot', () => {
    for (const gap of [5_000, 30_000, 59_000, 60_000, 61_000, 120_000, 600_000]) {
      expect(lineBreaks(gap), `gap ${gap} ms`).toBe(dotVanishes(gap));
    }
  });

  it('joins an ordinary five-second gap and breaks a tunnel', () => {
    // Fixes land about every five seconds while a train moves; a multi-minute
    // hole is a tunnel, a yard, or a train that had not departed.
    expect(lineBreaks(5_000)).toBe(false);
    expect(lineBreaks(300_000)).toBe(true);
  });

  it('puts the boundary exactly at twice the tolerance', () => {
    expect(lineBreaks(2 * FIX_TOLERANCE_MS)).toBe(false);
    expect(lineBreaks(2 * FIX_TOLERANCE_MS + 1)).toBe(true);
  });
});
