import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import {
  sunPosition,
  sunTimes,
  shadowBearing,
  shadowLengthRatio,
  solarFrame,
  frameAltitude,
  type SolarFrame,
} from '../utils/sun';
import { basemapTileUrl } from '../utils/basemap';
import { t, getLang, setLang, useI18nVersion, type Lang } from '../utils/i18n';
import { useTheme } from '../hooks/useTheme';
import { FeedSidebar } from './FeedSidebar';
import { defaultEnabledFeeds, sanitizeEnabled } from './feeds';
import {
  offsetPoint,
  emitSweptFlat,
  lonLatToMercator,
  mercatorToLonLat,
  prepareBuilding,
  projectPrepared,
  shadowLengthMetres,
  padBbox,
  bboxContains,
  MAX_SHADOW_PAD_METRES,
  type Affine,
  type Bbox,
  type PreparedBuilding,
} from './shadows';
import {
  resolveBuildings,
  canopyFromShard,
  planCoverage,
  type CoveragePlan,
  type HeightSource,
} from './buildingShards';
import {
  loadHeightField,
  terrainShadowMask,
  terrainZoomFor,
  hasTerrain,
  type HeightField,
} from './terrain';
import { fetchTrains, TRAIN_POLL_MS, TRAIN_STALE_MS, trainKey, type Train } from './trains';
import { activeAt, fetchIncidents, INCIDENT_POLL_MS, type Incident } from './incidents';
import {
  fetchObservations,
  fetchObservationSeries,
  fetchForecastSeries,
  OBSERVATION_POLL_MS,
  type Observation,
} from './observations';
import {
  fetchAirQuality,
  fetchAirQualitySeries,
  AIR_QUALITY_POLL_MS,
  AQ_COLORS,
  aqBandKey,
  type AirQuality,
} from './airquality';
import {
  createTimeline,
  clearTimeline,
  mergeReadings,
  sampleTimeline,
  type Timeline,
} from './timeline';
import {
  datesCovering,
  fetchDaySchedules,
  scheduledPositions,
  type ScheduledTrain,
  type TrainSchedule,
} from './trainSchedule';
import { useFeedPoll } from './useFeedPoll';
import { TimeBar } from './TimeBar';
import { DetailPanel, type Selection } from './DetailPanel';
import { fixAt, type TrainFix } from './trainDetail';
import { pickFeature } from './pick';
import {
  recordSnapshot,
  snapshotAt,
  trackedRange,
  TRACK_WINDOW_MS,
  type TrainSnapshot,
} from './trainHistory';
import {
  addDays,
  clockSeconds,
  clockTime,
  isFuture,
  quantise,
  shortDate,
  startOfDay,
} from './timeControl';
import {
  buildLiveSearch,
  parseLiveUrl,
  readableQuery,
  readStoredView,
  writeStoredView,
  type LiveUrlState,
  type LiveView,
} from './urlState';

/**
 * /live/ — the realtime surface.
 *
 * First feed is the sun: an exact, data-free shadow simulation in the vein of
 * shademap.app and sunspot.fi. Everything else in the registry is listed but not
 * yet wired (see feeds.ts).
 *
 * SHADOWS ARE DRAWN ON A 2D CANVAS OVER THE MAP, not as a MapLibre fill layer.
 * A fill layer composites each polygon separately, so the hundreds of overlapping
 * rings that make up a city block's shadows stack into a dark blotch wherever
 * they intersect. Accumulating every ring into ONE Path2D and filling it once
 * lets the nonzero winding rule merge the overlaps, giving a single uniform
 * shade — which is what a shadow actually looks like — and it does the polygon
 * union for free, so no boolean-geometry dependency enters the bundle.
 *
 * THE BUILDINGS ARE DRAWN TOO, on top of their own shadows. Shade alone reads as
 * a stain on the basemap: a raster basemap draws building blocks as undifferen-
 * tiated beige, so the dark shape had nothing to be attached to and the layer
 * looked like an error rather than like light. Painting the footprints last —
 * after the shadow union, in a solid tone — puts the object back at the root of
 * its shadow, which is most of the difference between this and shademap.app.
 * They are painted whether or not the sun is up, because a building does not
 * stop existing at dusk.
 */

// Same four basemap URLs the main map uses, so /live/ renders in whichever theme
// the visitor already chose site-wide rather than forcing its own.
const BASEMAP_LIGHT =
  (import.meta.env.VITE_BASEMAP_LIGHT_URL as string) ||
  'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK =
  (import.meta.env.VITE_BASEMAP_DARK_URL as string) ||
  'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
const BASEMAP_LIGHT_LABELS =
  (import.meta.env.VITE_BASEMAP_LIGHT_LABELS_URL as string) ||
  'https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK_LABELS =
  (import.meta.env.VITE_BASEMAP_DARK_LABELS_URL as string) ||
  'https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png';

const tilesFor = (theme: 'dark' | 'light') =>
  basemapTileUrl(theme === 'dark' ? BASEMAP_DARK : BASEMAP_LIGHT);
const labelTilesFor = (theme: 'dark' | 'light') =>
  basemapTileUrl(theme === 'dark' ? BASEMAP_DARK_LABELS : BASEMAP_LIGHT_LABELS);

/** Helsinki centre — the densest place where OSM actually has building heights. */
const DEFAULT_CENTER: [number, number] = [24.9384, 60.1699];
const DEFAULT_ZOOM = 15.5;

/**
 * How long the camera has to sit still before the address bar follows it.
 *
 * `moveend` already fires once per gesture rather than per frame, so this is not
 * about churn — it is about a flick-pan-flick, which fires three of them in
 * under a second and would leave two links in the history nobody navigated to.
 */
const URL_DEBOUNCE_MS = 500;

/**
 * The link this page was opened with, read once.
 *
 * Read at module scope rather than in an effect because the camera has to be
 * known before the map is CONSTRUCTED: MapLibre takes `center`/`zoom` in its
 * constructor, and setting them afterwards is a visible jump from Helsinki to
 * wherever the link pointed, plus a wasted round of building fetches for a view
 * nobody asked to see.
 */
function readInitialUrl(): LiveUrlState {
  if (typeof window === 'undefined') return { view: null, when: null, feeds: null };
  return parseLiveUrl(window.location.search);
}

/** Quiet period after the map stops moving before we ask Overpass for anything. */
const FETCH_DEBOUNCE_MS = 700;

/**
 * How long we wait for buildings before calling it a failure.
 *
 * Overpass queues requests when its slots are busy, so a query can sit for
 * minutes and then succeed. Without this the page shows "loading buildings…"
 * for as long as that takes, with no way for the user to tell a slow queue from
 * a request that will never come back. A stated failure they can retry is a
 * better answer than an honest-looking spinner that means nothing.
 */
const FETCH_TIMEOUT_MS = 45_000;

/**
 * Screen-space simplification tolerance, in CSS pixels.
 *
 * Zoom-adaptive for free: it is applied AFTER projection, so a footprint that
 * shrinks as you zoom out sheds proportionally more of its vertices.
 */
const SIMPLIFY_PX = 1.5;

/**
 * Footprint detail per zoom — the "how accurate should a shadow be" ladder.
 *
 * Ground resolution at Finland's latitude is about 78,271 / 2^zoom metres per
 * pixel, so a typical 20 m building measures roughly:
 *
 *   z13  2 px      z14  4 px      z15  8 px      z16  17 px
 *
 * At 17 px an outline's corners are legible and worth keeping at 1.5 px. At
 * 4 px the building is a blob whose SHAPE carries no information — only its
 * mass and the direction its shadow runs — so a coarse tolerance costs nothing
 * visible and buys back most of the frame. Tolerance is applied AFTER
 * projection, and `projectPrepared` substitutes a footprint's bounding box once
 * simplification collapses it below a drawable ring, so raising this is exactly
 * what turns distant buildings into cheap five-point boxes.
 */
function simplifyPxForZoom(zoom: number): number {
  if (zoom >= 16) return SIMPLIFY_PX;
  if (zoom >= 15) return 2.5;
  if (zoom >= 14) return 4;
  return 7;
}

/** Below this, a building plus its shadow is smaller than a pixel — skip it. */
const MIN_FEATURE_PX = 0.8;

/** Outlining every footprint below this zoom turns a city block into noise. */
const OUTLINE_ZOOM = 15;

/**
 * Shadow ink, per theme. `night` is the alpha the WHOLE map gets once the sun is
 * down — see `nightAlpha`.
 *
 * BOTH THEMES DARKEN. The dark theme used to shade with a LIGHTER blue, on the
 * reasoning that a near-black fill is invisible on a near-black basemap. That
 * holds while shade is a patch among lit ground — the eye reads the contrast,
 * not the direction. It stops holding the moment the whole viewport can be
 * shaded: a full-screen lightening wash made midnight render brighter than noon.
 * So the dark theme darkens too, with a deep blue rather than black and a much
 * higher alpha to stay legible against a basemap that is already dark.
 */
const SHADE = {
  dark: { ink: '8, 15, 40', rgb: [8, 15, 40], day: 0.45, night: 0.62 },
  light: { ink: '30, 45, 80', rgb: [30, 45, 80], day: 0.28, night: 0.44 },
} as const;

/**
 * Tree shade, drawn in its own pass at roughly two thirds of a building's alpha.
 *
 * A crown is not a wall. It dapples — a canopy in leaf passes a real fraction of
 * the light, and a bare one in a Finnish winter passes most of it — so casting it
 * at the building alpha would claim a solidity trees do not have.
 *
 * The heights behind it are measured (HSY's laser-derived land cover), so the
 * geometry is honest; only the opacity is a judgement, and it is the conservative
 * one.
 *
 * This is a RELATIVE weight, not a second layer of shade. Ground under both a
 * tree and a building is shaded ONCE, at the building's tone — see `draw`, where
 * the two casters are merged into a single mask before either reaches the screen.
 */
/** One theme's shade palette — either arm of {@link SHADE}, never one of them. */
type ShadeTone = (typeof SHADE)[keyof typeof SHADE];

const CANOPY_ALPHA_SCALE = 0.65;

/**
 * Canopy tolerance multiplier, on top of the buildings' zoom ladder.
 *
 * A crown has no true edge to preserve — the outline is a classification
 * boundary, not an object — and there are ~4x as many of them as buildings, so
 * this is where the per-frame cost of drawing trees is paid back. Past z14 the
 * multiplier climbs, which is what lets canopy be drawn at EVERY zoom buildings
 * are drawn at (it used to stop at z14, leaving a band of zooms where a forest
 * cast nothing and read as open ground) without giving back the frame budget the
 * zoom ladder bought. At the coarse end `projectPrepared` collapses each crown to
 * its bounding box, which is the cheapest thing the emitter can sweep.
 */
function canopySimplifyScale(zoom: number): number {
  if (zoom >= 15) return 2;
  if (zoom >= 14) return 3;
  return 4;
}

/**
 * Building ink, per theme.
 *
 * Opposite directions on purpose: on the pale basemap the mass has to be darker
 * than its surroundings to read as a solid object, and on the near-black one it
 * has to be lighter. Both sit above the shadow fill, so the alpha is what keeps
 * the basemap's streets and parks legible underneath — and on the dark theme it
 * is what keeps the buildings from being the brightest thing on the screen,
 * which is what a near-white fill turned them into.
 */
const BUILDING = {
  dark: { fill: 'rgba(148, 163, 184, 0.32)', stroke: 'rgba(203, 213, 225, 0.4)' },
  light: { fill: 'rgba(51, 65, 85, 0.42)', stroke: 'rgba(30, 41, 59, 0.55)' },
} as const;

/** Shared empty list, so the zoomed-out path allocates nothing per frame. */
const EMPTY_PREPARED: PreparedBuilding[] = [];

/** Same, for a scrubbed instant the recorded train history cannot answer for. */
const EMPTY_TRAINS: Train[] = [];

/**
 * Below this zoom, individual buildings and trees are not drawn at all — the
 * shadow map is terrain only.
 *
 * This is the shademap.app ladder, and it is a statement about what is legible
 * rather than about what we can afford. Ground resolution at this latitude is
 * ~78,271 / 2^zoom metres per pixel, so a 20 m building is about 3 px at z13.5
 * and its midday shadow is a fraction of one. Thousands of sub-pixel sweeps
 * average out to a flat wash that says nothing the terrain layer is not already
 * saying better, and near sunset they stop being sub-pixel — a 12 km shadow is
 * tens of pixels whatever cast it — so the sub-pixel cull that bounds the cost at
 * midday does not bound it at all at exactly the hour the layer matters most.
 *
 * So the detail layer switches off as a unit and relief takes over. Buildings and
 * canopy share this number deliberately: separate floors are what produced the
 * band of zooms where trees stopped casting and buildings did not.
 */
const DETAIL_MIN_ZOOM = 13.5;

/**
 * Longest shadow we will emit, as a multiple of the viewport diagonal.
 *
 * MAX_SHADOW_METRES keeps the GEOMETRY honest — 12 km, so a tower and a shed stay
 * distinguishable through sunset. This keeps the PATH bounded, which is a
 * different problem: at street zoom 12 km is ~10,000 px, so a low sun had every
 * on-screen building emitting a sweep far past the canvas. Rasterisation is
 * clipped and costs nothing there, but the path construction is not, and neither
 * is the memory it sits in.
 *
 * Past ~1.5 diagonals a shadow cannot reach any pixel the viewport will show even
 * from a caster in the opposite corner, so clamping there is invisible. It also
 * self-scales: zoomed out, 12 km is a few pixels and the clamp never binds; zoomed
 * in, it binds hard, which is exactly where it needs to.
 */
const MAX_SHADOW_DIAGONALS = 1.5;

/**
 * The scratch canvas the shadow casters are merged on, sized to the viewport.
 *
 * Module-level and reused across frames: allocating a viewport-sized canvas per
 * frame is what makes an offscreen compositing step expensive, and there is only
 * ever one map on the page.
 */
let maskCanvas: HTMLCanvasElement | null = null;

function ensureMask(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!maskCanvas) maskCanvas = document.createElement('canvas');
  if (maskCanvas.width !== width || maskCanvas.height !== height) {
    maskCanvas.width = width;
    maskCanvas.height = height;
  }
  return maskCanvas;
}

const STORAGE_KEY = 'live.feeds';

function readStoredFeeds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultEnabledFeeds();
    return sanitizeEnabled(JSON.parse(raw) as string[]);
  } catch {
    return defaultEnabledFeeds();
  }
}

const READOUT_KEY = 'live.readout';

/**
 * Whether the honesty strip starts open. It does not.
 *
 * THE STRIP IS COLLAPSED BY DEFAULT, AND THAT IS NOT A RETREAT FROM SAYING WHAT
 * THE MAP KNOWS. With five feeds on it stacks five sentences into the top-left
 * corner — the one place a national view has anything worth looking at — and
 * every one of them is a sentence a reader consults once and then reads past.
 * The count of trains does not change while you watch it; what changes is the
 * map underneath.
 *
 * What is NOT allowed to collapse with it is the fact that something went
 * wrong. A failed feed draws an empty layer, which is indistinguishable from a
 * quiet one, so the collapsed chip carries the alert state (`readoutAlert`
 * below) and colours itself amber — the reader still learns that a sentence is
 * waiting for them, they just do not have to read five to find it.
 *
 * Stored as a plain flag rather than defaulting per-visit, because a reader who
 * opens it is stating a preference about every later visit too.
 */
