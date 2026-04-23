import React, { useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import { buildFillColorExpression, LAYERS, type LayerId, getLayerById } from '../utils/colorScales';
import { useTheme } from '../hooks/useTheme';
import { t } from '../utils/i18n';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_MAX_ZOOM, envNum } from '../utils/mapConstants';

/**
 * Compact dropdown for choosing a data layer on one side of the split view.
 */
const SplitLayerPicker: React.FC<{
  value: LayerId;
  onChange: (id: LayerId) => void;
}> = ({ value, onChange }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value as LayerId)}
    className="block w-full max-w-[200px] rounded bg-white/90 dark:bg-surface-900/90 text-xs font-medium px-2 py-1 border border-slate-300 dark:border-slate-600 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 truncate"
    aria-label={t(getLayerById(value).labelKey)}
  >
    {LAYERS.map((layer) => (
      <option key={layer.id} value={layer.id}>
        {t(layer.labelKey)}
      </option>
    ))}
  </select>
);

const BASEMAP_LIGHT = (import.meta.env.VITE_BASEMAP_LIGHT_URL as string) || 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK = (import.meta.env.VITE_BASEMAP_DARK_URL as string) || 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';

const SPLIT_MIN_ZOOM = envNum('VITE_MAP_MIN_ZOOM', 4);

const SOURCE_ID = 'neighborhoods';
const FILL_LAYER = 'neighborhoods-fill';
const LINE_LAYER = 'neighborhoods-line';

interface SplitMapViewProps {
  data: FeatureCollection | null;
  leftLayer: LayerId;
  rightLayer: LayerId;
  onLeftLayerChange?: (id: LayerId) => void;
  onRightLayerChange?: (id: LayerId) => void;
  colorblind?: string;
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

const METRO_LINE_LAYER = 'neighborhoods-metro-line';

function addDataLayers(
  map: maplibregl.Map,
  data: FeatureCollection,
  layerId: LayerId,
  theme: 'dark' | 'light',
) {
  // If the source already exists, just refresh its data — rebuilding the
  // source + 3 layers on every data change (e.g., quality weight adjustment
  // with two maps mounted) doubles the MapLibre work unnecessarily.
  if (map.getSource(SOURCE_ID)) {
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    const layer = getLayerById(layerId);
    if (map.getLayer(FILL_LAYER)) {
      map.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer));
    }
    return;
  }

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
    filter: ['!', ['boolean', ['get', '_isMetroArea'], false]],
    paint: {
      'line-color': theme === 'dark' ? '#1e293b' : '#475569',
      'line-width': theme === 'dark' ? 0.8 : 1,
      'line-opacity': 0.6,
    },
  });

  // Show outer borders for metro area features
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
}

function updateThemeColors(map: maplibregl.Map, theme: 'dark' | 'light') {
  const border = theme === 'dark' ? '#1e293b' : '#475569';
  if (map.getLayer(LINE_LAYER)) {
    map.setPaintProperty(LINE_LAYER, 'line-color', border);
    map.setPaintProperty(LINE_LAYER, 'line-width', theme === 'dark' ? 0.8 : 1);
  }
  if (map.getLayer(METRO_LINE_LAYER)) {
    map.setPaintProperty(METRO_LINE_LAYER, 'line-color', border);
  }
}

export const SplitMapView: React.FC<SplitMapViewProps> = React.memo(({
  data,
  leftLayer,
  rightLayer,
  onLeftLayerChange,
  onRightLayerChange,
  colorblind = 'off',
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

    // Each map needs its own freshly-constructed style object. MapLibre mutates
    // style internals after construction; sharing one reference between two Map
    // instances causes intermittent cross-contamination of source/layer state.
    const commonOptions = {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: SPLIT_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      attributionControl: false as const,
    };

    const leftMap = new maplibregl.Map({
      container: leftContainerRef.current,
      style: makeStyle(theme),
      ...commonOptions,
    });

    const rightMap = new maplibregl.Map({
      container: rightContainerRef.current,
      style: makeStyle(theme),
      ...commonOptions,
    });

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

  // Switch basemap on theme change, and repaint the border colors in place.
  // Previously theme change rebuilt source + 3 layers on BOTH maps.
  useEffect(() => {
    const tiles = theme === 'dark' ? BASEMAP_DARK : BASEMAP_LIGHT;
    const pendingListeners: { map: maplibregl.Map; fn: () => void }[] = [];
    for (const mapRef of [leftMapRef, rightMapRef]) {
      const map = mapRef.current;
      if (!map) continue;
      const source = map.getSource('carto') as maplibregl.RasterTileSource | undefined;
      if (source) {
        source.setTiles([tiles]);
      }
      const apply = () => updateThemeColors(map, theme);
      if (map.isStyleLoaded()) apply();
      else {
        map.on('load', apply);
        pendingListeners.push({ map, fn: apply });
      }
    }
    return () => {
      for (const { map, fn } of pendingListeners) {
        map.off('load', fn);
      }
    };
  }, [theme]);

  // Add/update data layers when data changes. addDataLayers uses setData in
  // place on existing sources, so this only does the full layer setup on the
  // first data load.
  useEffect(() => {
    if (!data) return;

    const pendingListeners: { map: maplibregl.Map; fn: () => void }[] = [];

    const setupMap = (map: maplibregl.Map | null, layerId: LayerId) => {
      if (!map) return;
      const apply = () => addDataLayers(map, data, layerId, theme);
      if (map.isStyleLoaded()) {
        apply();
      } else {
        map.on('load', apply);
        pendingListeners.push({ map, fn: apply });
      }
    };

    setupMap(leftMapRef.current, leftLayer);
    setupMap(rightMapRef.current, rightLayer);

    return () => {
      for (const { map, fn } of pendingListeners) {
        map.off('load', fn);
      }
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="absolute top-2 left-2 z-10">
          {onLeftLayerChange ? (
            <SplitLayerPicker value={leftLayer} onChange={onLeftLayerChange} />
          ) : (
            <div className="px-2 py-1 rounded bg-white/80 dark:bg-surface-900/80 text-xs font-medium">
              {t(getLayerById(leftLayer).labelKey)}
            </div>
          )}
        </div>
      </div>

      {/* Vertical divider */}
      <div className="absolute left-1/2 top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-slate-400 dark:bg-slate-600 pointer-events-none" />

      {/* Right map */}
      <div className="relative h-full w-1/2">
        <div ref={rightContainerRef} className="absolute inset-0" />
        <div className="absolute top-2 left-2 z-10">
          {onRightLayerChange ? (
            <SplitLayerPicker value={rightLayer} onChange={onRightLayerChange} />
          ) : (
            <div className="px-2 py-1 rounded bg-white/80 dark:bg-surface-900/80 text-xs font-medium">
              {t(getLayerById(rightLayer).labelKey)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
SplitMapView.displayName = 'SplitMapView';
