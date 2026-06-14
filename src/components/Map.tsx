import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { prefersReducedMotion } from '../hooks/useReducedMotion';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import { feature as topoFeature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { buildFillColorExpression, getInterpolatedColor, type LayerId, type LayerConfig, getLayerById } from '../utils/colorScales';
import { ensureHatchImage } from '../utils/hatchPattern';
import { GRID_ZOOM_FADE_IN, buildFillOpacityFadeOut, buildGridFillOpacity } from '../utils/gridFade';
import type { NeighborhoodProperties } from '../utils/metrics';
import { useTheme } from '../hooks/useTheme';
import { trackEvent } from '../utils/analytics';
import { t, useI18nVersion } from '../utils/i18n';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_MIN_ZOOM, MAP_MAX_ZOOM } from '../utils/mapConstants';
// CF-5 Phase D1: pre-baked boundary outlines of all 69 Finnish seutukunnat.
import seutukunnatUrl from '../data/seutukunnat.topojson?url';

const BASEMAP_LIGHT = (import.meta.env.VITE_BASEMAP_LIGHT_URL as string) || 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK = (import.meta.env.VITE_BASEMAP_DARK_URL as string) || 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
// Labels-only overlay rendered above the choropleth so place names stay
// readable on top of the colored fills (the baked-in labels in the base
// raster are hidden under the fill).
const BASEMAP_LIGHT_LABELS = (import.meta.env.VITE_BASEMAP_LIGHT_LABELS_URL as string) || 'https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK_LABELS = (import.meta.env.VITE_BASEMAP_DARK_LABELS_URL as string) || 'https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png';

interface MapProps {
  data: FeatureCollection | null;
  activeLayer: LayerId;
  onHover: (props: NeighborhoodProperties | null, x: number, y: number, gridValue?: number | null) => void;
  onClick: (props: NeighborhoodProperties) => void;
  flyTo: { center: [number, number]; zoom?: number; bounds?: [number, number, number, number] } | null;
  selectedPno?: string | null;
  pinnedPnos?: string[];
  filterActive?: boolean;
  filterMatchPnos?: Set<string>;
  /** Increment to force GeoJSON source refresh (e.g. after quality index recomputation) */
  qualityVersion?: number;
  colorblind?: string;
  /** PO-4: PNOs to highlight from wizard results */
  wizardHighlightPnos?: string[];
  /** User-adjustable fill opacity multiplier (0–1, default 1) */
  fillOpacity?: number;
  /** Fine-grained grid data for layers that support it (e.g. 250m transit reachability cells) */
  gridData?: FeatureCollection | null;
  /** CF-6: Draw mode — when true, clicks add polygon vertices instead of selecting neighborhoods */
  drawMode?: boolean;
  /** CF-6: Callback when a polygon vertex is added or polygon is completed */
  onDrawClick?: (lngLat: [number, number]) => void;
  onDrawDoubleClick?: () => void;
  /** CF-6: Current draw vertices for preview rendering */
  drawVertices?: Position[];
  /** CF-6: Completed drawn polygon to render on the map */
  drawnPolygon?: Feature<Polygon> | null;
  /** CF-6: PNOs of neighborhoods matched by the drawn polygon (for boundary snapping) */
  drawnAreaPnos?: string[];
  /** Select-areas mode — tap neighborhoods to multi-select */
  selectMode?: boolean;
  /** Currently selected area PNOs in select mode */
  selectedAreaPnos?: string[];
  /** Callback when a neighborhood is tapped in select mode */
  onSelectAreaClick?: (props: NeighborhoodProperties) => void;
  /** Override for layer config (used for region-scoped color scales) */
  layerConfig?: LayerConfig;
  /** CF-5: travel-time isochrone polygon to overlay for the selected neighborhood. */
  isochrone?: Feature<Polygon | MultiPolygon> | null;
  /** CF-1: fires after the camera settles, so the host can capture the viewport for "copy link to this view". */
  onMoveEnd?: (camera: { center: [number, number]; zoom: number }) => void;
  /** T1: in a region view with a housing/rent price layer active, the seutukunta's
   *  average for that metric. Areas with no own value are painted this value's color
   *  (still hatched, so they read as a sub-region estimate) instead of plain gray. */
  priceFallbackValue?: number | null;
}

// Stable empty defaults to avoid creating new references on every render
const EMPTY_SET = new Set<string>();
const EMPTY_ARRAY: string[] = [];

// T4: only the genuine first <Map> mount (the cold-load landing) skips the initial
// animated fitBounds — that's where the Helsinki→all-Finland fly-out flash happened.
// Later remounts (closing split view, WebGL context recovery) capture a live flyTarget
// that is often bounds-only/zoom-less, so they MUST let the flyTo effect re-fit instead
// of freezing at the constructor's DEFAULT_ZOOM. Module-scoped so it survives remounts.
let isFirstMapMount = true;

// Viewport-fit tuning shared by the initial-frame reframe and the flyTo/fitBounds
// effect. The preset zooms in regions.ts are tuned for wide desktop screens; on a
// narrow/tall mobile viewport a static zoom crops the area (e.g. all-Finland not fully
// visible on first load), so bounds-based targets are fitted to the actual viewport.
const MOBILE_BREAKPOINT = 768;
// Cap how far a bounds-fit zooms in. Small postal-code bboxes would otherwise fill the
// whole screen at an aggressive zoom; capping here keeps some surrounding context and
// matches the 13.5 default used elsewhere for point navigation.
const FIT_MAX_ZOOM = 13.5;

const LABELS_SOURCE_ID = 'carto-labels';
const LABELS_LAYER = 'carto-labels';

/** Resolve a beforeId so the layer is inserted below the labels overlay.
 *  If the caller already specified one, keep it (those layers — e.g. the
 *  grid fill below LINE_LAYER, seutukunta lines below FILL_LAYER — sit
 *  below labels transitively). Falls back to undefined when the labels
 *  layer is absent (e.g. style not yet loaded) so addLayer never throws. */
function beforeLabels(map: maplibregl.Map, beforeId?: string): string | undefined {
  if (beforeId) return beforeId;
  return map.getLayer(LABELS_LAYER) ? LABELS_LAYER : undefined;
}

function makeStyle(theme: 'dark' | 'light'): maplibregl.StyleSpecification {
  const tiles = theme === 'dark' ? BASEMAP_DARK : BASEMAP_LIGHT;
  const labelTiles = theme === 'dark' ? BASEMAP_DARK_LABELS : BASEMAP_LIGHT_LABELS;
  return {
    version: 8,
    name: theme === 'dark' ? 'Dark' : 'Light',
    sources: {
      carto: {
        type: 'raster',
        tiles: [tiles],
        tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      },
      [LABELS_SOURCE_ID]: {
        type: 'raster',
        tiles: [labelTiles],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: 'carto-tiles',
        type: 'raster',
        source: 'carto',
        minzoom: 0,
        maxzoom: 20,
      },
      // Last in initial layer stack — choropleth layers are inserted
      // below this via beforeId=LABELS_LAYER so labels stay on top.
      {
        id: LABELS_LAYER,
        type: 'raster',
        source: LABELS_SOURCE_ID,
        minzoom: 0,
        maxzoom: 20,
      },
    ],
  };
}

const SOURCE_ID = 'neighborhoods';
const FILL_LAYER = 'neighborhoods-fill';
const LINE_LAYER = 'neighborhoods-line';
const METRO_LINE_LAYER = 'neighborhoods-metro-line';
const HIGHLIGHT_LAYER = 'neighborhoods-highlight';

const PINNED_LAYER = 'neighborhoods-pinned';
const SELECT_AREA_LAYER = 'neighborhoods-select-area';

const FILTER_HIGHLIGHT_LAYER = 'neighborhoods-filter-highlight';
const WIZARD_HIGHLIGHT_LAYER = 'neighborhoods-wizard-highlight';
const NO_DATA_LAYER = 'neighborhoods-no-data-pattern';

const GRID_SOURCE_ID = 'grid-cells';
const GRID_FILL_LAYER = 'grid-fill';

// CF-5: travel-time isochrone overlay (sits above the choropleth fill, below
// selection/hover borders and labels).
const ISOCHRONE_SOURCE_ID = 'isochrone';
const ISOCHRONE_FILL_LAYER = 'isochrone-fill';
const ISOCHRONE_LINE_LAYER = 'isochrone-line';

// CF-5 Phase D1: Finland-wide seutukunta boundary line layer. The data-less
// gray fills are NOT a separate layer — they are emitted as _noData features
// by buildMetroAreaFeatures into the main choropleth source, so they share the
// data regions' hover + click behavior.
const SEUTUKUNNAT_SOURCE_ID = 'seutukunnat-boundaries';
const SEUTUKUNNAT_LINE_LAYER = 'seutukunnat-boundary-line';