function readStoredReadout(): boolean {
  try {
    return localStorage.getItem(READOUT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * THE CLOCK AND ITS READOUT LIVE IN TimeBar.tsx, not here.
 *
 * The time scrubber used to be a bare `<input type=range>` in this file's
 * footer, and the sun readout a row of spans beside it. Both moved out when the
 * clock stopped belonging to the sun: it is now the whole page's instant, every
 * feed answers for it, and the bar has to say whether it is following real time
 * or has been moved off it. What is left here is what reads that instant —
 * see the archive constants below and `paintShade`.
 */

/**
 * THE SLIDER IS NOT A REQUEST. Read this before touching the archive constants.
 *
 * Every measured feed used to reach the page's clock as an HTTP request: quantise
 * the instant, debounce it, ask FMI for that window, wait, draw. Which meant the
 * bar drove two different kinds of layer — the shadows moved with the pointer,
 * and the temperatures moved when you let go and the network came back. The
 * complaint that produced this rewrite was exactly that: you had to STOP the
 * slider before it would tell you the temperature at that time.
 *
 * So the unit of fetching is now the DAY, not the instant. Each measured feed
 * loads its whole day up front — a national day of air temperature at hourly
 * steps is ~20 kB gzipped, less than four of the single-instant requests it
 * replaces — and the clock samples it locally (timeline.ts). A scrub costs a
 * binary search per station and no network at all, which is what puts these
 * layers on the same footing as the sun.
 *
 * The two constants below survive that change with a much smaller job. They no
 * longer gate what the map shows; they gate the REFINEMENT request that goes out
 * when the scrubber comes to rest, which upgrades the hourly sample under the
 * playhead to the ten-minutely reading nearest it. Nothing waits for it.
 */

/**
 * How coarsely a settled instant is rounded before the refinement request.
 *
 * Five minutes, which is finer than the ten-minute cycle most FMI stations
 * publish on — so it cannot cost the reader a measurement that exists — and
 * coarse enough that a slow, deliberate drag cannot slip a request through the
 * debounce every pixel.
 */
const ARCHIVE_STEP_MS = 300_000;

/**
 * How long the scrubber must be still before the refinement request goes out.
 *
 * Long enough to sit out a drag, short enough that coming to rest feels like it
 * sharpened immediately.
 */
const ARCHIVE_DEBOUNCE_MS = 400;

/**
 * How far a sample may sit from the clock and still be shown, per feed.
 *
 * This is the honesty knob of the whole timeline arrangement, and the two
 * numbers differ because the quantities do. Air temperature is published every
 * ten minutes and the day is loaded hourly, so 45 minutes guarantees every
 * instant of a loaded day resolves to a real reading — never more than half an
 * hour old, and always printed with its own timestamp. The air quality index is
 * a whole hour's AVERAGE, so a 90-minute reach spans the neighbouring hour when
 * a station skips one, and no further: an index from three hours ago is not a
 * fact about now.
 *
 * Past the tolerance a station is absent from the sample and the map draws
 * nothing there, which is this project's answer for missing data everywhere else.
 */
const OBSERVATION_TOLERANCE_MS = 45 * 60_000;
const AIR_QUALITY_TOLERANCE_MS = 90 * 60_000;

/**
 * How often a loaded day is re-fetched while the page sits open.
 *
 * Only the FORECAST arm really needs this — the measured past does not change,
 * and the live poll extends today's measured tail every five minutes — but a
 * page left open across a model run would otherwise keep showing the forecast it
 * loaded this morning. Half an hour is well inside ECMWF's publication cycle and
 * costs two requests an hour for a feed that is switched on.
 */
const DAY_REFRESH_MS = 1_800_000;

/**
 * How long the clock must rest outside the recorded window before the day's
 * timetables are fetched.
 *
 * Longer than the archive debounce because the payload is: a day of Fintraffic
 * timetables is 638 kB gzipped (see trainSchedule.ts). Dragging THROUGH the gap
 * either side of the session's recording must not pay for it.
 */
const SCHEDULE_DEBOUNCE_MS = 600;

/** Shared empty lists, so the off paths allocate nothing per render. */
const EMPTY_OBSERVATIONS: Observation[] = [];
const EMPTY_AIR_QUALITY: AirQuality[] = [];
const EMPTY_SCHEDULED: ScheduledTrain[] = [];

/**
 * How often the page's clock catches up with the world while it is following it.
 *
 * The clock used to be captured once, at mount, and never advanced — so a page
 * called /live/ left open for an hour drew the sun where it had been an hour
 * ago, silently, with a scrubber sitting under the wrong minute. Thirty seconds
 * is well under one pixel of a 24-hour bar at any reasonable width, so the
 * playhead creeps rather than jumping.
 */
const LIVE_TICK_MS = 30_000;

/** Highlight ink for the selected marker and its route, per theme. */
const SELECTED = {
  dark: { ring: '#fbbf24', track: 'rgba(196, 181, 253, 0.9)' },
  light: { ring: '#b45309', track: 'rgba(109, 40, 217, 0.8)' },
} as const;

/**
 * Debounce a value.
 *
 * Used for exactly one thing — the instant the archive feeds fetch for — and it
 * is the difference between a drag across the bar costing one request and
 * costing several hundred aborted ones.
 */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * How dark the whole map goes once the sun is below the horizon.
 *
 * The sun setting does not end the shadow simulation — it makes the answer
 * "everywhere", which is the one case the old code drew as "nowhere". Ramping
 * from the daytime shadow alpha at the horizon to the full night alpha at the
 * end of civil twilight (−6°) means the last building shadow at sunset hands
 * over to the all-over shade at the same tone, instead of the layer blinking off.
 */
function nightAlpha(altitudeDeg: number, day: number, night: number): number {
  const t = Math.min(1, Math.max(0, -altitudeDeg / 6));
  return day + (night - day) * t;
}

/**
 * The Mercator→screen transform for the map's current camera.
 *
 * Calibrated with three `map.project()` calls rather than rebuilt from
 * MapLibre's transform internals, so it stays exact across zoom and rotation
 * with nothing to keep in sync. Exact only at pitch 0, which the map pins.
 */
function cameraAffine(map: MaplibreMap): Affine {
  const c = map.getCenter();
  const [ox, oy] = lonLatToMercator(c.lng, c.lat);
  const o = map.project([c.lng, c.lat]);
  // One ten-thousandth of the world is ~4 km of Mercator at this latitude: large
  // enough that the pixel difference is precise, and the map being affine means
  // the step size cannot introduce error however big it is.
  const step = 1e-5;
  const px = map.project(mercatorToLonLat(ox + step, oy));
  const py = map.project(mercatorToLonLat(ox, oy + step));
  return {
    ox,
    oy,
    px: o.x,
    py: o.y,
    ax: (px.x - o.x) / step,
    ay: (px.y - o.y) / step,
    bx: (py.x - o.x) / step,
    by: (py.y - o.y) / step,
  };
}

/**
 * How far outside the viewport we fetch buildings.
 *
 * Two jobs. A building standing just off-screen still throws its shadow across
 * the visible area, and fetching exactly the viewport made those shadows blink
 * out along every edge the moment the camera moved — the specific bug that made
 * zooming look like buildings were being deleted. And the surplus is what lets a
 * zoom-in or a short pan reuse what is already loaded instead of re-querying.
 *
 * Kept modest, because padding is paid for in query area on all four sides: a
 * 15 % margin costs about 35 % more ground, while 25 % costs 100 %. The lower
 * bound is what actually fixes the edge artefact at street zoom, and the cap is
 * MAX_SHADOW_PAD_METRES — deliberately not the 12 km a shadow may now be drawn
 * to, because that is a screen-space allowance and this is a query-area one.
 */
function fetchPadMetres(view: Bbox): number {
  const midLat = ((view.south + view.north) / 2) * (Math.PI / 180);
  const spanNS = (view.north - view.south) * 111_320;
  const spanEW = (view.east - view.west) * 111_320 * Math.cos(midLat);
  const span = Math.min(spanNS, spanEW);
  return Math.min(MAX_SHADOW_PAD_METRES, Math.max(350, 0.15 * span));
}

/**
 * Screen spacing, in CSS pixels, between solar-altitude samples in the twilight
 * wash.
 *
 * NOT set by how fast the field varies — it varies barely at all, being the
 * smoothest thing on the page. It is set by the SHARPEST feature in it: the
 * terminator, where the wash steps from nothing to the daytime shadow tone in one
 * sample. Bilinear interpolation of a step reconstructs the edge on the sample
 * lattice, so a coarse step draws that line as a visible staircase with treads
 * the width of the spacing. Everything else here would be happy at 64 px; the
 * edge is what pays for 8.
 *
 * Measured at 21,800 samples for a 1540x900 viewport, ~1.1 ms a frame — against a
 * 16 ms budget at zooms where, by construction, there are no buildings to sweep.
 */
const TWILIGHT_STEP_PX = 8;

/**
 * Scratch canvases for the twilight wash, at sample resolution.
 *
 * TWO, because the wash does two things that composite differently — see
 * {@link twilightLayer}. Module-level and reused, like every other per-frame
 * raster here.
 */
let twilightShadeCanvas: HTMLCanvasElement | null = null;
let twilightDeepenCanvas: HTMLCanvasElement | null = null;
let twilightShadePixels: ImageData | null = null;
let twilightDeepenPixels: ImageData | null = null;

/** The night side of the terminator, as the two passes that draw it. */
interface TwilightLayer {
  /** Opaque where the sun has set. Joins the merged mask as one more occluder. */
  shade: HTMLCanvasElement;
  /** How much DARKER than a daytime shadow that ground is. Drawn after. */
  deepen: HTMLCanvasElement;
  /**
   * Whether any of the view is still in daylight.
   *
   * For the honesty strip, not for the drawing. Once a terminator can cross the
   * screen, "the sun has set — the whole area is in shade" stops being a fact
   * about the map and becomes a fact about its centre pixel, and the reader can
   * see it is wrong: half the frame is lit.
   */
  lit: boolean;
}

/**
 * Screen pixel -> lon/lat, by inverting the camera's Mercator affine.
 *
 * The same trade the shadow projection makes in the other direction: at pitch 0 —
 * which /live/ pins — Mercator->screen is affine, so the inverse is a 2x2 solve
 * and a pair of transcendentals rather than a MapLibre `unproject` call and a
 * fresh LngLat object per sample. At a thousand samples a frame, on a path that
 * runs on every `render` event, that difference is the layer being free or not.
 */
function screenToLonLat(t: Affine, sx: number, sy: number): [number, number] {
  const det = t.ax * t.by - t.bx * t.ay;
  const x = sx - t.px;
  const y = sy - t.py;
  return mercatorToLonLat(
    t.ox + (t.by * x - t.bx * y) / det,
    t.oy + (t.ax * y - t.ay * x) / det,
  );
}

/**
 * The day/night terminator, as a wash whose depth is the LOCAL solar altitude.
 *
 * THE SUN DOES NOT HAVE ONE ALTITUDE OVER A MAP. This layer exists because the
 * page used to assume it did: `sunPosition` was evaluated once at the centre
 * pixel and that single number decided whether the entire viewport was day or
 * night. At a camera framing Finland that is a claim about 2,000 km of ground
 * from one sample — and at 02:18 UTC on an August morning the truth ran from
 * -12.9° over Denmark to +8.5° over the White Sea. The page drew that as a
 * uniform sheet, either all lit or all dark, where the real picture is a
 * terminator cutting diagonally across the frame. Every other shadow-map on the
 * web draws that line; drawing a flat wash instead is the single thing that made
 * the zoomed-out view read as broken.
 *
 * Returns null when the sun is above the horizon at every sample — the ordinary
 * daytime case, where this contributes nothing and the caller keeps its cheaper
 * path.
 *
 * WHY TWO PASSES AND NOT ONE ALPHA. Night is darker than a daytime shadow (0.62
 * against 0.45 on the dark theme), and the merged mask is composited at a single
 * alpha — so a wash that needed to reach the night tone could not live on it. But
 * splitting the wash by what it is DOING makes both halves exact:
 *
 *   `shade`  is opaque wherever the sun has set. It joins the merged mask as one
 *            more occluder, saturating against buildings and relief exactly as
 *            they saturate against each other — so ground that is both past
 *            sunset and behind a hill is shaded ONCE, which is the invariant this
 *            file's compositing exists to hold.
 *   `deepen` is the REMAINDER: how much further past a daytime shadow that ground
 *            has gone, drawn over the composited mask. Above the horizon it is
 *            zero, so it can never darken a daytime shadow. Below it, the mask
 *            has already laid down exactly `shade.day`, so `day + deepen*(1-day)`
 *            lands on `nightAlpha` precisely.
 *
 * The result is that the old behaviour — flood the viewport at `nightAlpha` once
 * the sun is down — is reproduced exactly wherever the whole viewport agrees
 * about the sun, which is every zoom at which buildings are drawn. What changes
 * is that the viewport is no longer required to agree.
 */
function twilightLayer(
  map: MaplibreMap,
  frame: SolarFrame,
  shade: ShadeTone,
  width: number,
  height: number,
): TwilightLayer | null {
  if (typeof document === 'undefined') return null;

  const t0 = cameraAffine(map);

  // BROAD DAYLIGHT LEAVES BEFORE THE LOOP.
  //
  // Otherwise this pays ~21,800 solar evaluations a frame to discover that every
  // one of them is above the horizon — on the same path that is sweeping
  // thousands of buildings at street zoom, which is where the frame budget is
  // actually tight and where the terminator provably is not.
  //
  // Nine probes, and the test is `min > spread` rather than `min > 0`. Over a
  // lat/lon rectangle the sun's altitude attains its minimum on the BOUNDARY —
  // as a function of latitude it is R·sin(φ+ψ), which has a single maximum, and
  // as a function of hour angle it is monotonic in |h| — so the probes bracket
  // it. Requiring the margin to exceed the spread between the probes is what
  // keeps that an argument rather than an assumption: at street zoom the spread
  // is ~0.001° and the guard fires, at a continental camera it is 20° and the
  // guard correctly refuses to fire.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 9; i++) {
    const [lon, lat] = screenToLonLat(t0, (width * (i % 3)) / 2, (height * Math.floor(i / 3)) / 2);
    const a = frameAltitude(frame, lat, lon);
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  if (lo - (hi - lo) > 0) return null;

  const cols = Math.max(2, Math.ceil(width / TWILIGHT_STEP_PX));
  const rows = Math.max(2, Math.ceil(height / TWILIGHT_STEP_PX));

  twilightShadeCanvas ??= document.createElement('canvas');
  twilightDeepenCanvas ??= document.createElement('canvas');
  if (twilightShadeCanvas.width !== cols || twilightShadeCanvas.height !== rows) {
    twilightShadeCanvas.width = cols;
    twilightShadeCanvas.height = rows;
    twilightDeepenCanvas.width = cols;
    twilightDeepenCanvas.height = rows;
    twilightShadePixels = null;
    twilightDeepenPixels = null;
  }
  const sctx = twilightShadeCanvas.getContext('2d');
  const dctx = twilightDeepenCanvas.getContext('2d');
  if (!sctx || !dctx) return null;
  twilightShadePixels ??= sctx.createImageData(cols, rows);
  twilightDeepenPixels ??= dctx.createImageData(cols, rows);
  const sp = twilightShadePixels.data;
  const dp = twilightDeepenPixels.data;

  const t = t0;
  const [ir, ig, ib] = shade.rgb;
  // Source-over puts `day + x*(1 - day)` on ground the mask has already shaded,
  // so this is the inversion that makes the pair land on nightAlpha exactly.
  const remainder = 1 - shade.day;

  let any = false;
  let lit = false;
  for (let r = 0, p = 0; r < rows; r++) {
    // Sample at the CENTRE of the cell each canvas pixel will be stretched to,
    // so the upscale lands the values back exactly where they were measured.
    const sy = (r + 0.5) * TWILIGHT_STEP_PX;
    for (let c = 0; c < cols; c++, p += 4) {
      const [lon, lat] = screenToLonLat(t, (c + 0.5) * TWILIGHT_STEP_PX, sy);
      const altitude = frameAltitude(frame, lat, lon);
      sp[p] = ir;
      sp[p + 1] = ig;
      sp[p + 2] = ib;
      dp[p] = ir;
      dp[p + 1] = ig;
      dp[p + 2] = ib;
      if (altitude > 0) {
        lit = true;
        sp[p + 3] = 0;
        dp[p + 3] = 0;
        continue;
      }
      any = true;
      sp[p + 3] = 255;
      dp[p + 3] = Math.round(
        (255 * (nightAlpha(altitude, shade.day, shade.night) - shade.day)) / remainder,
      );
    }
  }
  if (!any) return null;
  sctx.putImageData(twilightShadePixels, 0, 0);
  dctx.putImageData(twilightDeepenPixels, 0, 0);
  return { shade: twilightShadeCanvas, deepen: twilightDeepenCanvas, lit };
}

/**
 * Scratch canvas holding the terrain shadow mask at HEIGHTFIELD resolution.
 *
 * Separate from `maskCanvas`, and deliberately not viewport-sized: the mask is
 * computed in the field's own Mercator grid and drawn through an affine, so it
 * is reused across camera moves that do not change which tiles are loaded.
 */
let terrainCanvas: HTMLCanvasElement | null = null;

/**
 * What the cached terrain mask was computed for.
 *
 * THE MASK DOES NOT DEPEND ON THE CAMERA. It is a function of the heightfield
 * and the sun — where the shade falls on the ground does not change because you
 * panned. But `draw` runs on MapLibre's `render` event, up to sixty times a
 * second while a drag is in flight, so recomputing it there meant a full O(cells)
 * sweep plus a fresh 786k-pixel ImageData per frame to arrive at pixels identical
 * to the previous frame's. Panning was paying the entire terrain cost over and
 * over to produce the same picture.
 *
 * Keyed on the field identity plus the sun, so a scrub (sun moves) recomputes and
 * a pan (sun does not) reuses. The affine that lands it on screen IS recomputed
 * every frame — that is three `map.project` calls and it is what actually has to
 * track the camera.
 */
let terrainCacheKey = '';
let terrainCacheField: HeightField | null = null;
/** Reused ImageData, so a per-frame recompute does not also allocate megabytes. */
let terrainPixels: ImageData | null = null;

/** The terrain mask plus the affine that lands it on screen. */
interface TerrainLayer {
  canvas: HTMLCanvasElement;
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Rasterise the terrain shadow for the current sun, ready to composite.
 *
 * Returns null when there is no heightfield, or when the sun is down — below the
 * horizon the caller floods the whole viewport, and a mask saying "all of it"
 * would be the same picture computed the expensive way.
 *
 * The transform is built from three `map.project` calls on the field's own
 * corners, exactly like `cameraAffine`: Mercator->screen is affine at pitch 0
 * (which /live/ pins), so three points define it and it stays correct through
 * rotation and zoom with nothing to keep in sync.
 */
function terrainLayer(
  field: HeightField | null,
  sunAltitudeDeg: number,
  shadowBearingDeg: number,
  map: MaplibreMap,
  shade: ShadeTone,
  frame: SolarFrame,
  timeKey: number,
): TerrainLayer | null {
  // NOT gated on the centre pixel's sun. A viewport can straddle the terminator,
  // and when it does the sunlit half still has relief to cast — the sweep decides
  // per field whether anything is lit at all, and says so by returning no mask.
  if (!field) return null;
  if (typeof document === 'undefined') return null;

  const { width, height, bbox } = field;
  if (!terrainCanvas) terrainCanvas = document.createElement('canvas');
  if (terrainCanvas.width !== width || terrainCanvas.height !== height) {
    terrainCanvas.width = width;
    terrainCanvas.height = height;
    terrainPixels = null;
    terrainCacheKey = '';
  }
  const tctx = terrainCanvas.getContext('2d');
  if (!tctx) return null;

  // KEYED ON THE INSTANT, NOT ON A ROUNDED ALTITUDE. This used to quantise the
  // sun to a tenth of a degree on the grounds that a tenth of a degree is
  // sub-pixel. It is not, near the horizon: a shadow is cot(altitude) long, so
  // 0.1° and 0.2° above the horizon differ by a FACTOR OF TWO in length — and the
  // horizon is precisely where this layer is being looked at. The time is what
  // the mask is really a function of, and using it directly is both correct and
  // simpler: a pan (same instant) reuses, a scrub (new instant) recomputes, which
  // is all the cache was ever for.
  const key = `${timeKey},${shadowBearingDeg.toFixed(1)},${shade.ink}`;
  if (terrainCacheField !== field || terrainCacheKey !== key) {
    const mask = terrainShadowMask(field, sunAltitudeDeg, shadowBearingDeg, frame);
    if (!mask) return null;
    // Inked here rather than left as bare coverage. The merged mask is
    // composited onto the page in ONE drawImage, so every caster on it has to
    // already carry the theme's shade colour — a black-filled terrain would come
    // out black next to the buildings' deep blue instead of joining the union.
    //
    if (!terrainPixels) terrainPixels = tctx.createImageData(width, height);
    const px = terrainPixels.data;
    const [ir, ig, ib] = shade.rgb;
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      px[p] = ir;
      px[p + 1] = ig;
      px[p + 2] = ib;
      px[p + 3] = mask[i];
    }
    tctx.putImageData(terrainPixels, 0, 0);
    terrainCacheField = field;
    terrainCacheKey = key;
  }

  const [west, south, east, north] = bbox;
  const nw = map.project([west, north]);
  const ne = map.project([east, north]);
  const sw = map.project([west, south]);
  return {
    canvas: terrainCanvas,
    a: (ne.x - nw.x) / width,
    b: (ne.y - nw.y) / width,
    c: (sw.x - nw.x) / height,
    d: (sw.y - nw.y) / height,
    e: nw.x,
    f: nw.y,
  };
}

/** Paint the building masses themselves, above whatever shade they cast. */
function paintBuildings(
  ctx: CanvasRenderingContext2D,
  buildings: PreparedBuilding[],
  theme: 'dark' | 'light',
  zoom: number,
  width: number,
  height: number,
): void {
  const path = new Path2D();
  let drew = false;
  // closePath is only needed for the STROKE — fill() closes implicitly, and the
  // call is quadratic in the accumulated path (see the note above emitSweptFlat).
  const willStroke = zoom >= OUTLINE_ZOOM;
  for (const b of buildings) {
    if (b.sn < 4) continue;
    if (b.maxX < 0 || b.minX > width || b.maxY < 0 || b.minY > height) continue;
    path.moveTo(b.sx[0], b.sy[0]);
    for (let i = 1; i < b.sn; i++) path.lineTo(b.sx[i], b.sy[i]);
    if (willStroke) path.closePath();
    drew = true;
  }
  if (!drew) return;
  const ink = BUILDING[theme];
  ctx.fillStyle = ink.fill;
  // Nonzero, like the shadow union: terraces that share a wall then read as one
  // mass instead of showing a seam where two rings meet.
  ctx.fill(path, 'nonzero');
  if (zoom >= OUTLINE_ZOOM) {
    ctx.strokeStyle = ink.stroke;
    ctx.lineWidth = 1;
    ctx.stroke(path);
  }
}

/**
 * Train ink, per theme, keyed to the transport group's accent in the sidebar so
 * the dots on the map and the toggle that switches them on read as one thing.
 *
 * The ring is the opposite of the fill rather than a darker shade of it: these
 * are drawn over shadow, over buildings and over a raster basemap, so the only
 * thing that keeps a 4.5 px dot legible against all three is a hard edge in the
 * page's background colour.
 */
const TRAIN = {
  dark: {
    fill: '#c4b5fd',
    ring: 'rgba(2, 6, 23, 0.9)',
    label: '#ddd6fe',
    halo: 'rgba(2, 6, 23, 0.85)',
  },
  light: {
    fill: '#6d28d9',
    ring: 'rgba(255, 255, 255, 0.95)',
    label: '#4c1d95',
    halo: 'rgba(255, 255, 255, 0.9)',
  },
} as const;

const TRAIN_RADIUS_PX = 4.5;

/** Below this, a hundred numbers over a map of Finland is noise, not a label. */
const TRAIN_LABEL_ZOOM = 10;

/**
 * Paint the live trains, above every layer of shade.
 *
 * DRAWN LAST, AND ON THIS CANVAS RATHER THAN AS A MAPLIBRE LAYER. The overlay
 * sits on top of the map, so a GeoJSON source would put the trains UNDER the
 * shadow fill — and under the full-viewport wash the layer paints after sunset,
 * which at 0.62 alpha would leave a realtime feed barely visible exactly when
 * someone is most likely to be watching it. Drawing them here costs one
 * `map.project` per train, and there are ~111 in the whole country.
 *
 * No interpolation between fixes — see the note in trains.ts. A dot moves when
 * the feed says it moved, and a fix too old to trust is drawn hollow instead of
 * being quietly presented as current.
 */
/**
 * Incident ink, per theme. Amber — the colour the rest of the app already uses
 * for "something needs your attention" (the failed-fetch line right below this
 * uses it), rather than a fourth hue for the reader to learn.
 */
const INCIDENT = {
  dark: { stroke: 'rgba(251, 191, 36, 0.95)', halo: 'rgba(8, 15, 40, 0.85)' },
  light: { stroke: 'rgba(217, 119, 6, 0.95)', halo: 'rgba(255, 255, 255, 0.9)' },
} as const;

/** Below this, a closure's extent is a few pixels and only its position reads. */
const INCIDENT_LINE_ZOOM = 8;

/**
 * Paint road incidents, above the shade and below the trains.
 *
 * LINES ARE DRAWN AS LINES. A third of this feed is LineString or
 * MultiLineString geometry — a closure is a stretch of road, not a spot — and
 * collapsing those to a marker would draw a ten-kilometre closure the same size
 * as a single obstruction and understate it. Points stay points.
 *
 * Haloed for the same reason the train labels are: a stroke here crosses lit
 * ground, shadow, building fill and the full-viewport night wash within one pan,
 * and no flat colour stays legible over all four.
 */
function paintIncidents(
  ctx: CanvasRenderingContext2D,
  map: MaplibreMap,
  incidents: Incident[],
  theme: 'dark' | 'light',
  zoom: number,
  width: number,
  height: number,
): void {
  if (incidents.length === 0) return;
  const ink = INCIDENT[theme];
  const withLines = zoom >= INCIDENT_LINE_ZOOM;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const incident of incidents) {
    const anchor = map.project([incident.lon, incident.lat]);
    // Generous margin: a closure running off the edge of the screen still has to
    // be drawn, because most of it being off-screen is not a reason to hide the
    // part that is on it.
    if (
      anchor.x < -200 ||
      anchor.y < -200 ||
      anchor.x > width + 200 ||
      anchor.y > height + 200
    ) {
      continue;
    }

    if (withLines && incident.lines.length > 0) {
      const path = new Path2D();
      for (const line of incident.lines) {
        let first = true;
        for (const [lon, lat] of line) {
          const p = map.project([lon, lat]);
          if (first) {
            path.moveTo(p.x, p.y);
            first = false;
          } else {
            path.lineTo(p.x, p.y);
          }
        }
      }
      ctx.lineWidth = 6;
      ctx.strokeStyle = ink.halo;
      ctx.stroke(path);
      ctx.lineWidth = 3;
      ctx.strokeStyle = ink.stroke;
      ctx.stroke(path);
      continue;
    }

    // A point incident, or a line too small to read as one: a ring, which stays
    // distinguishable from the trains' filled dots at a glance.
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 5, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = ink.halo;
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink.stroke;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Paint air-quality stations as coloured discs.
 *
 * COLOUR, NOT A NUMBER, because the value is categorical. FMI's index runs 1 to
 * 5 and "3" tells a reader nothing without the scale printed beside it, whereas
 * a position on a green-to-red ramp is legible immediately and needs no legend.
 * The band names are stated in the readout, which is where the scale belongs.
 *
 * Drawn UNDER the temperature labels: a disc survives a number written over it,
 * and a number does not survive a disc.
 */
function paintAirQuality(
  ctx: CanvasRenderingContext2D,
  map: MaplibreMap,
  stations: AirQuality[],
  theme: 'dark' | 'light',
  width: number,
  height: number,
): void {
  if (stations.length === 0) return;
  // A ring in the basemap's own background tone, so a disc reads as a marker on
  // the map rather than as a stain in the shadow layer underneath it.
  const ring = theme === 'dark' ? 'rgba(8, 15, 40, 0.85)' : 'rgba(255, 255, 255, 0.9)';

  ctx.save();
  for (const s of stations) {
    const p = map.project([s.lon, s.lat]);
    if (p.x < -20 || p.y < -20 || p.x > width + 20 || p.y > height + 20) continue;
    const band = Math.min(5, Math.max(1, Math.round(s.index)));
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = AQ_COLORS[band];
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ring;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Temperature ink, per theme. Deliberately neutral rather than a warm/cold ramp:
 * a colour scale would need a legend and would compete with the shadow layer,
 * which is what the page is actually about. The number carries the information.
 *
 * `forecast` is the second ink, and it is not a style choice. Past "now" the
 * layer keeps drawing, from ECMWF's published forecast at the same stations
 * (observations.ts) — so the map has to state, on the number itself, which of
 * the two a reader is looking at. Amber is the page's existing "this is not the
 * present" colour: the clock chip and the scrubbed-time banner already use it.
 * The ITALIC in `paintObservations` carries the same distinction without relying
 * on colour, and the readout says it in words.
 */
const OBSERVATION = {
  dark: {
    label: 'rgba(226, 232, 240, 0.96)',
    forecast: 'rgba(252, 211, 77, 0.96)',
    halo: 'rgba(8, 15, 40, 0.9)',
  },
  light: {
    label: 'rgba(15, 23, 42, 0.96)',
    forecast: 'rgba(180, 83, 9, 0.96)',
    halo: 'rgba(255, 255, 255, 0.92)',
  },
} as const;

/**
 * Paint station temperatures.
 *
 * Collision-suppressed like the train labels, and for a stronger reason: these
 * are ALL text, so two overlapping readings do not degrade into a cluttered dot
 * and a number — they degrade into an unreadable one. When two stations collide
 * the nearer-to-drawn-first one wins and the other is simply not drawn, which is
 * honest at the pixel level: the map is not claiming that station has no reading,
 * it is declining to write two numbers on top of each other.
 */
function paintObservations(
  ctx: CanvasRenderingContext2D,
  map: MaplibreMap,
  observations: Observation[],
  theme: 'dark' | 'light',
  width: number,
  height: number,
): void {
  if (observations.length === 0) return;
  const ink = OBSERVATION[theme];

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;

  // Set once and re-set only when the kind changes. A sampled instant is
  // normally all measurement or all forecast — the boundary between them is
  // "now", which is one instant of the day — so this is one assignment in
  // practice and never more than two.
  let italic: boolean | null = null;
  const setKind = (forecast: boolean) => {
    if (italic === forecast) return;
    italic = forecast;
    ctx.font = `${forecast ? 'italic ' : ''}600 12px system-ui, -apple-system, sans-serif`;
  };

  const placed: number[][] = [];
  for (const o of observations) {
    const p = map.project([o.lon, o.lat]);
    if (p.x < -30 || p.y < -30 || p.x > width + 30 || p.y > height + 30) continue;

    setKind(o.forecast === true);
    // One decimal is what FMI publishes and what a degree of air temperature is
    // worth; rounding to whole degrees would throw away a real distinction
    // between 0.4 and -0.4, which on a Finnish map is the interesting one.
    const text = `${o.celsius.toFixed(1)}°`;
    const w = ctx.measureText(text).width;
    const box = [p.x - w / 2 - 3, p.y - 8, p.x + w / 2 + 3, p.y + 8];
    let collides = false;
    for (const other of placed) {
      if (box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]) {
        collides = true;
        break;
      }
    }
    if (collides) continue;
    placed.push(box);

    ctx.strokeStyle = ink.halo;
    ctx.strokeText(text, p.x, p.y);
    ctx.fillStyle = o.forecast === true ? ink.forecast : ink.label;
    ctx.fillText(text, p.x, p.y);
  }

  ctx.restore();
}

/**
 * A diamond, which is what a position derived from a timetable gets.
 *
 * The measured feed owns the circle in both its states — filled for a fresh fix,
 * hollow for one the train may have left — so a schedule-derived position cannot
 * be a circle of any kind without claiming to be a fix. A four-vertex path reads
 * as a different KIND of mark at 5 px, where a different colour or a different
 * size would only read as a different train.
 */
function diamondPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

function paintTrains(
  ctx: CanvasRenderingContext2D,
  map: MaplibreMap,
  trains: Train[],
  now: number,
  theme: 'dark' | 'light',
  zoom: number,
  width: number,
  height: number,
  /**
   * Whether this list came from the published timetable rather than from fixes.
   *
   * The whole list or none of it — the page never mixes the two, because
   * "measured where we have it, timetable elsewhere" is a choice made once for
   * the instant, not per train (see the draw loop).
   */
  scheduled = false,
): void {
  if (trains.length === 0) return;
  const ink = TRAIN[theme];
  const withLabels = zoom >= TRAIN_LABEL_ZOOM;

  ctx.save();
  if (withLabels) {
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
  }

  /**
   * Label boxes already placed this frame, as [x0, y0, x1, y1].
   *
   * Trains cluster hard — a dozen of them sit within a few pixels of each other
   * in a terminus throat — and unsuppressed labels there overprint into a single
   * illegible smear that reads as one corrupted number rather than as several
   * trains. Dropping the labels that would collide keeps every DOT (which is the
   * actual datum) and loses only the duplicate text.
   *
   * A flat array scanned linearly, not a spatial index: only on-screen trains at
   * z >= TRAIN_LABEL_ZOOM get here, which is tens of boxes.
   */
  const placed: number[][] = [];

  for (const train of trains) {
    const p = map.project([train.lon, train.lat]);
    // A margin rather than a strict viewport test: a dot that is just off-screen
    // should slide in as you pan, not pop, and its label sits to its right.
    if (p.x < -40 || p.y < -40 || p.x > width + 40 || p.y > height + 40) continue;

    if (scheduled) {
      // Outlined with a wash inside it, so a dense corridor still reads as
      // several trains rather than as a smear, and so it can never be mistaken
      // at a glance for the solid dot of a reported position. Staleness does not
      // apply: a timetable point is not a fix that can go out of date, it is a
      // published time that either brackets this instant or does not.
      diamondPath(ctx, p.x, p.y, TRAIN_RADIUS_PX + 1.5);
      ctx.fillStyle = ink.halo;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ink.fill;
      ctx.stroke();
    } else {
      const stale = train.at !== null && now - train.at > TRAIN_STALE_MS;
      ctx.beginPath();
      ctx.arc(p.x, p.y, TRAIN_RADIUS_PX, 0, Math.PI * 2);
      if (stale) {
        // Hollow: the train reported this position, and we are not claiming it
        // is still there. A train in a tunnel keeps its last fix forever.
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = ink.fill;
        ctx.stroke();
      } else {
        ctx.fillStyle = ink.fill;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = ink.ring;
        ctx.stroke();
      }
    }

    if (!withLabels) continue;
    // The number and the speed are everything this feed knows about a train —
    // it carries no type or destination (see trains.ts).
    const text =
      train.speed !== null && train.speed > 0
        ? `${train.number} · ${Math.round(train.speed)} km/h`
        : String(train.number);
    const x = p.x + TRAIN_RADIUS_PX + 4;
    const w = ctx.measureText(text).width;
    // 11 px text, so 6 px either side of the baseline covers the glyph box with
    // a little air — the gap is what stops two labels reading as one string.
    const box = [x, p.y - 6, x + w, p.y + 6];
    let collides = false;
    for (const other of placed) {
      if (box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]) {
        collides = true;
        break;
      }
    }
    if (collides) continue;
    placed.push(box);

    // Haloed, because the label crosses lit ground, shadow and building fill
    // within a single pan and no flat colour stays readable over all three.
    ctx.lineWidth = 3;
    ctx.strokeStyle = ink.halo;
    ctx.strokeText(text, x, p.y);
    ctx.fillStyle = ink.label;
    ctx.fillText(text, x, p.y);
  }

  ctx.restore();
}

/**
 * The selected marker's route and highlight, drawn above every feed.
 *
 * THE ROUTE IS MEASURED, NOT PLANNED. It is the train's own reported fixes for
 * its departure date — the same numbers the dot is drawn from, just all of them
 * — so the line traces where it actually went, including the minutes it spent
 * standing still. A line drawn along the timetable would look tidier and would
 * be a drawing of the schedule, which is a different claim.
 *
 * The dot is placed at the fix NEAREST the page's clock, and only if one is
 * close enough (`fixAt` refuses beyond half a minute). That is what lets a
 * selected train be scrubbed across the whole day when the national feed's
 * history reaches back only as far as this session watched: selecting a train
 * upgrades it from "recorded here" to "measured all day", and where the record
 * has a hole the map draws nothing rather than a plausible position.
 */
function paintSelection(
  ctx: CanvasRenderingContext2D,
  map: MaplibreMap,
  point: { lon: number; lat: number } | null,
  track: TrainFix[] | null,
  theme: 'dark' | 'light',
): void {
  const ink = SELECTED[theme];

  if (track && track.length > 1) {
    const path = new Path2D();
    let first = true;
    for (const fix of track) {
      const p = map.project([fix.lon, fix.lat]);
      if (first) {
        path.moveTo(p.x, p.y);
        first = false;
      } else {
        path.lineTo(p.x, p.y);
      }
    }
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Haloed like every other stroke on this canvas: the route crosses lit
    // ground, shadow, building fill and the night wash within one pan.
    ctx.lineWidth = 5;
    ctx.strokeStyle = theme === 'dark' ? 'rgba(2, 6, 23, 0.7)' : 'rgba(255, 255, 255, 0.8)';
    ctx.stroke(path);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink.track;
    ctx.stroke(path);
    ctx.restore();
  }

  if (!point) return;
  const p = map.project([point.lon, point.lat]);
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = ink.ring;
  ctx.stroke();
  ctx.restore();
}

/**
 * @param lang The language this URL is for — `/live/`, `/en/live/`, `/sv/live/`.
 *
 * The three routes are three indexable URLs with their own titles, descriptions
 * and hreflang (scripts/prerender.mjs), and the prefix has to reach the running
 * page or the split buys nothing: before this the component read whatever
 * language localStorage held, so someone arriving on /en/live/ from an English
 * search result got an English title over a Finnish interface. Applied exactly
 * as PrivacyPage and DataSourcesPage apply theirs — the route sets the language
 * on mount, and the in-page picker is still free to change it afterwards.
 */
export const LivePage: React.FC<{ lang?: Lang }> = ({ lang }) => {
  useI18nVersion();
  const { theme } = useTheme();

  useEffect(() => {
    if (lang && getLang() !== lang) void setLang(lang);
  }, [lang]);

  useEffect(() => {
    if (lang) document.documentElement.lang = lang;
  }, [lang]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  /** Footprints in Mercator space, with per-camera screen buffers. */
  const preparedRef = useRef<PreparedBuilding[]>([]);
  /** Tree canopy, same representation, drawn in its own lighter pass. */
  const preparedCanopyRef = useRef<PreparedBuilding[]>([]);
  /** Camera state the screen buffers were last filled for. */
  const cameraKeyRef = useRef('');
  /** The padded bbox and plan the loaded buildings answer for. */
  const loadedRef = useRef<{ bbox: Bbox; plan: CoveragePlan } | null>(null);
  /**
   * The terrain heightfield covering the current view, or null.
   *
   * A ref, like the footprints, because the draw loop reads it up to 60 times a
   * second and re-rendering the tree at that rate is what the whole
   * ref-plus-rAF arrangement exists to avoid.
   */
  const terrainRef = useRef<HeightField | null>(null);
  /** Which field extent is loaded, so a pan inside it does not refetch. */
  const terrainKeyRef = useRef('');
  /**
   * The last polled train positions, nationally.
   *
   * A ref for the same reason the footprints are — the draw loop reads it on
   * every `render` event. The COUNT is state, because it changes once per poll
   * and belongs in the readout.
   */
  const trainsRef = useRef<Train[]>([]);
  /**
   * Every train snapshot this session has watched arrive, thinned and trimmed.
   *
   * This is the train feed's entire past — Digitraffic publishes the latest fix
   * nationally and nothing else, so scrubbing backwards can only show what we
   * saw. See trainHistory.ts for why the alternatives are all worse.
   */
  const trainBufferRef = useRef<TrainSnapshot[]>([]);
  /**
   * The selected train's measured track for its departure date, when one is
   * loaded — the only feed history on this page that reaches past the session.
   */
  const trackRef = useRef<TrainFix[] | null>(null);
  /** The last polled road incidents, nationally. A ref for the same reason. */
  const incidentsRef = useRef<Incident[]>([]);
  /**
   * The measured feeds' DAYS, rather than their present.
   *
   * These hold every value the page has loaded for the day under the playhead —
   * measured behind "now", ECMWF's forecast ahead of it for temperature — and
   * the clock samples them instead of fetching. That is what makes a drag on the
   * bar move the numbers with the pointer rather than after it. See timeline.ts.
   *
   * Refs, with a version counter beside them, for the reason the footprints are:
   * they are written by network callbacks and read by a memo on every clock
   * step, and neither wants the object identity of the store to churn.
   */
  const obsTimelineRef = useRef<Timeline>(createTimeline());
  const aqTimelineRef = useRef<Timeline>(createTimeline());
  const [timelineVersion, setTimelineVersion] = useState(0);
  const bumpTimeline = useCallback(() => setTimelineVersion((v) => v + 1), []);
  /**
   * The day's published timetables, for the instants the recording cannot answer.
   *
   * A ref rather than state because it is 1,800-odd routes through the day and
   * only the derived positions belong in a render. See trainSchedule.ts for what
   * this is allowed to draw and why it is a diamond.
   */
  const schedulesRef = useRef<TrainSchedule[]>([]);
  const [scheduleVersion, setScheduleVersion] = useState(0);
  /**
   * The current selection, for the draw loop.
   *
   * A ref as well as state: `draw` runs on MapLibre's `render` event and reads
   * it, but rebuilding `draw` whenever the selection changes would also rebuild
   * every effect keyed on it. The effect below schedules the one repaint that
   * a selection change actually needs.
   */
  const selectionRef = useRef<Selection | null>(null);
  /** Pending coalesced repaint, so several triggers in one frame do one draw. */
  const rafRef = useRef(0);
  /** Bumped once the map exists, to re-run the effect that binds its listeners. */
  const [mapReady, setMapReady] = useState(0);
  // Read by the construction effect, which must not re-run on a theme change —
  // rebuilding the map would throw away the camera. The effect below swaps the
  // tile URLs in place instead.
  const themeRef = useRef(theme);
  themeRef.current = theme;

  /**
   * The link this page was opened with, and the camera it resolves to.
   *
   * Both are `useState` initialisers rather than plain calls so they run exactly
   * once — `readInitialUrl` reads `window.location`, which the sync effect below
   * then starts rewriting, and re-reading it on a later render would hand the
   * map back its own output.
   */
  const [initialUrl] = useState<LiveUrlState>(readInitialUrl);
  const [initialView] = useState<LiveView>(
    () =>
      initialUrl.view ??
      readStoredView() ?? { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
  );
  /**
   * The opening camera again, as a ref, for the construction effect.
   *
   * A ref for the same reason `themeRef` is one: that effect must not carry the
   * camera in its dependency array, because re-running it rebuilds the map and
   * throws away whatever the user has panned to since.
   */
  const initialViewRef = useRef<LiveView>(initialView);

  const [when, setWhen] = useState<Date>(() => initialUrl.when ?? new Date());
  /**
   * Whether the page is following real time rather than a scrubbed instant.
   *
   * A separate flag rather than "is `when` close to now", because those are
   * different states with different obligations: a page that has been dragged
   * onto the current minute should NOT silently start advancing under the user's
   * cursor, and a page that is following should say so.
   *
   * A link carrying `t=` opens pinned, for the same reason: it is a link to an
   * instant somebody chose, and starting it live would discard that instant on
   * the first tick.
   */
  const [live, setLive] = useState(() => initialUrl.when === null);
  /** The marker the reader has asked about, or null. */
  const [selection, setSelection] = useState<Selection | null>(null);
  const [center, setCenter] = useState<[number, number]>(() => initialView.center);
  /**
   * The camera's zoom, mirrored into React state for the address bar alone.
   *
   * The draw path reads zoom straight off the map — it changes per frame and
   * must never re-render the tree. This copy is written from the same `moveend`
   * handler that already sets `center`, so it costs no extra render.
   */
  const [zoom, setZoom] = useState<number>(() => initialView.zoom);
  const [enabled, setEnabled] = useState<Set<string>>(() =>
    initialUrl.feeds ? sanitizeEnabled(initialUrl.feeds) : readStoredFeeds(),
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** Whether the honesty strip is expanded. See `readStoredReadout`. */
  const [readoutOpen, setReadoutOpen] = useState(readStoredReadout);
  const [coverage, setCoverage] = useState<{
    source: HeightSource;
    measured: number;
    osmWithHeight: number;
    osmTotal: number;
    partial: boolean;
    canopy: number;
  } | null>(null);
  const [tooCoarse, setTooCoarse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  /**
   * Whether relief is currently being cast, for the readout.
   *
   * State rather than a ref because it changes rarely — once per heightfield
   * load — unlike everything else the draw loop touches.
   */
  const [terrainOn, setTerrainOn] = useState(false);
  /**
   * Whether the day/night terminator is currently crossing the view.
   *
   * State, and set from the draw loop, for the same reason `terrainOn` is: the
   * honesty strip has to know something only the per-sample solar field knows,
   * and it changes at the rate a camera crosses a terminator rather than at the
   * rate the canvas repaints.
   */
  const [splitByTerminator, setSplitByTerminator] = useState(false);
  /**
   * What the last train poll returned: how many are running, or that it failed.
   *
   * `null` until the first poll lands, which is what the readout shows as
   * "loading" — distinct from a poll that came back with nothing.
   */
  const [trainStatus, setTrainStatus] = useState<{ count: number; failed: boolean } | null>(null);
  /**
   * What the recorded train history can answer for the current clock.
   *
   * Set from the draw loop, like `terrainOn`, because only the draw knows
   * whether a snapshot resolved — and it changes at the rate the clock moves,
   * not at the rate the canvas repaints, so a repeated value costs nothing
   * (React bails out on an unchanged one).
   */
  const [trainAt, setTrainAt] = useState<number | null>(null);
  const [incidentStatus, setIncidentStatus] = useState<{ count: number; failed: boolean } | null>(
    null,
  );
  /**
   * The active announcements as last polled.
   *
   * State as well as a ref (see the poll's `onData`): how many are IN EFFECT
   * depends on the page's clock, so the readout has to recount when the clock
   * moves rather than when the poll lands.
   */
  const [incidents, setIncidents] = useState<Incident[]>([]);
  /**
   * Whether each measured feed's LAST request worked, whichever kind it was.
   *
   * One state per feed rather than one per request kind, because the reader's
   * question is one question — "is this layer's source reachable" — and the two
   * requests (the day window, the refinement poll) are two ways of asking the
   * same service the same thing. `failed` takes precedence over the count for
   * the reason the train feed already does it that way: a dropped request leaves
   * the last known values on screen, so the readout is the only place that can
   * say we no longer know they are current.
   *
   * The counts that used to live here have gone. They were counts of what the
   * last POLL returned, and the readout's sentence is now about what is drawn AT
   * THE CLOCK — which is a sample of the timeline and is counted from it.
   */
  const [obsDay, setObsDay] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [aqDay, setAqDay] = useState<'loading' | 'ready' | 'failed'>('loading');
  /** Same, for the day's train timetables — which are only fetched on demand. */
  const [scheduleDay, setScheduleDay] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  const shadowsOn = enabled.has('shadows');
  const sunOn = enabled.has('sun_position');
  const trainsOn = enabled.has('trains');
  const incidentsOn = enabled.has('road_incidents');
  const observationsOn = enabled.has('observations');
  const airQualityOn = enabled.has('air_quality');

  const sun = useMemo(() => sunPosition(when, center[1], center[0]), [when, center]);
  const times = useMemo(() => sunTimes(when, center[1], center[0]), [when, center]);

  const whenMs = when.getTime();
  /**
   * Whether the clock has been moved past what a MEASUREMENT can answer for.
   *
   * Still the flag that keeps an instrument's reading off a future timestamp —
   * but no longer the flag that switches a whole layer off. Temperature carries
   * on past this line from ECMWF's published forecast, drawn as a forecast; air
   * quality does not, because FMI publishes no national air-quality forecast a
   * browser can ask for (airquality.ts). The difference is now stated per feed
   * rather than applied to all of them at once.
   */
  const future = !live && isFuture(whenMs);

  /**
   * The day under the playhead, as a window.
   *
   * This is the unit the measured feeds are fetched in — see the archive note
   * near the top of this file. Midnight to midnight LOCAL, because that is what
   * the scrubber's track is, so the window and the bar cover exactly the same
   * ground and no reachable position on the bar can be outside what was loaded.
   */
  const dayStartMs = useMemo(() => startOfDay(when).getTime(), [when]);
  /**
   * NEXT LOCAL MIDNIGHT, not `dayStartMs` plus twenty-four hours.
   *
   * Finland keeps summer time, so twice a year a local day is 23 or 25 hours
   * long — and the scrubber's own coordinate is minutes past local midnight
   * (`atMinuteOfDay`), which means on the October Sunday its last position is
   * dayStart + 25 h. A window closed at +24 h would leave that final hour of
   * the bar with nothing loaded behind it: a reachable position on the track
   * with no data under it, once a year, for the one hour hardest to notice.
   */
  const dayEndMs = useMemo(() => startOfDay(addDays(when, 1)).getTime(), [when]);

  /**
   * Re-fetch the loaded day every so often, for the forecast's sake.
   *
   * A tick rather than a dependency on `whenMs`: the measured past does not
   * change and today's measured tail is extended by the live poll, so the only
   * thing that goes stale on an open page is the forecast half of the window.
   */
  const [dayEpoch, setDayEpoch] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setDayEpoch((e) => e + 1), DAY_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  /**
   * The instant the refinement request fetches for: null while live, otherwise a
   * quantised, debounced past instant.
   *
   * Both steps matter and they do different jobs — the quantiser bounds how many
   * DISTINCT requests a full-day drag can produce, the debounce stops the ones
   * that a moving pointer would fire and immediately abandon. Neither of them
   * gates what is DRAWN any more; the day window already answered that.
   */
  const archiveTarget = live || future ? null : quantise(whenMs, ARCHIVE_STEP_MS);
  const archiveAt = useDebounced(archiveTarget, ARCHIVE_DEBOUNCE_MS);

  /**
   * The measured feeds, sampled at the clock.
   *
   * THIS IS THE WHOLE POINT OF THE TIMELINE. It runs on every step of the
   * scrubber, costs a binary search per station, and touches the network never —
   * so the temperatures move with the pointer instead of arriving after it. Each
   * value carries the instant it was published for, which is what the panel and
   * the readout print; nothing here is averaged, interpolated or carried further
   * than its feed's tolerance.
   */
  // `timelineVersion` is the dependency the linter cannot see: the stores are
  // refs, so a merge changes what these read without changing anything they
  // list. The counter is bumped by every merge and is the only thing that says
  // "the day behind this ref grew". Same shape below for the train buffer and
  // the schedules.
  /* eslint-disable react-hooks/exhaustive-deps */
  const observationsAt = useMemo(
    () =>
      observationsOn
        ? sampleTimeline(obsTimelineRef.current, whenMs, OBSERVATION_TOLERANCE_MS).map((s) => ({
            lon: s.lon,
            lat: s.lat,
            celsius: s.value,
            at: s.at,
            forecast: s.forecast,
          }))
        : EMPTY_OBSERVATIONS,
    [observationsOn, whenMs, timelineVersion],
  );

  const airQualityAt = useMemo(
    () =>
      airQualityOn
        ? sampleTimeline(aqTimelineRef.current, whenMs, AIR_QUALITY_TOLERANCE_MS).map((s) => ({
            lon: s.lon,
            lat: s.lat,
            index: s.value,
            at: s.at,
          }))
        : EMPTY_AIR_QUALITY,
    [airQualityOn, whenMs, timelineVersion],
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  /** How much of the sampled temperature is forecast rather than measured. */
  const forecastCount = useMemo(
    () => observationsAt.reduce((n, o) => (o.forecast ? n + 1 : n), 0),
    [observationsAt],
  );

  /**
   * The worst air-quality band anywhere AT THE CLOCK.
   *
   * Recomputed from the sample rather than carried on the poll's status, because
   * the poll's answer is about now and the readout's sentence is about whatever
   * instant the bar is showing. "82 stations" says nothing about the air, and a
   * national mean would average a city-centre exceedance into invisibility.
   */
  const airQualityWorst = useMemo(
    () => airQualityAt.reduce((w, s) => Math.max(w, s.index), 0),
    [airQualityAt],
  );

  /**
   * The selection AS OF THE CLOCK, which is not the same as the thing clicked.
   *
   * The panel used to hold the object the pointer landed on and print its
   * numbers forever, so scrubbing three hours back left a station reading
   * beside a clock it had nothing to do with — the same complaint as the map's,
   * one panel further in. Re-resolving here means the panel follows the slider
   * for free: the station keeps its identity (its position) and picks up
   * whatever value the timeline has for the instant on screen.
   *
   * Resolving to NULL hides the panel rather than clearing the selection. The
   * marker is not drawn at this instant either, so an inspector for it would be
   * inspecting nothing — but scrubbing back must bring both of them straight
   * back, and it does, because the underlying `selection` is untouched.
   *
   * Positions compare with `===` deliberately: both sides come from the same
   * timeline series, so they are the same numbers rather than nearly the same.
   */
  const shownSelection = useMemo<Selection | null>(() => {
    if (!selection) return null;
    if (selection.kind === 'observation') {
      const at = observationsAt.find(
        (o) => o.lon === selection.item.lon && o.lat === selection.item.lat,
      );
      return at ? { kind: 'observation', item: at } : null;
    }
    if (selection.kind === 'air_quality') {
      const at = airQualityAt.find(
        (s) => s.lon === selection.item.lon && s.lat === selection.item.lat,
      );
      return at ? { kind: 'air_quality', item: at } : null;
    }
    // An announcement carries its own validity, so "is this on screen right now"
    // is a question Fintraffic already answered — the same filter the map draws
    // with, asked of one record.
    if (selection.kind === 'incident') {
      return activeAt([selection.item], whenMs).length > 0 ? selection : null;
    }
    return selection;
  }, [selection, observationsAt, airQualityAt, whenMs]);

  /**
   * The recorded snapshot for the clock, or null.
   *
   * Hoisted out of the draw loop because three things need the same answer — the
   * painter, the hit test and the readout — and they must not be able to
   * disagree about whether this instant was watched.
   */
  const trainSnapshot = useMemo(
    () => (live ? null : snapshotAt(trainBufferRef.current, whenMs)),
    // `trainStatus` is the poll's heartbeat: it changes once per poll, which is
    // exactly when the buffer behind the ref has grown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, whenMs, trainStatus],
  );

  /**
   * Whether this instant needs the published timetable to be shown at all.
   *
   * Measured first, always: live is the current poll and a scrub inside the
   * session's recording is the snapshot it kept. Only outside both does the page
   * fall back to Fintraffic's plan — which is also what keeps the 638 kB day
   * from being fetched by anyone who does not need it.
   */
  const needSchedule = trainsOn && !live && trainSnapshot === null;

  /**
   * Which departure dates could hold a train running at this instant, debounced.
   *
   * A string rather than an array so the effect below can key on it by value —
   * and debounced because dragging THROUGH the gap either side of the recorded
   * window must not start a 638 kB fetch on the way past.
   */
  const scheduleDatesKey = useDebounced(
    needSchedule ? datesCovering(when).join(',') : '',
    SCHEDULE_DEBOUNCE_MS,
  );

  const scheduledTrains = useMemo(
    () =>
      needSchedule && schedulesRef.current.length > 0
        ? scheduledPositions(schedulesRef.current, whenMs)
        : EMPTY_SCHEDULED,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needSchedule, whenMs, scheduleVersion],
  );

  /** Move the clock, which always means leaving live mode. */
  const scrubTo = useCallback((next: Date) => {
    setWhen(next);
    setLive(false);
  }, []);

  const goLive = useCallback(() => {
    setWhen(new Date());
    setLive(true);
  }, []);

  // A live page has to actually be live. Without this the clock is whatever it
  // was at mount, so the sun slowly drifts out of date on an open tab and the
  // scrubber sits under a minute that has passed.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setWhen(new Date()), LIVE_TICK_MS);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...enabled]));
    } catch {
      /* private mode — the toggles still work for this session */
    }
  }, [enabled]);

  useEffect(() => {
    try {
      localStorage.setItem(READOUT_KEY, readoutOpen ? '1' : '0');
    } catch {
      /* private mode — the strip still opens and closes for this session */
    }
  }, [readoutOpen]);

  /**
   * Keep the address bar saying what the page is showing.
   *
   * `replaceState`, never `pushState`: a pan is not a navigation, and filling
   * the back stack with every camera the map passed through would turn the back
   * button into an undo for gestures nobody thinks of as steps. The cost of that
   * choice is that Back leaves the page rather than retracing it, which is what
   * every map application does and what people expect from one.
   *
   * The write is skipped when the string is already right, so a re-render that
   * changed nothing — a theme flip, a feed's poll landing — does not touch
   * history at all.
   *
   * See urlState.ts for why the clock is written only when it has been moved,
   * and why this page syncs a camera the main map deliberately does not.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = setTimeout(() => {
      const view: LiveView = { center, zoom };
      const search = buildLiveSearch(window.location.search, {
        view,
        when: live ? null : when,
        feeds: [...enabled],
      });
      // Compared through the same decoding the writer applies, so a browser that
      // normalises `,` back to `%2C` in `location.search` cannot make every
      // comparison fail and turn this into a write on every render.
      if (search !== readableQuery(window.location.search)) {
        window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
      }
    }, URL_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [center, zoom, when, live, enabled]);

  /**
   * Remember the camera for a later bare `/live/`.
   *
   * Its own effect, keyed on the camera alone, because the clock ticks every
   * thirty seconds while the page is live and this has nothing to say about the
   * clock — folded into the sync above it would write the same string to
   * localStorage twice a minute forever.
   */
  useEffect(() => {
    writeStoredView({ center, zoom });
  }, [center, zoom]);

  /**
   * Repaint the shadow canvas.
   *
   * Kept in a ref-reading callback rather than driven by React state because it
   * runs on MapLibre's `render` event — up to 60 times a second while panning —
   * and re-rendering the component tree at that rate would make the page
   * unusable. This is the same reasoning the map's tooltipStore is built on.
   */
  const draw = useCallback(() => {
    const map = mapRef.current;
    const canvas = canvasRef.current;
    if (!map || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = map.getCanvas().getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const zoom = map.getZoom();

    /**
     * The whole sun pass: shade, then the masses casting it.
     *
     * An inner function rather than an early return, because it is no longer
     * the last thing drawn — the trains go on top of it, and every one of the
     * three ways this pass can finish (layer off, sun down, sun up) would
     * otherwise need its own copy of the call that paints them. One exit is
     * what stops a fourth branch being added later without it.
     */
    const paintShade = () => {
      const shade = SHADE[theme];
      const buildings = preparedRef.current;

      // Re-project every footprint ONCE per camera position. Scrubbing the time
      // slider then costs four multiply-adds a vertex instead of a projection
      // call, which is what makes a ten-thousand-building city view scrub at all.
      const c = map.getCenter();
      const cameraKey = `${c.lng},${c.lat},${zoom},${map.getBearing()},${width}x${height}`;
      // BUILDINGS AND TREES SHARE ONE FLOOR, AND BELOW IT NEITHER IS DRAWN.
      //
      // They used to have different floors (z12 and z14), so zooming out crossed a
      // band where a forest silently stopped casting while the buildings beside it
      // kept going, and the ground the trees had been shading turned bright. Giving
      // them separate floors is what made that gap possible, so they no longer have
      // separate floors — the detail layer is one thing that is either drawn or not.
      //
      // The floor itself is back after briefly being removed. Removing it meant a
      // zoomed-out view over Helsinki emitted every one of ~9,000 footprints and
      // ~34,000 crowns into a single Path2D, and near sunset the sub-pixel cull
      // cannot help — a 12 km shadow is tens of pixels long however small its caster
      // is, so nothing gets dropped and all 43,000 sweeps are built every frame.
      // That is not a shadow map, it is a stall.
      //
      // What replaces it is terrain (see `drawTerrainShade`), which is what a
      // zoomed-out shadow map should be showing anyway: at this range the relief is
      // the thing casting legible shadows and an individual roof is a pixel.
      const detail = zoom >= DETAIL_MIN_ZOOM;
      const buildingsOn = detail ? buildings : EMPTY_PREPARED;
      const canopy = detail ? preparedCanopyRef.current : EMPTY_PREPARED;
      if (cameraKeyRef.current !== cameraKey && (buildingsOn.length > 0 || canopy.length > 0)) {
        cameraKeyRef.current = cameraKey;
        const transform = cameraAffine(map);
        const simplifyPx = simplifyPxForZoom(zoom);
        for (const b of buildingsOn) projectPrepared(b, transform, simplifyPx);
        for (const c2 of canopy) projectPrepared(c2, transform, simplifyPx * canopySimplifyScale(zoom));
      }

      // The instant, evaluated once. Everything below that asks where the sun is
      // asks it of this, at ITS OWN PLACE — the centre pixel's answer is a fact
      // about the centre pixel and nothing else.
      const frame = solarFrame(when);

      // Night, as a field rather than a verdict. Above the horizon everywhere
      // this is null and costs one loop over ~1,300 samples; where any of the
      // viewport has passed sunset it carries the terminator.
      const twilight = twilightLayer(map, frame, shade, width, height);
      // Repeats are free — React bails out on an unchanged value — and this
      // changes about as often as the camera crosses a terminator, which is
      // rarely. Same shape as `setTerrainOn`.
      setSplitByTerminator(twilight !== null && twilight.lit);

      // One screen-space displacement vector per metre of shadow. Mercator scale
      // varies negligibly across a city-sized viewport, so deriving it once at the
      // centre is accurate to well under a pixel here and removes the per-vertex
      // geodesic offset entirely.
      const bearing = shadowBearing(sun.azimuth);
      const origin = map.project([c.lng, c.lat]);
      const probeMetres = 1000;
      const probe = map.project(offsetPoint(c.lng, c.lat, probeMetres, bearing));
      const ux = (probe.x - origin.x) / probeMetres;
      const uy = (probe.y - origin.y) / probeMetres;

      // The screen-space ceiling from MAX_SHADOW_DIAGONALS, converted back into
      // metres once per frame. `Math.hypot(ux, uy)` is pixels per metre along the
      // shadow's own direction, so this is the length at which a sweep stops being
      // able to reach any visible pixel.
      const pxPerMetre = Math.hypot(ux, uy);
      const maxDrawMetres =
        pxPerMetre > 0
          ? (MAX_SHADOW_DIAGONALS * Math.hypot(width, height)) / pxPerMetre
          : Infinity;

      /** Accumulate one source's swept shadows into a single path. */
      const shadowPath = (list: PreparedBuilding[]): Path2D | null => {
        const p = new Path2D();
        let any = false;
        for (const b of list) {
          if (b.sn < 4) continue;
          const metres = Math.min(shadowLengthMetres(b.height, sun.altitude), maxDrawMetres);
          if (metres <= 0) continue;
          const dx = ux * metres;
          const dy = uy * metres;
          if (Math.max(b.maxX, b.maxX + dx) < 0 || Math.min(b.minX, b.minX + dx) > width) continue;
          if (Math.max(b.maxY, b.maxY + dy) < 0 || Math.min(b.minY, b.minY + dy) > height) continue;
          if (
            b.maxX - b.minX + Math.abs(dx) < MIN_FEATURE_PX &&
            b.maxY - b.minY + Math.abs(dy) < MIN_FEATURE_PX
          ) {
            continue;
          }
          emitSweptFlat(p, b.sx, b.sy, b.sn, dx, dy);
          any = true;
        }
        return any ? p : null;
      };

      const canopyShade = canopy.length ? shadowPath(canopy) : null;

      // ONE path for every ring of every building — see the file header for why
      // this is not a per-polygon fill.
      const path = shadowPath(buildingsOn) ?? new Path2D();

      // Relief, rasterised from the heightfield rather than swept as polygons.
      // Terrain has no footprint to extrude — it is a continuous surface, so its
      // shadow is a per-cell occlusion test, not a silhouette. See terrain.ts.
      const terrain = terrainLayer(
        terrainRef.current,
        sun.altitude,
        bearing,
        map,
        shade,
        frame,
        when.getTime(),
      );

      // SHADE IS A UNION, NOT A STACK.
      //
      // Both casters used to be filled straight onto the canvas, one after the
      // other, so ground that was under a tree AND a building got painted twice
      // and alpha-composited to something darker than either — 0.28 over 0.182
      // reads as 0.41. That put a visibly darker patch wherever a canopy happened
      // to overlap a building's shadow, which is not a real optical effect: a
      // point is either lit or it is not, and a second occluder behind the first
      // changes nothing. Shade is binary; only its SOURCE varies in how much light
      // it stops.
      //
      // So the two are merged first, on a scratch canvas, where the building fill
      // is fully opaque and therefore SATURATES rather than accumulates. The merged
      // alpha is max(building, canopy), and one composite at `shade.day` puts it on
      // screen: building shade at the full tone, canopy-only at CANOPY_ALPHA_SCALE
      // of it, overlap at the building tone exactly.
      //
      // Only when there is something to merge — a viewport with buildings alone
      // keeps the direct single fill, which is cheaper by a full-viewport drawImage.
      const needsMask = canopyShade !== null || terrain !== null || twilight !== null;
      const mask = needsMask ? ensureMask(canvas.width, canvas.height) : null;
      const mctx = mask?.getContext('2d') ?? null;
      if (needsMask && mctx) {
        mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        mctx.clearRect(0, 0, width, height);
        // Weakest caster first, so the opaque ones below saturate over it.
        if (canopyShade) {
          mctx.fillStyle = `rgba(${shade.ink}, ${CANOPY_ALPHA_SCALE})`;
          mctx.fill(canopyShade, 'nonzero');
        }
        if (twilight) {
          // Sunset is an occluder like any other here — opaque, so it saturates
          // with relief and walls instead of adding to them. The smoothing is
          // what turns a 32 px sample step into a clean terminator edge.
          mctx.save();
          mctx.imageSmoothingEnabled = true;
          mctx.imageSmoothingQuality = 'high';
          mctx.drawImage(
            twilight.shade,
            0,
            0,
            twilight.shade.width * TWILIGHT_STEP_PX,
            twilight.shade.height * TWILIGHT_STEP_PX,
          );
          mctx.restore();
        }
        if (terrain) {
          // A hill is not a crown: it stops light completely, so relief goes in at
          // the same full weight as a wall.
          //
          // Drawn through the field's own Mercator->screen transform rather than
          // stretched to the viewport, so it stays registered under rotation and
          // when the field extends past the screen edge. Smoothing is on because
          // the mask is computed at roughly a third of screen resolution AND
          // because a terrain shadow's edge is genuinely soft — cast by a slope,
          // not by a wall — so the interpolation is the correct appearance rather
          // than a concession to it.
          mctx.save();
          mctx.imageSmoothingEnabled = true;
          mctx.imageSmoothingQuality = 'high';
          mctx.transform(terrain.a, terrain.b, terrain.c, terrain.d, terrain.e, terrain.f);
          mctx.drawImage(terrain.canvas, 0, 0);
          mctx.restore();
        }
        // Opaque: this is what makes an overlap saturate to the full tone instead
        // of summing with whatever is already underneath it.
        mctx.fillStyle = `rgb(${shade.ink})`;
        mctx.fill(path, 'nonzero');
        ctx.globalAlpha = shade.day;
        ctx.drawImage(mask!, 0, 0, width, height);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = `rgba(${shade.ink}, ${shade.day})`;
        ctx.fill(path, 'nonzero');
      }

      // Night, past the daytime tone. Separate from the mask on purpose: this is
      // not another occluder to be unioned but the difference between "in shadow"
      // and "the sun has set", and it is zero everywhere the sun is still up — so
      // it cannot deepen a daytime shadow. See twilightLayer.
      if (twilight) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          twilight.deepen,
          0,
          0,
          twilight.deepen.width * TWILIGHT_STEP_PX,
          twilight.deepen.height * TWILIGHT_STEP_PX,
        );
        ctx.restore();
      }

      paintBuildings(ctx, buildingsOn, theme, zoom, width, height);
    };

    if (shadowsOn) paintShade();
    // Last, and above the shade — see paintTrains for why they are not a
    // MapLibre layer.
    // Incidents under the trains: a closure is context for the network, a train
    // is a moving thing on it, and where they coincide the moving thing is what
    // someone is tracking.
    if (incidentsOn) {
      // FILTERED BY THE PUBLISHER'S OWN VALIDITY, at the page's clock. The feed
      // is fetched with `inactiveHours=12` so recently-expired announcements are
      // in hand for a scrub backwards; at "now" this filter is what keeps them
      // off the map, and scrubbing forward onto a planned closure shows
      // Fintraffic's plan rather than a guess.
      paintIncidents(ctx, map, activeAt(incidentsRef.current, whenMs), theme, zoom, width, height);
    }
    if (trainsOn) {
      // THE TRAIN LAYER IS A DIFFERENT SET AT A DIFFERENT TIME, AND IT SAYS SO.
      //
      // Live, it is the latest poll. Scrubbed inside the window this session
      // watched, it is the snapshot recorded nearest that instant — real
      // positions at the times they were reported. Outside both, it is
      // Fintraffic's published timetable for the day, placed between control
      // points and drawn as DIAMONDS rather than dots, because that is a plan
      // and not a fix (see trainSchedule.ts).
      //
      // What it is never is the current positions under a past clock, which
      // remains the one thing here that would be a lie rather than a gap.
      const list = live ? trainsRef.current : (trainSnapshot?.trains ?? EMPTY_TRAINS);
      setTrainAt(live ? null : (trainSnapshot?.at ?? null));
      if (list.length > 0 || !needSchedule) {
        // THE STALENESS CLOCK IS THE SNAPSHOT'S, NOT THE WALL'S. `paintTrains`
        // draws a fix older than two minutes hollow, because a train in a tunnel
        // keeps its last position in the feed indefinitely. Judging a recorded
        // snapshot against `Date.now()` would make every train in it hollow the
        // moment the scrub was more than two minutes back — marking as doubtful
        // the one thing on the page that is certain, which is where they were.
        paintTrains(ctx, map, list, trainSnapshot?.at ?? Date.now(), theme, zoom, width, height);
      } else {
        paintTrains(ctx, map, scheduledTrains, whenMs, theme, zoom, width, height, true);
      }
    }
    // Temperatures last: they are text, and text under a dot or a closure line is
    // unreadable, while a dot under a number is still a dot.
    // Under the temperature text, for the same reason incidents sit under trains:
    // a coloured dot survives a number drawn over it, the reverse does not.
    //
    // Neither is gated on `future` any more. Both are gated on having a sample
    // WITHIN TOLERANCE of the clock, which is a stricter test that happens to
    // cover the future case: nothing has measured tomorrow, so nothing is in
    // range for it — except the forecast, which is in range, and is drawn as one.
    paintAirQuality(ctx, map, airQualityAt, theme, width, height);
    paintObservations(ctx, map, observationsAt, theme, width, height);

    // Above everything, because it is the answer to a question the reader asked.
    if (selectionRef.current) {
      const sel = selectionRef.current;
      const track = sel.kind === 'train' ? trackRef.current : null;
      // WHERE THE RING GOES IS THE SAME QUESTION THE LAYER ANSWERS, asked of one
      // train. Live, that is the current poll — looked up by key rather than
      // reused from the click, or the ring would stay behind while the dot moved
      // away from under it. Scrubbed, it is the train's own measured track when
      // the panel has fetched one (which reaches the whole day) and otherwise the
      // recorded snapshot. Every branch is a position somebody reported.
      const point = (() => {
        if (sel.kind !== 'train') return sel.item;
        const key = trainKey(sel.item);
        const sameTrain = (t: Train) => trainKey(t) === key;
        if (live) return trainsRef.current.find(sameTrain) ?? sel.item;
        // The train's own measured track first — it reaches the whole day and is
        // the best answer this page can give. Then the recorded snapshot. Then,
        // and only then, the timetable position, which is where the ring has to
        // go when the diamond under it came from the plan. Every branch is
        // somewhere a publisher put this train.
        return (
          (track && fixAt(track, whenMs)) ??
          trainSnapshot?.trains.find(sameTrain) ??
          scheduledTrains.find(sameTrain) ??
          null
        );
      })();
      paintSelection(ctx, map, point, track, theme);
    }
  }, [
    shadowsOn,
    trainsOn,
    incidentsOn,
    sun.altitude,
    sun.azimuth,
    when,
    whenMs,
    live,
    theme,
    observationsAt,
    airQualityAt,
    trainSnapshot,
    scheduledTrains,
    needSchedule,
  ]);

  /**
   * Always-current `draw`, so the map listeners can be bound ONCE.
   *
   * `draw` changes on every scrubber tick. Binding it directly meant the effect
   * that owns the map listeners tore down and re-ran at the same rate — and its
   * cleanup aborts the in-flight Overpass request, so scrubbing the time slider
   * while buildings were loading cancelled the fetch over and over and the
   * layer never populated.
   */
  const drawRef = useRef(draw);
  drawRef.current = draw;

  /**
   * Coalesce repaints into one per animation frame.
   *
   * A single slider step used to repaint twice — once from the state effect and
   * once from MapLibre's `render` — and both did the full path build. Collapsing
   * them halves the per-step cost and caps the layer at the display's rate no
   * matter how many triggers arrive.
   */
  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current();
    });
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  /* ------------------------------------------------- the day, loaded once */

  /**
   * Moving to another day throws the loaded one away.
   *
   * Declared BEFORE the loaders so a day change clears and then refills, and
   * kept separate from them so switching a feed off does not discard the day the
   * other feed is still using. Without it a week of scrubbing accumulates every
   * day it visited, and — worse — a station that reported on Tuesday and not on
   * Wednesday would keep Tuesday's number within tolerance of Wednesday's clock.
   */
  useEffect(() => {
    clearTimeline(obsTimelineRef.current);
    clearTimeline(aqTimelineRef.current);
    bumpTimeline();
  }, [dayStartMs, bumpTimeline]);

  /**
   * The day's national air temperature: measured behind now, forecast ahead.
   *
   * TWO REQUESTS, ONE SERIES. The split is at the wall clock rather than at a
   * day boundary because that is where the difference actually falls — today is
   * measured until this hour and forecast after it, and the reader is entitled
   * to see the join. Yesterday issues only the first request, tomorrow only the
   * second, and neither needs a special case here.
   *
   * The forecast arm is allowed to fail on its own. A measured morning with no
   * forecast afternoon is a page that works; failing both because ECMWF's
   * collection hiccuped would not be.
   */
  useEffect(() => {
    if (!observationsOn) return;
    const ac = new AbortController();
    let cancelled = false;
    setObsDay('loading');

    const now = Date.now();
    const measuredTo = Math.min(dayEndMs, now);
    const forecastFrom = Math.max(dayStartMs, now);
    const jobs: Promise<Observation[]>[] = [];
    if (measuredTo > dayStartMs) jobs.push(fetchObservationSeries(dayStartMs, measuredTo, ac.signal));
    if (forecastFrom < dayEndMs) {
      jobs.push(fetchForecastSeries(forecastFrom, dayEndMs, ac.signal).catch(() => []));
    }

    void Promise.all(jobs)
      .then((lists) => {
        if (cancelled) return;
        for (const list of lists) {
          mergeReadings(
            obsTimelineRef.current,
            list.map((o) => ({ lon: o.lon, lat: o.lat, value: o.celsius, at: o.at })),
            list[0]?.forecast === true,
          );
        }
        setObsDay('ready');
        bumpTimeline();
        scheduleDraw();
      })
      .catch((err: unknown) => {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        setObsDay('failed');
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [observationsOn, dayStartMs, dayEndMs, dayEpoch, bumpTimeline, scheduleDraw]);

  /**
   * The day's urban air quality index — measured only, and only up to now.
   *
   * No forecast arm, and that is the source's limit rather than an omission:
   * FMI's SILAM forecast is point-only and currently answers `NaN` for the index
   * (airquality.ts). The layer therefore stops at the present, which the readout
   * states in words.
   */
  useEffect(() => {
    if (!airQualityOn) return;
    const now = Date.now();
    const to = Math.min(dayEndMs, now);
    if (to <= dayStartMs) {
      setAqDay('ready');
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    setAqDay('loading');

    void fetchAirQualitySeries(dayStartMs, to, ac.signal)
      .then((list) => {
        if (cancelled) return;
        mergeReadings(
          aqTimelineRef.current,
          list.map((s) => ({ lon: s.lon, lat: s.lat, value: s.index, at: s.at })),
        );
        setAqDay('ready');
        bumpTimeline();
        scheduleDraw();
      })
      .catch((err: unknown) => {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        setAqDay('failed');
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [airQualityOn, dayStartMs, dayEndMs, dayEpoch, bumpTimeline, scheduleDraw]);

  /**
   * The day's published timetables, fetched only when nothing measured can answer.
   *
   * `scheduleDatesKey` is empty whenever the recorded snapshots or the live poll
   * can speak for the clock, which is what keeps this off the critical path of an
   * ordinary visit entirely — and debounced, so scrubbing across the edge of the
   * session's recording does not start the fetch on the way past. The fetch
   * itself caches per date (trainSchedule.ts), so stepping between two days is
   * one request each and then free.
   */
  useEffect(() => {
    if (!scheduleDatesKey) {
      schedulesRef.current = [];
      setScheduleDay('idle');
      return;
    }
    let cancelled = false;
    setScheduleDay('loading');

    void Promise.all(scheduleDatesKey.split(',').map((d) => fetchDaySchedules(d)))
      .then((lists) => {
        if (cancelled) return;
        schedulesRef.current = lists.flat();
        setScheduleDay('ready');
        setScheduleVersion((v) => v + 1);
        scheduleDraw();
      })
      .catch(() => {
        if (!cancelled) setScheduleDay('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [scheduleDatesKey, scheduleDraw]);

  // Map construction. Runs once — camera changes go through the map instance.
  //
  // maplibre-gl is imported DYNAMICALLY, not at module scope. A static import
  // makes Rolldown fold the `maplibre` manual chunk into the `live` one, which
  // put the whole ~1 MB renderer inside the live chunk and left the map route
  // pulling /live/ just to get MapLibre — the exact coupling the separate budget
  // exists to prevent. It also means the sun readout renders immediately instead
  // of waiting on the renderer.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let created: MaplibreMap | null = null;

    void (async () => {
      const [{ default: maplibregl }] = await Promise.all([
        import('maplibre-gl'),
        import('maplibre-gl/dist/maplibre-gl.css'),
      ]);
      if (cancelled) return;
      try {
        created = new maplibregl.Map({
        container,
        style: {
          version: 8,
          sources: {
            carto: {
              type: 'raster',
              tiles: [tilesFor(themeRef.current)],
              tileSize: 256,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
            },
            'carto-labels': {
              type: 'raster',
              tiles: [labelTilesFor(themeRef.current)],
              tileSize: 256,
            },
          },
          layers: [
            { id: 'carto-tiles', type: 'raster', source: 'carto', minzoom: 0, maxzoom: 20 },
            { id: 'carto-label-tiles', type: 'raster', source: 'carto-labels', minzoom: 0, maxzoom: 20 },
          ],
        },
        // From the link, else the camera this browser was last left at, else
        // Helsinki — resolved once, above, because the constructor is the only
        // place a camera can be set without the map visibly flying there.
        center: initialViewRef.current.center,
        zoom: initialViewRef.current.zoom,
        // Pitch is pinned flat. The overlay projects footprints with an affine
        // Mercator→screen transform, which is exact at pitch 0 and only there;
        // and a tilted view would show 2D footprints lying flat under shadows
        // cast by heights they do not appear to have. Rotation is unaffected —
        // the transform is calibrated from the live camera, bearing included.
        maxPitch: 0,
        pitchWithRotate: false,
        attributionControl: false,
        });
      } catch (err) {
        // WebGL unavailable. The sun readout still works without a map, so fail
        // quietly rather than blanking the page.
        console.warn('LivePage: failed to initialize WebGL', err);
        return;
      }
      mapRef.current = created;
      created.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      created.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      // The listener effect below runs before this resolves, so it needs a nudge
      // once there is actually a map to bind to.
      setMapReady((n) => n + 1);
    })();

    return () => {
      cancelled = true;
      created?.remove();
      mapRef.current = null;
    };
  }, []);

  // Building fetch, debounced and gated on what the viewport can be covered by.
  // An in-flight request is aborted when the camera moves again so a slow
  // Overpass reply can never overwrite the buildings for the viewport the user
  // is actually looking at.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;

    const clearBuildings = () => {
      preparedRef.current = [];
      preparedCanopyRef.current = [];
      cameraKeyRef.current = '';
      loadedRef.current = null;
      setCoverage(null);
    };

    /**
     * Load the heightfield for this view, unless the one in hand already covers
     * it at the same detail.
     *
     * Keyed on the DEM zoom plus the tile the viewport's corners fall in rather
     * than on the raw bbox, because that is the granularity at which the answer
     * actually changes — panning within a tile reuses the field, and the tile
     * cache in terrain.ts means a pan back to somewhere recent costs nothing.
     *
     * Failure is swallowed to a null field. Terrain is an enhancement to the
     * shadow layer; losing it should cost relief, not the building shadows that
     * worked before it existed.
     */
    const ensureTerrain = async (view: Bbox, zoom: number) => {
      if (!hasTerrain()) return;
      const dz = terrainZoomFor(zoom);
      const key = [
        dz,
        Math.floor(view.west * 4),
        Math.floor(view.south * 4),
        Math.ceil(view.east * 4),
        Math.ceil(view.north * 4),
      ].join(',');
      if (terrainKeyRef.current === key) return;
      terrainKeyRef.current = key;
      try {
        const field = await loadHeightField(view, zoom);
        // A newer camera won this race — its own load is authoritative.
        if (terrainKeyRef.current !== key) return;
        terrainRef.current = field;
        setTerrainOn(field !== null);
        scheduleDraw();
      } catch {
        terrainRef.current = null;
        terrainKeyRef.current = '';
        setTerrainOn(false);
      }
    };

    const refresh = () => {
      const c = map.getCenter();
      setCenter([c.lng, c.lat]);
      // Only for the address bar and the remembered camera — the draw path reads
      // zoom off the map directly, because it changes per frame.
      setZoom(map.getZoom());

      // Nothing to draw them for. The sun readout still tracks the camera, but
      // a switched-off layer must not cost the user a multi-megabyte download or
      // a free shared endpoint a query.
      if (!shadowsOn) return;

      const b = map.getBounds();
      const view: Bbox = {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };
      const bbox = padBbox(view, fetchPadMetres(view));
      const plan = planCoverage(bbox);

      // TERRAIN LOADS AT EVERY ZOOM, ahead of the detail floor's early return.
      //
      // It is the layer that has to survive zooming out — relief is what still
      // casts a legible shadow when a roof is a fraction of a pixel — so gating
      // it behind the same threshold that switches buildings off would leave the
      // zoomed-out view showing nothing, which is the state this whole ladder
      // exists to replace.
      void ensureTerrain(view, map.getZoom());

      // ONE THRESHOLD FOR THE DETAIL LAYER, USED BY BOTH THE FETCH AND THE DRAW.
      //
      // There were briefly two — a fetch floor and a separate "is it worth
      // drawing" rule — and they disagreed, which is how a viewport could hold
      // ~43,000 loaded footprints and crowns that the renderer then swept every
      // frame at a zoom where none of them covered a pixel. Keeping the loaded set
      // and the drawn set governed by the SAME number is what makes that
      // impossible rather than merely unlikely: below DETAIL_MIN_ZOOM nothing is
      // fetched, so there is nothing to draw and nothing to project.
      //
      // `planCoverage` still refuses an unreasonable Overpass query on its own
      // terms (area, not zoom) by returning 'none'.
      if (plan === 'none' || map.getZoom() < DETAIL_MIN_ZOOM) {
        setTooCoarse(true);
        clearBuildings();
        scheduleDraw();
        return;
      }
      setTooCoarse(false);

      // Everything this viewport needs is already loaded — a zoom-in, or a pan
      // inside the padding. The plan has to match too: zooming in can turn a
      // measured-heights-only view into one Overpass will also answer for, and
      // a contained bbox alone would keep serving the smaller set forever.
      const loaded = loadedRef.current;
      if (loaded && loaded.plan === plan && bboxContains(loaded.bbox, bbox)) return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        controller?.abort();
        const active = new AbortController();
        controller = active;
        // Aborting for the watchdog and aborting because the camera moved land
        // in the same catch, and they mean opposite things — one is a failure to
        // report, the other is a request the user has already replaced.
        let timedOut = false;
        const watchdog = setTimeout(() => {
          timedOut = true;
          active.abort();
        }, FETCH_TIMEOUT_MS);
        setLoading(true);
        setFetchFailed(false);
        resolveBuildings(bbox, active.signal)
          .then((result) => {
            preparedRef.current = result.buildings.map(prepareBuilding);
            // Trees from the PREVIOUS view are dropped now rather than left to
            // linger under the new one until their own fetch lands.
            preparedCanopyRef.current = [];
            cameraKeyRef.current = '';
            loadedRef.current = { bbox, plan };
            setCoverage({
              source: result.source,
              measured: result.measured,
              canopy: 0,
              osmWithHeight: result.osmWithHeight,
              osmTotal: result.osmTotal,
              partial: result.partial,
            });
            setLoading(false);
            scheduleDraw();

            // Trees follow, without holding the buildings up. Decoding the
            // canopy shard blocks the main thread for the best part of a second
            // (see the note in resolveBuildings), and buildings are the caster
            // worth showing first — so they are already on screen by the time
            // this resolves, and the trees join them a beat later.
            canopyFromShard(bbox)
              .then((canopy) => {
                // A newer camera already replaced this view; its own canopy load
                // is the authoritative one.
                if (active.signal.aborted || loadedRef.current?.bbox !== bbox) return;
                preparedCanopyRef.current = canopy.map(prepareBuilding);
                cameraKeyRef.current = '';
                setCoverage((c) => (c ? { ...c, canopy: canopy.length } : c));
                scheduleDraw();
              })
              .catch(() => {
                /* buildings-only is a valid picture — see canopyFromShard */
              });
          })
          .catch((err: unknown) => {
            if ((err as Error)?.name === 'AbortError' && !timedOut) return;
            setLoading(false);
            setFetchFailed(true);
          })
          .finally(() => clearTimeout(watchdog));
      }, FETCH_DEBOUNCE_MS);
    };

    map.on('moveend', refresh);
    map.on('render', scheduleDraw);
    // Kick the first fetch immediately rather than waiting for the map's 'load'
    // event. The camera is fully defined the moment the map is constructed, so
    // getBounds()/getZoom() are already answerable — whereas 'load' also waits on
    // the basemap, and a slow or unreachable tile CDN would then take the shadow
    // layer down with it even though shadows need no tiles at all.
    refresh();

    return () => {
      map.off('moveend', refresh);
      map.off('render', scheduleDraw);
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
    // `shadowsOn` gates the fetch, so switching the layer back on has to re-run
    // this and ask for the buildings it skipped. Everything else the listeners
    // touch is a ref or a stable callback — deliberately, because this effect
    // owns the abort controller and re-running it cancels an in-flight request.
  }, [scheduleDraw, mapReady, shadowsOn]);

  /**
   * Poll the national train feed while the layer is on.
   *
   * NOT KEYED ON THE CAMERA, deliberately — unlike the buildings above. The
   * whole country is 2.4 kB gzipped, so there is nothing to save by scoping the
   * query to the viewport and something real to lose: a bbox query has to re-run
   * on every pan, and the trains would arrive a beat after the map settles
   * instead of already being there. The set in hand is national, so panning and
   * zooming are pure draw-time filtering.
   *
   * POLLING STOPS WHILE THE TAB IS HIDDEN. This is a page people leave open, and
   * an abandoned tab quietly asking a free public endpoint for data nobody is
   * looking at, every five seconds, forever, is not a reasonable thing to ship.
   * It resumes on `visibilitychange` rather than waiting out the interval, so
   * coming back to the tab shows current positions immediately.
   */
  useFeedPoll<Train[]>({
    enabled: trainsOn,
    fetcher: fetchTrains,
    intervalMs: TRAIN_POLL_MS,
    onData: useCallback(
      (list: Train[]) => {
        trainsRef.current = list;
        // EVERY POLL IS KEPT, thinned, for as long as the window allows. This is
        // the whole of the feed's past — see trainHistory.ts — and it is
        // recorded whether or not the clock has been scrubbed, because a reader
        // who scrubs back has to find something already there.
        recordSnapshot(trainBufferRef.current, Date.now(), list);
        setTrainStatus({ count: list.length, failed: false });
        // An open panel is a live readout too. Without this the speed and the
        // fix time freeze at whatever they were when the dot was clicked, which
        // on a page about realtime data is the wrong kind of still.
        setSelection((prev) => {
          if (prev?.kind !== 'train') return prev;
          const fresh = list.find((t) => trainKey(t) === trainKey(prev.item));
          // Gone from the feed means the journey ended, not that we know less
          // about it — the last reported fix stands, with its own timestamp.
          return fresh ? { kind: 'train', item: fresh } : prev;
        });
        scheduleDraw();
      },
      [scheduleDraw],
    ),
    onError: useCallback(() => {
      setTrainStatus((prev) => ({ count: prev?.count ?? 0, failed: true }));
    }, []),
    onClear: useCallback(() => {
      trainsRef.current = [];
      // The recording is NOT cleared with the layer. Switching the dots off for
      // a minute should not throw away the history that was collected before it,
      // and the buffer trims itself by age regardless.
      setTrainStatus(null);
      scheduleDraw();
    }, [scheduleDraw]),
  });

  /**
   * Road incidents, on the same loop at a much slower cadence.
   *
   * A minute rather than the trains' five seconds, because an announcement is
   * published once and then stands for hours — see incidents.ts.
   */
  useFeedPoll<Incident[]>({
    enabled: incidentsOn,
    fetcher: fetchIncidents,
    intervalMs: INCIDENT_POLL_MS,
    onData: useCallback(
      (list: Incident[]) => {
        incidentsRef.current = list;
        // Also held as state, unlike the other feeds: the readout has to count
        // the announcements in effect at the PAGE'S clock, not the ones the poll
        // returned, and that count changes when the clock moves rather than when
        // the poll lands. Fourteen features once a minute is a cheap render.
        setIncidents(list);
        setIncidentStatus({ count: list.length, failed: false });
        scheduleDraw();
      },
      [scheduleDraw],
    ),
    onError: useCallback(() => {
      setIncidentStatus((prev) => ({ count: prev?.count ?? 0, failed: true }));
    }, []),
    onClear: useCallback(() => {
      incidentsRef.current = [];
      setIncidents([]);
      setIncidentStatus(null);
      scheduleDraw();
    }, [scheduleDraw]),
  });

  /**
   * Station temperatures, on the same loop at the slowest cadence of the three.
   *
   * Five minutes, because most FMI stations publish every ten — see
   * observations.ts. Polling faster re-downloads numbers that cannot have moved.
   */
  useFeedPoll<Observation[]>({
    // NOT what the map draws — the day window is (see the archive note near the
    // top of this file). This is the sharpening pass: while live it keeps
    // today's tail current between day loads, and when the scrubber comes to
    // rest it fetches the ten-minutely readings nearest that instant so the
    // hourly sample under the playhead is replaced by the real one. Nothing
    // waits for it, so a slow response costs the reader no responsiveness.
    //
    // ENABLED WHENEVER THE LAYER IS, INCLUDING FOR A FUTURE CLOCK. It used to be
    // gated on `!future` as well, which looked right — this arm is measurements
    // and there are none — and was a bug with teeth: `useFeedPoll` calls
    // `onClear` when it is disabled, so scrubbing into tomorrow DISCARDED the
    // loaded day, forecast half included, and the layer emptied under a clock
    // the forecast could perfectly well answer for.
    //
    // What the future does change is what it asks for: `at` null, so the poll
    // keeps today's measured tail current instead of asking the archive for an
    // instant that has not happened. Those readings carry their own timestamps,
    // so a clock that cannot be answered by them simply does not see them.
    enabled: observationsOn,
    at: future ? null : archiveAt,
    fetcher: fetchObservations,
    intervalMs: OBSERVATION_POLL_MS,
    onData: useCallback(
      (list: Observation[]) => {
        mergeReadings(
          obsTimelineRef.current,
          list.map((o) => ({ lon: o.lon, lat: o.lat, value: o.celsius, at: o.at })),
        );
        setObsDay('ready');
        bumpTimeline();
        scheduleDraw();
      },
      [bumpTimeline, scheduleDraw],
    ),
    onError: useCallback(() => setObsDay('failed'), []),
    onClear: useCallback(() => {
      // The day goes with the layer, unlike the trains' recording: it is
      // re-fetchable in one request, so holding a day of a switched-off feed
      // buys nothing and a stale one would have to be invalidated anyway.
      clearTimeline(obsTimelineRef.current);
      setObsDay('loading');
      bumpTimeline();
      scheduleDraw();
    }, [bumpTimeline, scheduleDraw]),
  });

  /**
   * Air quality, the slowest loop on the page.
   *
   * The index is published hourly, so a quarter-hour poll is already four times
   * finer than the data can move — see airquality.ts.
   */
  useFeedPoll<AirQuality[]>({
    // Same shape as the temperature poll above, and for the same reason —
    // disabling it for a future clock would clear the day this feed has no
    // forecast to replace with.
    enabled: airQualityOn,
    at: future ? null : archiveAt,
    fetcher: fetchAirQuality,
    intervalMs: AIR_QUALITY_POLL_MS,
    onData: useCallback(
      (list: AirQuality[]) => {
        mergeReadings(
          aqTimelineRef.current,
          list.map((s) => ({ lon: s.lon, lat: s.lat, value: s.index, at: s.at })),
        );
        setAqDay('ready');
        bumpTimeline();
        scheduleDraw();
      },
      [bumpTimeline, scheduleDraw],
    ),
    onError: useCallback(() => setAqDay('failed'), []),
    onClear: useCallback(() => {
      clearTimeline(aqTimelineRef.current);
      setAqDay('loading');
      bumpTimeline();
      scheduleDraw();
    }, [bumpTimeline, scheduleDraw]),
  });

  useEffect(() => {
    scheduleDraw();
  }, [draw, scheduleDraw]);

  // The selection is read by the draw loop through a ref, so changing it does
  // not rebuild `draw` — which means it also does not repaint by itself.
  useEffect(() => {
    selectionRef.current = shownSelection;
    if (shownSelection?.kind !== 'train') trackRef.current = null;
    scheduleDraw();
  }, [shownSelection, scheduleDraw]);

  /** The selected train's measured track, once the panel has fetched it. */
  const onTrack = useCallback(
    (track: TrainFix[] | null) => {
      trackRef.current = track;
      scheduleDraw();
    },
    [scheduleDraw],
  );

  /**
   * What is under a point on the map, given the current clock.
   *
   * The candidate sets are exactly what is DRAWN at this instant — the same
   * filters, in the same order — because a marker you can see and cannot click,
   * or click and cannot see, is worse than either.
   */
  const hitTest = useCallback(
    (point: { x: number; y: number }): Selection | null => {
      const map = mapRef.current;
      if (!map) return null;
      // Exactly the list the draw loop just painted, chosen by the same test —
      // measured first, timetable only where nothing measured reaches.
      const measured = live ? trainsRef.current : (trainSnapshot?.trains ?? EMPTY_TRAINS);
      const trains = trainsOn
        ? measured.length > 0 || !needSchedule
          ? measured
          : (scheduledTrains as Train[])
        : undefined;
      const visible = incidentsOn ? activeAt(incidentsRef.current, whenMs) : undefined;
      const hit = pickFeature(
        point,
        {
          trains,
          incidents: visible,
          observations: observationsAt,
          airQuality: airQualityAt,
        },
        (lon, lat) => map.project([lon, lat]),
      );
      if (!hit) return null;
      if (hit.kind === 'train' && trains) return { kind: 'train', item: trains[hit.index] };
      if (hit.kind === 'incident' && visible) return { kind: 'incident', item: visible[hit.index] };
      if (hit.kind === 'observation') {
        return { kind: 'observation', item: observationsAt[hit.index] };
      }
      return { kind: 'air_quality', item: airQualityAt[hit.index] };
    },
    [
      trainsOn,
      incidentsOn,
      live,
      whenMs,
      observationsAt,
      airQualityAt,
      trainSnapshot,
      scheduledTrains,
      needSchedule,
    ],
  );

  // Bound once and read through a ref, like `draw`: the map's listeners must not
  // be torn down and rebuilt every time the clock ticks.
  const hitRef = useRef(hitTest);
  hitRef.current = hitTest;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onClick = (e: { point: { x: number; y: number } }) => {
      // Clicking empty map clears — the panel is an inspector, not a modal, so
      // dismissing it should not require finding its close button.
      setSelection(hitRef.current(e.point));
    };

    /**
     * Hover feedback, throttled.
     *
     * Without it there is nothing on screen saying the markers are clickable,
     * and this canvas has no DOM elements to carry a `cursor` rule. The throttle
     * is what keeps it honest about cost: a hit test projects every visible
     * marker, and MapLibre emits `mousemove` at pointer rate.
     */
    let lastMove = 0;
    const onMove = (e: { point: { x: number; y: number } }) => {
      const now = Date.now();
      if (now - lastMove < 60) return;
      lastMove = now;
      map.getCanvas().style.cursor = hitRef.current(e.point) ? 'pointer' : '';
    };

    map.on('click', onClick);
    map.on('mousemove', onMove);
    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMove);
    };
  }, [mapReady]);

  // Follow the site-wide light/dark choice by swapping the raster tile URLs in
  // place. Deliberately not `setStyle` — that tears down and rebuilds every
  // source and layer, which on this page would drop the camera and force a
  // fresh building fetch for a change that only affects two URLs.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [id, url] of [
      ['carto', tilesFor(theme)],
      ['carto-labels', labelTilesFor(theme)],
    ] as const) {
      const source = map.getSource(id);
      // setTiles exists on RasterTileSource; guard because getSource is typed
      // as the union of every source kind.
      if (source && 'setTiles' in source) (source as { setTiles: (t: string[]) => void }).setTiles([url]);
    }
  }, [theme, mapReady]);

  const toggleFeed = (feedId: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(feedId)) next.delete(feedId);
      else next.add(feedId);
      return next;
    });

  const setAll = (on: boolean) => setEnabled(on ? defaultEnabledFeeds() : new Set<string>());

  const shadowRatio = shadowLengthRatio(sun.altitude);

  /** How many announcements are in effect at the clock, not how many were polled. */
  const incidentsNow = useMemo(() => activeAt(incidents, whenMs).length, [incidents, whenMs]);

  /**
   * The coverage sentence for whichever tier(s) actually supplied the buildings.
   *
   * Source-aware because the tiers mean different things: the city model has a
   * measured height for every building it holds, so an "n of m" ratio would
   * always read 100 % and tell nobody anything, whereas OSM's gaps are the whole
   * point. A viewport spanning both gets each half stated separately rather than
   * one blended figure that is true of neither.
   */
  const coverageText = (() => {
    if (!coverage) return null;
    // Trees are stated separately. They are now cast at every zoom the buildings
    // are, so the count is simply whether the layer has any — it no longer has to
    // second-guess a zoom threshold to avoid claiming shade that is not drawn.
    const trees =
      coverage.canopy > 0
        ? ' ' + t('live.shadow.canopy').replace('{n}', String(coverage.canopy))
        : '';
    // Relief is stated alongside the casters, not instead of them: at street
    // zoom a hill still shades whole blocks, and a reader who sees shade with no
    // building over it should be able to tell that terrain is why.
    const relief = terrainOn ? ' ' + t('live.shadow.terrain') : '';
    if (coverage.source === 'city_model') {
      // Buildings that stop along a straight line have to be explained, or the
      // empty half of the screen reads as "nothing is built there".
      const key = coverage.partial ? 'live.shadow.coverage_partial' : 'live.shadow.coverage_measured';
      return t(key).replace('{n}', String(coverage.measured)) + trees + relief;
    }
    if (coverage.source === 'mixed') {
      return t('live.shadow.coverage_mixed')
        .replace('{measured}', String(coverage.measured))
        .replace('{n}', String(coverage.osmWithHeight))
        .replace('{total}', String(coverage.osmTotal)) + trees + relief;
    }
    return (
      t('live.shadow.coverage')
        .replace('{n}', String(coverage.osmWithHeight))
        .replace('{total}', String(coverage.osmTotal)) + trees + relief
    );
  })();

  /** Whether any enabled feed has a sentence to show at all. */
  const readoutOn = shadowsOn || trainsOn || incidentsOn || observationsOn || airQualityOn;

  /**
   * Whether any of those sentences is a failure rather than a result.
   *
   * ONE MIRROR OF THE AMBER ARMS BELOW, and it has to stay one: each clause here
   * is the exact condition under which the strip renders an amber paragraph, and
   * a clause that drifts out of step re-creates the thing the strip exists to
   * prevent — a blank layer that could equally be "nothing is happening" or
   * "we could not ask". When the strip is collapsed this is the only channel
   * left, so it is what turns the chip amber.
   */
  const readoutAlert =
    (shadowsOn && sun.altitude > 0 && !tooCoarse && !loading && fetchFailed) ||
    (trainsOn &&
      (live
        ? trainStatus?.failed === true
        : trainAt === null && scheduleDay === 'failed')) ||
    (incidentsOn && incidentStatus?.failed === true) ||
    (observationsOn && obsDay === 'failed') ||
    (airQualityOn && aqDay === 'failed');

  return (
    <div className="flex h-screen w-full flex-col bg-white text-surface-900 dark:bg-surface-950 dark:text-white">
      <header className="flex items-center gap-3 border-b border-surface-200 px-4 py-2 dark:border-surface-800">
        <a href="/" className="text-sm font-semibold text-surface-700 hover:text-surface-900 dark:text-surface-200 dark:hover:text-white">
          naapurustot<span className="text-brand-400">.fi</span>
        </a>
        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-400">
          {t('live.badge')}
        </span>
        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="ml-auto rounded border border-surface-300 px-2 py-1 text-xs dark:border-surface-700"
          >
            {t('live.filters.title')}
          </button>
        )}
        <select
          className="ml-auto rounded border border-surface-300 bg-white px-2 py-1 text-xs dark:border-surface-700 dark:bg-surface-900"
          value={getLang()}
          onChange={(e) => void setLang(e.target.value as Lang)}
          aria-label={t('live.language')}
        >
          <option value="fi">Suomi</option>
          <option value="en">English</option>
          <option value="sv">Svenska</option>
        </select>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <FeedSidebar
            enabled={enabled}
            onToggle={toggleFeed}
            onSetAll={setAll}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        <div className="relative min-w-0 flex-1">
          {/* h-full, NOT `absolute inset-0`: MapLibre stamps `.maplibregl-map`
              onto its container, and that class carries `position: relative`,
              which beats the absolute positioning and collapses the div to
              height 0 — the canvas then falls back to its intrinsic 300 px and
              the map looks like it never loaded. Size it explicitly instead. */}
          <div ref={containerRef} className="h-full w-full" />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
          />

          {/* Honesty strip. Every state the shadow layer can be in says which one
              it is, because an empty map means four different things here:
              zoomed too far out, sun below the horizon, Overpass unreachable, or
              genuinely no buildings with height data.

              Collapsed it is one chip, which is the strip's affordance and its
              alert light at once: amber means one of the sentences behind it is
              a failure rather than a count (see `readoutAlert`), which is the
              one thing that must survive the collapse. */}
          {readoutOn && !readoutOpen && (
            <button
              type="button"
              onClick={() => setReadoutOpen(true)}
              aria-expanded={false}
              aria-label={t(readoutAlert ? 'live.readout.alert' : 'live.readout.show')}
              className={`absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-sm ring-1 backdrop-blur transition-colors ${
                readoutAlert
                  ? 'bg-amber-500/95 text-white ring-amber-600/40 hover:bg-amber-500'
                  : 'bg-white/90 text-surface-600 ring-surface-200 hover:bg-white dark:bg-surface-950/85 dark:text-surface-300 dark:ring-surface-800 dark:hover:bg-surface-950'
              }`}
            >
              <span aria-hidden="true" className="leading-none">
                {readoutAlert ? '!' : 'ℹ'}
              </span>
              {t('live.readout.title')}
            </button>
          )}

          {readoutOn && readoutOpen && (
            <div className="absolute left-3 top-3 z-10 max-w-xs space-y-1 rounded-lg bg-white/90 px-3 py-2 text-xs leading-relaxed shadow-sm ring-1 ring-surface-200 backdrop-blur dark:bg-surface-950/85 dark:ring-surface-800">
              <div className="flex items-center gap-2">
                <h2 className="mr-auto text-[10px] font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500">
                  {t('live.readout.title')}
                </h2>
                <button
                  type="button"
                  onClick={() => setReadoutOpen(false)}
                  aria-expanded
                  aria-label={t('live.readout.hide')}
                  className="-mr-1 -mt-0.5 shrink-0 rounded px-1.5 text-base leading-none text-surface-400 hover:text-surface-900 dark:text-surface-500 dark:hover:text-white"
                >
                  −
                </button>
              </div>

              {/* WHEN THE CLOCK IS NOT NOW, THAT IS THE FIRST THING SAID.
                  Everything under this line is a statement about a moment, and
                  on a page called /live/ the reader's default assumption is that
                  the moment is this one. Stating it once at the top is cheaper
                  than qualifying every sentence below — and the second line is
                  the honest caveat that the feeds do not all reach equally far,
                  which is what `time` in the feed registry encodes. */}
              {!live && (
                <p className="-mx-1 mb-1 rounded bg-amber-500/15 px-2 py-1 font-semibold text-amber-700 dark:text-amber-300">
                  {t('live.time.showing')
                    .replace('{date}', shortDate(when))
                    .replace('{time}', clockTime(when))}
                  <span className="block font-normal opacity-80">{t('live.time.scrub_note')}</span>
                </p>
              )}

              {shadowsOn && (
                sun.altitude <= 0 ? (
                  <p className="text-surface-600 dark:text-surface-300">
                    {/* "The whole area is in shade" is a claim about the whole
                        area, and a zoomed-out view can plainly contradict it —
                        the sun is down here and up two provinces east, with the
                        line between them drawn on screen. Polar night keeps its
                        own sentence: it is a statement about the day at this
                        place, which a sunlit corner elsewhere does not falsify. */}
                    {times.polar === 'night'
                      ? t('live.shadow.polar_night')
                      : splitByTerminator
                        ? t('live.shadow.sun_down_partial')
                        : t('live.shadow.sun_down')}
                  </p>
                ) : tooCoarse ? (
                  <p className="text-surface-600 dark:text-surface-300">
                    {/* "Zoom in" was the only thing this could say when nothing was
                        drawn out here. Relief IS drawn now, so saying the layer is
                        blank would be false — it states what is being cast and what
                        is still to come. */}
                    {terrainOn ? t('live.shadow.terrain_only') : t('live.shadow.zoom_in')}
                  </p>
                ) : loading ? (
                  <p className="text-surface-600 dark:text-surface-300">{t('live.shadow.loading')}</p>
                ) : fetchFailed ? (
                  <p className="text-amber-600 dark:text-amber-400">{t('live.shadow.failed')}</p>
                ) : coverageText ? (
                  <p className="text-surface-600 dark:text-surface-300">{coverageText}</p>
                ) : null
              )}

              {/* The train feed states its own three cases for the same reason
                  the shadow layer does: a map with no dots on it means "still
                  asking", "asked and could not reach Fintraffic", or "asked, and
                  this is genuinely everything running in Finland right now". */}
              {trainsOn && (
                !live ? (
                  /* SCRUBBED, so the question is no longer "how many are
                     running" but "where does this instant's answer come from".
                     A recorded snapshot is stated with the second it was taken.
                     Failing that, the day's published timetable is stated AS a
                     timetable, with the mark it draws named, because a diamond
                     nobody explained is just a dot the reader has not looked at
                     closely. Only when neither is available is it a gap — and
                     the gap says how far the session's own recording reaches,
                     because "no trains" and "we were not looking" are different
                     facts that the map draws identically. */
                  trainAt !== null ? (
                    <p className="text-surface-600 dark:text-surface-300">
                      {t('live.trains.recorded').replace('{time}', clockSeconds(trainAt))}
                    </p>
                  ) : scheduleDay === 'loading' ? (
                    <p className="text-surface-600 dark:text-surface-300">
                      {t('live.trains.schedule_loading')}
                    </p>
                  ) : scheduleDay === 'ready' && scheduledTrains.length > 0 ? (
                    <p className="text-surface-600 dark:text-surface-300">
                      {t('live.trains.scheduled').replace(
                        '{n}',
                        String(scheduledTrains.length),
                      )}
                    </p>
                  ) : scheduleDay === 'failed' ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      {t('live.trains.schedule_failed')}
                    </p>
                  ) : (
                    <p className="text-surface-600 dark:text-surface-300">
                      {t('live.trains.no_record').replace(
                        '{minutes}',
                        String(Math.round(TRACK_WINDOW_MS / 60_000)),
                      )}
                      {(() => {
                        const range = trackedRange(trainBufferRef.current);
                        return range
                          ? ' ' +
                              t('live.trains.recorded_range')
                                .replace('{from}', clockTime(range.from))
                                .replace('{to}', clockTime(range.to))
                          : '';
                      })()}
                    </p>
                  )
                ) : trainStatus === null ? (
                  <p className="text-surface-600 dark:text-surface-300">{t('live.trains.loading')}</p>
                ) : trainStatus.failed ? (
                  <p className="text-amber-600 dark:text-amber-400">{t('live.trains.failed')}</p>
                ) : (
                  <p className="text-surface-600 dark:text-surface-300">
                    {t('live.trains.count').replace('{n}', String(trainStatus.count))}
                  </p>
                )
              )}

              {/* Same three cases again, and the third one matters most here:
                  an empty road map is a RESULT — "nothing is currently reported
                  anywhere in Finland" — and it has to be distinguishable from
                  the feed being unreachable, which looks identical on the map. */}
              {incidentsOn && (
                incidentStatus === null ? (
                  <p className="text-surface-600 dark:text-surface-300">
                    {t('live.incidents.loading')}
                  </p>
                ) : incidentStatus.failed ? (
                  <p className="text-amber-600 dark:text-amber-400">{t('live.incidents.failed')}</p>
                ) : incidentsNow === 0 ? (
                  <p className="text-surface-600 dark:text-surface-300">
                    {t('live.incidents.none')}
                  </p>
                ) : (
                  <p className="text-surface-600 dark:text-surface-300">
                    {/* The count IN EFFECT at the clock, not the count polled —
                        the feed carries recently-expired and future-dated
                        announcements so the clock can move through them. */}
                    {t('live.incidents.count').replace('{n}', String(incidentsNow))}
                  </p>
                )
              )}

              {/* THE SENTENCE IS ABOUT WHAT IS ON THE MAP AT THE CLOCK, which
                  since the day is loaded as a window is no longer the same
                  question as "did the last poll work". Order matters: an empty
                  layer is explained by whichever of the three actually caused
                  it — the day could not be loaded, the day is still loading, or
                  the day loaded and simply has nothing within tolerance of this
                  minute. The forecast case is stated separately and by name,
                  because a number drawn from a model must never be read as a
                  reading no matter how carefully it is drawn. */}
              {observationsOn && (
                obsDay === 'failed' ? (
                  <p className="text-amber-600 dark:text-amber-400">
                    {t('live.observations.failed')}
                  </p>
                ) : obsDay === 'loading' && observationsAt.length === 0 ? (
                  <p className="text-surface-600 dark:text-surface-300">
                    {t('live.observations.loading')}
                  </p>
                ) : observationsAt.length === 0 ? (
                  <p className="text-surface-600 dark:text-surface-300">
                    {t('live.observations.none')}
                  </p>
                ) : forecastCount === observationsAt.length ? (
                  <p className="text-surface-600 dark:text-surface-300">
                    {t('live.observations.forecast').replace('{n}', String(observationsAt.length))}
                  </p>
                ) : forecastCount > 0 ? (
                  <p className="text-surface-600 dark:text-surface-300">
                    {t('live.observations.mixed')
                      .replace('{measured}', String(observationsAt.length - forecastCount))
                      .replace('{n}', String(forecastCount))}
                  </p>
                ) : (
                  <p className="text-surface-600 dark:text-surface-300">
                    {t('live.observations.count').replace('{n}', String(observationsAt.length))}
                  </p>
                )
              )}

              {airQualityOn && (
                aqDay === 'failed' ? (
                  <p className="text-amber-600 dark:text-amber-400">
                    {t('live.air_quality.failed')}
                  </p>
                ) : aqDay === 'loading' && airQualityAt.length === 0 ? (
                  <p className="text-surface-600 dark:text-surface-300">
                    {t('live.air_quality.loading')}
                  </p>
                ) : airQualityAt.length === 0 ? (
                  /* No forecast arm exists for this feed — SILAM is point-only
                     and answers NaN for the index — so a clock past the last
                     published hour is a gap, and it says so rather than
                     stretching an hourly average forward over it. */
                  <p className="text-surface-600 dark:text-surface-300">
                    {future ? t('live.air_quality.future') : t('live.air_quality.none')}
                  </p>
                ) : (
                  <p className="text-surface-600 dark:text-surface-300">
                    {t('live.air_quality.count')
                      .replace('{n}', String(airQualityAt.length))
                      .replace('{worst}', t(aqBandKey(airQualityWorst)))}
                  </p>
                )
              )}

              {/* The markers are clickable and nothing else on screen says so —
                  they are canvas pixels, with no hover affordance beyond the
                  cursor. One line, and only while a clickable feed is on. */}
              {(trainsOn || incidentsOn || observationsOn || airQualityOn) && !shownSelection && (
                <p className="pt-0.5 text-surface-400 dark:text-surface-500">
                  {t('live.detail.hint')}
                </p>
              )}
            </div>
          )}

          {shownSelection && (
            <DetailPanel
              selection={shownSelection}
              when={when}
              onClose={() => setSelection(null)}
              onTrack={onTrack}
            />
          )}
        </div>
      </div>

      <TimeBar
        when={when}
        live={live}
        onScrub={scrubTo}
        onNow={goLive}
        center={center}
        sun={sun}
        times={times}
        shadowRatio={shadowRatio}
        showSun={sunOn}
      />
    </div>
  );
};

export default LivePage;
