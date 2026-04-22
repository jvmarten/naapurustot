import React, { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Polygon, Position } from 'geojson';
import { buildFillColorExpression, type LayerId, type LayerConfig, getLayerById } from '../utils/colorScales';
import type { NeighborhoodProperties } from '../utils/metrics';
import { useTheme } from '../hooks/useTheme';
import { trackEvent } from '../utils/analytics';
import { DEFAULT_CENTER, getInitialZoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM } from '../utils/mapConstants';

const BASEMAP_LIGHT = (import.meta.env.VITE_BASEMAP_LIGHT_URL as string) || 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK = (import.meta.env.VITE_BASEMAP_DARK_URL as string) || 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';

interface MapProps {
  data: FeatureCollection | null;
  activeLayer: LayerId;
  onHover: (props: NeighborhoodProperties | null, x: number, y: number) => void;
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
}

// Stable empty defaults to avoid creating new references on every render
const EMPTY_SET = new Set<string>();
const EMPTY_ARRAY: string[] = [];

function makeStyle(theme: 'dark' | 'light'): maplibregl.StyleSpecification {
  const tiles = theme === 'dark' ? BASEMAP_DARK : BASEMAP_LIGHT;
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
    },
    layers: [
      {
        id: 'carto-tiles',
        type: 'raster',
        source: 'carto',
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

export const Map: React.FC<MapProps> = React.memo(({ data, activeLayer, onHover, onClick, flyTo, selectedPno = null, pinnedPnos = EMPTY_ARRAY, filterActive = false, filterMatchPnos = EMPTY_SET, qualityVersion = 0, colorblind = 'off', wizardHighlightPnos = EMPTY_ARRAY, fillOpacity = 1, gridData = null, drawMode = false, onDrawClick, onDrawDoubleClick, drawVertices, drawnPolygon = null, drawnAreaPnos = EMPTY_ARRAY, selectMode = false, selectedAreaPnos = EMPTY_ARRAY, onSelectAreaClick, layerConfig }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const { theme } = useTheme();

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

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeStyle(theme),
      center: DEFAULT_CENTER,
      zoom: getInitialZoom(),
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    // Debounced resize — collapses rapid resize events (ResizeObserver,
    // visualViewport, and early layout settle timers) into a single call.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const debouncedResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (mapRef.current) mapRef.current.resize(); }, 50);
    };

    // Recalculate container size once the map is fully loaded to prevent
    // partial rendering when the layout isn't settled at init time (mobile first-load bug).
    map.once('load', () => { map.resize(); });

    // When navigating from an external page on mobile, the browser viewport
    // may still be animating.  Debounced timers cover the settle window.
    const earlyResizeTimers = [100, 300, 1000].map(ms =>
      setTimeout(debouncedResize, ms),
    );

    mapRef.current = map;

    // Keep map in sync when the container element is resized (e.g., mobile
    // address-bar show/hide, orientation change, or late layout shifts).
    const ro = new ResizeObserver(debouncedResize);
    ro.observe(containerRef.current);

    // On mobile, the visual viewport can change (address bar show/hide)
    // without triggering a container resize.  Listen for that too.
    window.visualViewport?.addEventListener('resize', debouncedResize);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      earlyResizeTimers.forEach(clearTimeout);
      window.visualViewport?.removeEventListener('resize', debouncedResize);
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
  }, [theme]);

  // Add source + layers once. On subsequent `data` changes we call setData on
  // the existing source instead of tearing down and recreating ~8 layers every
  // time — quality-weight sliders in "all cities" view used to rebuild the map
  // (and re-run @turf/union on the dataset level) on every debounced tick.
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
          'fill-color': buildFillColorExpression(layer),
          'fill-color-transition': { duration: 300, delay: 0 },
          'fill-opacity': buildFillOpacity(fillOpacity) as maplibregl.ExpressionSpecification,
          'fill-opacity-transition': { duration: 300, delay: 0 },
        },
      });

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
      });

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
      });

      map.addLayer({
        id: HIGHLIGHT_LAYER,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': theme === 'dark' ? '#f8fafc' : '#0f172a',
          'line-width': 2.5,
          'line-opacity': ['case', ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]], 1, 0],
        },
      });

      // QW-2: Hatched pattern overlay for neighborhoods with null data
      // Also exclude metro area features (no individual postal code borders in all-cities view)
      map.addLayer({
        id: NO_DATA_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['all',
          ['!', ['boolean', ['get', '_isMetroArea'], false]],
          ['any',
            ['!', ['has', layer.property]],
            ['==', ['get', layer.property], null],
          ],
        ] as unknown as maplibregl.ExpressionSpecification,
        paint: {
          'line-color': theme === 'dark' ? '#475569' : '#94a3b8',
          'line-width': 1.5,
          'line-dasharray': [2, 2],
          'line-opacity': 0.8,
        },
      });
    };

    if (map.isStyleLoaded()) {
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
        map.setPaintProperty(NO_DATA_LAYER, 'line-color', theme === 'dark' ? '#475569' : '#94a3b8');
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
    if (map.isStyleLoaded()) apply();
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

      map.addSource(GRID_SOURCE_ID, { type: 'geojson', data: gridData });

      map.addLayer({
        id: GRID_FILL_LAYER,
        type: 'fill',
        source: GRID_SOURCE_ID,
        paint: {
          'fill-color': buildFillColorExpression(layer, layer.gridProperty),
          'fill-opacity': 0.8 * fillOpacity,
          'fill-opacity-transition': { duration: 300, delay: 0 },
        },
      }, FILL_LAYER);
    };

    if (map.isStyleLoaded()) {
      addGridLayer();
    } else {
      map.on('load', addGridLayer);
    }

    return () => {
      map.off('load', addGridLayer);
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
      // Hide postal fill, show only borders + grid cells
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', 0);
      // Update grid fill color for current layer
      if (map.getLayer(GRID_FILL_LAYER)) {
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-color', buildFillColorExpression(layer, layer.gridProperty));
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', 0.8 * fillOpacity);
      }
    } else {
      // Remove grid layer if present, restore postal fill
      if (map.getLayer(GRID_FILL_LAYER)) map.removeLayer(GRID_FILL_LAYER);
      if (map.getSource(GRID_SOURCE_ID)) map.removeSource(GRID_SOURCE_ID);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when layer changes to toggle modes
  }, [activeLayer, gridData, colorblind, layerConfig]);

  // Update fill opacity when user adjusts the slider.
  // Handles ALL rendering modes (default, filter, wizard, grid) so that the
  // filter/wizard effects don't need fillOpacity in their dep arrays — which
  // previously caused them to re-run their full filter expression logic
  // (~Array.from, setFilter, addLayer) on every pixel of the opacity slider drag.
  const filterActiveRef = useRef(filterActive);
  filterActiveRef.current = filterActive;
  const filterMatchPnosRef = useRef(filterMatchPnos);
  filterMatchPnosRef.current = filterMatchPnos;
  const wizardHighlightPnosRef = useRef(wizardHighlightPnos);
  wizardHighlightPnosRef.current = wizardHighlightPnos;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getLayer(FILL_LAYER)) return;

    const layer = layerConfig ?? getLayerById(activeLayer);
    const useGrid = !!gridData && !!layer.gridProperty;

    if (useGrid) {
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', 0);
      if (map.getLayer(GRID_FILL_LAYER)) {
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', 0.8 * fillOpacity);
      }
    } else if (filterActiveRef.current && filterMatchPnosRef.current.size > 0) {
      const matchPnoArray = Array.from(filterMatchPnosRef.current);
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(fillOpacity, {
        matchExpr: ['in', ['get', 'pno'], ['literal', matchPnoArray]],
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
      // PO-2: Animated transition — fade out, swap color, fade back in
      // Temporarily shorten the opacity transition for a snappy fade-out
      map.setPaintProperty(FILL_LAYER, 'fill-opacity-transition', { duration: 150, delay: 0 });
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', 0);

      // Also fade grid layer if present
      if (map.getLayer(GRID_FILL_LAYER)) {
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity-transition', { duration: 150, delay: 0 });
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', 0);
      }

      layerTransitionRef.current = setTimeout(() => {
        layerTransitionRef.current = null;
        if (!mapRef.current || !mapRef.current.getLayer(FILL_LAYER)) return;

        // Swap the color expression while fully transparent
        mapRef.current.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer));

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
          mapRef.current.setPaintProperty(FILL_LAYER, 'fill-opacity', 0);
          if (mapRef.current.getLayer(GRID_FILL_LAYER)) {
            mapRef.current.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity-transition', { duration: 200, delay: 0 });
            mapRef.current.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', 0.8 * currentFillOpacity);
          }
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
      }, 180);
    } else {
      // Initial render or colorblind toggle — apply immediately (no fade)
      map.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer));
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
  }, [activeLayer, colorblind, layerConfig]);

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
      const matchPnoArray = Array.from(filterMatchPnos);
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
        });
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
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const onDrawClickRef = useRef(onDrawClick);
  onDrawClickRef.current = onDrawClick;
  const onDrawDoubleClickRef = useRef(onDrawDoubleClick);
  onDrawDoubleClickRef.current = onDrawDoubleClick;
  const onSelectAreaClickRef = useRef(onSelectAreaClick);
  onSelectAreaClickRef.current = onSelectAreaClick;
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

        onHoverRef.current(feat.properties as NeighborhoodProperties, e.point.x, e.point.y);
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

    map.on('mousemove', onMouseMove);
    map.on('mouseleave', FILL_LAYER, onMouseLeave);
    map.on('click', onMapClick);
    map.on('dblclick', onMapDblClick);

    return () => {
      handlersAttachedRef.current = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      map.off('mousemove', onMouseMove);
      map.off('mouseleave', FILL_LAYER, onMouseLeave);
      map.off('click', onMapClick);
      map.off('dblclick', onMapDblClick);
    };
  }, [data]);

  // FlyTo / fitBounds
  useEffect(() => {
    if (!mapRef.current || !flyTo) return;
    if (flyTo.bounds) {
      const isMobile = window.innerWidth < 768;
      mapRef.current.fitBounds(flyTo.bounds, { padding: isMobile ? 40 : 80, duration: 1200, maxZoom: 14.5 });
    } else {
      mapRef.current.flyTo({ center: flyTo.center, zoom: flyTo.zoom ?? 13.5, duration: 1200 });
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
    if (!map.isStyleLoaded() || !map.getSource(SOURCE_ID)) return;

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
      });
    }
  }, [pinnedPnos, data, theme]);

  // Select-areas mode highlight layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.isStyleLoaded() || !map.getSource(SOURCE_ID)) return;

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
      });
    }
  }, [selectedAreaPnos, data, theme]);

  // PO-4: Wizard results highlight layer — uses setFilter on existing layer to avoid recreation.
  // Opacity is handled by the dedicated fillOpacity effect — this only manages the
  // highlight layer and the initial opacity expression when wizard results change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.isStyleLoaded() || !map.getSource(SOURCE_ID)) return;

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
      });
    }
  }, [wizardHighlightPnos, data, theme]);

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
      });
      map.addLayer({
        id: DRAW_PREVIEW_VERTEX_LAYER, type: 'circle', source: DRAW_PREVIEW_SOURCE_ID,
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#8b5cf6', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, 'circle-opacity': 0.9 },
      });
    };

    if (map.isStyleLoaded()) {
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
        });

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
        });
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
        });

        map.addLayer({
          id: DRAW_LINE_LAYER,
          type: 'line',
          source: DRAW_SOURCE_ID,
          paint: {
            'line-color': '#8b5cf6',
            'line-width': 2.5,
            'line-opacity': 0.9,
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
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

  return <div ref={containerRef} className="absolute inset-0" />;
});

Map.displayName = 'Map';
