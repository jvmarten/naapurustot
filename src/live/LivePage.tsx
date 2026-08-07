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
  MAX_SHADOW_METRES,
  type Affine,
  type Bbox,
  type PreparedBuilding,
} from './shadows';
import { resolveBuildings, planCoverage, type CoveragePlan, type HeightSource } from './buildingShards';

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
 * Below this zoom we draw no buildings at all.
 *
 * Not a data limit — how far out a viewport may reach before a query becomes
 * unreasonable is decided by AREA, in buildingShards.MAX_OSM_AREA_KM2, and a
 * prebuilt city-model shard has no query cost at all. This is the point where
 * an individual building's shadow stops being resolvable on screen, so the
 * honest answer is "zoom in" rather than an even grey wash.
 */
const MIN_SHADOW_ZOOM = 12;

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
  dark: { ink: '8, 15, 40', day: 0.45, night: 0.62 },
  light: { ink: '30, 45, 80', day: 0.28, night: 0.44 },
} as const;

/**
 * Tree shade, drawn in its own pass at roughly two thirds of a building's alpha.
 *
 * A crown is not a wall. It dapples — a canopy in leaf passes a real fraction of
 * the light, and a bare one in a Finnish winter passes most of it — so casting it
 * at the building alpha would claim a solidity trees do not have. Two passes also
 * mean ground under BOTH a building and a tree compounds to slightly darker,
 * which is the right direction.
 *
 * The heights behind it are measured (HSY's laser-derived land cover), so the
 * geometry is honest; only the opacity is a judgement, and it is the conservative
 * one.
 */
const CANOPY_ALPHA_SCALE = 0.65;

/**
 * Below this zoom, canopy is not drawn at all.
 *
 * Higher than the buildings' own floor, and deliberately. A tree crown is a few
 * metres across where a building is tens, so at z13.5 — where a 20 m building is
 * still a 2 px mass with a legible shadow — a 10 m crown is about one pixel and
 * contributes an even wash rather than shade you can read. Drawing them there
 * cost 62 -> 106 ms a scrub step for that wash, which is most of the frame budget
 * the zoom ladder had just bought back.
 */
const CANOPY_MIN_ZOOM = 14;

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

