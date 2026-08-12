/**
 * The /live/ page's clock: the one instant every layer answers for.
 *
 * The page used to have a time slider that moved the SUN and nothing else. That
 * was defensible while the sun was the only feed — astronomy is exact at any
 * instant, so scrubbing it is free and always honest. It stopped being
 * defensible the moment trains, temperatures, air quality and road
 * announcements appeared on the same canvas: the shadows would jump to 03:00
 * while the trains stayed where they are right now, and nothing on screen said
 * that the picture was a composite of two different times.
 *
 * So the instant is now the page's, not the sun's, and every feed has to declare
 * what it can honestly say about it. That declaration is {@link FeedTimeModel}
 * in feeds.ts, and the four answers are genuinely different:
 *
 *   computed  — exact at any instant, past or future (the sun).
 *   archive   — the SOURCE holds measured history and will serve it (FMI's WFS
 *               takes starttime/endtime and answers for any past window).
 *   recorded  — only what THIS SESSION watched. The train feed publishes the
 *               latest fix and nothing else, so its past is whatever we kept.
 *   validity  — the records carry their own from/to, so "in effect at T" is a
 *               question the publisher already answered.
 *
 * What is deliberately absent is a fifth answer that guesses. No feed
 * interpolates between fixes, extrapolates a trend, or renders a modelled value
 * as if it were measured — a scrub into a time a feed cannot speak for turns
 * that feed OFF and says so, which is the same rule the rest of this project
 * applies to a postal code with no data.
 */
import { solarFrame, frameAltitude } from '../utils/sun';

export const MINUTES_PER_DAY = 1440;
export const MS_PER_MINUTE = 60_000;

/** Local midnight beginning the day that contains `date`. */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Minutes since local midnight, fractional — the scrubber's coordinate. */
export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

/** The same calendar day as `date`, at `minutes` past local midnight. */
export function atMinuteOfDay(date: Date, minutes: number): Date {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, minutes));
  const d = startOfDay(date);
  d.setMinutes(Math.round(clamped));
  return d;
}

/** `date` shifted by whole days, keeping the time of day. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** `YYYY-MM-DD` in LOCAL time — what a `<input type="date">` and the rail API want. */
export function isoDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * Round an instant down to a step, in ms.
 *
 * The archive feeds are keyed on this rather than on the raw scrubber value, and
 * the reason is not politeness — it is that a pointer drag produces an instant
 * per pixel. Keying a network request on that asks FMI for ~600 windows during
 * one sweep of the bar, all but the last of them already superseded. Five
 * minutes is finer than the ten-minute cycle most stations publish on, so the
 * quantisation cannot cost the reader a reading that exists.
 */
export function quantise(ms: number, stepMs: number): number {
  return Math.floor(ms / stepMs) * stepMs;
}

/**
 * How far in the future an instant may be and still count as "now".
 *
 * A live page's clock and a source's clock are never exactly aligned, and the
 * scrubber itself lands on whole minutes, so a strict `t > Date.now()` test
 * flickers a feed into its "no measurements exist yet" state every time the
 * user drags onto the current minute. One minute of slack is far below the
 * publishing interval of every feed here.
 */
export const FUTURE_SLACK_MS = 60_000;

export function isFuture(ms: number, now: number = Date.now()): boolean {
  return ms > now + FUTURE_SLACK_MS;
}

/* ----------------------------------------------------------------- clocks */

/**
 * The formatters, built once each.
 *
 * `Date.prototype.toLocaleTimeString` constructs a fresh `Intl.DateTimeFormat`
 * per call, and that construction — not the formatting — is the expensive part.
 * The bottom bar formats several times per render and re-renders on every step
 * of the scrubber, where this measured at 3 % of total profile time before it
 * was hoisted: more than the shadow sweep it sits next to.
 *
 * Lazily built rather than at module scope so they pick up the environment's
 * locale at first use rather than at import, and cost nothing on the pages that
 * never mount /live/.
 */
let hm: Intl.DateTimeFormat | null = null;
let hms: Intl.DateTimeFormat | null = null;
let dayFmt: Intl.DateTimeFormat | null = null;
let hourFmt: Intl.DateTimeFormat | null = null;

/** Local wall-clock "HH:MM" for an instant, in the viewer's own zone. */
export function clockTime(date: Date | number | null): string {
  if (date === null) return '—';
  hm ??= new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  return hm.format(date);
}

/**
 * "HH:MM:SS", for the times a measurement was actually taken.
 *
 * Seconds are not decoration here. A train fix is timestamped to the second and
 * they arrive about five seconds apart, so "measured at 08:45" would present
 * twelve distinct measurements as one — and the whole point of the panel is to
 * say which instant the dot on the map belongs to.
 */
export function clockSeconds(date: Date | number | null): string {
  if (date === null) return '—';
  hms ??= new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return hms.format(date);
}

