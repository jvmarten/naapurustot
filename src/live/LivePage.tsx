import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { sunPosition, sunTimes, shadowBearing, shadowLengthRatio } from '../utils/sun';
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

/**
 * One labelled number in the sun readout, reserved at its widest value.
 *
 * THE POINT IS THE FIXED WIDTH, not the styling. These sit in the same flex row
 * as the time scrubber, which is `flex-1` and therefore absorbs any width the
 * rest of the row gives up. Every one of these values changes character count as
 * you scrub — altitude crosses zero and gains a minus sign, azimuth runs 9° to
 * 360°, the shadow ratio flips between a number and a dash — so the readout kept
 * resizing and the slider grew and shrank underneath the user's own cursor. The
 * track moving while you drag it is a nasty thing to do to a control that exists
 * to be dragged.
 *
 * `tabular-nums` alone does not fix it: it equalises digit WIDTHS, not digit
 * COUNTS. The reservation is what makes the row's width independent of the time
 * being shown, and `ch` is the natural unit for it once the digits are tabular.
 */
const SunStat: React.FC<{ label: string; width: string; children: React.ReactNode }> = ({
  label,
  width,
  children,
}) => (
  <span className="whitespace-nowrap">
    {label}:{' '}
    <b
      className="inline-block text-right tabular-nums text-surface-900 dark:text-white"
      style={{ minWidth: width }}
    >
      {children}
    </b>
  </span>
);

/**
 * The shadow-length multiplier, formatted so it cannot run away.
 *
 * It is cot(altitude), which is unbounded: at 0.1° above the horizon a building
 * casts 573 times its height, and the figure keeps climbing right up to sunset.
 * Printing it verbatim is both useless — nobody needs three significant figures
 * of "very long" — and a layout hazard, because no reserved width can hold it.
 * Past 99 it becomes ">99", which says the same thing in a fixed number of
 * characters.
 */
function formatShadowRatio(ratio: number | null): string {
  if (ratio === null) return '—';
  if (ratio > 99) return '>99×';
  return `${ratio.toFixed(1)}×`;
}

/** Local wall-clock "HH:MM" for an instant, in the viewer's own zone. */
function clockTime(date: Date | null): string {
  if (!date) return '—';
  return timeFormat().format(date);
}

/**
 * The one formatter, built once.
 *
 * `Date.prototype.toLocaleTimeString` constructs a fresh `Intl.DateTimeFormat`
 * on every call, and that construction — not the formatting — is the expensive
 * part. This is called three times per render (clock, sunrise, sunset) and the
 * footer re-renders on every step of the time scrubber, so it showed up at 3 %
 * of total profile time while dragging the slider: more than the shadow sweep it
 * sits next to. Hoisting the formatter makes it a lookup.
 *
 * Lazily built rather than at module scope so it picks up the environment's
 * locale at first use rather than at import, and so it costs nothing on the
 * pages that never mount /live/.
 */
