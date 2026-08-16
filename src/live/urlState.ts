/**
 * /live/'s place, instant and feed set, carried in the address bar.
 *
 * WHY THIS PAGE SYNCS THE CAMERA AND THE MAIN MAP DELIBERATELY DOES NOT.
 * `useUrlState.ts` refuses to write the viewport on every pan — "continuous
 * panning would churn replaceState" — and offers an explicit "copy link to this
 * view" button instead. That is right there and wrong here, because the two
 * pages carry their state in different places. On the main map the thing being
 * looked at is a postal code, and `?pno=00100` already names it; the camera is
 * decoration around a selection the URL holds. On /live/ there is no selection.
 * The camera IS the subject — this page is a claim about where a shadow falls at
 * one spot at one minute, and a link that drops the spot and the minute has
 * dropped the entire content. A page whose whole output is "here, now" that
 * cannot say which here or which now is not shareable at all.
 *
 * So the address bar is the share affordance, as it is on every map application
 * people already know, and the churn objection is answered by WHEN rather than
 * whether: the camera is written on `moveend`, once per gesture after the motion
 * settles, not per frame.
 *
 * THE CLOCK IS WRITTEN ONLY WHEN IT HAS BEEN MOVED, and that is the honest
 * encoding rather than a saving. This page has two clock states and they mean
 * different things (see timeControl.ts): following real time, or pinned to an
 * instant somebody chose. Stamping `t=` while the page is live would mint links
 * that say "18:42" when what the sender was looking at was "now" — the reader
 * would open a frozen page and believe they were watching what the sender
 * watched. Absent `t` means live, present `t` means pinned, which is exactly the
 * distinction the page makes everywhere else.
 *
 * The camera also falls back to localStorage, for the case the URL cannot cover:
 * a bare `/live/` typed or bookmarked. Before this, every visit opened over
 * Helsinki and getting to your own street meant panning across the country
 * again, which is a strange thing to ask of a page about your own building.
 * Precedence is URL, then the last camera this browser was left at, then
 * Helsinki.
 */

/** A camera: where the map is looking and how close. */
export interface LiveView {
  center: [number, number];
  zoom: number;
}

export interface LiveUrlState {
  /** The camera from `at=`, or null when the link does not carry one. */
  view: LiveView | null;
  /** The pinned instant from `t=`, or null when the link means "now". */
  when: Date | null;
  /**
   * The feed ids from `f=`, or null when the link does not carry the key.
   *
   * Null and the empty set are different answers and both are reachable: a link
   * without `f` says nothing about feeds and leaves this browser's own toggles
   * alone, while `f=` says every feed is off, which is a view somebody chose and
   * may well be the point of the link (bare relief, or just the trains).
   */
  feeds: string[] | null;
}

const VIEW_KEY = 'at';
const TIME_KEY = 't';
const FEEDS_KEY = 'f';

/** localStorage key holding the last camera, for a bare `/live/`. */
export const VIEW_STORAGE_KEY = 'live.view';

/**
 * Coordinate precision in the URL, in decimal places.
 *
 * Five places is about a metre at this latitude — finer than the buildings the
 * page draws, and far finer than anyone can point a map at. The zoom gets two,
 * which is well under the ~0.15 steps a scroll wheel produces.
 */
const COORD_DP = 5;
const ZOOM_DP = 2;

/** MapLibre's own zoom range. A link outside it would be silently clamped. */
const MIN_ZOOM = 0;
const MAX_ZOOM = 22;

function finite(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * `at=lat,lon,zoom`, in that order.
 *
 * LATITUDE FIRST, though everything inside this codebase passes `[lng, lat]`.
 * The URL is read by people — pasted into chats, compared by eye against a
 * coordinate off a phone or out of Google Maps — and every one of those writes
 * latitude first. The flip happens here, once, at the boundary.
 */
function parseView(raw: string | null): LiveView | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length !== 3) return null;
  // `Number('')` and `Number(' ')` are both 0, not NaN — so an `at=,,` or a
  // truncated paste would otherwise parse as a perfectly valid camera pointing
  // at Null Island from orbit, and the page would open there rather than
  // ignoring the broken link and going where it was already going.
  if (parts.some((p) => p.trim() === '')) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  const zoom = Number(parts[2]);
  if (!finite(lat) || !finite(lon) || !finite(zoom)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) return null;
  return { center: [lon, lat], zoom };
}

