/**
 * Weather radar for /live/, from the Finnish Meteorological Institute.
 *
 * Source: FMI's open WMS (`openwms.fmi.fi/geoserver/Radar`), CC BY 4.0, no API
 * key, `Access-Control-Allow-Origin: *` on both GetCapabilities and GetMap. The
 * layer is `suomi_dbz_eureffin` — the national composite of Finland's ten
 * weather radars, published every five minutes with about seven days of history
 * behind it (the capabilities document states the window: measured on
 * 2026-08-18 it read `2026-08-11T07:00Z/2026-08-18T06:55Z/PT5M`).
 *
 * THE FIRST RASTER FEED ON THIS PAGE, which changes two things about how it
 * answers the clock.
 *
 * 1. IT CANNOT LOAD ITS DAY UP FRONT. Every other measured feed here fetches the
 *    whole day once and samples it locally, because a national day of station
 *    readings is ~20 kB (see timeline.ts, and the invariant it is written under:
 *    "the time slider is not a request"). A day of radar is 288 images and about
 *    25 MB, so this one genuinely is a request per instant it has not already
 *    seen. What it is NOT is a request per instant the clock lands on — the
 *    frames it has decoded stay decoded, in {@link RadarReel}, and the clock
 *    picks from them exactly the way `sampleTimeline` picks from a loaded day.
 *    That reel is what makes a scrub track the playhead instead of waiting for
 *    it to stop; see its own docstring for the sums.
 *
 * 2. IT HAS NO VALUE TO DROP. A station outside tolerance is left off the map;
 *    a raster is all-or-nothing, so the tolerance is applied to the FRAME: if
 *    the newest composite at or before the playhead is more than
 *    {@link RADAR_TOLERANCE_MS} old, nothing is drawn and the readout says why.
 *    That is the same rule the temperature layer applies per station, moved up
 *    a level because the data is.
 *
 * NOTHING IS BLENDED, EVER. The reel holds a dozen consecutive composites and
 * the obvious next move — cross-fading between the two either side of the
 * playhead — is the one thing forbidden here: it would draw a rain field nobody
 * measured, which is feed invariant 8 (no interpolation between fixes of a
 * measured quantity) applied to pixels. The reel makes the layer RESPONSIVE. It
 * does not widen what may be shown by a single frame.
 *
 * THE GREY WASH IS THE PUBLISHER'S, AND IT IS DATA. FMI's own style paints
 * everything outside the radars' range as a faint grey — measured at
 * `rgba(204,204,204,0.2)` — while ground inside the range with no echo is fully
 * transparent. So the image already draws this project's own distinction
 * between "no rain" and "we cannot see", and it is kept rather than filtered
 * out: over the Baltic, northern Norway and the Russian side, that wash is the
 * edge of what the network measures. The readout names it, because a haze
 * nobody explained reads as a rendering fault.
 *
 * REFLECTIVITY, NOT MILLIMETRES. `suomi_dbz_eureffin` is the dBZ composite and
 * `suomi_rr_eureffin` the rain-rate one; they were compared frame for frame and
 * the dBZ product is the one drawn, because its style ramps ALPHA with
 * intensity (light echo is faint, a core is opaque) where the rain-rate style
 * has three alphas and nothing between them. On a page that draws everything
 * over a basemap, a product that fades where the signal is weak is the one that
 * stays a map. The value is not printed as a number anywhere, so the unit never
 * has to be explained: colour carries it, which is the same call the air quality
 * feed makes for its index.
 *
 * THE FORECAST HALF IS NOT FMI'S, AND THAT IS THE SOURCE'S DOING. FMI's open WMS
 * carries three workspaces — `Radar`, `Basemaps`, `silva` — and all 116 of their
 * time-dimensioned layers end at the present minute; asking `suomi_dbz_eureffin`
 * for an instant an hour ahead answers `InvalidDimensionValue`, the same as
 * asking it for next year. On the WFS side the string "nowcast" does not occur
 * in any of the 160 stored query ids, and the forecast GRID queries resolve to
 * `opendata.fmi.fi/download`, which serves GRIB2 with no
 * `Access-Control-Allow-Origin` header at all — unreadable from a static site
 * whatever the format. So there is no FMI rain forecast a browser can draw.
 *
 * There is a publisher's one, and it comes from the same radars: MET Norway's
 * Nordic nowcast, whose mosaic lists all eleven FMI sites among its nodes. That
 * is nowcast.ts, and it fills the same reel with the same kind of frame — see
 * {@link RadarFrame.forecast}. What this file does NOT do, and must never do, is
 * extrapolate FMI's own composite: advecting a measured picture forward is a
 * model, and a model we wrote is exactly the thing this project will not draw.
 */
