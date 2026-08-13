import { describe, it, expect } from 'vitest';
import {
  parseSchedules,
  scheduledPositions,
  datesCovering,
  OVERNIGHT_REACH_HOURS,
} from '../live/trainSchedule';
import type { RailStation } from '../live/trainDetail';

/**
 * The one layer on /live/ that draws a position nobody measured — and the tests
 * are mostly about the conditions under which it is allowed to.
 *
 * The numbers are Fintraffic's: its control points, its published times, its
 * measured passing times where a train has already been somewhere. What this
 * module adds is the interpolation between two of them, and every test below
 * pins one of the guarantees that makes that defensible — a mark that can never
 * be mistaken for a fix, a train that is simply absent when it is not running,
 * and a route that cannot run backwards.
 */

const stations = new Map<string, RailStation>([
  ['HKI', { name: 'Helsinki', lat: 60.0, lon: 25.0 }],
  ['PSL', { name: 'Pasila', lat: 61.0, lon: 25.0 }],
  ['TPE', { name: 'Tampere', lat: 62.0, lon: 25.0 }],
  ['NOWHERE', { name: 'Unplaceable', lat: NaN, lon: NaN }],
]);

const t = (iso: string) => `2026-08-12T${iso}:00.000Z`;
const ms = (iso: string) => Date.parse(t(iso));

const train = (rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  trainNumber: 1,
  departureDate: '2026-08-12',
  trainType: 'IC',
  trainCategory: 'Long-distance',
  cancelled: false,
  timeTableRows: rows,
  ...extra,
});

