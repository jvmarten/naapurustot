/**
 * The train feed's past, as far as it honestly has one.
 *
 * Digitraffic publishes the LATEST fix for every train and nothing else
 * nationally; the only history it will serve is per train, per departure date
 * (see trainDetail.ts, which fetches exactly that for a selected train). So the
 * generic snapshot ring in positionBuffer.ts is the whole of the national past —
 * every poll is a measured national snapshot, and a scrub inside the session's
 * own window replays real positions at the real times they were reported. Why
 * the alternatives are all lies, and why the ring is bounded the way it is, is
 * written there; this module binds it to trains and adds the one thing a train
 * needs on top: a measured-first resolution ladder for a single selected train.
 */
import { trainKey, type Train } from './trains';
import {
  type Snapshot,
  recordSnapshot,
  snapshotAt,
  trackedRuns,
  nearestRun,
  TRACK_WINDOW_MS,
  TRACK_SPACING_MS,
  TRACK_TOLERANCE_MS,
} from './positionBuffer';

/** One poll's worth of measured train positions. */
export type TrainSnapshot = Snapshot<Train>;

export {
  recordSnapshot,
  snapshotAt,
  trackedRuns,
  nearestRun,
  TRACK_WINDOW_MS,
  TRACK_SPACING_MS,
  TRACK_TOLERANCE_MS,
};

/**
 * The record a selected train has for one instant, or null when it has none.
 *
 * ONE DEFINITION, BECAUSE TWO CAN DISAGREE. The map's ring and the detail panel
 * both have to answer "which of this train's reports belongs to the clock", and
 * they used to answer it differently — the ring walked this ladder while the
 * panel kept the object the pointer landed on and printed its timestamp and its
 * speed forever. Scrubbing three hours put a mark at one instant and a
 * "measured at" beside it from another, both drawn as measurements. That is the
 * failure `snapshotAt` exists to prevent, one panel further in.
 *
 * The order is measured-first, which is the same order the whole feed uses: the
 * live poll, then this session's own recording, then Fintraffic's published
 * timetable — which is a plan and is drawn and labelled as one.
 *
 * Live falls back to the selected train itself rather than to null, matching the
 * ring: a train that has arrived and left the national feed is still the thing
 * you clicked, and its last reported fix is still a fix. Scrubbed has no such
 * fallback — outside the recording and outside the timetable there is nothing
 * this page can say about where it was, and saying nothing is the answer.
 *
 * The measured TRACK is deliberately not part of this. It reaches further than
 * any of these, but it is fetched by and owned by the panel, it carries fixes
 * rather than train records, and the panel already prints its clock-resolved fix
 * as its own labelled row. The map layers it on top for the ring's position.
 */
export function trainRecordAt<T extends Train>(
  selected: T,
  opts: {
    live: boolean;
    /** The latest national poll. */
    current: T[];
    /** The session's recorded snapshot for this instant, if it has one. */
    snapshot: { items: T[] } | null;
    /** Timetable positions for this instant, if the day has been fetched. */
    scheduled: T[];
  },
): T | null {
  // `trainKey` rather than comparing the two fields here: identity is its
  // definition, and a second copy of it is the thing this function exists to
  // stop existing.
  const key = trainKey(selected);
  const same = (t: T) => trainKey(t) === key;
  if (opts.live) return opts.current.find(same) ?? selected;
  return opts.snapshot?.items.find(same) ?? opts.scheduled.find(same) ?? null;
}