import { bboxContains, lonLatToMercator, type Bbox } from './shadows';

const ENDPOINT = 'https://openwms.fmi.fi/geoserver/Radar/wms';
const LAYER = 'suomi_dbz_eureffin';

/**
 * The composite's publishing interval, in ms.
 *
 * Not a polling choice — it is the grid the archive is indexed on. Asking for
 * any instant that is not a multiple of this answers `InvalidDimensionValue`,
 * so every request here is floored onto it first.
 */
export const RADAR_STEP_MS = 300_000;

/**
 * How old the newest available composite may be and still be drawn, in ms.
 *
 * Three steps. FMI publishes a frame a few minutes after the scan it is made
 * from, so at "now" the newest one is routinely five to ten minutes back — draw
 * only the exact step under the playhead and the layer would be empty most of
 * the time it is live. Beyond fifteen minutes the picture is a different weather
 * situation, and this feed's whole subject is where the rain is at the moment.
 */
export const RADAR_TOLERANCE_MS = 3 * RADAR_STEP_MS;

/** How many published instants sit inside the tolerance, the newest included. */
const RADAR_WINDOW_STEPS = RADAR_TOLERANCE_MS / RADAR_STEP_MS;

/**
 * How long before an instant FMI had nothing for is asked about again, in ms.
 *
 * Only the leading edge is ever re-asked, and only because the answer there
 * genuinely changes: the page's clock steps onto 07:05 a minute or two before
 * FMI publishes it, so the first probe is a `ServiceException` and the second,
 * a minute later, is the picture. Deeper than {@link RADAR_TOLERANCE_MS} into
 * the past the answer is final — a composite that was not in the mosaic fifteen
 * minutes after its own instant is a radar outage or the far end of the seven-
 * day archive, and neither of those un-happens.
 *
 * A minute rather than a step, because the exception body is 286 bytes measured
 * and the alternative is a leading edge that runs up to five minutes stale for
 * no reason. One wasted request a minute, only while the feed is switched on.
 */
export const RADAR_ABSENT_RETRY_MS = 60_000;

/**
 * The composite's own cell size on the ground, in metres.
 *
 * Measured rather than taken from documentation: the same 100 km box requested
 * in EPSG:3067 at 250 m/px came back with a modal run of two identical pixels
 * across, and at 125 m/px with a modal run of four to five. Both put the cell at
 * 500 m. It matters because it is the point past which asking for more pixels
 * buys nothing — GeoServer resamples with nearest neighbour, so a 4x request is
 * the same picture in four times the bytes.
 */
const RADAR_CELL_M = 500;

/**
 * Hard cap on either side of a requested frame, in pixels.
 *
 * A national view at screen resolution is ~100 kB of PNG; this bounds what a
 * very large display can ask a free public service for. Above it the frame is
 * scaled up on the canvas, which at that zoom is well below one screen pixel per
 * radar cell anyway.
 */
const MAX_RADAR_PX = 1400;

/** Half the equator in EPSG:3857 metres — the Mercator unit square's span. */
const MERC_SPAN = 40_075_016.6856;

/** One composite, decoded, with the ground it covers and the instant it is. */
export interface RadarFrame {
  image: ImageBitmap;
  /**
   * The composite's OWN instant, on the five-minute grid.
   *
   * Never the playhead's. The page prints this, and the gap between the two is
   * exactly the thing a reader has to be told about a layer that lags its clock.
   */
  at: number;
  /** Mercator unit-square bounds of the image, west/north to east/south. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The lon/lat box it was requested for, so a later view can reuse it. */
  bbox: Bbox;
  /**
   * True when this is MET Norway's nowcast rather than FMI's measurement.
   *
   * Rides on the frame rather than on the reel for the same reason
   * `Sample.forecast` rides on the sample in timeline.ts: the two halves live in
   * one series with the boundary INSIDE it, and a store that was one or the
   * other would have to be split at an instant that moves. See nowcast.ts.
   */
  forecast?: boolean;
  /**
   * For a forecast frame, the instant of the radar picture it was extrapolated
   * from — MET's `forecast_reference_time`. Printed, because "a forecast" and
   * "a forecast made from the 08:25 scan" are different amounts of information.
   */
  runAt?: number;
}

