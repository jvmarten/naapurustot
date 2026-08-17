/**
 * The train feed's past, as far as it honestly has one.
 *
 * Digitraffic publishes the LATEST fix for every train and nothing else
 * nationally; the only history it will serve is per train, per departure date
 * (see trainDetail.ts, which fetches exactly that for a selected train). So when
 * the page's clock is scrubbed backwards there are three things the map could
 * do, and two of them are lies:
 *
 *   1. Leave the current positions on screen under a past timestamp. This is
 *      what every naive implementation does and it is the worst option — it
 *      states, with a clock next to it, that a train was somewhere it was not.
 *   2. Dead-reckon backwards along the reported heading. A drawn position nobody
 *      measured, which trains.ts already refuses to do forwards.
 *   3. Show the fixes we actually watched arrive, and nothing else.
 *
 * This is (3). Every poll is a measured national snapshot; keeping them lets a
 * scrub inside the session's own window replay real positions at the real times
 * they were reported. Outside that window the layer goes dark and the readout
 * says why, which is the same answer this project gives for a postal code with
 * no data.
 *
 * WHY A RING RATHER THAN "KEEP EVERYTHING". A snapshot is ~111 trains of five
 * fields; at the 5-second poll that is 720 snapshots an hour and about 6 MB of
 * retained objects for a tab someone leaves open all day. The two bounds below
 * hold it near 1.5 MB: thinning to one snapshot per {@link TRACK_SPACING_MS}
 * costs nothing visible (a train at 200 km/h moves 830 m in 15 s, which is one
 * pixel at the zoom where the whole country fits) and the window bounds the
 * total.
 */
import { trainKey, type Train } from './trains';

/** One poll's worth of measured positions. */
export interface TrainSnapshot {
  /** When the snapshot was taken, ms since the epoch. */
  at: number;
  trains: Train[];
}

/** How far back the buffer reaches. */
export const TRACK_WINDOW_MS = 3_600_000;

/**
 * Minimum gap between retained snapshots.
 *
 * Not the poll interval — polls stay at 5 s so the LIVE view is current. This is
 * how densely the past is kept, and 15 s is below what a scrubber pixel can
 * resolve: a 24-hour bar on a 1,200 px screen is 72 seconds per pixel.
 */
export const TRACK_SPACING_MS = 15_000;

/**
 * How far a scrub may sit from a retained snapshot and still be answered by it.
 *
 * A shade over the spacing, so an ordinary gap always resolves; a longer gap —
 * the tab was hidden, the network dropped — does not, and the reader is told
 * there is no measurement for that moment instead of being shown the nearest
 * one under the wrong time.
 */
export const TRACK_TOLERANCE_MS = 20_000;

/**
 * Append a snapshot, thinning and trimming in place.
 *
 * Mutates and returns the same array: the caller holds it in a ref that the
 * draw loop reads at up to 60 Hz, and reallocating it once per poll would be
 * churn for nothing.
 */
export function recordSnapshot(
  buffer: TrainSnapshot[],
  at: number,
  trains: Train[],
): TrainSnapshot[] {
  const last = buffer[buffer.length - 1];
  // A clock that went backwards (a resumed laptop, an NTP step) would otherwise
  // leave the buffer unsorted, and every lookup below assumes it is ordered.
  if (last && at < last.at) buffer.length = 0;
  else if (last && at - last.at < TRACK_SPACING_MS) return buffer;

  buffer.push({ at, trains });

  const cutoff = at - TRACK_WINDOW_MS;
  let drop = 0;
  while (drop < buffer.length && buffer[drop].at < cutoff) drop++;
  if (drop > 0) buffer.splice(0, drop);
  return buffer;
}

/**
 * The retained snapshot nearest `at`, or null when none is close enough.
 *
 * Binary search rather than a scan: this runs inside the draw loop, which fires
 * on every MapLibre `render` event.
 */
export function snapshotAt(
  buffer: TrainSnapshot[],
  at: number,
  toleranceMs: number = TRACK_TOLERANCE_MS,
): TrainSnapshot | null {
  if (buffer.length === 0) return null;
  let lo = 0;
  let hi = buffer.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (buffer[mid].at < at) lo = mid + 1;
    else hi = mid;
  }
  // `lo` is the first snapshot at or after `at`; its predecessor is the other
  // candidate, and one of the two is the nearest.
  const after = buffer[lo];
  const before = buffer[lo - 1];
  const best =
    before && (!after || at - before.at <= after.at - at) ? before : after;
  return Math.abs(best.at - at) <= toleranceMs ? best : null;
}

/**
 * The CONTIGUOUS stretches the buffer actually covers, oldest first.
 *
 * NOT "oldest to newest", which is what this used to report and which the
 * readout printed as "Recorded 09:15–09:59." — one sentence after telling the
 * reader that nothing was recorded for an instant inside that very span. The
 * holes are not an edge case: `useFeedPoll` deliberately stops polling while the
 * tab is hidden, so every visit that involves switching tabs for a few minutes
 * produces one, and `snapshotAt` correctly refuses the middle of it.
 *
 * A gap is a step longer than TWICE the tolerance `snapshotAt` answers within,
 * and the factor of two is the whole definition rather than a fudge: the worst
 * an instant between two snapshots can do is land at their midpoint, so every
 * instant between them is answerable exactly when their separation is at most
 * 2 × tolerance. That makes the sentence this feeds true as written — inside a
 * run reported here, every instant has a snapshot the page will actually use.
 */
export function trackedRuns(buffer: TrainSnapshot[]): { from: number; to: number }[] {
  if (buffer.length === 0) return [];
  const runs: { from: number; to: number }[] = [];
  let from = buffer[0].at;
  for (let i = 1; i < buffer.length; i++) {
    if (buffer[i].at - buffer[i - 1].at > 2 * TRACK_TOLERANCE_MS) {
      runs.push({ from, to: buffer[i - 1].at });
      from = buffer[i].at;
    }
  }
  runs.push({ from, to: buffer[buffer.length - 1].at });
  return runs;
}

/**
 * The stretch nearest `at`, or null while the buffer is empty.
 *
 * What the readout wants when it has to say how far the recording reaches: the
 * reader is looking at an instant nothing can answer for, so the useful fact is
 * where the nearest thing that CAN starts and stops.
 */
export function nearestRun(
  buffer: TrainSnapshot[],
  at: number,
): { from: number; to: number; runs: number } | null {
  const runs = trackedRuns(buffer);
  if (runs.length === 0) return null;
  let best = runs[0];
  let bestGap = Infinity;
  for (const run of runs) {
    const gap = at < run.from ? run.from - at : at > run.to ? at - run.to : 0;
    if (gap < bestGap) {
      bestGap = gap;
      best = run;
    }
  }
  return { ...best, runs: runs.length };
}

/**
 * The record a selected train has for one instant, or null when it has none.
 *
 * ONE DEFINITION, BECAUSE TWO CAN DISAGREE. The map's ring and the detail panel
 * both have to answer "which of this train's reports belongs to the clock", and
 * they used to answer it differently — the ring walked this ladder while the
 * panel kept the object the pointer landed on and printed its timestamp and its
 * speed forever. Scrubbing three hours put a mark at one instant and a
 * "measured at" beside it from another, both drawn as measurements. That is the
 * failure `snapshotAt` above exists to prevent, one panel further in.
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
    snapshot: { trains: T[] } | null;
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
  return opts.snapshot?.trains.find(same) ?? opts.scheduled.find(same) ?? null;
}