/** Local wall-clock "HH:MM" for an instant, in the viewer's own zone. */
function clockTime(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
 * the longest shadow we will draw — past that the extra area cannot affect a
 * single pixel on screen.
 */
function fetchPadMetres(view: Bbox): number {
  const midLat = ((view.south + view.north) / 2) * (Math.PI / 180);
  const spanNS = (view.north - view.south) * 111_320;
  const spanEW = (view.east - view.west) * 111_320 * Math.cos(midLat);
  const span = Math.min(spanNS, spanEW);
  return Math.min(MAX_SHADOW_METRES, Math.max(350, 0.15 * span));
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
  /** Camera zoom, in state only so the readout can tell whether canopy is being drawn. */
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
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
    const canopy = zoom >= CANOPY_MIN_ZOOM ? preparedCanopyRef.current : EMPTY_PREPARED;
    if (cameraKeyRef.current !== cameraKey && (buildings.length > 0 || canopy.length > 0)) {
      cameraKeyRef.current = cameraKey;
      const transform = cameraAffine(map);
      const simplifyPx = simplifyPxForZoom(zoom);
      for (const b of buildings) projectPrepared(b, transform, simplifyPx);
      // Canopy gets a coarser tolerance at every zoom. A crown has no true edge
      // to preserve — the outline is a classification boundary, not an object —
      // and there are ~4x as many of them, so this is where the per-frame cost of
      // adding trees is paid back.
      for (const c2 of canopy) projectPrepared(c2, transform, simplifyPx * 2);
    }

    // The sun is below the horizon: every surface in view is in shade, so the
    // shade is the whole viewport. Drawing nothing here — which is what this
    // used to do — says "no data" in the same visual language.
    if (sun.altitude <= 0) {
      ctx.fillStyle = `rgba(${shade.ink}, ${nightAlpha(sun.altitude, shade.day, shade.night)})`;
      ctx.fillRect(0, 0, width, height);
      paintBuildings(ctx, buildings, theme, zoom, width, height);
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

    /** Accumulate one source's swept shadows into a single path. */
    const shadowPath = (list: PreparedBuilding[]): Path2D | null => {
      const p = new Path2D();
      let any = false;
      for (const b of list) {
        if (b.sn < 4) continue;
        const metres = shadowLengthMetres(b.height, sun.altitude);
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

    // Trees first, in their own lighter pass — see CANOPY_ALPHA_SCALE. Ground
    // under both a tree and a building then compounds to slightly darker, which
    // is the right direction.
    const canopyShade = canopy.length ? shadowPath(canopy) : null;
    if (canopyShade) {
      ctx.fillStyle = `rgba(${shade.ink}, ${(shade.day * CANOPY_ALPHA_SCALE).toFixed(3)})`;
      ctx.fill(canopyShade, 'nonzero');
    }

    // ONE path for every ring of every building — see the file header for why
    // this is not a per-polygon fill.
    const path = new Path2D();
    for (const b of buildings) {
      if (b.sn < 4) continue;
      const metres = shadowLengthMetres(b.height, sun.altitude);
      if (metres <= 0) continue;
      const dx = ux * metres;
      const dy = uy * metres;
      // Off-screen, including where the shadow lands.
      if (Math.max(b.maxX, b.maxX + dx) < 0 || Math.min(b.minX, b.minX + dx) > width) continue;
      if (Math.max(b.maxY, b.maxY + dy) < 0 || Math.min(b.minY, b.minY + dy) > height) continue;
      // Sub-pixel once zoomed out: the Path2D calls would cost more than the
      // pixels they cannot fill.
      if (
        b.maxX - b.minX + Math.abs(dx) < MIN_FEATURE_PX &&
        b.maxY - b.minY + Math.abs(dy) < MIN_FEATURE_PX
      ) {
        continue;
      }
      emitSweptFlat(path, b.sx, b.sy, b.sn, dx, dy);
    }
    ctx.fillStyle = `rgba(${shade.ink}, ${shade.day})`;
    ctx.fill(path, 'nonzero');

    paintBuildings(ctx, buildings, theme, zoom, width, height);
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

    const refresh = () => {
      const c = map.getCenter();
      setCenter([c.lng, c.lat]);
      setMapZoom(map.getZoom());

      // Nothing to draw them for. The sun readout still tracks the camera, but
      // a switched-off layer must not cost the user a multi-megabyte download or
      // a free shared endpoint a query.
      if (!shadowsOn) return;

      if (map.getZoom() < MIN_SHADOW_ZOOM) {
        setTooCoarse(true);
        clearBuildings();
        scheduleDraw();
        return;
      }

      const b = map.getBounds();
      const view: Bbox = {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };
      const bbox = padBbox(view, fetchPadMetres(view));
      const plan = planCoverage(bbox);
      if (plan === 'none') {
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
            preparedCanopyRef.current = result.canopy.map(prepareBuilding);
            cameraKeyRef.current = '';
            loadedRef.current = { bbox, plan };
            setCoverage({
              source: result.source,
              measured: result.measured,
              canopy: result.canopy.length,
              osmWithHeight: result.osmWithHeight,
              osmTotal: result.osmTotal,
              partial: result.partial,
            });
            setLoading(false);
            scheduleDraw();
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
    // Trees are stated separately, and only when they are actually being drawn —
    // the canopy pass is skipped below CANOPY_MIN_ZOOM, and claiming shade the
    // layer is not casting would be exactly the kind of quiet overstatement the
    // rest of this readout exists to avoid.
    const trees =
      coverage.canopy > 0 && mapZoom >= CANOPY_MIN_ZOOM
        ? ' ' + t('live.shadow.canopy').replace('{n}', String(coverage.canopy))
        : '';
    if (coverage.source === 'city_model') {
      // Buildings that stop along a straight line have to be explained, or the
      // empty half of the screen reads as "nothing is built there".
      const key = coverage.partial ? 'live.shadow.coverage_partial' : 'live.shadow.coverage_measured';
      return t(key).replace('{n}', String(coverage.measured)) + trees;
    }
    if (coverage.source === 'mixed') {
      return t('live.shadow.coverage_mixed')
        .replace('{measured}', String(coverage.measured))
        .replace('{n}', String(coverage.osmWithHeight))
        .replace('{total}', String(coverage.osmTotal)) + trees;
    }
    return (
      t('live.shadow.coverage')
        .replace('{n}', String(coverage.osmWithHeight))
        .replace('{total}', String(coverage.osmTotal)) + trees
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
                <span className="text-surface-600 dark:text-surface-300">{t('live.shadow.zoom_in')}</span>
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
            <span className="tabular-nums text-surface-600 dark:text-surface-300">{clockTime(when)}</span>
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
              <span>
                {t('live.sun.altitude')}: <b className="text-surface-900 dark:text-white">{sun.altitude.toFixed(1)}°</b>
              </span>
              <span>
                {t('live.sun.azimuth')}: <b className="text-surface-900 dark:text-white">{sun.azimuth.toFixed(0)}°</b>
              </span>
              <span>
                {t('live.sun.shadow_ratio')}:{' '}
                <b className="text-surface-900 dark:text-white">{shadowRatio === null ? '—' : `${shadowRatio.toFixed(1)}×`}</b>
              </span>
              <span>
                {t('live.sun.sunrise')}: <b className="text-surface-900 dark:text-white">{clockTime(times.sunrise)}</b>
              </span>
              <span>
                {t('live.sun.sunset')}: <b className="text-surface-900 dark:text-white">{clockTime(times.sunset)}</b>
              </span>
              <span>
                {t('live.sun.day_length')}:{' '}
                <b className="text-surface-900 dark:text-white">{times.dayLength.toFixed(1)} h</b>
              </span>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
};

export default LivePage;