/** Requested pixel dimensions for a frame. */
export interface RadarSize {
  width: number;
  height: number;
}

/** The newest published instant at or before `ms`. */
export function radarFrameAt(ms: number): number {
  return Math.floor(ms / RADAR_STEP_MS) * RADAR_STEP_MS;
}

/**
 * Pixel size to request for a box, capped by the data and by courtesy.
 *
 * `pxPerMerc` is the camera's own scale, so at a street zoom the request is the
 * viewport's size and at a country zoom it is much smaller than the data would
 * allow. The aspect ratio always follows the Mercator box rather than the canvas
 * — under rotation the ground box that covers the screen is neither the screen's
 * shape nor its size, and a frame requested at the canvas's aspect would land on
 * the map stretched.
 */
export function radarRequestSize(
  bbox: Bbox,
  pxPerMerc: number,
  cap = MAX_RADAR_PX,
): RadarSize {
  const [x0, y0] = lonLatToMercator(bbox.west, bbox.north);
  const [x1, y1] = lonLatToMercator(bbox.east, bbox.south);
  const mw = Math.max(x1 - x0, 1e-9);
  const mh = Math.max(y1 - y0, 1e-9);

  const midLat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const groundM = mw * MERC_SPAN * Math.cos(midLat);
  // Never finer than the composite's own grid, never larger than the cap, and
  // never so coarse that a wide box collapses to a handful of pixels.
  const width = Math.max(16, Math.min(mw * pxPerMerc, groundM / RADAR_CELL_M, cap));
  const height = Math.min(width * (mh / mw), cap);
  return { width: Math.round(width), height: Math.round(Math.max(16, height)) };
}

/**
 * A lon/lat box as a WMS 1.3.0 `bbox` in EPSG:3857 metres, minx,miny,maxx,maxy.
 *
 * EPSG:3857 rather than 4326, for two reasons: the page's whole overlay is an
 * affine map from Mercator to screen, so a Mercator raster lands on it without a
 * warp — and WMS 1.3.0 reads a 4326 bbox as lat,lon, an axis-order trap this
 * codebase has already been bitten by once at the two HSY/Helsinki servers.
 *
 * Shared with nowcast.ts, which asks a different service for the same ground and
 * must ask for it in exactly the same frame or the two halves of this layer
 * would not register against each other.
 */
export function mercatorBboxParam(bbox: Bbox): string {
  const [x0, y0] = lonLatToMercator(bbox.west, bbox.north);
  const [x1, y1] = lonLatToMercator(bbox.east, bbox.south);
  return [
    (x0 - 0.5) * MERC_SPAN,
    (0.5 - y1) * MERC_SPAN,
    (x1 - 0.5) * MERC_SPAN,
    (0.5 - y0) * MERC_SPAN,
  ]
    .map((v) => v.toFixed(1))
    .join(',');
}

/** The Mercator unit-square corners a frame for `bbox` occupies. */
export function frameBounds(bbox: Bbox): Pick<RadarFrame, 'x0' | 'y0' | 'x1' | 'y1'> {
  const [x0, y0] = lonLatToMercator(bbox.west, bbox.north);
  const [x1, y1] = lonLatToMercator(bbox.east, bbox.south);
  return { x0, y0, x1, y1 };
}

/** The GetMap URL for one frame. Exported so a test can read it. */
export function radarUrl(bbox: Bbox, size: RadarSize, at: number): string {
  const bboxParam = mercatorBboxParam(bbox);
  const q = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: LAYER,
    styles: '',
    format: 'image/png',
    transparent: 'true',
    crs: 'EPSG:3857',
    bbox: bboxParam,
    width: String(size.width),
    height: String(size.height),
    time: new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  return `${ENDPOINT}?${q}`;
}

