import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { sunPosition, sunTimes, shadowBearing, shadowLengthRatio } from '../utils/sun';
import { basemapTileUrl } from '../utils/basemap';
import { t, getLang, setLang, useI18nVersion, type Lang } from '../utils/i18n';
import { FeedSidebar } from './FeedSidebar';
import { defaultEnabledFeeds, sanitizeEnabled } from './feeds';
import { fetchBuildings, shadowRings, type Bbox, type Building } from './shadows';

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

const BASEMAP_DARK =
  (import.meta.env.VITE_BASEMAP_DARK_URL as string) ||
  'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK_LABELS =
  (import.meta.env.VITE_BASEMAP_DARK_LABELS_URL as string) ||
  'https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png';

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

const SHADOW_FILL = 'rgba(8, 15, 30, 0.55)';
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const buildingsRef = useRef<Building[]>([]);
  /** Bumped once the map exists, to re-run the effect that binds its listeners. */
  const [mapReady, setMapReady] = useState(0);

  const [when, setWhen] = useState<Date>(() => new Date());
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [enabled, setEnabled] = useState<Set<string>>(readStoredFeeds);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [coverage, setCoverage] = useState<{ withHeight: number; total: number } | null>(null);
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
    // ONE path for every ring of every building — see the file header for why
    // this is not a per-polygon fill.
    const path = new Path2D();
    for (const building of buildingsRef.current) {
      for (const ring of shadowRings(building, sun.altitude, bearing)) {
        let first = true;
        for (const [lon, lat] of ring) {
          const p = map.project([lon, lat]);
          if (first) {
            path.moveTo(p.x, p.y);
            first = false;
          } else {
            path.lineTo(p.x, p.y);
          }
        }
        path.closePath();
      }
    }
    ctx.fillStyle = SHADOW_FILL;
    ctx.fill(path, 'nonzero');
  }, [shadowsOn, sun.altitude, sun.azimuth]);

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
              tiles: [basemapTileUrl(BASEMAP_DARK)],
              tileSize: 256,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
            },
            'carto-labels': {
              type: 'raster',
              tiles: [basemapTileUrl(BASEMAP_DARK_LABELS)],
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
        fetchBuildings(bbox, controller.signal)
          .then(({ buildings, total }) => {
            buildingsRef.current = buildings;
            setCoverage({ withHeight: buildings.length, total });
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
    map.on('render', draw);
    // Kick the first fetch immediately rather than waiting for the map's 'load'
    // event. The camera is fully defined the moment the map is constructed, so
    // getBounds()/getZoom() are already answerable — whereas 'load' also waits on
    // the basemap, and a slow or unreachable tile CDN would then take the shadow
    // layer down with it even though shadows need no tiles at all.
    refresh();

    return () => {
      map.off('moveend', refresh);
      map.off('render', draw);
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [draw, mapReady]);

  useEffect(() => {
    draw();
  }, [draw]);

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
    <div className="flex h-screen w-full flex-col bg-surface-950 text-white">
      <header className="flex items-center gap-3 border-b border-surface-800 px-4 py-2">
        <a href="/" className="text-sm font-semibold text-surface-200 hover:text-white">
          naapurustot<span className="text-brand-400">.fi</span>
        </a>
        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-400">
          {t('live.badge')}
        </span>
        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="ml-auto rounded border border-surface-700 px-2 py-1 text-xs"
          >
            {t('live.filters.title')}
          </button>
        )}
        <select
          className="ml-auto rounded border border-surface-700 bg-surface-900 px-2 py-1 text-xs"
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
          <div ref={containerRef} className="absolute inset-0" />
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
            <div className="absolute left-3 top-3 max-w-xs rounded-lg bg-surface-950/85 px-3 py-2 text-xs leading-relaxed">
              {sun.altitude <= 0 ? (
                <span className="text-surface-300">
                  {times.polar === 'night' ? t('live.shadow.polar_night') : t('live.shadow.sun_down')}
                </span>
              ) : tooCoarse ? (
                <span className="text-surface-300">{t('live.shadow.zoom_in')}</span>
              ) : loading ? (
                <span className="text-surface-300">{t('live.shadow.loading')}</span>
              ) : fetchFailed ? (
                <span className="text-amber-400">{t('live.shadow.failed')}</span>
              ) : coverage ? (
                <span className="text-surface-300">
                  {t('live.shadow.coverage')
                    .replace('{n}', String(coverage.withHeight))
                    .replace('{total}', String(coverage.total))}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-surface-800 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <label className="flex min-w-[16rem] flex-1 items-center gap-3">
            <span className="tabular-nums text-surface-300">{clockTime(when)}</span>
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
            className="rounded border border-surface-700 px-2 py-1 text-surface-200"
          >
            {t('live.time.now')}
          </button>

          {sunOn && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-surface-300">
              <span>
                {t('live.sun.altitude')}: <b className="text-white">{sun.altitude.toFixed(1)}°</b>
              </span>
              <span>
                {t('live.sun.azimuth')}: <b className="text-white">{sun.azimuth.toFixed(0)}°</b>
              </span>
              <span>
                {t('live.sun.shadow_ratio')}:{' '}
                <b className="text-white">{shadowRatio === null ? '—' : `${shadowRatio.toFixed(1)}×`}</b>
              </span>
              <span>
                {t('live.sun.sunrise')}: <b className="text-white">{clockTime(times.sunrise)}</b>
              </span>
              <span>
                {t('live.sun.sunset')}: <b className="text-white">{clockTime(times.sunset)}</b>
              </span>
              <span>
                {t('live.sun.day_length')}:{' '}
                <b className="text-white">{times.dayLength.toFixed(1)} h</b>
              </span>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
};

export default LivePage;