export function formatView(view: LiveView): string {
  const [lon, lat] = view.center;
  return `${lat.toFixed(COORD_DP)},${lon.toFixed(COORD_DP)},${view.zoom.toFixed(ZOOM_DP)}`;
}

/**
 * `t=2026-08-16T15:42Z` — UTC, to the minute.
 *
 * UTC RATHER THAN LOCAL TIME, even though every clock this page shows is
 * Finnish local. A local stamp would need its offset to be unambiguous, and the
 * offset's `+` is a literal space in a query string — `t=2026-08-16T18:42+03:00`
 * arrives as `18:42 03:00` and parses as garbage, or worse, as a plausible wrong
 * hour. The `Z` form has no character that survives a round trip changed.
 *
 * To the minute because that is the clock's own resolution: `atMinuteOfDay`
 * rounds, so seconds in a link would be precision the page never had.
 */
function parseWhen(raw: string | null): Date | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(raw)) return null;
  const ms = Date.parse(raw);
  if (!finite(ms)) return null;
  return new Date(ms);
}

export function formatWhen(when: Date): string {
  const ms = when.getTime();
  if (!finite(ms)) return '';
  // Truncated rather than rounded: `toISOString` gives
  // `2026-08-16T15:42:37.123Z`, and the first 16 characters are the minute the
  // clock is actually on. Rounding up would move the link a minute past the
  // instant the sender was looking at.
  return `${when.toISOString().slice(0, 16)}Z`;
}

/**
 * Read /live/'s state out of a query string.
 *
 * Every field is independently optional and independently validated: a link
 * with a corrupt camera and a good clock keeps the clock. Nothing here throws —
 * a malformed link is a link that carries less, never a page that fails to open.
 */
export function parseLiveUrl(search: string): LiveUrlState {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { view: null, when: null, feeds: null };
  }
  const rawFeeds = params.get(FEEDS_KEY);
  return {
    view: parseView(params.get(VIEW_KEY)),
    when: parseWhen(params.get(TIME_KEY)),
    feeds:
      rawFeeds === null
        ? null
        : rawFeeds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
  };
}

/**
 * Build the query string for a state, preserving any params we do not own.
 *
 * The page is reachable with `?lang=en` and whatever a campaign or a referrer
 * appended, and a sync that rewrote the whole query would quietly delete them on
 * the first pan.
 */
export function buildLiveSearch(
  current: string,
  state: { view: LiveView | null; when: Date | null; feeds: string[] | null },
): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(current);
  } catch {
    params = new URLSearchParams();
  }

  if (state.view) params.set(VIEW_KEY, formatView(state.view));
  else params.delete(VIEW_KEY);

  // Absent, not empty: see the header. `t` is present exactly when the clock has
  // been moved off real time.
  if (state.when) params.set(TIME_KEY, formatWhen(state.when));
  else params.delete(TIME_KEY);

  if (state.feeds) params.set(FEEDS_KEY, state.feeds.join(','));
  else params.delete(FEEDS_KEY);

  const str = readableQuery(params.toString());
  return str ? `?${str}` : '';
}

/**
 * Put the commas and colons back.
 *
 * `URLSearchParams.toString()` percent-encodes both, so a camera comes out as
 * `at=60.16990%2C24.93840%2C15.50` and an instant as `t=2026-08-16T15%3A42Z`.
 * Both characters are legal unescaped in a query string (RFC 3986 lists `,` as
 * a sub-delim and permits `:` outright), every browser displays them decoded,
 * and `URLSearchParams` reads them back identically either way — so the only
 * thing the encoding buys is an unreadable link.
 *
 * That matters more here than it would elsewhere: this page has no "copy link"
 * button because the address bar IS the share affordance, so the string a
 * person selects and pastes into a message is this one. A coordinate they can
 * read at a glance is the difference between a link and a barcode.
 */
export function readableQuery(str: string): string {
  return str.replace(/%2C/g, ',').replace(/%3A/g, ':');
}

/** The last camera this browser was left at, for a `/live/` with no `at=`. */
export function readStoredView(): LiveView | null {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    return parseView(raw);
  } catch {
    return null;
  }
}

export function writeStoredView(view: LiveView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, formatView(view));
  } catch {
    /* private mode — the URL still carries the camera for this session */
  }
}