/**
 * ONE composite, for ONE instant. `null` means FMI has no such frame.
 *
 * A GetMap for an instant the mosaic does not hold answers HTTP 200 with an
 * `InvalidDimensionValue` ServiceException — a text/xml body, which is how this
 * tells a missing frame from a broken request without parsing anything: an image
 * response is an image. That distinction is the whole contract of this function,
 * and the reason it returns rather than throws: "FMI has nothing for 07:05 yet"
 * is an answer, and printing it as "could not load the radar" would be a lie
 * about a service that is working.
 *
 * A transport failure still throws. This used to walk backwards through the
 * tolerance itself, retrying up to four instants inside one call; the walk now
 * lives in {@link reelPlan}, where it can consult what has already been asked
 * instead of re-probing the same missing instants on every camera nudge.
 */
export async function fetchRadarFrame(
  bbox: Bbox,
  size: RadarSize,
  at: number,
  signal?: AbortSignal,
): Promise<RadarFrame | null> {
  const res = await fetch(radarUrl(bbox, size, at), { signal });
  if (!res.ok) throw new Error(`radar ${res.status}`);
  if (!(res.headers.get('content-type') ?? '').includes('image')) return null;
  const image = await createImageBitmap(await res.blob());
  return { image, at, ...frameBounds(bbox), bbox };
}

/**
 * Whether a composite of instant `at` may be drawn under a playhead at `when`.
 *
 * ONE RULE, READ BY BOTH SIDES — the reel that decides what to fetch and the
 * draw that decides what to blit. They were briefly two copies, which is how a
 * layer ends up drawing a frame the sentence beside it has already disowned.
 * Never forward of the playhead, and never further behind it than the tolerance.
 */
export function radarInRange(at: number, when: number): boolean {
  return at <= when && when - at <= RADAR_TOLERANCE_MS;
}

/* ------------------------------------------------------------------- reel */

/**
 * How many decoded bytes of composites the page holds at once.
 *
 * BOUNDED BY BYTES AND NOT BY COUNT, because a frame's size is the viewport's.
 * `radarRequestSize` caps each side at {@link MAX_RADAR_PX} = 1400, so one frame
 * is at most 1400×1400×4 = 7.8 MB of decoded pixels; a desktop framing Finland
 * lands near 1400×790 = 4.4 MB and a phone near 470×1010 = 1.9 MB. A twelve-slot
 * count-bounded cache is therefore anywhere between 23 MB and 94 MB depending on
 * who opened the page, and the top of that range is not shippable. Forty-eight
 * megabytes buys about eleven desktop frames — an hour of scrubbing — or
 * twenty-five on a phone, which is the same hour at the same cost.
 *
 * Evicted frames are not lost, only un-decoded: FMI serves `max-age=86400`, so
 * scrubbing back over evicted ground is answered by the browser's own cache and
 * costs a decode rather than a download.
 */
export const RADAR_REEL_BYTES = 48 * 1024 * 1024;

/** A count cap as well, for the small frames a phone-sized viewport asks for. */
export const RADAR_REEL_FRAMES = 64;

interface ReelEntry {
  frame: RadarFrame;
  /** The camera generation this frame was cut for. See {@link reelRetarget}. */
  gen: number;
  /** Decoded bytes — width × height × 4. */
  bytes: number;
  /** Monotonic use stamp, for eviction. */
  used: number;
}

/**
 * The composites the page has decoded, so the clock can sample them locally.
 *
 * THIS IS THE RASTER'S ANSWER TO `timeline.ts`. The station feeds load a day and
 * binary-search it; this holds the frames it has actually seen and picks the
 * newest one in range of the playhead. The difference that matters to a reader
 * is the one the old single-slot design got wrong: a scrub used to move the
 * clock while the radar stayed on the one frame it had, then vanished entirely
 * fifteen simulated minutes later, and could not fetch anything until the
 * pointer had been still for 400 ms (60 s during playback, by a constant chosen
 * so it would never fire). A backwards drag blanked on its very first step,
 * because `radarInRange` refuses a frame from the playhead's future.
 *
 * The reel changes nothing about what may be DRAWN — same `radarInRange`, same
 * one-frame-at-a-time, no blending — and everything about when it is asked for.
 * The fetch loop reads {@link reelPlan} against the live playhead rather than a
 * settled one, so a drag is served as it moves; a second drag over the same
 * window costs no network and no decode at all, which is where this finally
 * reads like the rest of the page.
 *
 * ONE CAMERA AT A TIME. Every frame in here is cut for the same ground box and
 * pixel size, because that is what makes them interchangeable under the
 * playhead. A camera move that leaves the reel's box behind bumps `gen` and
 * drops the old cut — except for the one frame on screen, which stays as the
 * picture the map holds while the new cut arrives (see {@link reelRetarget}).
 */