// Module-level cache: the seutukunta boundary GeoJSON is fetched + parsed once
// and shared across map instances (main map + split view).
let seutukunnatGeoPromise: Promise<FeatureCollection | null> | null = null;
function loadSeutukunnatBoundaries(): Promise<FeatureCollection | null> {
  if (!seutukunnatGeoPromise) {
    seutukunnatGeoPromise = fetch(seutukunnatUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`seutukunnat boundaries: ${res.status}`);
        return res.json() as Promise<Topology>;
      })
      .then((topo) => {
        const objName = Object.keys(topo.objects ?? {})[0];
        if (!objName) return null;
        return topoFeature(topo, topo.objects[objName]) as FeatureCollection;
      })
      .catch((err) => {
        console.warn('[Map] failed to load seutukunta boundaries', err);
        seutukunnatGeoPromise = null;
        return null;
      });
  }
  return seutukunnatGeoPromise;
}

// CF-6: Draw polygon layer constants
const DRAW_SOURCE_ID = 'draw-polygon';
const DRAW_FILL_LAYER = 'draw-fill';
const DRAW_LINE_LAYER = 'draw-line';
const DRAW_PREVIEW_SOURCE_ID = 'draw-preview';
const DRAW_PREVIEW_LINE_LAYER = 'draw-preview-line';
const DRAW_PREVIEW_VERTEX_LAYER = 'draw-preview-vertices';
// CF-6: Snapped boundary layers (showing actual neighborhood edges instead of raw drawn polygon)
const DRAW_SNAP_FILL_LAYER = 'draw-snap-fill';
const DRAW_SNAP_LINE_LAYER = 'draw-snap-line';


/**
 * Build a MapLibre fill-opacity expression that:
 * 1. Highlights hovered/selected features at 85% opacity
 * 2. Optionally dims non-matching features (used by filter and wizard highlight modes)
 * 3. Scales all values by the user's opacity slider multiplier `o` (0–1)
 *
 * Returns a MapLibre "case" expression array.
 *
 * IMPORTANT: never replace this with a constant via setPaintProperty on a
 * layer whose fill-opacity was initialized state-dependent. MapLibre's
 * ProgramConfiguration.updatePaintArrays keeps the stale binder, reassigns
 * its `.expression` to the new constant value, then calls `.evaluate()` on
 * it — and constants have no `evaluate`, so the next setFeatureState during
 * a render frame throws `this.expression.evaluate is not a function`. Pass
 * `o = 0` here to "hide" the fill while keeping the expression state-dependent.
 */
function buildFillOpacity(o: number, overrides?: { matchExpr?: unknown[]; matchVal?: number; dimVal?: number }) {
  const base: unknown[] = [
    'case',
    ['boolean', ['feature-state', 'hover'], false],
    0.85 * o,
    ['boolean', ['feature-state', 'selected'], false],
    0.85 * o,
  ];
  if (overrides?.matchExpr) {
    base.push(overrides.matchExpr, (overrides.matchVal ?? 0.8) * o, (overrides.dimVal ?? 0.15) * o);
  } else {
    base.push(0.65 * o);
  }
  return base;
}

