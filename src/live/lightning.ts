/**
 * Lightning strikes for /live/, from the Finnish Meteorological Institute.
 *
 * Source: FMI open data WFS, CC BY 4.0, no API key —
 * `fmi::observations::lightning::multipointcoverage`, the located-flash feed from
 * the Nordic detection network. Every record is one flash somebody's sensors
 * triangulated, with its own second and its own coordinates. That is what makes
 * it the first feed on this page whose data is EVENTS rather than the state of a
 * station: temperature, air quality and train positions all answer "what was
 * this thing doing at T", and this one answers "what happened between T0 and T1".
 * The clock therefore reads it as a trailing window rather than as a sample (see
 * {@link STRIKE_WINDOW_MS}), and nothing here is ever interpolated — a flash
 * either happened in the window or it did not.
 *
 * WHY `multipointcoverage` HERE, WHEN observations.ts CHOSE `simple`. That file
 * measured the two encodings against each other and found the verbose one wins
 * over the wire, because gzip eats repetition. The ratio INVERTS for event data,
 * and by two decimal orders. Measured against the live service on 2026-08-17,
 * the same 24 h of Finnish strikes:
 *
 *   multipointcoverage   1.5 MB raw   ->  387 kB gzipped
 *   simple              75.6 MB raw   ->  2.0 MB gzipped
 *
 * The reason is that `simple` emits a complete GML element — id, point, srsName,
 * time, parameter name — PER PARAMETER PER FLASH, so 40,000 flashes become
 * 160,000 elements, and the repetition gzip is eating is repetition this feed
 * did not have to send. The coverage encoding sends two blocks of bare numbers.
 * Anyone re-reading observations.ts's note should read this one beside it: the
 * conclusion there is right for a couple of hundred stations and wrong here.
 *
 * WHAT A DAY ACTUALLY COSTS, measured over the ten days to 2026-08-17 — peak
 * thunderstorm season in Finland, so this is the expensive end of the year:
 *
 *   16 Aug   46,563 strikes   477 kB      11 Aug    1,612 strikes    20 kB
 *   15 Aug    7,273 strikes    75 kB      10 Aug      144 strikes   3.4 kB
 *   14 Aug        0 strikes   554 B        9 Aug      902 strikes    12 kB
 *   13 Aug        0 strikes   554 B        8 Aug       65 strikes   2.5 kB
 *   12 Aug      608 strikes   8.6 kB       7 Aug    1,087 strikes    15 kB
 *
 * The median day is ~10 kB, which is the same class as the temperature day
 * (20 kB) and the air quality day (19 kB), and a winter day is half a kilobyte.
 * The 477 kB day is the tail, and it is the reason this feed is `defaultOn:
 * false`: nobody pays it who has not asked for lightning. It buys the whole day
 * at once, which is what lets the slider stay a local operation on the busiest
 * day of the year rather than becoming a request per drag.
 *
 * THE THREE TRAPS, all of them shared with the rest of FMI's WFS and one of them
 * new here:
 *
 *  - COORDINATES ARE LATITUDE FIRST. The multipoint is `srsName=...EPSG/0/4258`,
 *    ETRS89 in its authority-defined axis order, exactly like the `simple`
 *    responses fmi.ts parses. Read lon/lat, and every Finnish flash lands in the
 *    Indian Ocean without anything complaining.
 *
 *  - THE THIRD NUMBER IN A POSITION IS A UNIX SECOND, not an altitude. The
 *    envelope declares a compound CRS — `compoundCRS.php?crs=4258&time=unixtime`
 *    — so each position row is `lat lon epochSeconds`. This is the one trap that
 *    does not exist in the `simple` responses, where the time is its own element.
 *
 *  - A MALFORMED RESPONSE DOES NOT THROW. `DOMParser` answers with a document
 *    containing `<parsererror>`, so an unchecked parse reads a truncated response
 *    as a quiet sky. An EMPTY one is different and must not be confused with it:
 *    FMI answers a strike-free window with a bare `FeatureCollection` carrying
 *    `numberReturned="0"` and no coverage at all, and that is a real answer —
 *    "nothing struck Finland in this window" — which most Finnish days are.
 *
 * WHAT `cloud_indicator` MEANS, and how that was established rather than assumed.
 * FMI's parameter metadata calls it "Lightning type indicator" and stops there,
 * so the encoding was corroborated against the data itself over the 39,755
 * strikes of 16–17 August 2026:
 *
 *                      count   multiplicity        median |I|   negative
 *   cloud_indicator 0   7,145   0..7+, spread         12 kA        89 %
 *   cloud_indicator 1  33,075   exactly 1, always      5 kA        27 %
 *
 * Those are the textbook signatures. A cloud-to-ground flash is a sequence of
 * return strokes down the same channel, so its multiplicity varies and is the
 * whole reason the field exists; about 90 % of them are negative. A cloud flash
 * has no return strokes to count (reported as 1), is weaker, and has no polarity
 * preference. So 0 is a GROUND flash and 1 is a CLOUD flash — and the ratio,
 * 82 % cloud, is the usual one. This matters because it is the distinction worth
 * drawing: a ground flash is the one that hits something.
 */