export interface RadarReel {
  /** Decoded frames by the composite's OWN instant. */
  entries: Map<number, ReelEntry>;
  /**
   * Instants FMI answered with a ServiceException, stamped with the wall clock
   * we learned it at — which is what tells a leading edge that has not been
   * published yet from an archive gap that never will be.
   */
  absent: Map<number, number>;
  /** Instants a request is in the air for, so the plan cannot ask twice. */
  inflight: Set<number>;
  /** The ground box, pixel size and camera scale new frames are cut for. */
  bbox: Bbox;
  size: RadarSize;
  scale: number;
  /**
   * The newest instant that may be ASKED for, when it is later than now.
   *
   * Zero while the measured composite is all there is, which is what makes `now`
   * the ceiling. Set to the end of MET Norway's nowcast run (nowcast.ts) once one
   * has been resolved, which is the single place the forecast half of this layer
   * enters the plan — everything downstream of it is the same reel, the same
   * tolerance, and the same one-frame-at-a-time draw.
   */
  horizon: number;
  /**
   * Whether a forecast request is in the air. At most one, ever.
   *
   * thredds.met.no is a shared research service whose own catalogue page asks
   * callers not to open parallel sessions, and a nowcast GetMap measured 1–2 s
   * against FMI's sub-second. The two pump loops share this so the second one
   * takes a measured instant or waits, rather than doubling up on the polite
   * host. FMI's frames have no such gate — they are a public tile-scale service
   * answering in under a second.
   */
  forecastInflight: boolean;
  gen: number;
  bytes: number;
  budget: number;
  frameCap: number;
  /** Monotonic counter behind `ReelEntry.used`. */
  clock: number;
  /** The instant {@link reelPick} last answered with — the picture on screen. */
  shown: number | null;
}

export function createReel(
  bbox: Bbox,
  size: RadarSize,
  scale: number,
  budget = RADAR_REEL_BYTES,
  frameCap = RADAR_REEL_FRAMES,
): RadarReel {
  return {
    entries: new Map(),
    absent: new Map(),
    inflight: new Set(),
    bbox,
    size,
    scale,
    horizon: 0,
    forecastInflight: false,
    gen: 0,
    bytes: 0,
    budget,
    frameCap,
    clock: 0,
    shown: null,
  };
}

/** Whether the reel's current cut still covers `view` at enough resolution. */
export function reelCovers(reel: RadarReel, view: Bbox, scale: number): boolean {
  // The same two predicates the single-slot design used, unchanged: the frame's
  // ground has to contain the screen's, and the camera must not have zoomed in
  // so far that the composite is being blown up past what it resolves. A zoom
  // OUT is always covered — a wider camera sees less of the frame, not more.
  return bboxContains(reel.bbox, view) && scale <= reel.scale * 1.6;
}

/**
 * Point the reel at a new camera, keeping only the frame currently on screen.
 *
 * The kept frame is not covered by the new cut and is not meant to be. It is
 * drawn while the first frame of the new generation is in the air, correctly
 * registered to its own ground by `paintRadar`'s Mercator affine — which is the
 * behaviour the single-slot design had and the one thing about it worth
 * keeping, because the alternative is the rain blinking out of existence every
 * time somebody zooms.
 */
export function reelRetarget(
  reel: RadarReel,
  bbox: Bbox,
  size: RadarSize,
  scale: number,
): void {
  for (const [at, entry] of reel.entries) {
    if (at === reel.shown) continue;
    entry.frame.image.close();
    reel.entries.delete(at);
    reel.bytes -= entry.bytes;
  }
  reel.bbox = bbox;
  reel.size = size;
  reel.scale = scale;
  reel.gen += 1;
}

