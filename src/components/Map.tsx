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
  flyTo: [number, number] | null;
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

export const Map: React.FC<MapProps> = ({ data, activeLayer, onHover, onClick, flyTo }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
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
      (source as any).setTiles([tiles]);
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
          'fill-color': buildFillColorExpression(layer) as any,
          'fill-color-transition': { duration: 300, delay: 0 },
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.85,
            0.65,
          ],
        },
      });

      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': theme === 'dark' ? '#1e293b' : '#cbd5e1',
          'line-width': 0.8,
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
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
        },
      });
    };

    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      map.on('load', addLayers);
    }
  }, [data, theme]);

  // Smoothly transition fill color when active layer changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    if (!map.getLayer(FILL_LAYER)) return;

    const layer = getLayerById(activeLayer);
    map.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer) as any);
  }, [activeLayer]);

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

  // FlyTo
  useEffect(() => {
    if (!mapRef.current || !flyTo) return;
    mapRef.current.flyTo({ center: flyTo, zoom: 13.5, duration: 1200 });
  }, [flyTo]);

  return <div ref={containerRef} className="absolute inset-0" />;
};
