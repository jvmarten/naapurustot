import React, { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import { buildFillColorExpression, type LayerId, getLayerById } from '../utils/colorScales';
import type { NeighborhoodProperties } from '../utils/metrics';

interface MapProps {
  data: FeatureCollection | null;
  activeLayer: LayerId;
  onHover: (props: NeighborhoodProperties | null, x: number, y: number) => void;
  onClick: (props: NeighborhoodProperties) => void;
  flyTo: [number, number] | null;
}

const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Dark',
  sources: {
    carto: {
      type: 'raster',
      tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
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

const SOURCE_ID = 'neighborhoods';
const FILL_LAYER = 'neighborhoods-fill';
const LINE_LAYER = 'neighborhoods-line';
const HIGHLIGHT_LAYER = 'neighborhoods-highlight';

export const Map: React.FC<MapProps> = ({ data, activeLayer, onHover, onClick, flyTo }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredIdRef = useRef<string | null>(null);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: [24.94, 60.17],
      zoom: 10.5,
      minZoom: 8,
      maxZoom: 16,
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
          'line-color': '#1e293b',
          'line-width': 0.8,
          'line-opacity': 0.6,
        },
      });

      map.addLayer({
        id: HIGHLIGHT_LAYER,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': '#f8fafc',
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
  }, [data, activeLayer]);

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