/** Drop everything and release the decoded pixels. */
export function closeReel(reel: RadarReel): void {
  for (const entry of reel.entries.values()) entry.frame.image.close();
  reel.entries.clear();
  reel.absent.clear();
  reel.inflight.clear();
  reel.bytes = 0;
  reel.shown = null;
}

/**
 * Take a decoded frame into the reel, evicting by least-recently-drawn.
 *
 * The frame just added and the frame on screen are both exempt from eviction:
 * closing either is a visible blank, and closing the incoming one would make
 * the whole fetch pointless at a budget smaller than two frames.
 */
export function reelPut(reel: RadarReel, frame: RadarFrame, gen = reel.gen): void {
  const existing = reel.entries.get(frame.at);
  if (existing) {
    existing.frame.image.close();
    reel.bytes -= existing.bytes;
  }
  const bytes = frame.image.width * frame.image.height * 4;
  reel.entries.set(frame.at, { frame, gen, bytes, used: ++reel.clock });
  reel.bytes += bytes;
  reel.absent.delete(frame.at);

  while (
    (reel.bytes > reel.budget || reel.entries.size > reel.frameCap) &&
    reel.entries.size > 1
  ) {
    let victim: number | null = null;
    let oldest = Infinity;
    for (const [at, entry] of reel.entries) {
      if (at === frame.at || at === reel.shown) continue;
      if (entry.used < oldest) {
        oldest = entry.used;
        victim = at;
      }
    }
    if (victim === null) break;
    const entry = reel.entries.get(victim)!;
    entry.frame.image.close();
    reel.entries.delete(victim);
    reel.bytes -= entry.bytes;
  }
}

/** Record that FMI has no composite for `at`, as of wall clock `now`. */
export function reelAbsent(reel: RadarReel, at: number, now: number): void {
  reel.absent.set(at, now);
}

/**
 * Whether an instant already answered "no such frame" is worth asking again.
 *
 * Final past the tolerance — see {@link RADAR_ABSENT_RETRY_MS} for why the
 * leading edge is the only place this ever changes its mind.
 */
function askableAgain(at: number, learnedAt: number, now: number): boolean {
  if (learnedAt - at > RADAR_TOLERANCE_MS) return false;
  return now - learnedAt >= RADAR_ABSENT_RETRY_MS;
}

/** Whether the reel holds a frame for `at` cut for the CURRENT camera. */
function held(reel: RadarReel, at: number): boolean {
  return reel.entries.get(at)?.gen === reel.gen;
}

/**
 * The frame that would be drawn under a playhead at `when`, without side effects.
 *
 * NEWEST IN RANGE WINS, and the current camera's cut wins over the frame kept
 * across a retarget — a stale-camera frame is a stopgap for the moment after a
 * zoom, not something to prefer once the new cut has landed.
 *
 * ONE RULE, TWO CALLERS: the draw loop asks through {@link reelPick} and the
 * readout asks through this, so the picture and the sentence beside it cannot
 * end up describing different instants. That divergence is exactly what the
 * single-slot design shipped — its state tracked camera coverage while the draw
 * tracked the clock, so a blank layer reported a frame it was not drawing.
 */
export function reelPeek(reel: RadarReel, when: number): RadarFrame | null {
  let best: ReelEntry | null = null;
  let fallback: ReelEntry | null = null;
  for (const entry of reel.entries.values()) {
    if (!radarInRange(entry.frame.at, when)) continue;
    if (entry.gen === reel.gen) {
      if (!best || entry.frame.at > best.frame.at) best = entry;
    } else if (!fallback || entry.frame.at > fallback.frame.at) {
      fallback = entry;
    }
  }
  return (best ?? fallback)?.frame ?? null;
}

/**
 * The frame to draw under a playhead at `when`, marked as the one on screen.
 *
 * {@link reelPeek} plus the bookkeeping eviction runs on: the frames a reader is
 * actually scrubbing over are the last to be closed, and the frame currently
 * drawn is never closed at all.
 */
export function reelPick(reel: RadarReel, when: number): RadarFrame | null {
  const frame = reelPeek(reel, when);
  if (!frame) return null;
  const entry = reel.entries.get(frame.at);
  if (entry) entry.used = ++reel.clock;
  reel.shown = frame.at;
  return frame;
}

