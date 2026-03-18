import React, { useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import { buildFillColorExpression, type LayerId, getLayerById } from '../utils/colorScales';
import { useTheme } from '../hooks/useTheme';
import { t } from '../utils/i18n';

const BASEMAP_LIGHT = import.meta.env.VITE_BASEMAP_LIGHT_URL as string;
const BASEMAP_DARK = import.meta.env.VITE_BASEMAP_DARK_URL as string;
const MAP_CENTER_LNG = Number(import.meta.env.VITE_MAP_CENTER_LNG);
const MAP_CENTER_LAT = Number(import.meta.env.VITE_MAP_CENTER_LAT);
const MAP_ZOOM = Number(import.meta.env.VITE_MAP_ZOOM);
const MAP_MIN_ZOOM = Number(import.meta.env.VITE_MAP_MIN_ZOOM);
const MAP_MAX_ZOOM = Number(import.meta.env.VITE_MAP_MAX_ZOOM);

const SOURCE_ID = 'neighborhoods';
const FILL_LAYER = 'neighborhoods-fill';
const LINE_LAYER = 'neighborhoods-line';

interface SplitMapViewProps {
  data: FeatureCollection | null;
  leftLayer: LayerId;
  rightLayer: LayerId;
  colorblind?: boolean;
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
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
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

function addDataLayers(
  map: maplibregl.Map,
  data: FeatureCollection,
  layerId: LayerId,
  theme: 'dark' | 'light',
) {
  if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
  if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data,
    promoteId: 'pno',
  });

  const layer = getLayerById(layerId);

  map.addLayer({
    id: FILL_LAYER,
    type: 'fill',
    source: SOURCE_ID,
    paint: {
      'fill-color': buildFillColorExpression(layer),
      'fill-color-transition': { duration: 300, delay: 0 },
      'fill-opacity': 0.65,
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
}

export const SplitMapView: React.FC<SplitMapViewProps> = ({
  data,
  leftLayer,
  rightLayer,
  colorblind = false,
}) => {
  const leftContainerRef = useRef<HTMLDivElement>(null);
  const rightContainerRef = useRef<HTMLDivElement>(null);
  const leftMapRef = useRef<maplibregl.Map | null>(null);
  const rightMapRef = useRef<maplibregl.Map | null>(null);
  const syncingRef = useRef(false);
  const { theme } = useTheme();

  // Sync handler factory: when one map moves, update the other
  const createSyncHandler = useCallback(
    (source: React.RefObject<maplibregl.Map | null>, target: React.RefObject<maplibregl.Map | null>) => {
      return () => {
        if (syncingRef.current) return;
        if (!source.current || !target.current) return;

        syncingRef.current = true;
        const center = source.current.getCenter();
        const zoom = source.current.getZoom();
        const bearing = source.current.getBearing();
        const pitch = source.current.getPitch();

        target.current.jumpTo({ center, zoom, bearing, pitch });
        syncingRef.current = false;
      };
    },
    [],
  );

  // Initialize both maps
  useEffect(() => {
    if (!leftContainerRef.current || !rightContainerRef.current) return;

    const mapOptions: Partial<maplibregl.MapOptions> = {
      style: makeStyle(theme),
      center: [MAP_CENTER_LNG, MAP_CENTER_LAT],
      zoom: MAP_ZOOM,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      attributionControl: false,
    };

    const leftMap = new maplibregl.Map({
      container: leftContainerRef.current,
      ...mapOptions,
    } as maplibregl.MapOptions);

    const rightMap = new maplibregl.Map({
      container: rightContainerRef.current,
      ...mapOptions,
    } as maplibregl.MapOptions);

    leftMap.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    rightMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    leftMapRef.current = leftMap;
    rightMapRef.current = rightMap;

    // Set up sync handlers
    const syncLeftToRight = createSyncHandler(leftMapRef, rightMapRef);
    const syncRightToLeft = createSyncHandler(rightMapRef, leftMapRef);

    leftMap.on('move', syncLeftToRight);
    rightMap.on('move', syncRightToLeft);

    return () => {
      leftMap.off('move', syncLeftToRight);
      rightMap.off('move', syncRightToLeft);
      leftMap.remove();
      rightMap.remove();
      leftMapRef.current = null;
      rightMapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Switch basemap on theme change
  useEffect(() => {
    const tiles = theme === 'dark' ? BASEMAP_DARK : BASEMAP_LIGHT;
    for (const mapRef of [leftMapRef, rightMapRef]) {
      const map = mapRef.current;
      if (!map) continue;
      const source = map.getSource('carto') as maplibregl.RasterTileSource | undefined;
      if (source) {
        source.setTiles([tiles]);
      }
    }
  }, [theme]);

  // Add/update data layers when data or theme changes
  useEffect(() => {
    if (!data) return;

    const setupMap = (map: maplibregl.Map | null, layerId: LayerId) => {
      if (!map) return;
      const apply = () => addDataLayers(map, data, layerId, theme);
      if (map.isStyleLoaded()) {
        apply();
      } else {
        map.on('load', apply);
      }
    };

    setupMap(leftMapRef.current, leftLayer);
    setupMap(rightMapRef.current, rightLayer);
  }, [data, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update fill color when active layers or colorblind mode change
  useEffect(() => {
    if (!data) return;

    const updateFill = (map: maplibregl.Map | null, layerId: LayerId) => {
      if (!map || !map.getLayer(FILL_LAYER)) return;
      const layer = getLayerById(layerId);
      map.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer));
    };

    updateFill(leftMapRef.current, leftLayer);
    updateFill(rightMapRef.current, rightLayer);
  }, [leftLayer, rightLayer, colorblind, data]);

  return (
    <div className="relative flex h-full w-full">
      {/* Left map */}
      <div className="relative h-full w-1/2">
        <div ref={leftContainerRef} className="absolute inset-0" />
        <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-white/80 dark:bg-surface-900/80 text-xs font-medium">
          {t(getLayerById(leftLayer).labelKey)}
        </div>
      </div>

      {/* Vertical divider */}
      <div className="absolute left-1/2 top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-slate-400 dark:bg-slate-600 pointer-events-none" />

      {/* Right map */}
      <div className="relative h-full w-1/2">
        <div ref={rightContainerRef} className="absolute inset-0" />
        <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-white/80 dark:bg-surface-900/80 text-xs font-medium">
          {t(getLayerById(rightLayer).labelKey)}
        </div>
      </div>
    </div>
  );
};
