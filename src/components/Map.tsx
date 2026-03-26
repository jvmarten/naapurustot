import React, { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Polygon, Position } from 'geojson';
import { buildFillColorExpression, type LayerId, type LayerConfig, getLayerById } from '../utils/colorScales';
import type { NeighborhoodProperties } from '../utils/metrics';
import { useTheme } from '../hooks/useTheme';
import { DEFAULT_CENTER, getInitialZoom } from '../utils/mapConstants';

const BASEMAP_LIGHT = (import.meta.env.VITE_BASEMAP_LIGHT_URL as string) || 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK = (import.meta.env.VITE_BASEMAP_DARK_URL as string) || 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';

function envNum(key: string, fallback: number): number {
  const raw = import.meta.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return isFinite(n) ? n : fallback;
}

const MAP_MIN_ZOOM = envNum('VITE_MAP_MIN_ZOOM', 2);
const MAP_MAX_ZOOM = envNum('VITE_MAP_MAX_ZOOM', 16);

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
const DRAW_VERTEX_LAYER = 'draw-vertices';
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

    // Recalculate container size once the map is fully loaded to prevent
    // partial rendering when the layout isn't settled at init time (mobile first-load bug).
    map.once('load', () => { map.resize(); });

    // When navigating from an external page (e.g. Google search results) on
    // mobile, the browser viewport may still be animating (address bar
    // collapsing, scroll restoration) after the map initialises, causing a
    // stretched / skewed render.  A series of delayed resize() calls covers
    // the window during which the viewport settles.
    const earlyResizeTimers = [100, 300, 1000].map(ms =>
      setTimeout(() => { if (mapRef.current) mapRef.current.resize(); }, ms),
    );

    mapRef.current = map;

    // Keep map in sync when the container element is resized (e.g., mobile
    // address-bar show/hide, orientation change, or late layout shifts).
    const ro = new ResizeObserver(() => { map.resize(); });
    ro.observe(containerRef.current);

    // On mobile, the visual viewport can change (address bar show/hide)
    // without triggering a container resize.  Listen for that too.
    const vvResize = () => { if (mapRef.current) mapRef.current.resize(); };
    window.visualViewport?.addEventListener('resize', vvResize);

    return () => {
      earlyResizeTimers.forEach(clearTimeout);
      window.visualViewport?.removeEventListener('resize', vvResize);
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

  // Add/update data source and layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const addLayers = () => {
      // Remove existing layers (must be removed before source)
      if (map.getLayer(NO_DATA_LAYER)) map.removeLayer(NO_DATA_LAYER);
      if (map.getLayer(FILTER_HIGHLIGHT_LAYER)) map.removeLayer(FILTER_HIGHLIGHT_LAYER);
      if (map.getLayer(WIZARD_HIGHLIGHT_LAYER)) map.removeLayer(WIZARD_HIGHLIGHT_LAYER);
      if (map.getLayer(PINNED_LAYER)) map.removeLayer(PINNED_LAYER);
      if (map.getLayer(HIGHLIGHT_LAYER)) map.removeLayer(HIGHLIGHT_LAYER);
      if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
      if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

      // Reset feature state refs — the old source (and its states) is gone
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
        filter: ['!=', ['get', '_isMetroArea'], true],
        paint: {
          'line-color': theme === 'dark' ? '#1e293b' : '#475569',
          'line-width': theme === 'dark' ? 0.8 : 1,
          'line-opacity': 0.6,
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
          ['!=', ['get', '_isMetroArea'], true],
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
      addLayers();
    } else {
      map.on('load', addLayers);
    }

    return () => {
      map.off('load', addLayers);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeLayer/fillOpacity changes handled by dedicated effects
  }, [data, theme]);

  // Refresh GeoJSON source data when quality indices are recomputed
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || qualityVersion === 0) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    }
  }, [qualityVersion, data]);

  // Add/update fine-grained grid layer when grid data is available
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layer = layerConfig ?? getLayerById(activeLayer);
    const useGrid = !!gridData && !!layer.gridProperty;

    const addGridLayer = () => {
      // Remove old grid layer/source
      if (map.getLayer(GRID_FILL_LAYER)) map.removeLayer(GRID_FILL_LAYER);
      if (map.getSource(GRID_SOURCE_ID)) map.removeSource(GRID_SOURCE_ID);

      if (!useGrid || !gridData) return;

      map.addSource(GRID_SOURCE_ID, { type: 'geojson', data: gridData });

      // Insert grid fill layer just above the basemap tiles, below the postal borders
      map.addLayer({
        id: GRID_FILL_LAYER,
        type: 'fill',
        source: GRID_SOURCE_ID,
        paint: {
          'fill-color': buildFillColorExpression(layer, layer.gridProperty),
          'fill-opacity': 0.8 * fillOpacity,
          'fill-opacity-transition': { duration: 300, delay: 0 },
        },
      }, FILL_LAYER); // insert below the postal fill layer
    };

    if (map.isStyleLoaded()) {
      addGridLayer();
    } else {
      map.on('load', addGridLayer);
    }

    return () => {
      map.off('load', addGridLayer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeLayer/fillOpacity handled by dedicated effects
  }, [gridData, data, theme]);

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

  // Update fill opacity when user adjusts the slider
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getLayer(FILL_LAYER)) return;

    // Only update if no filter/wizard override is active (those effects handle their own opacity)
    if (filterActive && filterMatchPnos.size > 0) return;
    if (wizardHighlightPnos.length > 0) return;

    const layer = layerConfig ?? getLayerById(activeLayer);
    const useGrid = !!gridData && !!layer.gridProperty;
    if (useGrid) {
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', 0);
      if (map.getLayer(GRID_FILL_LAYER)) {
        map.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', 0.8 * fillOpacity);
      }
    } else {
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(fillOpacity));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- data/filterActive/filterMatchPnos/wizardHighlightPnos are guards, not triggers
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
        mapRef.current.setPaintProperty(FILL_LAYER, 'fill-opacity-transition', { duration: 200, delay: 0 });
        const layerMeta = layerConfig ?? getLayerById(activeLayer);
        const useGrid = !!gridData && !!layerMeta.gridProperty;
        if (useGrid) {
          mapRef.current.setPaintProperty(FILL_LAYER, 'fill-opacity', 0);
          if (mapRef.current.getLayer(GRID_FILL_LAYER)) {
            mapRef.current.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity-transition', { duration: 200, delay: 0 });
            mapRef.current.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', 0.8 * fillOpacity);
          }
        } else {
          mapRef.current.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(fillOpacity) as maplibregl.ExpressionSpecification);
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
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getLayer(FILL_LAYER)) return;

    if (filterActive && filterMatchPnos.size > 0) {
      const matchPnoArray = Array.from(filterMatchPnos);
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(fillOpacity, {
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
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(fillOpacity));
      if (map.getLayer(FILTER_HIGHLIGHT_LAYER)) {
        map.setLayoutProperty(FILTER_HIGHLIGHT_LAYER, 'visibility', 'none');
      }
    }
  }, [filterActive, filterMatchPnos, data, theme, fillOpacity]);

  // Hover handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      // In draw mode, show crosshair and update preview line
      if (drawMode) {
        map.getCanvas().style.cursor = 'crosshair';
        onHover(null, 0, 0);
        return;
      }

      const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });

      if (features.length > 0) {
        const feat = features[0];
        const pno = feat.properties?.pno;

        if (hoveredIdRef.current && hoveredIdRef.current !== pno) {
          map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hover: false });
        }

        hoveredIdRef.current = pno;
        map.setFeatureState({ source: SOURCE_ID, id: pno }, { hover: true });
        map.getCanvas().style.cursor = 'pointer';

        onHover(feat.properties as NeighborhoodProperties, e.point.x, e.point.y);
      } else {
        if (hoveredIdRef.current) {
          map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hover: false });
          hoveredIdRef.current = null;
        }
        map.getCanvas().style.cursor = '';
        onHover(null, 0, 0);
      }
    };

    const onMouseLeave = () => {
      if (hoveredIdRef.current) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hover: false });
        hoveredIdRef.current = null;
      }
      if (!drawMode) {
        map.getCanvas().style.cursor = '';
      }
      onHover(null, 0, 0);
    };

    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (drawMode) {
        onDrawClick?.([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
      if (features.length > 0) {
        const props = features[0].properties as NeighborhoodProperties;
        if (selectMode && onSelectAreaClick) {
          onSelectAreaClick(props);
          return;
        }
        onClick(props);
      }
    };

    const onMapDblClick = (e: maplibregl.MapMouseEvent) => {
      if (drawMode) {
        e.preventDefault();
        onDrawDoubleClick?.();
      }
    };

    map.on('mousemove', onMouseMove);
    map.on('mouseleave', FILL_LAYER, onMouseLeave);
    map.on('click', onMapClick);
    map.on('dblclick', onMapDblClick);

    return () => {
      map.off('mousemove', onMouseMove);
      map.off('mouseleave', FILL_LAYER, onMouseLeave);
      map.off('click', onMapClick);
      map.off('dblclick', onMapDblClick);
    };
  }, [data, onHover, onClick, drawMode, onDrawClick, onDrawDoubleClick, selectMode, onSelectAreaClick]);

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
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.isStyleLoaded() || !map.getSource(SOURCE_ID)) return;

    if (wizardHighlightPnos.length === 0) {
      if (map.getLayer(WIZARD_HIGHLIGHT_LAYER)) {
        map.setLayoutProperty(WIZARD_HIGHLIGHT_LAYER, 'visibility', 'none');
      }
      // Restore default opacity
      if (map.getLayer(FILL_LAYER)) {
        map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(fillOpacity));
      }
      return;
    }

    // Dim non-highlighted neighborhoods
    if (map.getLayer(FILL_LAYER)) {
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacity(fillOpacity, {
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
  }, [wizardHighlightPnos, data, theme, fillOpacity]);

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

  // CF-6: Render draw preview (vertices being drawn)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const addPreview = () => {
      // Clean up old
      if (map.getLayer(DRAW_PREVIEW_VERTEX_LAYER)) map.removeLayer(DRAW_PREVIEW_VERTEX_LAYER);
      if (map.getLayer(DRAW_PREVIEW_LINE_LAYER)) map.removeLayer(DRAW_PREVIEW_LINE_LAYER);
      if (map.getSource(DRAW_PREVIEW_SOURCE_ID)) map.removeSource(DRAW_PREVIEW_SOURCE_ID);

      if (!drawVertices || drawVertices.length < 1) return;

      // Use a FeatureCollection with both a LineString (for the line) and Points (for vertex dots)
      const features: GeoJSON.Feature[] = [];

      // Add line if we have 2+ vertices
      if (drawVertices.length >= 2) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: drawVertices as Position[],
          },
        });
      }

      // Add a point for each vertex
      for (const coord of drawVertices) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: coord as Position,
          },
        });
      }

      map.addSource(DRAW_PREVIEW_SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features,
        },
      });

      map.addLayer({
        id: DRAW_PREVIEW_LINE_LAYER,
        type: 'line',
        source: DRAW_PREVIEW_SOURCE_ID,
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#8b5cf6',
          'line-width': 2,
          'line-dasharray': [3, 2],
          'line-opacity': 0.8,
        },
      });

      map.addLayer({
        id: DRAW_PREVIEW_VERTEX_LAYER,
        type: 'circle',
        source: DRAW_PREVIEW_SOURCE_ID,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#8b5cf6',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.9,
        },
      });
    };

    if (map.isStyleLoaded()) {
      addPreview();
    } else {
      map.on('load', addPreview);
      return () => { map.off('load', addPreview); };
    }

    return () => {
      if (map.getLayer(DRAW_PREVIEW_VERTEX_LAYER)) map.removeLayer(DRAW_PREVIEW_VERTEX_LAYER);
      if (map.getLayer(DRAW_PREVIEW_LINE_LAYER)) map.removeLayer(DRAW_PREVIEW_LINE_LAYER);
      if (map.getSource(DRAW_PREVIEW_SOURCE_ID)) map.removeSource(DRAW_PREVIEW_SOURCE_ID);
    };
  }, [drawVertices]);

  // CF-6: Render completed drawn polygon — snap to neighborhood boundaries when possible
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const addDrawnPolygon = () => {
      // Clean up old raw polygon layers
      if (map.getLayer(DRAW_VERTEX_LAYER)) map.removeLayer(DRAW_VERTEX_LAYER);
      if (map.getLayer(DRAW_LINE_LAYER)) map.removeLayer(DRAW_LINE_LAYER);
      if (map.getLayer(DRAW_FILL_LAYER)) map.removeLayer(DRAW_FILL_LAYER);
      if (map.getSource(DRAW_SOURCE_ID)) map.removeSource(DRAW_SOURCE_ID);
      if (map.getSource(DRAW_SOURCE_ID + '-pts')) map.removeSource(DRAW_SOURCE_ID + '-pts');

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
      if (map.getLayer(DRAW_VERTEX_LAYER)) map.removeLayer(DRAW_VERTEX_LAYER);
      if (map.getSource(DRAW_SOURCE_ID + '-pts')) map.removeSource(DRAW_SOURCE_ID + '-pts');
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