/**
 * The instants worth asking FMI for, most wanted first.
 *
 * THE WALK-BACK, MEMOISED. The leading edge is ragged — the clock steps onto
 * 07:05 before FMI publishes it — so the plan starts at the playhead's own step
 * and works backwards through the tolerance until it reaches a frame already in
 * hand, which is the picture that will be drawn if nothing newer arrives.
 * Instants already answered "no such frame" are skipped rather than re-probed,
 * which is the difference between this and the loop it replaces: that one
 * re-asked the same four missing instants on every camera nudge and every
 * five-minute step of a playback that had run past now.
 *
 * `direction` is the sign of the playhead's own motion, and it buys the only
 * prefetch here: dragging forwards or watching playback run, the next couple of
 * steps are asked for before the clock reaches them, so the layer is already
 * holding them when it does. Backwards needs none — the tolerance window IS
 * three steps of backwards cover.
 *
 * Nothing later than {@link RadarReel.horizon} — which is `now` until a nowcast
 * run has been resolved — is ever asked for. A picture of an instant nobody has
 * either measured or forecast cannot exist, and asking would be asking a server
 * to confirm that the future has not happened yet: four requests per five-minute
 * step of a scrub into tomorrow, all of them answered `InvalidDimensionValue`.
 */
export function reelPlan(
  reel: RadarReel,
  when: number,
  now: number,
  direction = 0,
  ahead = 2,
): number[] {
  const reach = Math.max(now, reel.horizon);
  // Nothing either publisher can hold is within tolerance of this playhead, so
  // there is nothing to ask about. Scrubbing an hour past the forecast's end
  // used to walk the whole window at every five-minute step, four requests at a
  // time, all of them answered `InvalidDimensionValue`.
  if (when - RADAR_TOLERANCE_MS > reach) return [];

  const out: number[] = [];
  const newest = radarFrameAt(Math.min(when, reach));
  const want = (at: number): boolean => {
    if (at > reach || reel.inflight.has(at) || held(reel, at)) return false;
    const learnedAt = reel.absent.get(at);
    return learnedAt === undefined || askableAgain(at, learnedAt, now);
  };

  for (let i = 0; i <= RADAR_WINDOW_STEPS; i++) {
    const at = newest - i * RADAR_STEP_MS;
    if (held(reel, at)) break;
    if (want(at)) out.push(at);
  }

  if (direction > 0) {
    for (let i = 1; i <= ahead; i++) {
      const at = newest + i * RADAR_STEP_MS;
      if (want(at)) out.push(at);
    }
  } else if (direction < 0) {
    for (let i = 1; i <= ahead; i++) {
      const at = newest - (RADAR_WINDOW_STEPS + i) * RADAR_STEP_MS;
      if (want(at)) out.push(at);
    }
  }
  return out;
}

/**
 * Whether the reel is still waiting to hear about the playhead's own window.
 *
 * "WE HAVE NOT ASKED YET" AND "THE PUBLISHER HAS NOTHING" ARE DIFFERENT
 * SENTENCES, and the single-slot design printed the second one for both: its
 * state stayed `ready` through a whole scrub because it tracked camera coverage
 * rather than clock coverage, so a blank layer over an archive FMI certainly
 * holds said "the newest radar composite has not been published yet". This is
 * the same split invariant 14 forced on the station feeds, one level up.
 *
 * An instant that came back absent counts as answered even while it is still
 * retryable — the reader is owed "there is no frame for this minute", not a
 * spinner that never resolves.
 */
export function reelPending(reel: RadarReel, when: number, now: number): boolean {
  // Past the tolerance into the future there is nothing to wait for, and saying
  // "loading" there would be a spinner over a question nobody asked.
  if (when - RADAR_TOLERANCE_MS > now) return false;
  const newest = radarFrameAt(Math.min(when, now));
  for (let i = 0; i <= RADAR_WINDOW_STEPS; i++) {
    const at = newest - i * RADAR_STEP_MS;
    if (at > now) continue;
    if (held(reel, at)) return false;
    if (reel.inflight.has(at)) return true;
    if (!reel.absent.has(at)) return true;
  }
  return false;
}
