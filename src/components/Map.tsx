import React, { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import { buildFillColorExpression, type LayerId, getLayerById } from '../utils/colorScales';
import type { NeighborhoodProperties } from '../utils/metrics';
import { useTheme } from '../hooks/useTheme';

const BASEMAP_LIGHT = import.meta.env.VITE_BASEMAP_LIGHT_URL as string;
const BASEMAP_DARK = import.meta.env.VITE_BASEMAP_DARK_URL as string;
const MAP_CENTER_LNG = Number(import.meta.env.VITE_MAP_CENTER_LNG);
const MAP_CENTER_LAT = Number(import.meta.env.VITE_MAP_CENTER_LAT);
const MAP_ZOOM = Number(import.meta.env.VITE_MAP_ZOOM);
const MAP_MIN_ZOOM = Number(import.meta.env.VITE_MAP_MIN_ZOOM);
const MAP_MAX_ZOOM = Number(import.meta.env.VITE_MAP_MAX_ZOOM);

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
  colorblind?: boolean;
  /** PO-4: PNOs to highlight from wizard results */
  wizardHighlightPnos?: string[];
}

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

const FILTER_HIGHLIGHT_LAYER = 'neighborhoods-filter-highlight';
const WIZARD_HIGHLIGHT_LAYER = 'neighborhoods-wizard-highlight';
const NO_DATA_LAYER = 'neighborhoods-no-data-pattern';

export const DEFAULT_CENTER: [number, number] = [MAP_CENTER_LNG, MAP_CENTER_LAT];
export const DEFAULT_ZOOM = MAP_ZOOM;

