/**
 * A rolling buffer of measured position snapshots, shared by every /live/ feed
 * whose only history is what this session watched arrive.
 *
 * Some sources publish the LATEST state and nothing else nationally — Digitraffic
 * hands out the latest fix per train and the latest position per vessel, both
 * without a national past a browser can ask for. So when the page's clock is
 * scrubbed backwards there are three things the map could do, and two of them are
 * lies:
 *
 *   1. Leave the current positions on screen under a past timestamp. This is what
 *      every naive implementation does and it is the worst option — it states,
 *      with a clock next to it, that a thing was somewhere it was not.
 *   2. Dead-reckon backwards along the reported heading. A drawn position nobody
 *      measured, which this project refuses to do forwards too.
 *   3. Show the fixes we actually watched arrive, and nothing else.
 *
 * This is (3). Every poll is a measured national snapshot; keeping them lets a
 * scrub inside the session's own window replay real positions at the real times
 * they were reported. Outside that window the layer goes dark and the readout
 * says why, which is the same answer this project gives for a postal code with no
 * data.
 *
 * WHY A RING RATHER THAN "KEEP EVERYTHING". A snapshot can be hundreds or a
 * thousand records of a handful of fields, and a tab left open all day would
 * otherwise accumulate an unbounded pile of them. The two bounds below cap it —
 * on the order of a couple of megabytes for the trains, up to roughly ten for the
 * ~1,000-vessel ship set — rather than letting it grow without limit: thinning to
 * one snapshot per {@link TRACK_SPACING_MS} costs nothing a scrubber pixel can
 * resolve, and the window bounds the total. A feed that polls slower than the
 * spacing (the ships, at a minute) keeps every poll, and the window still holds.
 *
 * The type is generic because it says nothing about what a record IS — only that
 * a poll produced a set of them at an instant. `trainHistory.ts` binds it to
 * trains (and adds the measured-first resolution ladder a train needs); the ship
 * feed uses it directly.
 */

/** One poll's worth of measured records. */
export interface Snapshot<T> {
  /** When the snapshot was taken, ms since the epoch. */
  at: number;
  items: T[];
}

/** How far back the buffer reaches. */
export const TRACK_WINDOW_MS = 3_600_000;

/**
 * Minimum gap between retained snapshots.
 *
 * Not the poll interval — a feed may poll far more often so the LIVE view stays
 * current. This is how densely the past is kept, and 15 s is below what a
 * scrubber pixel can resolve: a 24-hour bar on a 1,200 px screen is 72 seconds
 * per pixel.
 */
export const TRACK_SPACING_MS = 15_000;

/**
 * How far a scrub may sit from a retained snapshot and still be answered by it.
 *
 * A shade over the spacing, so an ordinary gap always resolves; a longer gap —
 * the tab was hidden, the network dropped — does not, and the reader is told
 * there is no measurement for that moment instead of being shown the nearest one
 * under the wrong time.
 */
export const TRACK_TOLERANCE_MS = 20_000;

/**
 * Append a snapshot, thinning and trimming in place.
 *
 * Mutates and returns the same array: the caller holds it in a ref that the draw
 * loop reads at up to 60 Hz, and reallocating it once per poll would be churn for
 * nothing.
 */
export function recordSnapshot<T>(buffer: Snapshot<T>[], at: number, items: T[]): Snapshot<T>[] {
  const last = buffer[buffer.length - 1];
  // A clock that went backwards (a resumed laptop, an NTP step) would otherwise
  // leave the buffer unsorted, and every lookup below assumes it is ordered.
  if (last && at < last.at) buffer.length = 0;
  else if (last && at - last.at < TRACK_SPACING_MS) return buffer;

  buffer.push({ at, items });

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
export function snapshotAt<T>(
  buffer: Snapshot<T>[],
  at: number,
  toleranceMs: number = TRACK_TOLERANCE_MS,
): Snapshot<T> | null {
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

/** A contiguous stretch of retained snapshots. */
export interface Run {
  from: number;
  to: number;
}

/**
 * The CONTIGUOUS stretches the buffer actually covers, oldest first.
 *
 * NOT "oldest to newest", which would print as "Recorded 09:15–09:59." — one
 * sentence after telling the reader that nothing was recorded for an instant
 * inside that very span. The holes are not an edge case: polling deliberately
 * stops while the tab is hidden, so every visit that involves switching tabs for
 * a few minutes produces one, and `snapshotAt` correctly refuses the middle of
 * it.
 *
 * A gap is a step longer than TWICE the tolerance `snapshotAt` answers within,
 * and the factor of two is the whole definition rather than a fudge: the worst an
 * instant between two snapshots can do is land at their midpoint, so every
 * instant between them is answerable exactly when their separation is at most
 * 2 × tolerance. That makes the sentence this feeds true as written — inside a
 * run reported here, every instant has a snapshot the page will actually use.
 *
 * The tolerance is a PARAMETER because it is set by the feed's poll interval, not
 * by this module: the trains poll every 5 s and resolve within 20 s, but the ship
 * feed polls once a minute, so its ordinary 60 s gap would read as a fresh run on
 * every step — and `snapshotAt`, asked with the default 20 s, would refuse every
 * instant more than 20 s from a snapshot, blanking most of a continuous
 * recording. A feed must pass the SAME tolerance here that it passes to
 * `snapshotAt`, or the two disagree about what "recorded" means.
 */
export function trackedRuns<T>(
  buffer: Snapshot<T>[],
  toleranceMs: number = TRACK_TOLERANCE_MS,
): Run[] {
  if (buffer.length === 0) return [];
  const runs: Run[] = [];
  let from = buffer[0].at;
  for (let i = 1; i < buffer.length; i++) {
    if (buffer[i].at - buffer[i - 1].at > 2 * toleranceMs) {
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
export function nearestRun<T>(
  buffer: Snapshot<T>[],
  at: number,
  toleranceMs: number = TRACK_TOLERANCE_MS,
): { from: number; to: number; runs: number } | null {
  const runs = trackedRuns(buffer, toleranceMs);
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