export const Map: React.FC<MapProps> = React.memo(({ data, activeLayer, onHover, onClick, flyTo, selectedPno = null, pinnedPnos = EMPTY_ARRAY, filterActive = false, filterMatchPnos = EMPTY_SET, qualityVersion = 0, colorblind = 'off', wizardHighlightPnos = EMPTY_ARRAY, fillOpacity = 1, gridData = null, drawMode = false, onDrawClick, onDrawDoubleClick, drawVertices, drawnPolygon = null, drawnAreaPnos = EMPTY_ARRAY, selectMode = false, selectedAreaPnos = EMPTY_ARRAY, onSelectAreaClick, layerConfig, isochrone = null, onMoveEnd, priceFallbackValue = null }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const { theme } = useTheme();
  // True when MapLibre can't create a WebGL context. Surfaces an explicit
  // "map unavailable" message instead of throwing into the ErrorBoundary
  // (whose generic "try again / reload" UI is misleading for a permanent
  // lack of WebGL support).
  const [webglFailed, setWebglFailed] = useState(false);
  // E6: distinguish a permanent failure (construction threw — the device/browser
  // has no WebGL, so reloading is futile) from a transient context loss (GPU reset
  // / tab backgrounding — reloading helps). Drives which copy + whether Reload shows.
  const [webglPermanent, setWebglPermanent] = useState(false);
  const i18nVersion = useI18nVersion();

  // PO-2: Track previous active layer to detect layer switches (skip animation on initial render)
  const prevActiveLayerRef = useRef<LayerId | null>(null);
  // PO-2: Track pending layer transition timeouts for cleanup
  const layerTransitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layerTransitionResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track previous data identity to deduplicate setData calls.
  // When data identity AND qualityVersion both change in the same render (e.g.,
  // "all cities" view after quality weight change), only the [data] effect
  // needs to call setData — the [qualityVersion] effect can skip.
  const prevDataRef = useRef<FeatureCollection | null>(null);
  const dataChangedThisRender = prevDataRef.current !== null && prevDataRef.current !== data;
  prevDataRef.current = data;

  // Refs for values read inside layer transition timeouts to avoid stale closures
  const fillOpacityRef = useRef(fillOpacity);
  fillOpacityRef.current = fillOpacity;
  const gridDataRef = useRef(gridData);
  gridDataRef.current = gridData;
  // Tracks whether the map's initial 'load' event has fired. Unlike
  // map.isStyleLoaded() — which returns false during in-flight setData on the
  // main source — this flag flips to true once and stays true, so post-init
  // layer additions can run directly instead of being queued on a 'load' event
  // that will never fire again. See the [gridData] effect for the race details.
  const mapStyleLoadedRef = useRef(false);
  // Bridge between the [data] effect (which adds FILL_LAYER) and the [gridData]
  // effect (which needs FILL_LAYER to exist before it can addLayer below it via
  // beforeId). When gridData arrives before data, the grid effect's addGridLayer
  // defers — and ensureLayers calls this ref once FILL_LAYER is in place.
  const addGridLayerRef = useRef<(() => void) | null>(null);

  // T4: the mount-time flyTo target. The init effect uses it to position the first
  // frame; the flyTo effect skips this identity so it doesn't re-animate to a camera
  // the constructor already set (which caused the world-view fly-out flash on load).
  const initialFlyToRef = useRef(flyTo);
  // T4: capture whether THIS mount is the genuine first one. Only then is the initial
  // flyTo skipped — on a remount the constructor can't reproduce a bounds-only/zoom-less
  // target, so the flyTo effect must run its fitBounds to frame it correctly.
  const isFirstMountRef = useRef(isFirstMapMount);

  // T1: keep the latest price fallback value reachable from effect/setTimeout closures.
  const priceFallbackValueRef = useRef(priceFallbackValue);
  priceFallbackValueRef.current = priceFallbackValue;
  // Region-estimate fill color for a price layer (null areas paint this instead of
  // gray, and are still hatched by NO_DATA_LAYER so they read as a sub-region estimate).
  // Returns undefined for non-price layers or when no seutukunta average is available.
  const fillFallbackColor = (l: LayerConfig): string | undefined => {
    const v = priceFallbackValueRef.current;
    if (v == null || !isFinite(v)) return undefined;
    if (l.property !== 'property_price_sqm' && l.property !== 'rental_price_sqm') return undefined;
    return getInterpolatedColor(l, v);
  };

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;
    // T4: any subsequent <Map> mount is a remount — its flyTo effect must run.
    isFirstMapMount = false;

    let map: maplibregl.Map;
    // T4: paint the FIRST frame at the real target camera (from the mount-time flyTo
    // prop) using center+zoom — NOT the Helsinki preset. Previously the map was built
    // at DEFAULT_CENTER/zoom 9.2 then an animated fitBounds flew out to the all-Finland
    // overview, which MapLibre's parabolic flight renders as a whole-world zoom-out
    // flash. center+zoom is also independent of container size, so it avoids the
    // cold-load "stretched until refresh" race that a bounds-fit hits before resize().
    const initialCenter = initialFlyToRef.current?.center ?? DEFAULT_CENTER;
    const initialZoom = initialFlyToRef.current?.zoom ?? DEFAULT_ZOOM;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: makeStyle(theme),
        center: initialCenter,
        zoom: initialZoom,
        minZoom: MAP_MIN_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        attributionControl: false,
      });
    } catch (err) {
      // WebGL unavailable — show the fallback instead of crashing. Construction
      // failure is permanent for this device (E6): reloading won't help.
      console.warn('Map: failed to initialize WebGL', err);
      setWebglPermanent(true);
      setWebglFailed(true);
      return;
    }

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    // E5: recover from runtime WebGL context loss (GPU reset, tab backgrounding,
    // driver hiccup). The synchronous try/catch above only covers construction;
    // these listeners surface the same fallback UI for a transient loss and clear
    // it if the browser restores the context.
    const canvas = map.getCanvas();
    const onLost = (ev: Event) => { ev.preventDefault(); setWebglPermanent(false); setWebglFailed(true); };
    const onRestored = () => setWebglFailed(false);
    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);
    // Diagnostics only — most map 'error' events are recoverable (failed tile,
    // transient source error), so do NOT flip webglFailed here.
    map.on('error', (e) => { console.warn('Map runtime error', e?.error); });

    // Debounced resize — collapses rapid resize events (ResizeObserver,
    // visualViewport, and early layout settle timers) into a single call.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const debouncedResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (mapRef.current) mapRef.current.resize(); }, 50);
    };

    // Verifies the map canvas dimensions match the container; if not, resize.
    // Catches iOS Safari cases where ResizeObserver/visualViewport events fire
    // before layout has fully settled, leaving the canvas stretched.
    const verifySize = () => {
      const m = mapRef.current;
      const c = containerRef.current;
      if (!m || !c) return;
      const canvas = m.getCanvas();
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      const pr = window.devicePixelRatio || 1;
      const expectedW = Math.round(cw * pr);
      const expectedH = Math.round(ch * pr);
      if (canvas.width !== expectedW || canvas.height !== expectedH) {
        m.resize();
      }
    };

    // Recalculate container size once the map is fully loaded to prevent
    // partial rendering when the layout isn't settled at init time (mobile first-load bug).
    map.once('load', () => {
      mapStyleLoadedRef.current = true;
      // A1: give the WebGL canvas an accessible name + role so screen readers
      // announce it as an interactive map region (MapLibre's keyboard pan/zoom
      // handler stays enabled — no keyboard:false in the Map options above).
      try {
        map.getCanvas().setAttribute('aria-label', t('aria.map_canvas'));
        map.getCanvas().setAttribute('role', 'application');
      } catch { /* canvas unavailable */ }
      map.resize();
      // Reframe the initial bounds-based target to the actual (now-resized) viewport.
      // The constructor positioned the first frame with the preset center+zoom — tuned
      // for desktop — and the flyTo effect skips this mount-time target to avoid a
      // fly-out flash. On a narrow mobile screen that static zoom crops the region (the
      // all-Finland default no longer shows the whole country), so jump-fit it here.
      // Runs after resize() so dimensions are correct — no cold-load stretch race.
      const initTarget = initialFlyToRef.current;
      if (isFirstMountRef.current && initTarget?.bounds && window.innerWidth < MOBILE_BREAKPOINT) {
        map.fitBounds(initTarget.bounds, { padding: 40, duration: 0, maxZoom: FIT_MAX_ZOOM });
      }
      // After paint, double-check dimensions in case layout was still settling.
      requestAnimationFrame(() => requestAnimationFrame(verifySize));
    });

    // When navigating from an external page on mobile, the browser viewport
    // may still be animating.  Debounced timers cover the settle window.
    // Extended schedule catches late iOS Safari address-bar transitions
    // (which can finish settling well past 1000ms on cold loads).
    const earlyResizeTimers = [100, 300, 1000, 2000, 3500].map(ms =>
      setTimeout(() => { debouncedResize(); verifySize(); }, ms),
    );

    mapRef.current = map;

    // Keep map in sync when the container element is resized (e.g., mobile
    // address-bar show/hide, orientation change, or late layout shifts).
    const ro = new ResizeObserver(debouncedResize);
    ro.observe(containerRef.current);

    // On mobile, the visual viewport can change (address bar show/hide)
    // without triggering a container resize.  Listen for that too.
    window.visualViewport?.addEventListener('resize', debouncedResize);

    // iOS Safari fires neither ResizeObserver nor visualViewport resize
    // reliably when the address bar collapses on first scroll. Catch those
    // transitions and bfcache restores explicitly.
    const onOrientationChange = () => {
      debouncedResize();
      setTimeout(verifySize, 300);
    };
    const onPageShow = () => debouncedResize();
    window.addEventListener('orientationchange', onOrientationChange);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      earlyResizeTimers.forEach(clearTimeout);
      window.visualViewport?.removeEventListener('resize', debouncedResize);
      window.removeEventListener('orientationchange', onOrientationChange);
      window.removeEventListener('pageshow', onPageShow);
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; theme changes handled by separate effect
  }, []);

  // Switch basemap on theme change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const source = map.getSource('carto') as maplibregl.RasterTileSource | undefined;
    if (source) {
      const tiles = theme === 'dark' ? BASEMAP_DARK : BASEMAP_LIGHT;
      source.setTiles([tiles]);
    }
    const labelsSource = map.getSource(LABELS_SOURCE_ID) as maplibregl.RasterTileSource | undefined;
    if (labelsSource) {
      const labelTiles = theme === 'dark' ? BASEMAP_DARK_LABELS : BASEMAP_LIGHT_LABELS;
      labelsSource.setTiles([labelTiles]);
    }
  }, [theme]);

  // Add source + layers once. On subsequent `data` changes we call setData on
  // the existing source instead of tearing down and recreating ~8 layers every
  // time — quality-weight sliders in "all cities" view used to rebuild the map
  // (and re-derive the whole metro-area dataset) on every debounced tick.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const ensureLayers = () => {
      // Source already exists (region switch, qualityVersion bump, etc.):
      // just refresh the data in-place. MapLibre preserves feature-state keyed
      // by promoteId, and the existing layers already reference SOURCE_ID.
      if (map.getSource(SOURCE_ID)) {
        const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (source) source.setData(data);
        return;
      }

      // Reset feature state refs — fresh source, no prior states to track.
      hoveredIdRef.current = null;
      selectedIdRef.current = null;

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data,
        promoteId: 'pno',
      });

      const layer = layerConfig ?? getLayerById(activeLayer);

      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': buildFillColorExpression(layer, undefined, fillFallbackColor(layer)),
          'fill-color-transition': { duration: 300, delay: 0 },
          'fill-opacity': buildFillOpacity(fillOpacity) as maplibregl.ExpressionSpecification,
          'fill-opacity-transition': { duration: 300, delay: 0 },
        },
      }, beforeLabels(map));

      // Hide postal code borders for metro area features (all-cities view)
      // to avoid showing internal postal code grid lines
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['!', ['boolean', ['get', '_isMetroArea'], false]],
        paint: {
          'line-color': theme === 'dark' ? '#1e293b' : '#475569',
          'line-width': theme === 'dark' ? 0.8 : 1,
          'line-opacity': 0.6,
        },
      }, beforeLabels(map));

      // Show only outer borders for metro area features (all-cities view)
      map.addLayer({
        id: METRO_LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['boolean', ['get', '_isMetroArea'], false],
        paint: {
          'line-color': theme === 'dark' ? '#1e293b' : '#475569',
          'line-width': 1.5,
          'line-opacity': 0.7,
        },
      }, beforeLabels(map));

      map.addLayer({
        id: HIGHLIGHT_LAYER,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': theme === 'dark' ? '#f8fafc' : '#0f172a',
          'line-width': 2.5,
          'line-opacity': ['case', ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]], 1, 0],
        },
      }, beforeLabels(map));

      // PO-1: true diagonal-hatch fill for neighborhoods with null/missing data.
      // Replaces the old dashed-border treatment with a runtime-generated
      // fill-pattern. Excludes metro area features so all-cities dissolve
      // outlines stay clean (CLAUDE.md pitfall #4). The hatch image is
      // registered here and re-added automatically on style reload via the
      // styleimagemissing handler wired by ensureHatchImage.
      map.addLayer({
        id: NO_DATA_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['all',
          ['!', ['boolean', ['get', '_isMetroArea'], false]],
          ['any',
            ['!', ['has', layer.property]],
            ['==', ['get', layer.property], null],
          ],
        ] as unknown as maplibregl.ExpressionSpecification,
        paint: {
          'fill-pattern': ensureHatchImage(map, theme),
          'fill-opacity': 0.9,
        },
      }, beforeLabels(map));

      // FILL_LAYER now exists — flush any pending grid layer that arrived
      // before this effect ran. Without this callback, addGridLayer's
      // beforeId=FILL_LAYER fails silently when grid data wins the race,
      // and air_quality/light_pollution paint nothing until refresh.
      addGridLayerRef.current?.();
    };

    // Gate on the persistent mapStyleLoadedRef, not map.isStyleLoaded(): the
    // latter returns false during an in-flight setData re-parse (quality-weight
    // recompute, metro-area rebuild, region switch), which would re-queue this on
    // the one-shot 'load' event that already fired — silently dropping the layers.
    if (mapStyleLoadedRef.current) {
      ensureLayers();
    } else {
      map.on('load', ensureLayers);
    }

    return () => {
      map.off('load', ensureLayers);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeLayer/fillOpacity/theme changes handled by dedicated effects
  }, [data]);

  // Update theme-dependent line colors in place. Previously changing theme
  // tore down the whole data source and all ~8 choropleth layers; now we just
  // repaint the border colors, which is effectively free.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const border = theme === 'dark' ? '#1e293b' : '#475569';
      if (map.getLayer(LINE_LAYER)) {
        map.setPaintProperty(LINE_LAYER, 'line-color', border);
        map.setPaintProperty(LINE_LAYER, 'line-width', theme === 'dark' ? 0.8 : 1);
      }
      if (map.getLayer(METRO_LINE_LAYER)) {
        map.setPaintProperty(METRO_LINE_LAYER, 'line-color', border);
      }
      if (map.getLayer(HIGHLIGHT_LAYER)) {
        map.setPaintProperty(HIGHLIGHT_LAYER, 'line-color', theme === 'dark' ? '#f8fafc' : '#0f172a');
      }
      if (map.getLayer(NO_DATA_LAYER)) {
        // PO-1: swap to the theme-matched hatch image (registered + reload-safe via ensureHatchImage).
        map.setPaintProperty(NO_DATA_LAYER, 'fill-pattern', ensureHatchImage(map, theme));
      }
      if (map.getLayer(PINNED_LAYER)) {
        map.setPaintProperty(PINNED_LAYER, 'line-color', theme === 'dark' ? '#facc15' : '#d97706');
      }
      if (map.getLayer(FILTER_HIGHLIGHT_LAYER)) {
        map.setPaintProperty(FILTER_HIGHLIGHT_LAYER, 'line-color', theme === 'dark' ? '#34d399' : '#059669');
      }
      if (map.getLayer(WIZARD_HIGHLIGHT_LAYER)) {
        map.setPaintProperty(WIZARD_HIGHLIGHT_LAYER, 'line-color', theme === 'dark' ? '#60a5fa' : '#2563eb');
      }
      if (map.getLayer(SELECT_AREA_LAYER)) {
        map.setPaintProperty(SELECT_AREA_LAYER, 'line-color', theme === 'dark' ? '#a78bfa' : '#7c3aed');
      }
      if (map.getLayer(DRAW_SNAP_LINE_LAYER)) {
        map.setPaintProperty(DRAW_SNAP_LINE_LAYER, 'line-color', theme === 'dark' ? '#a78bfa' : '#7c3aed');
      }
    };
    // Gate on mapStyleLoadedRef (not isStyleLoaded()) so a theme toggle during an
    // in-flight setData still repaints line/highlight colors instead of queuing on
    // the one-shot 'load' that will never fire again.
    if (mapStyleLoadedRef.current) apply();
    else map.on('load', apply);
    return () => { map.off('load', apply); };
  }, [theme]);

  // Refresh GeoJSON source data when quality indices are recomputed in place.
  // The main `[data]` effect already calls setData when `data` identity changes
  // (e.g., metro area view rebuild), so this only runs for in-place mutations
  // where `data` identity stays stable but feature properties changed.
  // `dataChangedThisRender` (computed during render, before effects) detects
  // the overlap case and skips the redundant setData.
  const dataChangedRef = useRef(false);
  dataChangedRef.current = dataChangedThisRender;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || qualityVersion === 0) return;
    if (dataChangedRef.current) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    }
  }, [qualityVersion, data]);

  // Add/update fine-grained grid layer when grid data changes.
  // Previously depended on [gridData, data, theme], which tore down and recreated
  // the grid source+layer on every data refresh (quality version bump) and theme
  // toggle — even though data and theme have their own dedicated effects.
  // Now depends only on [gridData], which changes only when the user switches to
  // a grid-capable layer for the first time (lazy fetch completes).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layer = layerConfig ?? getLayerById(activeLayer);
    const useGrid = !!gridData && !!layer.gridProperty;

    const addGridLayer = () => {
      if (map.getLayer(GRID_FILL_LAYER)) map.removeLayer(GRID_FILL_LAYER);
      if (map.getSource(GRID_SOURCE_ID)) map.removeSource(GRID_SOURCE_ID);

      if (!useGrid || !gridData) return;
      // beforeId=LINE_LAYER below requires the line layer to already exist —
      // otherwise MapLibre throws and the grid layer silently never appears.
      // When grid data arrives before the main data has loaded, defer here;
      // ensureLayers will invoke addGridLayerRef.current() the moment it
      // creates the line layer, so the deferred add fires automatically.
      if (!map.getLayer(LINE_LAYER)) return;

      map.addSource(GRID_SOURCE_ID, { type: 'geojson', data: gridData });

      // Inserted above FILL_LAYER (postal choropleth) but below LINE_LAYER so
      // borders, highlights, and the no-data hatch always stay on top. minzoom
      // skips rendering 13k+ cells at country zoom where they'd just be noise.
      map.addLayer({
        id: GRID_FILL_LAYER,
        type: 'fill',
        source: GRID_SOURCE_ID,
        minzoom: GRID_ZOOM_FADE_IN,
        paint: {
          'fill-color': buildFillColorExpression(layer, layer.gridProperty),
          'fill-opacity': buildGridFillOpacity(fillOpacity) as maplibregl.ExpressionSpecification,
          'fill-opacity-transition': { duration: 300, delay: 0 },
        },
      }, LINE_LAYER);
    };

    // Expose to ensureLayers so it can flush a deferred grid layer add
    // once FILL_LAYER becomes available.
    addGridLayerRef.current = addGridLayer;

    // Use mapStyleLoadedRef (not map.isStyleLoaded()) to gate post-init layer
    // additions. isStyleLoaded() returns false whenever the main source is
    // re-parsing tiles after setData — quality-weight recompute, metro-area
    // rebuild when the pre-baked outlines arrive, region switch. If gridData lands inside
    // that window, queueing addGridLayer on 'load' silently drops it because
    // 'load' is a one-shot event that already fired at init. That leaves
    // GRID_FILL_LAYER unadded while Effect 2 hides FILL_LAYER — the map paints
    // nothing for the chosen layer until a refresh. After the initial load,
    // Style._loaded stays true, so addSource/addLayer are safe to call directly.
    if (mapStyleLoadedRef.current) {
      addGridLayer();
    } else {
      map.on('load', addGridLayer);
    }

    return () => {
      map.off('load', addGridLayer);
      if (addGridLayerRef.current === addGridLayer) {
        addGridLayerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeLayer/fillOpacity/layerConfig handled by dedicated effects; data/theme no longer needed
  }, [gridData]);

  // Toggle postal fill visibility: hide when grid data is shown, show otherwise
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getLayer(FILL_LAYER)) return;

    const layer = layerConfig ?? getLayerById(activeLayer);
    const useGrid = !!gridData && !!layer.gridProperty;

    if (useGrid) {
      // Postal choropleth stays visible at low zoom (smooth country view) and
      // fades out as the grid fades in — see GRID_ZOOM_FADE_IN/OUT.
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacityFadeOut(fillOpacity));
      if (map.getLayer(GRID_FILL_LAYER)) {
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-color', buildFillColorExpression(layer, layer.gridProperty));
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', buildGridFillOpacity(fillOpacity));
      }
    } else {
      // Remove grid layer if present, restore postal fill
      if (map.getLayer(GRID_FILL_LAYER)) map.removeLayer(GRID_FILL_LAYER);
      if (map.getSource(GRID_SOURCE_ID)) map.removeSource(GRID_SOURCE_ID);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when layer changes to toggle modes
  }, [activeLayer, gridData, colorblind, layerConfig]);

  // CF-5: travel-time isochrone overlay. Adds/updates/removes a translucent
  // reachable-area polygon for the selected neighborhood, above the choropleth
  // fill but below selection/hover borders (beforeId=HIGHLIGHT_LAYER) and labels.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!isochrone) {
        if (map.getLayer(ISOCHRONE_LINE_LAYER)) map.removeLayer(ISOCHRONE_LINE_LAYER);
        if (map.getLayer(ISOCHRONE_FILL_LAYER)) map.removeLayer(ISOCHRONE_FILL_LAYER);
        if (map.getSource(ISOCHRONE_SOURCE_ID)) map.removeSource(ISOCHRONE_SOURCE_ID);
        return;
      }
      const fc: FeatureCollection = { type: 'FeatureCollection', features: [isochrone] };
      const existing = map.getSource(ISOCHRONE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(fc);
        return;
      }
      map.addSource(ISOCHRONE_SOURCE_ID, { type: 'geojson', data: fc });
      const before = map.getLayer(HIGHLIGHT_LAYER) ? HIGHLIGHT_LAYER : beforeLabels(map);
      map.addLayer({
        id: ISOCHRONE_FILL_LAYER,
        type: 'fill',
        source: ISOCHRONE_SOURCE_ID,
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.22 },
      }, before);
      map.addLayer({
        id: ISOCHRONE_LINE_LAYER,
        type: 'line',
        source: ISOCHRONE_SOURCE_ID,
        paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-opacity': 0.85 },
      }, before);
    };
    if (mapStyleLoadedRef.current) apply();
    else map.on('load', apply);
    return () => { map.off('load', apply); };
  }, [isochrone]);

  // CF-5 Phase D1: faint Finland-wide seutukunta boundary line. Outlines all 69
  // sub-regions for structural context. Sits beneath the choropleth fill so it
  // never occludes data; zoom-faded so it recedes when drilling into a region.
  // The data-less gray fills are part of the choropleth source itself (emitted
  // as _noData features by buildMetroAreaFeatures), not this layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lineColor = theme === 'dark' ? '#3f4d63' : '#9aa7b8';

    // Idle scheduler with a setTimeout fallback (Safari lacks requestIdleCallback).
    // The timeout cap guarantees the work still runs on a busy main thread.
    let idleHandle: number | undefined;
    const scheduleIdle = (cb: () => void): number =>
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(cb, { timeout: 2000 })
        : window.setTimeout(cb, 200);
    const cancelIdle = (h: number): void => {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(h);
      else clearTimeout(h);
    };

    // The heavy first-time add: the boundary file is ~199KB gzipped and its decode
    // (large JSON.parse + topojson feature() of all 69 sub-regions) is pure
    // background context. Running it at idle keeps it from contending with the
    // region data fetch and first map paint on a cold single-region load.
    const addSeutukunnatLayer = () => {
      void loadSeutukunnatBoundaries().then((geo) => {
        // Guard against the captured `map` being a stale (removed) instance after an
        // unmount/remount: only proceed if it is still the live map. mapRef.current
        // is nulled (and the map removed) on cleanup, so equality proves liveness.
        if (!geo || mapRef.current !== map) return;
        if (map.getLayer(SEUTUKUNNAT_LINE_LAYER)) return;
        if (!map.getSource(SEUTUKUNNAT_SOURCE_ID)) {
          map.addSource(SEUTUKUNNAT_SOURCE_ID, { type: 'geojson', data: geo });
        }
        // Sit below the choropleth fill when it exists; otherwise the fill,
        // added later, ends up on top anyway. Falls back to the labels overlay
        // so the boundary never paints above place names.
        const beforeId = map.getLayer(FILL_LAYER) ? FILL_LAYER : undefined;
        map.addLayer({
          id: SEUTUKUNNAT_LINE_LAYER,
          type: 'line',
          source: SEUTUKUNNAT_SOURCE_ID,
          paint: {
            'line-color': lineColor,
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.9, 8, 1.2, 12, 0.5],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.65, 9, 0.4, 12, 0.12],
          },
        }, beforeLabels(map, beforeId));
      });
    };

    const addBoundaries = () => {
      // Layer already present (theme toggle): just repaint immediately — cheap.
      if (map.getLayer(SEUTUKUNNAT_LINE_LAYER)) {
        map.setPaintProperty(SEUTUKUNNAT_LINE_LAYER, 'line-color', lineColor);
        return;
      }
      // First-time add: defer off the first-paint window. The getLayer guard and
      // mapRef equality check inside addSeutukunnatLayer keep it idempotent if a
      // theme toggle races during the idle wait.
      idleHandle = scheduleIdle(() => {
        idleHandle = undefined;
        if (mapRef.current !== map) return;
        addSeutukunnatLayer();
      });
    };

    // Gate on mapStyleLoadedRef (not isStyleLoaded()) so the seutukunnat boundary
    // is still added when this runs during an in-flight setData rather than being
    // queued on the already-fired one-shot 'load' event.
    if (mapStyleLoadedRef.current) addBoundaries();
    else map.on('load', addBoundaries);
    return () => {
      map.off('load', addBoundaries);
      if (idleHandle !== undefined) cancelIdle(idleHandle);
    };
  }, [theme]);

  // Update fill opacity when user adjusts the slider.
  // Handles ALL rendering modes (default, filter, wizard, grid) so that the
  // filter/wizard effects don't need fillOpacity in their dep arrays — which
  // previously caused them to re-run their full filter expression logic
  // (~Array.from, setFilter, addLayer) on every pixel of the opacity slider drag.
  const filterActiveRef = useRef(filterActive);
  filterActiveRef.current = filterActive;
  const filterMatchPnosRef = useRef(filterMatchPnos);
  filterMatchPnosRef.current = filterMatchPnos;
  // Cache the Array.from conversion so fillOpacity slider drags don't recreate
  // it on every tick (~60Hz) from the same underlying Set.
  const filterMatchPnoArrayRef = useRef<string[]>([]);
  const filterMatchPnoSetRef = useRef<Set<string>>(EMPTY_SET);
  if (filterMatchPnoSetRef.current !== filterMatchPnos) {
    filterMatchPnoSetRef.current = filterMatchPnos;
    filterMatchPnoArrayRef.current = filterMatchPnos.size > 0 ? Array.from(filterMatchPnos) : [];
  }
  const wizardHighlightPnosRef = useRef(wizardHighlightPnos);
  wizardHighlightPnosRef.current = wizardHighlightPnos;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getLayer(FILL_LAYER)) return;

    const layer = layerConfig ?? getLayerById(activeLayer);
    const useGrid = !!gridData && !!layer.gridProperty;

    if (useGrid) {
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacityFadeOut(fillOpacity));
      if (map.getLayer(GRID_FILL_LAYER)) {
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', buildGridFillOpacity(fillOpacity));
      }
    } else if (filterActiveRef.current && filterMatchPnoArrayRef.current.length > 0) {
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(fillOpacity, {
        matchExpr: ['in', ['get', 'pno'], ['literal', filterMatchPnoArrayRef.current]],
        matchVal: 0.8,
        dimVal: 0.15,
      }));
    } else if (wizardHighlightPnosRef.current.length > 0) {
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(fillOpacity, {
        matchExpr: ['in', ['get', 'pno'], ['literal', wizardHighlightPnosRef.current]],
        matchVal: 0.8,
        dimVal: 0.2,
      }));
    } else {
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(fillOpacity));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- filter/wizard state read from refs
  }, [fillOpacity]);

  // PO-2: Smoothly transition fill color when active layer or colorblind mode changes.
  // Fades opacity to 0, switches the fill-color expression, then fades back up.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getLayer(FILL_LAYER)) return;

    const layer = layerConfig ?? getLayerById(activeLayer);
    const isLayerSwitch = prevActiveLayerRef.current !== null && prevActiveLayerRef.current !== activeLayer;
    prevActiveLayerRef.current = activeLayer;

    // Clear any in-flight transition from a previous rapid switch
    if (layerTransitionRef.current) {
      clearTimeout(layerTransitionRef.current);
      layerTransitionRef.current = null;
    }
    if (layerTransitionResetRef.current) {
      clearTimeout(layerTransitionResetRef.current);
      layerTransitionResetRef.current = null;
    }

    // QW-2: Update no-data layer filter for new active layer
    if (map.getLayer(NO_DATA_LAYER)) {
      map.setFilter(NO_DATA_LAYER, ['all',
        ['!=', ['get', '_isMetroArea'], true],
        ['any',
          ['!', ['has', layer.property]],
          ['==', ['get', layer.property], null],
        ],
      ] as unknown as maplibregl.FilterSpecification);
    }

    if (isLayerSwitch) {
      // Respect reduced-motion: swap the fill color instantly and skip the chained
      // fade timers. This MUST run before the fade-to-0 below — otherwise
      // fill-opacity is set to 0 and the early return leaves the choropleth blank.
      // Mirrors the no-fade branch in the `else` below and the flyTo reduce-motion path.
      if (prefersReducedMotion()) {
        map.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer, undefined, fillFallbackColor(layer)));
        if (map.getLayer(GRID_FILL_LAYER) && layer.gridProperty) {
          map.setPaintProperty(GRID_FILL_LAYER, 'fill-color', buildFillColorExpression(layer, layer.gridProperty));
        }
        return;
      }
      // PO-2 / X5: animated recolor — dip, swap color, fade back in. The dip goes to
      // a PARTIAL opacity (not 0) so the choropleth never blanks to the bare basemap
      // mid-switch (which read as a momentary "broken" state and contradicted the
      // legend, which updates instantly). The color swap still happens at the dimmed
      // point, so the change isn't a hard cut.
      const DIP_OPACITY = 0.35;
      map.setPaintProperty(FILL_LAYER, 'fill-opacity-transition', { duration: 130, delay: 0 });
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(DIP_OPACITY));

      // Also dip grid layer if present
      if (map.getLayer(GRID_FILL_LAYER)) {
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity-transition', { duration: 130, delay: 0 });
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', DIP_OPACITY);
      }

      layerTransitionRef.current = setTimeout(() => {
        layerTransitionRef.current = null;
        if (!mapRef.current || !mapRef.current.getLayer(FILL_LAYER)) return;

        // Swap the color expression while fully transparent
        mapRef.current.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer, undefined, fillFallbackColor(layer)));

        // Update grid layer color if present
        if (mapRef.current.getLayer(GRID_FILL_LAYER) && layer.gridProperty) {
          mapRef.current.setPaintProperty(GRID_FILL_LAYER, 'fill-color', buildFillColorExpression(layer, layer.gridProperty));
        }

        // Restore transition duration and fade back in
        // Read current values from refs to avoid stale closures (gridData/fillOpacity
        // can change during the 180ms fade-out delay)
        mapRef.current.setPaintProperty(FILL_LAYER, 'fill-opacity-transition', { duration: 200, delay: 0 });
        const currentGridData = gridDataRef.current;
        const currentFillOpacity = fillOpacityRef.current;
        const useGrid = !!currentGridData && !!layer.gridProperty;
        if (useGrid) {
          mapRef.current.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacityFadeOut(currentFillOpacity));
          if (mapRef.current.getLayer(GRID_FILL_LAYER)) {
            mapRef.current.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity-transition', { duration: 200, delay: 0 });
            mapRef.current.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', buildGridFillOpacity(currentFillOpacity));
          }
        } else if (filterActiveRef.current && filterMatchPnoArrayRef.current.length > 0) {
          // Preserve filter dimming across a layer switch — otherwise non-matching
          // neighborhoods jump back to full opacity while the match highlight stays.
          mapRef.current.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(currentFillOpacity, {
            matchExpr: ['in', ['get', 'pno'], ['literal', filterMatchPnoArrayRef.current]],
            matchVal: 0.8,
            dimVal: 0.15,
          }) as maplibregl.ExpressionSpecification);
        } else if (wizardHighlightPnosRef.current.length > 0) {
          // Same for wizard-result dimming.
          mapRef.current.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(currentFillOpacity, {
            matchExpr: ['in', ['get', 'pno'], ['literal', wizardHighlightPnosRef.current]],
            matchVal: 0.8,
            dimVal: 0.2,
          }) as maplibregl.ExpressionSpecification);
        } else {
          mapRef.current.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(currentFillOpacity) as maplibregl.ExpressionSpecification);
        }

        // Reset transition to default after fade-in completes
        layerTransitionResetRef.current = setTimeout(() => {
          layerTransitionResetRef.current = null;
          if (!mapRef.current || !mapRef.current.getLayer(FILL_LAYER)) return;
          mapRef.current.setPaintProperty(FILL_LAYER, 'fill-opacity-transition', { duration: 300, delay: 0 });
          if (mapRef.current.getLayer(GRID_FILL_LAYER)) {
            mapRef.current.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity-transition', { duration: 300, delay: 0 });
          }
        }, 250);
      }, 150);
    } else {
      // Initial render or colorblind toggle — apply immediately (no fade). Also the
      // path when only priceFallbackValue changed (same active layer): recolor at once.
      map.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer, undefined, fillFallbackColor(layer)));
    }

    return () => {
      if (layerTransitionRef.current) {
        clearTimeout(layerTransitionRef.current);
        layerTransitionRef.current = null;
      }
      if (layerTransitionResetRef.current) {
        clearTimeout(layerTransitionResetRef.current);
        layerTransitionResetRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- data/gridData/fillOpacity are guards, not triggers
  }, [activeLayer, colorblind, layerConfig, priceFallbackValue]);

  // Filter-aware rendering: dim non-matching neighborhoods and highlight matching ones.
  // Uses setFilter on an existing layer instead of remove/add to avoid layer recreation overhead.
  // Opacity is handled by the dedicated fillOpacity effect above — this effect only manages
  // the filter expression and highlight layer visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getLayer(FILL_LAYER)) return;

    const currentOpacity = fillOpacityRef.current;

    if (filterActive && filterMatchPnos.size > 0) {
      const matchPnoArray = filterMatchPnoArrayRef.current;
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(currentOpacity, {
        matchExpr: ['in', ['get', 'pno'], ['literal', matchPnoArray]],
        matchVal: 0.8,
        dimVal: 0.15,
      }));

      const filterExpr = ['in', ['get', 'pno'], ['literal', matchPnoArray]] as unknown as maplibregl.ExpressionSpecification;
      if (map.getLayer(FILTER_HIGHLIGHT_LAYER)) {
        map.setFilter(FILTER_HIGHLIGHT_LAYER, filterExpr);
        map.setLayoutProperty(FILTER_HIGHLIGHT_LAYER, 'visibility', 'visible');
      } else {
        map.addLayer({
          id: FILTER_HIGHLIGHT_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: filterExpr,
          paint: {
            'line-color': theme === 'dark' ? '#34d399' : '#059669',
            'line-width': 2,
            'line-opacity': 0.8,
          },
        }, beforeLabels(map));
      }
    } else {
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(currentOpacity));
      if (map.getLayer(FILTER_HIGHLIGHT_LAYER)) {
        map.setLayoutProperty(FILTER_HIGHLIGHT_LAYER, 'visibility', 'none');
      }
    }
  }, [filterActive, filterMatchPnos, data, theme]);

  // Hover/click handler — registered once and never re-attached.
  // All callbacks and mode flags are read from refs so the handlers stay
  // stable across data changes, quality weight adjustments, and layer switches.
  // Previously depended on [data], which tore down and re-registered 4 event
  // listeners on every data refresh (quality version bumps, metro area rebuilds,
  // city switches after initial setup). This caused hover state to flash
  // (hoveredIdRef cleared during cleanup) and wasted ~8 addEventListener/
  // removeEventListener calls per data change.
  const drawModeRef = useRef(drawMode);
  drawModeRef.current = drawMode;
  const selectModeRef = useRef(selectMode);
  selectModeRef.current = selectMode;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  // QW-8: the always-attached hover handler reads the current effective layer (for its
  // gridProperty + crossfade) from a ref so it stays stable but never goes stale.
  const effectiveLayerRef = useRef<LayerConfig>(layerConfig ?? getLayerById(activeLayer));
  effectiveLayerRef.current = layerConfig ?? getLayerById(activeLayer);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const onDrawClickRef = useRef(onDrawClick);
  onDrawClickRef.current = onDrawClick;
  const onDrawDoubleClickRef = useRef(onDrawDoubleClick);
  onDrawDoubleClickRef.current = onDrawDoubleClick;
  const onSelectAreaClickRef = useRef(onSelectAreaClick);
  onSelectAreaClickRef.current = onSelectAreaClick;
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;
  const handlersAttachedRef = useRef(false);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || handlersAttachedRef.current) return;
    handlersAttachedRef.current = true;

    // Throttle mousemove processing to once per animation frame.
    // Without this, queryRenderedFeatures + setFeatureState fire on every
    // pixel of movement (potentially >60 Hz on high-refresh-rate input).
    // Only the last event per frame matters for visual output.
    let pendingMouseEvent: maplibregl.MapMouseEvent | null = null;
    let rafId: number | null = null;

    const processMouseMove = () => {
      rafId = null;
      const e = pendingMouseEvent;
      if (!e) return;
      pendingMouseEvent = null;

      if (drawModeRef.current) {
        map.getCanvas().style.cursor = 'crosshair';
        onHoverRef.current(null, 0, 0);
        return;
      }

      if (!map.getSource(SOURCE_ID)) return;
      const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });

      if (features.length > 0) {
        const feat = features[0];
        const pno = feat.properties?.pno as string | undefined;

        if (!pno) return;

        if (hoveredIdRef.current !== pno) {
          if (hoveredIdRef.current) {
            map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hover: false });
          }
          hoveredIdRef.current = pno;
          map.setFeatureState({ source: SOURCE_ID, id: pno }, { hover: true });
          map.getCanvas().style.cursor = 'pointer';
        }

        // QW-8: above the crossfade the postal fill is invisible (opacity 0) but still
        // hit-tested, so over a fine-grained grid the tooltip would show the postal
        // aggregate. Query the grid layer under the cursor and surface ITS cell value.
        let gridValue: number | null = null;
        const lyr = effectiveLayerRef.current;
        if (gridDataRef.current && lyr.gridProperty && map.getZoom() >= GRID_ZOOM_FADE_IN && map.getLayer(GRID_FILL_LAYER)) {
          const cells = map.queryRenderedFeatures(e.point, { layers: [GRID_FILL_LAYER] });
          const gv = cells[0]?.properties?.[lyr.gridProperty];
          if (typeof gv === 'number' && isFinite(gv)) gridValue = gv;
        }
        onHoverRef.current(feat.properties as NeighborhoodProperties, e.point.x, e.point.y, gridValue);
      } else {
        if (hoveredIdRef.current) {
          map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hover: false });
          hoveredIdRef.current = null;
          map.getCanvas().style.cursor = '';
        }
        onHoverRef.current(null, 0, 0);
      }
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      pendingMouseEvent = e;
      if (rafId === null) {
        rafId = requestAnimationFrame(processMouseMove);
      }
    };

    const onMouseLeave = () => {
      pendingMouseEvent = null;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      if (hoveredIdRef.current) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hover: false });
        hoveredIdRef.current = null;
      }
      if (!drawModeRef.current) {
        map.getCanvas().style.cursor = '';
      }
      onHoverRef.current(null, 0, 0);
    };

    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (drawModeRef.current) {
        onDrawClickRef.current?.([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      if (!map.getSource(SOURCE_ID)) return;
      const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
      if (features.length > 0) {
        const props = features[0].properties as NeighborhoodProperties;
        if (!props?.pno) return;
        if (selectModeRef.current && onSelectAreaClickRef.current) {
          onSelectAreaClickRef.current(props);
          return;
        }
        trackEvent('map-click-neighborhood', { pno: props.pno });
        onClickRef.current(props);
      }
    };

    const onMapDblClick = (e: maplibregl.MapMouseEvent) => {
      if (drawModeRef.current) {
        e.preventDefault();
        onDrawDoubleClickRef.current?.();
      }
    };

    // CF-1: report the settled camera so the host can offer "copy link to this view".
    const onMapMoveEnd = () => {
      if (!onMoveEndRef.current) return;
      const c = map.getCenter();
      onMoveEndRef.current({ center: [c.lng, c.lat], zoom: map.getZoom() });
    };

    map.on('mousemove', onMouseMove);
    map.on('mouseleave', FILL_LAYER, onMouseLeave);
    map.on('click', onMapClick);
    map.on('dblclick', onMapDblClick);
    map.on('moveend', onMapMoveEnd);

    return () => {
      handlersAttachedRef.current = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      map.off('mousemove', onMouseMove);
      map.off('mouseleave', FILL_LAYER, onMouseLeave);
      map.off('click', onMapClick);
      map.off('dblclick', onMapDblClick);
      map.off('moveend', onMapMoveEnd);
    };
  }, [data]);

  // FlyTo / fitBounds
  useEffect(() => {
    if (!mapRef.current || !flyTo) return;
    // T4: on the genuine first mount the constructor already positioned the map at the
    // mount-time flyTo, so skip animating to that same target (this is what produced the
    // world-view fly-out flash). On a REMOUNT the captured target may be bounds-only/
    // zoom-less, which the constructor can't reproduce — so don't skip there; fall
    // through to fitBounds. Every later viewport change gets a fresh identity and animates.
    if (flyTo === initialFlyToRef.current && isFirstMountRef.current) return;
    // PO-1: jump instantly instead of animating the camera under reduce-motion.
    const dur = prefersReducedMotion() ? 0 : 1200;
    if (flyTo.bounds) {
      const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
      mapRef.current.fitBounds(flyTo.bounds, { padding: isMobile ? 40 : 80, duration: dur, maxZoom: FIT_MAX_ZOOM });
    } else {
      mapRef.current.flyTo({ center: flyTo.center, zoom: flyTo.zoom ?? 13.5, duration: dur });
    }
  }, [flyTo]);

  // Highlight selected neighborhood
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getSource(SOURCE_ID)) return;

    // Clear previous selection
    if (selectedIdRef.current) {
      map.setFeatureState({ source: SOURCE_ID, id: selectedIdRef.current }, { selected: false });
    }

    // Set new selection
    if (selectedPno) {
      map.setFeatureState({ source: SOURCE_ID, id: selectedPno }, { selected: true });
    }
    selectedIdRef.current = selectedPno;
  // theme is included because the data/theme effect destroys and recreates the source,
  // which clears all feature states — without this, the selection highlight is lost on theme change.
  }, [selectedPno, data, theme]);

  // Highlight pinned neighborhoods — uses setFilter on existing layer to avoid layer recreation.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    // CF-2: gate on the persistent mapStyleLoadedRef (not isStyleLoaded(), which is
    // false during an in-flight setData re-parse) and queue on 'load' when pre-init —
    // returning early instead silently dropped the highlight with no retry.
    const apply = () => {
      if (!map.getSource(SOURCE_ID)) return;

      if (pinnedPnos.length === 0) {
        if (map.getLayer(PINNED_LAYER)) {
          map.setLayoutProperty(PINNED_LAYER, 'visibility', 'none');
        }
        return;
      }

      const filter = ['in', ['get', 'pno'], ['literal', pinnedPnos]] as unknown as maplibregl.ExpressionSpecification;

      if (map.getLayer(PINNED_LAYER)) {
        map.setFilter(PINNED_LAYER, filter);
        map.setLayoutProperty(PINNED_LAYER, 'visibility', 'visible');
      } else {
        map.addLayer({
          id: PINNED_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: filter,
          paint: {
            'line-color': theme === 'dark' ? '#facc15' : '#d97706',
            'line-width': 3,
            'line-opacity': 1,
          },
        }, beforeLabels(map));
      }
    };
    if (mapStyleLoadedRef.current) apply();
    else map.on('load', apply);
    return () => { map.off('load', apply); };
  }, [pinnedPnos, data, theme]);

  // Select-areas mode highlight layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    // CF-2: gate on mapStyleLoadedRef + queue on 'load' (see pinned-highlight effect).
    const apply = () => {
      if (!map.getSource(SOURCE_ID)) return;

      if (selectedAreaPnos.length === 0) {
        if (map.getLayer(SELECT_AREA_LAYER)) {
          map.setLayoutProperty(SELECT_AREA_LAYER, 'visibility', 'none');
        }
        return;
      }

      const filter = ['in', ['get', 'pno'], ['literal', selectedAreaPnos]] as unknown as maplibregl.ExpressionSpecification;

      if (map.getLayer(SELECT_AREA_LAYER)) {
        map.setFilter(SELECT_AREA_LAYER, filter);
        map.setLayoutProperty(SELECT_AREA_LAYER, 'visibility', 'visible');
      } else {
        map.addLayer({
          id: SELECT_AREA_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: filter,
          paint: {
            'line-color': theme === 'dark' ? '#a78bfa' : '#7c3aed',
            'line-width': 3,
            'line-opacity': 1,
          },
        }, beforeLabels(map));
      }
    };
    if (mapStyleLoadedRef.current) apply();
    else map.on('load', apply);
    return () => { map.off('load', apply); };
  }, [selectedAreaPnos, data, theme]);

  // PO-4: Wizard results highlight layer — uses setFilter on existing layer to avoid recreation.
  // Opacity is handled by the dedicated fillOpacity effect — this only manages the
  // highlight layer and the initial opacity expression when wizard results change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    // CF-2: gate on mapStyleLoadedRef + queue on 'load' (see pinned-highlight effect).
    const apply = () => {
      if (!map.getSource(SOURCE_ID)) return;

      const currentOpacity = fillOpacityRef.current;

      if (wizardHighlightPnos.length === 0) {
        if (map.getLayer(WIZARD_HIGHLIGHT_LAYER)) {
          map.setLayoutProperty(WIZARD_HIGHLIGHT_LAYER, 'visibility', 'none');
        }
        if (map.getLayer(FILL_LAYER)) {
          map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(currentOpacity));
        }
        return;
      }

      if (map.getLayer(FILL_LAYER)) {
        map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(currentOpacity, {
          matchExpr: ['in', ['get', 'pno'], ['literal', wizardHighlightPnos]],
          matchVal: 0.8,
          dimVal: 0.2,
        }));
      }

      const filter = ['in', ['get', 'pno'], ['literal', wizardHighlightPnos]] as unknown as maplibregl.ExpressionSpecification;

      if (map.getLayer(WIZARD_HIGHLIGHT_LAYER)) {
        map.setFilter(WIZARD_HIGHLIGHT_LAYER, filter);
        map.setLayoutProperty(WIZARD_HIGHLIGHT_LAYER, 'visibility', 'visible');
      } else {
        map.addLayer({
          id: WIZARD_HIGHLIGHT_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: filter,
          paint: {
            'line-color': theme === 'dark' ? '#60a5fa' : '#2563eb',
            'line-width': 3,
            'line-opacity': 1,
          },
        }, beforeLabels(map));
      }
    };
    if (mapStyleLoadedRef.current) apply();
    else map.on('load', apply);
    return () => { map.off('load', apply); };
  }, [wizardHighlightPnos, data, theme]);

  // CF-2: re-apply the canvas accessible name when the UI language changes. It is set
  // once inside map.once('load'), so without this the screen-reader name stayed in the
  // language the map first loaded in after a later language switch.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapStyleLoadedRef.current) return;
    try { map.getCanvas().setAttribute('aria-label', t('aria.map_canvas')); } catch { /* canvas unavailable */ }
  }, [i18nVersion]);

  // CF-6: Draw/select mode cursor
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawMode) {
      map.getCanvas().style.cursor = 'crosshair';
      // Disable double-click zoom in draw mode
      map.doubleClickZoom.disable();
    } else if (selectMode) {
      map.getCanvas().style.cursor = 'pointer';
      map.doubleClickZoom.enable();
    } else {
      map.getCanvas().style.cursor = '';
      map.doubleClickZoom.enable();
    }
  }, [drawMode, selectMode]);

  // CF-6: Render draw preview (vertices being drawn).
  // Uses setData on existing source instead of removing/re-adding source+layers on each vertex click.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const buildPreviewData = (): GeoJSON.FeatureCollection => {
      const features: GeoJSON.Feature[] = [];
      if (drawVertices && drawVertices.length >= 2) {
        features.push({
          type: 'Feature', properties: {},
          geometry: { type: 'LineString', coordinates: drawVertices as Position[] },
        });
      }
      if (drawVertices) {
        for (const coord of drawVertices) {
          features.push({
            type: 'Feature', properties: {},
            geometry: { type: 'Point', coordinates: coord as Position },
          });
        }
      }
      return { type: 'FeatureCollection', features };
    };

    const updatePreview = () => {
      const geojson = buildPreviewData();
      const existing = map.getSource(DRAW_PREVIEW_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        // Update data in-place — avoids tearing down and recreating layers
        existing.setData(geojson);
        const visible = drawVertices && drawVertices.length >= 1;
        if (map.getLayer(DRAW_PREVIEW_LINE_LAYER)) {
          map.setLayoutProperty(DRAW_PREVIEW_LINE_LAYER, 'visibility', visible ? 'visible' : 'none');
        }
        if (map.getLayer(DRAW_PREVIEW_VERTEX_LAYER)) {
          map.setLayoutProperty(DRAW_PREVIEW_VERTEX_LAYER, 'visibility', visible ? 'visible' : 'none');
        }
        return;
      }

      if (!drawVertices || drawVertices.length < 1) return;

      map.addSource(DRAW_PREVIEW_SOURCE_ID, { type: 'geojson', data: geojson });
      map.addLayer({
        id: DRAW_PREVIEW_LINE_LAYER, type: 'line', source: DRAW_PREVIEW_SOURCE_ID,
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#8b5cf6', 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
      }, beforeLabels(map));
      map.addLayer({
        id: DRAW_PREVIEW_VERTEX_LAYER, type: 'circle', source: DRAW_PREVIEW_SOURCE_ID,
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#8b5cf6', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, 'circle-opacity': 0.9 },
      }, beforeLabels(map));
    };

    // CF-2: gate on mapStyleLoadedRef, not isStyleLoaded() (false mid setData re-parse,
    // which would queue on a 'load' event that already fired and silently drop the update).
    if (mapStyleLoadedRef.current) {
      updatePreview();
    } else {
      map.on('load', updatePreview);
      return () => { map.off('load', updatePreview); };
    }

    // Only remove layers on full cleanup (component unmount), not on every vertex update
  }, [drawVertices]);

  // CF-6: Render completed drawn polygon — snap to neighborhood boundaries when possible
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const addDrawnPolygon = () => {
      // Clean up old raw polygon layers
      if (map.getLayer(DRAW_LINE_LAYER)) map.removeLayer(DRAW_LINE_LAYER);
      if (map.getLayer(DRAW_FILL_LAYER)) map.removeLayer(DRAW_FILL_LAYER);
      if (map.getSource(DRAW_SOURCE_ID)) map.removeSource(DRAW_SOURCE_ID);

      // Clean up snapped boundary layers
      if (map.getLayer(DRAW_SNAP_LINE_LAYER)) map.removeLayer(DRAW_SNAP_LINE_LAYER);
      if (map.getLayer(DRAW_SNAP_FILL_LAYER)) map.removeLayer(DRAW_SNAP_FILL_LAYER);

      if (!drawnPolygon) return;

      // When we have matched neighborhood PNOs, show their actual boundaries
      if (drawnAreaPnos.length > 0 && map.getSource(SOURCE_ID)) {
        const filter = ['in', ['get', 'pno'], ['literal', drawnAreaPnos]] as unknown as maplibregl.ExpressionSpecification;

        map.addLayer({
          id: DRAW_SNAP_FILL_LAYER,
          type: 'fill',
          source: SOURCE_ID,
          filter: filter,
          paint: {
            'fill-color': '#8b5cf6',
            'fill-opacity': 0.15,
          },
        }, beforeLabels(map));

        map.addLayer({
          id: DRAW_SNAP_LINE_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: filter,
          paint: {
            'line-color': theme === 'dark' ? '#a78bfa' : '#7c3aed',
            'line-width': 3,
            'line-opacity': 1,
          },
        }, beforeLabels(map));
      } else {
        // Fallback: show the raw drawn polygon if no PNOs matched
        map.addSource(DRAW_SOURCE_ID, {
          type: 'geojson',
          data: drawnPolygon,
        });

        map.addLayer({
          id: DRAW_FILL_LAYER,
          type: 'fill',
          source: DRAW_SOURCE_ID,
          paint: {
            'fill-color': '#8b5cf6',
            'fill-opacity': 0.15,
          },
        }, beforeLabels(map));

        map.addLayer({
          id: DRAW_LINE_LAYER,
          type: 'line',
          source: DRAW_SOURCE_ID,
          paint: {
            'line-color': '#8b5cf6',
            'line-width': 2.5,
            'line-opacity': 0.9,
          },
        }, beforeLabels(map));
      }
    };

    // CF-2: gate on mapStyleLoadedRef, not isStyleLoaded() (see draw-preview effect).
    if (mapStyleLoadedRef.current) {
      addDrawnPolygon();
    } else {
      map.on('load', addDrawnPolygon);
      return () => { map.off('load', addDrawnPolygon); };
    }

    return () => {
      if (map.getLayer(DRAW_LINE_LAYER)) map.removeLayer(DRAW_LINE_LAYER);
      if (map.getLayer(DRAW_FILL_LAYER)) map.removeLayer(DRAW_FILL_LAYER);
      if (map.getSource(DRAW_SOURCE_ID)) map.removeSource(DRAW_SOURCE_ID);
      if (map.getLayer(DRAW_SNAP_LINE_LAYER)) map.removeLayer(DRAW_SNAP_LINE_LAYER);
      if (map.getLayer(DRAW_SNAP_FILL_LAYER)) map.removeLayer(DRAW_SNAP_FILL_LAYER);
    };
  }, [drawnPolygon, drawnAreaPnos, theme]);

  if (webglFailed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-surface-50 dark:bg-surface-950">
        <div className="text-4xl mb-4" aria-hidden="true">🗺️</div>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-2">
          {t('error.webgl_unavailable')}
        </h2>
        <p className="text-sm text-surface-500 dark:text-surface-400 max-w-sm mb-4">
          {t(webglPermanent ? 'error.webgl_unavailable_desc' : 'error.webgl_context_lost_desc')}
        </p>
        {/* E6: reloading only helps a transient context loss; hide it when the
            device permanently lacks WebGL. */}
        {!webglPermanent && (
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
          >
            {t('error.reload')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      // A7: only the inner MapLibre canvas (set in the load handler above) carries
      // role="application" — it's the element that handles keyboard pan/zoom. The
      // wrapper is a plain named group so screen readers don't hit two nested,
      // differently-named application regions.
      role="group"
      aria-label={t('aria.map_region').replace('{layer}', t((layerConfig ?? getLayerById(activeLayer)).labelKey))}
    />
  );
});

Map.displayName = 'Map';
