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
import type { Train } from './trains';

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

/** Oldest and newest retained instants, or null while the buffer is empty. */
export function trackedRange(buffer: TrainSnapshot[]): { from: number; to: number } | null {
  if (buffer.length === 0) return null;
  return { from: buffer[0].at, to: buffer[buffer.length - 1].at };
}