import { FMI_BBOX, fmiSeriesUrl } from './fmi';

/** One located flash. */
export interface Strike {
  lon: number;
  lat: number;
  /** When it struck, ms since the epoch. FMI publishes to the second. */
  at: number;
  /**
   * Peak current in kiloamps, signed — negative is the ordinary polarity for a
   * ground flash. Null when the network located the flash but published no
   * current for it, which is a gap rather than a zero.
   */
  kiloamps: number | null;
  /** True for a cloud-to-ground flash, false for a cloud flash. */
  ground: boolean;
}

const STORED_QUERY = 'fmi::observations::lightning::multipointcoverage';

/**
 * The two fields worth asking for, of the four the query can send.
 *
 * `multiplicity` and `ellipse_major` are dropped, and the saving is real but
 * small: 387 kB -> 340 kB gzipped over the same day, because the positions block
 * is the bulk and the tuple list is the rest. They are dropped because nothing
 * on the page would show them, not to save the 12 % — a number downloaded and
 * never displayed is just weight.
 */
const PARAMETERS = 'peak_current,cloud_indicator';

/**
 * How long a strike stays on the map, in ms.
 *
 * THE WINDOW IS THE FEED, which is what makes this different from every other
 * measured layer here. A station has a value at any instant you ask; a flash
 * lasts a fraction of a second, so a map of "lightning at 14:23:07" is empty
 * essentially always and would say nothing about the storm that is standing over
 * Kuopio. Half an hour of them is a picture of where the cells are and which way
 * they are moving — and it is a picture made only of measured events, each drawn
 * at the place and second it was recorded.
 *
 * The readout states this window in words for the same reason the feed registry
 * states coverage: it is a property of what is drawn, and the reader finds out
 * here or is misled. Thirty minutes rather than an hour because the busiest
 * half-hour of the busiest day of the 2026 season held 3,269 strikes against
 * 6,227 for the busiest hour, and past a few thousand marks the cells stop being
 * separable from each other.
 */
export const STRIKE_WINDOW_MS = 30 * 60_000;

/** The same figure in minutes, because the readout says it in words. */
export const STRIKE_WINDOW_MINUTES = STRIKE_WINDOW_MS / 60_000;

/**
 * How often we ask, in ms.
 *
 * The network publishes within seconds of a flash, and a minute of a national
 * storm is ~150 strikes at the observed peak — a couple of kilobytes. Faster
 * would be asking a free public service for an answer that has barely changed;
 * slower would put a visible lag into the one feed on the page whose whole
 * subject is that something just happened.
 */
export const LIGHTNING_POLL_MS = 60_000;

/** The request URL for a window. Exported so a test can read it. */
export function lightningUrl(fromMs: number, toMs: number): string {
  return fmiSeriesUrl(STORED_QUERY, PARAMETERS, fromMs, toMs);
}

/** Read a `<swe:DataRecord>`'s field names, in the order the tuples use them. */
function fieldNames(doc: Document): string[] {
  const record = doc.getElementsByTagNameNS('*', 'DataRecord')[0];
  if (!record) return [];
  const fields = record.getElementsByTagNameNS('*', 'field');
  const names: string[] = [];
  for (let i = 0; i < fields.length; i++) names.push(fields[i].getAttribute('name') ?? '');
  return names;
}

/**
 * Parse a lightning coverage response into located flashes, oldest first.
 *
 * THE FIELD ORDER IS READ, NOT ASSUMED. The tuple list is bare numbers whose
 * meaning lives entirely in the `<swe:field>` names beside it, and the two things
 * this feed draws are a POLARITY and a TYPE — swap them and the map states that
 * every flash hit the ground with a current of 0 or 1 kA, confidently and
 * silently. Reading the names costs one pass over four elements.
 *
 * A ROW-COUNT MISMATCH IS FATAL, for the same reason. The two blocks are joined
 * by index alone: if they disagree, every current after the seam belongs to a
 * different flash than the one it is drawn on, which is a fabricated measurement
 * wearing a real one's coordinates. There is no partial answer worth keeping, so
 * this throws and the readout says the feed failed.
 *
 * Takes text rather than a Response so the whole thing is testable without a
 * network, exactly like fmi.ts.
 */