let cachedTimeFormat: Intl.DateTimeFormat | null = null;
function timeFormat(): Intl.DateTimeFormat {
  cachedTimeFormat ??= new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  return cachedTimeFormat;
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
  ink: readonly [number, number, number],
): TerrainLayer | null {
  if (!field || sunAltitudeDeg <= 0) return null;
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

  // Quantised: a tenth of a degree of sun is far below one pixel of shadow
  // movement at these cell sizes, and rounding is what lets a slow drag of the
  // time slider reuse the mask between adjacent ticks instead of rebuilding it.
  const key = `${sunAltitudeDeg.toFixed(1)},${shadowBearingDeg.toFixed(1)},${ink.join()}`;
  if (terrainCacheField !== field || terrainCacheKey !== key) {
    const mask = terrainShadowMask(field, sunAltitudeDeg, shadowBearingDeg);
    if (!mask) return null;
    // Inked here rather than left as bare coverage. The merged mask is
    // composited onto the page in ONE drawImage, so every caster on it has to
    // already carry the theme's shade colour — a black-filled terrain would come
    // out black next to the buildings' deep blue instead of joining the union.
    if (!terrainPixels) terrainPixels = tctx.createImageData(width, height);
    const px = terrainPixels.data;
    const [ir, ig, ib] = ink;
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

export const LivePage: React.FC = () => {
  useI18nVersion();
  const { theme } = useTheme();
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
  /** Pending coalesced repaint, so several triggers in one frame do one draw. */
  const rafRef = useRef(0);
  /** Bumped once the map exists, to re-run the effect that binds its listeners. */
  const [mapReady, setMapReady] = useState(0);
  // Read by the construction effect, which must not re-run on a theme change —
  // rebuilding the map would throw away the camera. The effect below swaps the
  // tile URLs in place instead.
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const [when, setWhen] = useState<Date>(() => new Date());
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [enabled, setEnabled] = useState<Set<string>>(readStoredFeeds);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

  const shadowsOn = enabled.has('shadows');
  const sunOn = enabled.has('sun_position');

  const sun = useMemo(() => sunPosition(when, center[1], center[0]), [when, center]);
  const times = useMemo(() => sunTimes(when, center[1], center[0]), [when, center]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...enabled]));
    } catch {
      /* private mode — the toggles still work for this session */
    }
  }, [enabled]);

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

    if (!shadowsOn) return;

    const shade = SHADE[theme];
    const buildings = preparedRef.current;
    const zoom = map.getZoom();

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

    // The sun is below the horizon: every surface in view is in shade, so the
    // shade is the whole viewport. Drawing nothing here — which is what this
    // used to do — says "no data" in the same visual language.
    if (sun.altitude <= 0) {
      ctx.fillStyle = `rgba(${shade.ink}, ${nightAlpha(sun.altitude, shade.day, shade.night)})`;
      ctx.fillRect(0, 0, width, height);
      paintBuildings(ctx, buildingsOn, theme, zoom, width, height);
      return;
    }

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
    const terrain = terrainLayer(terrainRef.current, sun.altitude, bearing, map, shade.rgb);

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
    const needsMask = canopyShade !== null || terrain !== null;
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

    paintBuildings(ctx, buildingsOn, theme, zoom, width, height);
  }, [shadowsOn, sun.altitude, sun.azimuth, theme]);

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
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
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

  useEffect(() => {
    scheduleDraw();
  }, [draw, scheduleDraw]);

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

  /** Minutes since local midnight, for the scrubber. */
  const minuteOfDay = when.getHours() * 60 + when.getMinutes();
  const setMinuteOfDay = (minutes: number) => {
    const next = new Date(when);
    next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    setWhen(next);
  };

  const shadowRatio = shadowLengthRatio(sun.altitude);

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
              genuinely no buildings with height data. */}
          {shadowsOn && (
            <div className="absolute left-3 top-3 max-w-xs rounded-lg bg-white/90 px-3 py-2 text-xs leading-relaxed shadow-sm ring-1 ring-surface-200 dark:bg-surface-950/85 dark:ring-surface-800">
              {sun.altitude <= 0 ? (
                <span className="text-surface-600 dark:text-surface-300">
                  {times.polar === 'night' ? t('live.shadow.polar_night') : t('live.shadow.sun_down')}
                </span>
              ) : tooCoarse ? (
                <span className="text-surface-600 dark:text-surface-300">
                  {/* "Zoom in" was the only thing this could say when nothing was
                      drawn out here. Relief IS drawn now, so saying the layer is
                      blank would be false — it states what is being cast and what
                      is still to come. */}
                  {terrainOn ? t('live.shadow.terrain_only') : t('live.shadow.zoom_in')}
                </span>
              ) : loading ? (
                <span className="text-surface-600 dark:text-surface-300">{t('live.shadow.loading')}</span>
              ) : fetchFailed ? (
                <span className="text-amber-600 dark:text-amber-400">{t('live.shadow.failed')}</span>
              ) : coverageText ? (
                <span className="text-surface-600 dark:text-surface-300">{coverageText}</span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-surface-200 px-4 py-3 dark:border-surface-800">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <label className="flex min-w-[16rem] flex-1 items-center gap-3">
            {/* Reserved for the same reason as SunStat, and it is not only about
                digits: in a 12-hour locale this renders "09:35 AM", and A and P
                are not the same width, so even a fixed digit count moved the
                slider by a pixel every noon. 8ch holds "12:35 PM"; a 24-hour
                locale simply leaves the tail empty. */}
            <span className="inline-block min-w-[8ch] tabular-nums text-surface-600 dark:text-surface-300">
              {clockTime(when)}
            </span>
            <input
              type="range"
              min={0}
              max={1439}
              value={minuteOfDay}
              onChange={(e) => setMinuteOfDay(Number(e.target.value))}
              className="h-1 flex-1 accent-amber-500"
              aria-label={t('live.time.scrub')}
            />
          </label>
          <button
            type="button"
            onClick={() => setWhen(new Date())}
            className="rounded border border-surface-300 px-2 py-1 text-surface-700 dark:border-surface-700 dark:text-surface-200"
          >
            {t('live.time.now')}
          </button>

          {sunOn && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-surface-600 dark:text-surface-300">
              {/* Widths are the widest each field can render: "-90.0°", "360°",
                  ">99×", "00:00", "24.0 h". See SunStat for why they are pinned. */}
              <SunStat label={t('live.sun.altitude')} width="5.5ch">
                {sun.altitude.toFixed(1)}°
              </SunStat>
              <SunStat label={t('live.sun.azimuth')} width="4ch">
                {sun.azimuth.toFixed(0)}°
              </SunStat>
              <SunStat label={t('live.sun.shadow_ratio')} width="5.5ch">
                {formatShadowRatio(shadowRatio)}
              </SunStat>
              <SunStat label={t('live.sun.sunrise')} width="5ch">
                {clockTime(times.sunrise)}
              </SunStat>
              <SunStat label={t('live.sun.sunset')} width="5ch">
                {clockTime(times.sunset)}
              </SunStat>
              <SunStat label={t('live.sun.day_length')} width="6ch">
                {times.dayLength.toFixed(1)} h
              </SunStat>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
};

export default LivePage;