describe('parseSchedules', () => {
  it('prefers a measured passing time over an estimate over the plan', () => {
    // This ordering is what makes a scrub back through this morning show where
    // the trains really were rather than where they were meant to be — and it is
    // why a delayed train's position is right rather than optimistic.
    const [schedule] = parseSchedules(
      [
        train([
          { stationShortCode: 'HKI', scheduledTime: t('08:00'), actualTime: t('08:04') },
          { stationShortCode: 'PSL', scheduledTime: t('09:00'), liveEstimateTime: t('09:06') },
          { stationShortCode: 'TPE', scheduledTime: t('10:00') },
        ]),
      ],
      stations,
    );

    expect(schedule.points.map((p) => p.at)).toEqual([ms('08:04'), ms('09:06'), ms('10:00')]);
    expect(schedule.points.map((p) => p.actual)).toEqual([true, false, false]);
  });

  it('drops control points it cannot place, and trains left with fewer than two', () => {
    // A point with no coordinate cannot anchor an interpolation, and guessing
    // one from its neighbours would put a train in a lake.
    const parsed = parseSchedules(
      [
        train([
          { stationShortCode: 'HKI', scheduledTime: t('08:00') },
          { stationShortCode: 'NOWHERE', scheduledTime: t('09:00') },
          { stationShortCode: 'UNKNOWN', scheduledTime: t('09:30') },
          { stationShortCode: 'TPE', scheduledTime: t('10:00') },
        ]),
        train([{ stationShortCode: 'HKI', scheduledTime: t('08:00') }], { trainNumber: 2 }),
      ],
      stations,
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].points.map((p) => p.code)).toEqual(['HKI', 'TPE']);
  });

  it('keeps a dwell as two points so a stopped train stays at its platform', () => {
    const [schedule] = parseSchedules(
      [
        train([
          { stationShortCode: 'HKI', scheduledTime: t('08:00') },
          { stationShortCode: 'PSL', scheduledTime: t('09:00') },
          { stationShortCode: 'PSL', scheduledTime: t('09:05') },
          { stationShortCode: 'TPE', scheduledTime: t('10:00') },
        ]),
      ],
      stations,
    );
    expect(schedule.points).toHaveLength(4);

    const during = scheduledPositions([schedule], ms('09:02'))[0];
    expect(during.lat).toBeCloseTo(61.0, 6);
  });

  it('collapses an arrival and a departure published at the same instant', () => {
    const [schedule] = parseSchedules(
      [
        train([
          { stationShortCode: 'HKI', scheduledTime: t('08:00') },
          { stationShortCode: 'PSL', scheduledTime: t('09:00') },
          { stationShortCode: 'PSL', scheduledTime: t('09:00') },
          { stationShortCode: 'TPE', scheduledTime: t('10:00') },
        ]),
      ],
      stations,
    );
    expect(schedule.points).toHaveLength(3);
  });

  it('never lets a live estimate send the route backwards', () => {
    // An estimate can be published earlier than the scheduled time of the row
    // before it. Left alone that inverts a segment and the train runs backwards
    // through it.
    const [schedule] = parseSchedules(
      [
        train([
          { stationShortCode: 'HKI', scheduledTime: t('09:00') },
          { stationShortCode: 'PSL', liveEstimateTime: t('08:30') },
          { stationShortCode: 'TPE', scheduledTime: t('10:00') },
        ]),
      ],
      stations,
    );
    const times = schedule.points.map((p) => p.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('rejects a payload that is not a list rather than reading it as no trains', () => {
    expect(() => parseSchedules({ error: 'nope' }, stations)).toThrow();
  });
});

describe('scheduledPositions', () => {
  const [schedule] = parseSchedules(
    [
      train([
        { stationShortCode: 'HKI', scheduledTime: t('08:00'), actualTime: t('08:00') },
        { stationShortCode: 'PSL', scheduledTime: t('09:00'), actualTime: t('09:00') },
        { stationShortCode: 'TPE', scheduledTime: t('10:00') },
      ]),
    ],
    stations,
  );

  it('places a train in proportion to the published times of its segment', () => {
    const [half] = scheduledPositions([schedule], ms('08:30'));
    expect(half.lat).toBeCloseTo(60.5, 6);
    expect(half.lon).toBeCloseTo(25.0, 6);
    expect(half.fromCode).toBe('HKI');
    expect(half.toCode).toBe('PSL');
  });

  it('marks every position as scheduled and publishes no speed', () => {
    // Distance over time along a straight line between two control points is not
    // the train's speed, and this page's rule is that a number on screen is one
    // somebody published.
    const [p] = scheduledPositions([schedule], ms('08:30'));
    expect(p.scheduled).toBe(true);
    expect(p.speed).toBeNull();
  });

  it('says whether the segment is bounded by measurements at both ends', () => {
    expect(scheduledPositions([schedule], ms('08:30'))[0].fromActual).toBe(true);
    expect(scheduledPositions([schedule], ms('09:30'))[0].fromActual).toBe(false);
  });

  it('omits a train that is not running at that instant', () => {
    // Absent, not pinned to an endpoint: a train that has not departed is not
    // sitting at its origin as far as this layer is concerned, it is a train the
    // layer has nothing to say about.
    expect(scheduledPositions([schedule], ms('07:59'))).toHaveLength(0);
    expect(scheduledPositions([schedule], ms('10:01'))).toHaveLength(0);
    expect(scheduledPositions([schedule], ms('08:00'))).toHaveLength(1);
    expect(scheduledPositions([schedule], ms('10:00'))).toHaveLength(1);
  });

  it('drops a cancelled train, whose timetable is still published', () => {
    const [cancelled] = parseSchedules(
      [
        train(
          [
            { stationShortCode: 'HKI', scheduledTime: t('08:00') },
            { stationShortCode: 'TPE', scheduledTime: t('10:00') },
          ],
          { cancelled: true },
        ),
      ],
      stations,
    );
    expect(scheduledPositions([cancelled], ms('09:00'))).toHaveLength(0);
  });
});

describe('datesCovering', () => {
  it('asks for yesterday too while overnight services can still be running', () => {
    // Digitraffic keys a day's timetables on the DEPARTURE date, so the trains
    // running at 04:00 are mostly filed under yesterday.
    const early = new Date(2026, 7, 12, OVERNIGHT_REACH_HOURS - 1, 0, 0);
    expect(datesCovering(early)).toEqual(['2026-08-12', '2026-08-11']);
  });

  it('asks for one day once nothing from yesterday can still be out', () => {
    const afternoon = new Date(2026, 7, 12, OVERNIGHT_REACH_HOURS, 0, 0);
    expect(datesCovering(afternoon)).toEqual(['2026-08-12']);
  });
});