/** A short date, e.g. "Aug 12" / "12. elok." — the date chip's label. */
export function shortDate(date: Date): string {
  dayFmt ??= new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return dayFmt.format(date);
}

/** An hour label for the ruler: "3 AM" or "03", per the viewer's locale. */
export function hourLabel(date: Date): string {
  hourFmt ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
  return hourFmt.format(date);
}

/**
 * The shadow-length multiplier, formatted so it cannot run away.
 *
 * It is cot(altitude), which is unbounded: at 0.1° above the horizon a building
 * casts 573 times its height, and the figure keeps climbing right up to sunset.
 * Printing it verbatim is both useless — nobody needs three significant figures
 * of "very long" — and a layout hazard, because no reserved width can hold it.
 * Past 99 it becomes ">99", which says the same thing in a fixed width.
 */
export function formatShadowRatio(ratio: number | null): string {
  if (ratio === null) return '—';
  if (ratio > 99) return '>99×';
  return `${ratio.toFixed(1)}×`;
}

/** Eight-point compass letters for an azimuth, so 99.7° also reads as "E". */
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compassPoint(azimuthDeg: number): string {
  return COMPASS[Math.round(((azimuthDeg % 360) + 360) % 360 / 45) % 8];
}

/* ------------------------------------------------------------------ sky ramp */

/**
 * Sky colour against solar altitude, as the twilight ribbon paints it.
 *
 * This is a RAMP OVER A MEASURED QUANTITY, not a decorative gradient with a
 * sunrise guessed into the middle of it. Every pixel of the ribbon is the
 * colour of the sun's actual altitude at that minute, at the place the map is
 * looking at — so the band narrows as you pan north in October and widens in
 * June, polar night renders as an unbroken dark bar, and the midnight sun never
 * dips. A hand-placed "sunrise at 30 %" would be a drawing of a day rather than
 * a picture of this one.
 *
 * The stops are the conventional twilight boundaries — −18° astronomical, −12°
 * nautical, −6° civil, −0.833° the refracted horizon, +6° the golden hour — so
 * the colour changes where the almanac says the sky changes.
 */
const SKY: [number, number, number, number][] = [
  [-18, 6, 10, 26],
  [-12, 15, 26, 66],
  [-6, 45, 49, 110],
  [-3, 104, 63, 122],
  [-0.833, 226, 96, 60],
  [0, 240, 134, 58],
  [3, 248, 168, 62],
  [6, 251, 196, 74],
  [12, 253, 217, 122],
  [25, 255, 233, 168],
  [60, 255, 244, 207],
];

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** `#rrggbb` for a solar altitude in degrees. */
export function skyColor(altitudeDeg: number): string {
  let i = 0;
  while (i < SKY.length - 1 && altitudeDeg > SKY[i + 1][0]) i++;
  const a = SKY[i];
  const b = SKY[Math.min(i + 1, SKY.length - 1)];
  const span = b[0] - a[0];
  const f = span > 0 ? Math.max(0, Math.min(1, (altitudeDeg - a[0]) / span)) : 0;
  const mix = (j: number) => Math.round(a[j] + (b[j] - a[j]) * f);
  return `#${hex2(mix(1))}${hex2(mix(2))}${hex2(mix(3))}`;
}

/**
 * How often the ribbon samples the sun, in minutes.
 *
 * Twilight is the fast part: at Helsinki's latitude in March the sun climbs the
 * 5.2° from civil dawn to sunrise in about half an hour, which is 2 % of the
 * bar. Eight minutes puts four samples across that, and CSS interpolates
 * between them — while the flat runs either side collapse to two stops each in
 * {@link skyStops}, so the sample rate costs nothing where nothing happens.
 */
const SKY_SAMPLE_MINUTES = 8;

/**
 * The ribbon for one day at one place, as CSS `linear-gradient` colour stops.
 *
 * Flat runs are collapsed to their two endpoints — a stop is kept only when its
 * colour differs from the previous or the next sample — which turns 180 samples
 * into roughly 40 stops on an ordinary day and into 2 during polar night,
 * without changing a single rendered pixel: CSS interpolates linearly between
 * consecutive stops, so dropping the interior of a constant-colour run is
 * exact.
 */
export function skyStops(dayStart: Date, lat: number, lon: number): string {
  const n = Math.floor(MINUTES_PER_DAY / SKY_SAMPLE_MINUTES);
  const colors: string[] = [];
  const base = dayStart.getTime();
  for (let i = 0; i <= n; i++) {
    const frame = solarFrame(new Date(base + i * SKY_SAMPLE_MINUTES * MS_PER_MINUTE));
    colors.push(skyColor(frameAltitude(frame, lat, lon)));
  }

  const out: string[] = [];
  for (let i = 0; i <= n; i++) {
    if (i > 0 && i < n && colors[i] === colors[i - 1] && colors[i] === colors[i + 1]) continue;
    out.push(`${colors[i]} ${((i / n) * 100).toFixed(2)}%`);
  }
  return out.join(', ');
}
