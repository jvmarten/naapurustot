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
  emitSweptPath,
  orientProjected,
  simplifyProjected,
  shadowLengthMetres,
  type Bbox,
  type Building,
  type Pt,
} from './shadows';
import { resolveBuildings, type HeightSource } from './buildingShards';

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
 * Below this zoom we do not fetch buildings at all.
 *
 * Two independent reasons, either of which alone would justify it: a city-wide
 * bbox asks Overpass for tens of thousands of footprints (slow for the user,
 * rude to a free shared endpoint), and at that scale an individual building's
 * shadow is smaller than a pixel, so the answer would be an even grey wash that
 * tells nobody anything.
 */
const MIN_SHADOW_ZOOM = 14.5;

/** Quiet period after the map stops moving before we ask Overpass for anything. */
const FETCH_DEBOUNCE_MS = 700;

/**
 * Shadow ink, per theme.
 *
 * Not one colour with one alpha: a shadow has to read as *shade* against the
 * basemap it falls on. On the dark basemap a near-black fill is nearly
 * invisible, so the dark theme uses a lighter, bluer ink at higher alpha; on the
 * light basemap a soft navy at lower alpha reads as shadow instead of as a hole
 * punched through the map.
 */
const SHADOW_FILL = {
  dark: 'rgba(120, 150, 200, 0.30)',
  light: 'rgba(30, 45, 80, 0.28)',
} as const;

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

export const LivePage: React.FC = () => {
  useI18nVersion();
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const buildingsRef = useRef<Building[]>([]);
  /** Footprints projected to screen space, keyed by the camera state that produced them. */
  const projectedRef = useRef<{ key: string; items: { points: Pt[]; height: number }[] } | null>(null);
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
  const [coverage, setCoverage] = useState<{ withHeight: number; total: number; source: HeightSource } | null>(null);
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

    if (!shadowsOn || sun.altitude <= 0) return;

    const bearing = shadowBearing(sun.azimuth);

    // Project each footprint ONCE per camera position and cache it. Scrubbing the
    // time slider then costs arithmetic instead of ~21,000 map.project() calls a
    // frame, which was pinning a scrub at ~83 ms (12 fps). The cache key is the
    // full camera state, so any pan/zoom/rotate/pitch invalidates it.
    const c = map.getCenter();
    const cameraKey = `${c.lng},${c.lat},${map.getZoom()},${map.getBearing()},${map.getPitch()},${width}x${height}`;
    if (projectedRef.current?.key !== cameraKey) {
      projectedRef.current = {
        key: cameraKey,
        items: buildingsRef.current.map((b) => ({
          // Orientation normalised once here, so the per-frame emitter can write
          // the footprint and its translation verbatim.
          points: orientProjected(
            simplifyProjected(
              b.ring.map((coord) => {
                const p = map.project(coord);
                return [p.x, p.y] as Pt;
              }),
            ),
          ),
          height: b.height,
        })),
      };
    }

    // One screen-space displacement vector per metre of shadow. Mercator scale
    // varies negligibly across a city-sized viewport, so deriving it once at the
    // centre is accurate to well under a pixel here and removes the per-vertex
    // geodesic offset entirely.
    const origin = map.project([c.lng, c.lat]);
    const probeMetres = 1000;
    const probeLngLat = offsetPoint(c.lng, c.lat, probeMetres, bearing);
    const probe = map.project(probeLngLat);
    const ux = (probe.x - origin.x) / probeMetres;
    const uy = (probe.y - origin.y) / probeMetres;

    // ONE path for every ring of every building — see the file header for why
    // this is not a per-polygon fill.
    const path = new Path2D();
    for (const item of projectedRef.current.items) {
      const metres = shadowLengthMetres(item.height, sun.altitude);
      if (metres <= 0) continue;
      emitSweptPath(path, item.points, ux * metres, uy * metres);
    }
    ctx.fillStyle = SHADOW_FILL[theme];
    ctx.fill(path, 'nonzero');
  }, [shadowsOn, sun.altitude, sun.azimuth, theme]);

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
      draw();
    });
  }, [draw]);

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

  // Building fetch, debounced and gated on zoom. An in-flight request is aborted
  // when the camera moves again so a slow Overpass reply can never overwrite the
  // buildings for the viewport the user is actually looking at.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;

    const refresh = () => {
      setCenter([map.getCenter().lng, map.getCenter().lat]);
      if (map.getZoom() < MIN_SHADOW_ZOOM) {
        setTooCoarse(true);
        buildingsRef.current = [];
        projectedRef.current = null;
        setCoverage(null);
        draw();
        return;
      }
      setTooCoarse(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        controller?.abort();
        controller = new AbortController();
        const b = map.getBounds();
        const bbox: Bbox = {
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
        };
        setLoading(true);
        setFetchFailed(false);
        resolveBuildings(bbox, controller.signal)
          .then(({ buildings, total, source }) => {
            buildingsRef.current = buildings;
            projectedRef.current = null;
            setCoverage({ withHeight: buildings.length, total, source });
            setLoading(false);
            draw();
          })
          .catch((err: unknown) => {
            if ((err as Error)?.name === 'AbortError') return;
            setLoading(false);
            setFetchFailed(true);
          });
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
  }, [draw, scheduleDraw, mapReady]);

  useEffect(() => {
    scheduleDraw();
  }, [scheduleDraw]);

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
              ) : coverage ? (
                <span className="text-surface-600 dark:text-surface-300">
                  {/* Source-aware, because the two tiers mean different things: the
                      city model has a measured height for every building (so a
                      "n of m" ratio would always read 100 % and tell nobody
                      anything), whereas OSM's gaps are the whole point. */}
                  {coverage.source === 'city_model'
                    ? t('live.shadow.coverage_measured').replace('{n}', String(coverage.withHeight))
                    : t('live.shadow.coverage')
                        .replace('{n}', String(coverage.withHeight))
                        .replace('{total}', String(coverage.total))}
                </span>
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