export const Map: React.FC<MapProps> = ({ data, activeLayer, onHover, onClick, flyTo, selectedPno = null, pinnedPnos = [], filterActive = false, filterMatchPnos = new Set(), qualityVersion = 0, colorblind = false, wizardHighlightPnos = [] }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const { theme } = useTheme();

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeStyle(theme),
      center: [MAP_CENTER_LNG, MAP_CENTER_LAT],
      zoom: MAP_ZOOM,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
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
      // Remove existing
      if (map.getLayer(HIGHLIGHT_LAYER)) map.removeLayer(HIGHLIGHT_LAYER);
      if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
      if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data,
        promoteId: 'pno',
      });

      const layer = getLayerById(activeLayer);

      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': buildFillColorExpression(layer),
          'fill-color-transition': { duration: 300, delay: 0 },
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.85,
            ['boolean', ['feature-state', 'selected'], false],
            0.85,
            0.65,
          ],
          'fill-opacity-transition': { duration: 300, delay: 0 },
        },
      });

      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
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
      if (map.getLayer(NO_DATA_LAYER)) map.removeLayer(NO_DATA_LAYER);
      map.addLayer({
        id: NO_DATA_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['any',
          ['!', ['has', layer.property]],
          ['==', ['get', layer.property], null],
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

  // Smoothly transition fill color when active layer or colorblind mode changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getLayer(FILL_LAYER)) return;

    const layer = getLayerById(activeLayer);
    map.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer));

    // QW-2: Update no-data layer filter for new active layer
    if (map.getLayer(NO_DATA_LAYER)) {
      map.setFilter(NO_DATA_LAYER, ['any',
        ['!', ['has', layer.property]],
        ['==', ['get', layer.property], null],
      ] as unknown as maplibregl.FilterSpecification);
    }
  }, [activeLayer, colorblind]);

  // Filter-aware rendering: dim non-matching neighborhoods and highlight matching ones
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getLayer(FILL_LAYER)) return;

    if (filterActive && filterMatchPnos.size > 0) {
      // Dim non-matching: set lower opacity for non-matching neighborhoods
      const matchPnoArray = Array.from(filterMatchPnos);
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        0.85,
        ['boolean', ['feature-state', 'selected'], false],
        0.85,
        ['in', ['get', 'pno'], ['literal', matchPnoArray]],
        0.8,
        0.15,
      ]);

      // Add/update a highlight border for matching neighborhoods
      if (map.getLayer(FILTER_HIGHLIGHT_LAYER)) map.removeLayer(FILTER_HIGHLIGHT_LAYER);
      map.addLayer({
        id: FILTER_HIGHLIGHT_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['in', ['get', 'pno'], ['literal', matchPnoArray]] as unknown as maplibregl.ExpressionSpecification,
        paint: {
          'line-color': theme === 'dark' ? '#34d399' : '#059669',
          'line-width': 2,
          'line-opacity': 0.8,
        },
      });
    } else {
      // Restore default opacity
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        0.85,
        ['boolean', ['feature-state', 'selected'], false],
        0.85,
        0.65,
      ]);

      if (map.getLayer(FILTER_HIGHLIGHT_LAYER)) map.removeLayer(FILTER_HIGHLIGHT_LAYER);
    }
  }, [filterActive, filterMatchPnos, data, theme]);

  // Hover handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
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
      map.getCanvas().style.cursor = '';
      onHover(null, 0, 0);
    };

    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
      if (features.length > 0) {
        onClick(features[0].properties as NeighborhoodProperties);
      }
    };

    map.on('mousemove', FILL_LAYER, onMouseMove);
    map.on('mouseleave', FILL_LAYER, onMouseLeave);
    map.on('click', FILL_LAYER, onMapClick);

    return () => {
      map.off('mousemove', FILL_LAYER, onMouseMove);
      map.off('mouseleave', FILL_LAYER, onMouseLeave);
      map.off('click', FILL_LAYER, onMapClick);
    };
  }, [data, onHover, onClick]);

  // FlyTo / fitBounds
  useEffect(() => {
    if (!mapRef.current || !flyTo) return;
    if (flyTo.bounds) {
      mapRef.current.fitBounds(flyTo.bounds, { padding: 100, duration: 1200, maxZoom: 14.5 });
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
  }, [selectedPno, data]);

  // Highlight pinned neighborhoods
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const apply = () => {
      // Remove old pinned layer if exists
      if (map.getLayer(PINNED_LAYER)) map.removeLayer(PINNED_LAYER);

      if (pinnedPnos.length === 0) return;

      // Build a filter for pinned features
      const filter: unknown[] = ['in', ['get', 'pno'], ['literal', pinnedPnos]];

      map.addLayer({
        id: PINNED_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: filter as maplibregl.ExpressionSpecification,
        paint: {
          'line-color': theme === 'dark' ? '#facc15' : '#d97706',
          'line-width': 3,
          'line-opacity': 1,
        },
      });
    };

    if (map.isStyleLoaded() && map.getSource(SOURCE_ID)) {
      apply();
    }

    return () => {
      if (map.getLayer(PINNED_LAYER)) map.removeLayer(PINNED_LAYER);
    };
  }, [pinnedPnos, data, theme]);

  // PO-4: Wizard results highlight layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const apply = () => {
      if (map.getLayer(WIZARD_HIGHLIGHT_LAYER)) map.removeLayer(WIZARD_HIGHLIGHT_LAYER);

      if (wizardHighlightPnos.length === 0) return;

      // Dim non-highlighted neighborhoods
      if (map.getLayer(FILL_LAYER)) {
        map.setPaintProperty(FILL_LAYER, 'fill-opacity', [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.85,
          ['boolean', ['feature-state', 'selected'], false],
          0.85,
          ['in', ['get', 'pno'], ['literal', wizardHighlightPnos]],
          0.8,
          0.2,
        ]);
      }

      map.addLayer({
        id: WIZARD_HIGHLIGHT_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['in', ['get', 'pno'], ['literal', wizardHighlightPnos]] as unknown as maplibregl.ExpressionSpecification,
        paint: {
          'line-color': theme === 'dark' ? '#60a5fa' : '#2563eb',
          'line-width': 3,
          'line-opacity': 1,
        },
      });
    };

    if (map.isStyleLoaded() && map.getSource(SOURCE_ID)) {
      apply();
    }

    return () => {
      if (map.getLayer(WIZARD_HIGHLIGHT_LAYER)) map.removeLayer(WIZARD_HIGHLIGHT_LAYER);
      // Restore default opacity
      if (map.getLayer(FILL_LAYER) && wizardHighlightPnos.length > 0) {
        map.setPaintProperty(FILL_LAYER, 'fill-opacity', [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.85,
          ['boolean', ['feature-state', 'selected'], false],
          0.85,
          0.65,
        ]);
      }
    };
  }, [wizardHighlightPnos, data, theme]);

  return <div ref={containerRef} className="absolute inset-0" />;
};