export function parseLightning(xml: string): Strike[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('FMI lightning: response was not parseable XML');
  }
  if (doc.getElementsByTagNameNS('*', 'FeatureCollection').length === 0) {
    throw new Error('FMI lightning: not a WFS FeatureCollection');
  }

  const positionsEl = doc.getElementsByTagNameNS('*', 'positions')[0];
  // A strike-free window is a bare FeatureCollection with no coverage in it, and
  // that is an answer rather than a failure — most Finnish days are exactly this.
  if (!positionsEl) return [];

  const tuplesEl = doc.getElementsByTagNameNS('*', 'doubleOrNilReasonTupleList')[0];
  if (!tuplesEl) throw new Error('FMI lightning: coverage carried positions but no values');

  const positions = (positionsEl.textContent ?? '').trim().split(/\s+/).filter(Boolean);
  const values = (tuplesEl.textContent ?? '').trim().split(/\s+/).filter(Boolean);

  const names = fieldNames(doc);
  const currentAt = names.indexOf('peak_current');
  const groundAt = names.indexOf('cloud_indicator');
  if (names.length === 0 || currentAt < 0 || groundAt < 0) {
    throw new Error('FMI lightning: response did not describe its own fields');
  }

  const rows = positions.length / 3;
  if (!Number.isInteger(rows) || values.length !== rows * names.length) {
    throw new Error('FMI lightning: positions and values disagree about how many strikes');
  }

  const out: Strike[] = [];
  for (let i = 0; i < rows; i++) {
    // LATITUDE FIRST, and the third number is a Unix second — see the file header.
    const lat = Number(positions[i * 3]);
    const lon = Number(positions[i * 3 + 1]);
    const seconds = Number(positions[i * 3 + 2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(seconds)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    // The mark IS the type, so a flash whose type is not one of the two published
    // values cannot be drawn without inventing which kind it was.
    const indicator = Number(values[i * names.length + groundAt]);
    if (indicator !== 0 && indicator !== 1) continue;

    // A missing current is a gap, not a zero: `Number('')` is 0 and `NaN` is a
    // value FMI does send, and either one would print "0 kA" in the panel as
    // though the network had measured a flash carrying no current.
    const current = Number(values[i * names.length + currentAt]);

    out.push({
      lon,
      lat,
      at: seconds * 1000,
      kiloamps: Number.isFinite(current) ? current : null,
      ground: indicator === 0,
    });
  }

  return out;
}

/**
 * Every located flash in a window over Finland.
 *
 * Throws rather than returning an empty list on a bad response, for the reason
 * every feed on this page does — and here the two are especially easy to confuse,
 * because a quiet sky is the common case and looks identical on the map.
 */
export async function fetchLightning(
  fromMs: number,
  toMs: number,
  signal?: AbortSignal,
): Promise<Strike[]> {
  const res = await fetch(lightningUrl(fromMs, toMs), { signal });
  if (!res.ok) throw new Error(`FMI lightning responded ${res.status}`);
  return parseLightning(await res.text());
}

/** Finland plus a margin — the bbox every request here is scoped to. */
export const LIGHTNING_BBOX = FMI_BBOX;

/** Identity for a flash, for the poll's overlap. Second, position, polarity. */
const strikeKey = (s: Strike) => `${s.at}|${s.lat}|${s.lon}|${s.kiloamps ?? ''}`;

/**
 * Append a freshly polled window to the strikes already held.
 *
 * THE RESULT STAYS SORTED WITHOUT SORTING, and the caller's fetch window is what
 * guarantees it: the poll asks from the newest instant already held, so every
 * flash it can return is at or after every flash already in the list, and a
 * concatenation of two ascending runs joined at that boundary is ascending. That
 * matters because the list reaches 46,000 entries on a storm day and the binary
 * search in {@link strikesIn} runs inside the draw loop.
 *
 * THE OVERLAP IS DEDUPLICATED RATHER THAN TRIMMED. FMI's window is inclusive at
 * both ends and its resolution is one second, and the observed peak is 151
 * strikes in a minute — so several flashes routinely share the boundary second,
 * and "keep only what is strictly newer" would drop the ones that arrived in the
 * same second as the last flash of the previous poll. Comparing the boundary
 * second's flashes by identity keeps them all exactly once.
 */
export function mergeStrikes(held: Strike[], polled: Strike[]): Strike[] {
  if (polled.length === 0) return held;
  if (held.length === 0) return polled;

  const boundary = held[held.length - 1].at;
  const seen = new Set<string>();
  for (let i = held.length - 1; i >= 0 && held[i].at === boundary; i--) seen.add(strikeKey(held[i]));

  const out = held.slice();
  for (const s of polled) {
    if (s.at < boundary) continue;
    if (s.at === boundary && seen.has(strikeKey(s))) continue;
    out.push(s);
  }
  return out;
}

/** Index of the first strike at or after `at`, in an ascending list. */
function lowerBound(list: Strike[], at: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].at < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The flashes in `[fromMs, toMs]`, in order.
 *
 * The hot path — it runs once per repaint over a list that is a whole day long —
 * so it is a binary search to the start of the window and a walk to the end of
 * it, which touches the few thousand marks actually drawn rather than the day.
 */
export function strikesIn(list: Strike[], fromMs: number, toMs: number): Strike[] {
  const out: Strike[] = [];
  for (let i = lowerBound(list, fromMs); i < list.length && list[i].at <= toMs; i++) {
    out.push(list[i]);
  }
  return out;
}

/** The newest instant held, or null while empty — where the next poll starts. */
export function newestStrikeAt(list: Strike[]): number | null {
  return list.length > 0 ? list[list.length - 1].at : null;
}
