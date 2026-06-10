import React, { useRef, useEffect, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import { buildFillColorExpression, LAYERS, type LayerId, type LayerConfig, getLayerById } from '../utils/colorScales';
import { ensureHatchImage } from '../utils/hatchPattern';
import { buildFillOpacityFadeOut, buildGridFillOpacity, GRID_ZOOM_FADE_IN } from '../utils/gridFade';
import { getGridInfo } from '../hooks/useGridData';
import { getCoveragePct, isLowCoverage, formatCoveragePct, type NeighborhoodProperties } from '../utils/metrics';
import { useTheme } from '../hooks/useTheme';
import { t, useI18nVersion } from '../utils/i18n';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '../utils/mapConstants';

/**
 * Compact dropdown for choosing a data layer on one side of the split view.
 */
const SplitLayerPicker: React.FC<{
  value: LayerId;
  onChange: (id: LayerId) => void;
}> = React.memo(({ value, onChange }) => {
  useI18nVersion();
  return (
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
});

/**
 * IN-1: in-pane hover tooltip. Mirrors the main map's Tooltip but is positioned
 * pane-locally (absolute within the pane) and shows the value for that pane's own
 * layer. Kept lightweight — only the hovered value + "vs avg" delta.
 */
const SplitPaneTooltip: React.FC<{
  hover: PaneHover;
  layer: LayerConfig;
  metroAverage?: number;
  /** 'left' tooltips flip leftward near the divider; 'right' flip rightward. */
  side: 'left' | 'right';
}> = ({ hover, layer, metroAverage, side }) => {
  // QW-8: over a fine-grained grid cell, show the cell's own value (labeled) instead of
  // the postal aggregate, and suppress the postal "vs avg" comparison.
  const isGridCell = hover.gridValue != null;
  const value = isGridCell ? hover.gridValue : (hover.props[layer.property] as number | null | undefined);
  const fmt = value != null ? (layer.tooltipFormat ?? layer.format)(value) : t('tooltip.no_data');
  let cmpText = '';
  let cmpClass = '';
  if (!isGridCell && value != null && metroAverage != null && metroAverage !== 0) {
    const diffPct = ((value - metroAverage) / Math.abs(metroAverage)) * 100;
    if (Math.abs(diffPct) >= 1) {
      const sign = diffPct > 0 ? '+' : '';
      cmpText = `${diffPct > 0 ? '▲' : '▼'} ${sign}${diffPct.toFixed(0)}% ${t('tooltip.vs_avg')}`;
      const isPositive = (layer.higherIsBetter !== false) ? diffPct > 0 : diffPct < 0;
      cmpClass = isPositive ? 'text-emerald-500' : 'text-rose-400';
    }
  }
  // Offset from the cursor; flip toward pane interior so it never spills over the
  // divider or off the outer edge.
  const flipX = side === 'left' ? -12 : 12;
  const style: React.CSSProperties = {
    transform: `translate(${side === 'left' ? 'calc(-100% - 0px)' : '0'}, -100%)`,
    left: hover.x + flipX,
    top: hover.y - 12,
  };
  return (
    <div
      className="tooltip-desktop pointer-events-none absolute z-30 max-w-[180px] rounded-lg bg-white/95 dark:bg-surface-900/95 px-3 py-2 text-sm shadow-xl border border-surface-200 dark:border-surface-700/50"
      style={style}
    >
      <div className="font-semibold text-surface-900 dark:text-white truncate">
        {hover.props.nimi || hover.props.pno}
      </div>
      <div className={value == null ? 'text-surface-400 italic' : 'text-surface-600 dark:text-surface-300'}>
        {fmt}
        {isGridCell && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-surface-400 dark:text-surface-500">{t('tooltip.cell_value')}</span>}
      </div>
      {cmpText && <div className={`text-xs mt-0.5 ${cmpClass}`}>{cmpText}</div>}
    </div>
  );
};

/**
 * IN-1: compact per-pane legend with a coverage-scope badge. Smaller than the
 * main Legend (no proxy/freshness rows) so it fits two side-by-side panes.
 */
const SplitPaneLegend: React.FC<{ layer: LayerConfig; side: 'left' | 'right' }> = ({ layer, side }) => {
  useI18nVersion();
  const n = layer.stops.length;
  const grid = getGridInfo(layer.id);
  const coverage = getCoveragePct(layer.property);
  const lowCoverage = isLowCoverage(layer.property);
  const coverageLabel = coverage != null ? formatCoveragePct(coverage) : null;
  return (
    <div className={`absolute bottom-2 z-10 ${side === 'left' ? 'left-2' : 'right-2'}`}>
      <div className="rounded-lg bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-lg px-2.5 py-1.5">
        <div className="flex items-center gap-0">
          {layer.colors.map((color, i) => (
            <div key={i} className="w-4 h-2.5 first:rounded-l last:rounded-r" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="flex justify-between mt-1" style={{ width: `${layer.colors.length * 16}px` }}>
          <span className="text-[9px] text-surface-500">{layer.format(layer.stops[0])}</span>
          <span className="text-[9px] text-surface-500">{layer.format(layer.stops[n - 1])}</span>
        </div>
        {grid && (
          <div className="mt-1 flex items-center gap-1 text-[9px] text-surface-400 dark:text-surface-500">
            <span aria-hidden="true">▦</span>
            <span>{t(grid.scope === 'national' ? 'grid.scope_national' : 'grid.scope_regional')}</span>
          </div>
        )}
        {lowCoverage && coverageLabel != null && (
          <div className="mt-1 flex items-center gap-1 text-[9px] text-amber-600 dark:text-amber-400">
            <span aria-hidden="true">▦</span>
            <span>{t('split.low_coverage').replace('{pct}', coverageLabel)}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const BASEMAP_LIGHT = (import.meta.env.VITE_BASEMAP_LIGHT_URL as string) || 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK = (import.meta.env.VITE_BASEMAP_DARK_URL as string) || 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
const BASEMAP_LIGHT_LABELS = (import.meta.env.VITE_BASEMAP_LIGHT_LABELS_URL as string) || 'https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK_LABELS = (import.meta.env.VITE_BASEMAP_DARK_LABELS_URL as string) || 'https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png';

const SOURCE_ID = 'neighborhoods';
const FILL_LAYER = 'neighborhoods-fill';
const LINE_LAYER = 'neighborhoods-line';
const LABELS_SOURCE_ID = 'carto-labels';
const LABELS_LAYER = 'carto-labels';

function beforeLabels(map: maplibregl.Map): string | undefined {
  return map.getLayer(LABELS_LAYER) ? LABELS_LAYER : undefined;
}

interface SplitMapViewProps {
  data: FeatureCollection | null;
  leftLayer: LayerId;
  rightLayer: LayerId;
  /** CF-2: App-level effective (region-rescaled / colorblind) config per pane, so the
   *  split panes use the SAME colour scale the main map does. Falls back to getLayerById. */
  leftLayerConfig?: LayerConfig;
  rightLayerConfig?: LayerConfig;
  onLeftLayerChange?: (id: LayerId) => void;
  onRightLayerChange?: (id: LayerId) => void;
  colorblind?: string;
  /** CF-2: the postal fill opacity slider value, so split view honours it like the main map. */
  fillOpacity?: number;
  /** CF-2: the selected neighbourhood's pno, to render a visual selection ring on click. */
  selectedPno?: string | null;
  /** IN-1: region-clipped fine-grained grid for the left pane's layer (null when none). */
  leftGridData?: FeatureCollection | null;
  /** IN-1: region-clipped fine-grained grid for the right pane's layer (null when none). */
  rightGridData?: FeatureCollection | null;
  /** IN-1: per-metric region averages, for the hover tooltip's "vs avg" line. */
  metroAverages?: Record<string, number>;
  /** IN-1: open the detail panel when a neighborhood is clicked in either pane. */
  onSelectNeighborhood?: (props: NeighborhoodProperties) => void;
}

/** IN-1: local hover state for one pane's in-map tooltip. */
interface PaneHover {
  props: NeighborhoodProperties;
  /** Cursor position in pane-local pixels. */
  x: number;
  y: number;
  /** QW-8: the fine-grained grid cell's value under the cursor (above the crossfade),
   *  shown instead of the postal aggregate. Null/absent over the postal fill. */
  gridValue?: number | null;
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
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
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
      // Labels overlay sits above the choropleth so place names render
      // on top of the colored fills; choropleth layers are inserted via
      // beforeId=LABELS_LAYER.
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

const METRO_LINE_LAYER = 'neighborhoods-metro-line';
const NO_DATA_LAYER = 'neighborhoods-no-data-pattern';
const HIGHLIGHT_LAYER = 'neighborhoods-highlight';
// IN-1: per-pane fine-grained grid source/layer, mirroring the main map.
const GRID_SOURCE_ID = 'grid-cells';
const GRID_FILL_LAYER = 'grid-fill';

/** PO-1: filter selecting features whose active-layer property is null/missing,
 *  excluding metro-area dissolve features (CLAUDE.md pitfall #4). */
function noDataFilter(propertyKey: string): maplibregl.FilterSpecification {
  return ['all',
    ['!', ['boolean', ['get', '_isMetroArea'], false]],
    ['any',
      ['!', ['has', propertyKey]],
      ['==', ['get', propertyKey], null],
    ],
  ] as unknown as maplibregl.FilterSpecification;
}

/** IN-1: true when a fine-grained grid should render for this layer + data pair. */
function gridActive(layer: LayerConfig, gridData: FeatureCollection | null | undefined): boolean {
  return !!gridData && !!layer.gridProperty;
}

// IN-1: base postal-fill opacity for the "no grid" case. Kept STATE-DEPENDENT
// (references feature-state hover/selected) on purpose — the panes call
// setFeatureState({hover}) on the FILL source, and MapLibre's
// ProgramConfiguration.updatePaintArrays throws "this.expression.evaluate is not
// a function" if a state-dependent fill-opacity is ever replaced by a bare
// constant and then a setFeatureState fires. Bumping the hovered cell also reads
// a touch better. Mirrors Map.tsx's buildFillOpacity rationale.
// CF-2: postal-fill opacity for the "no grid" case, scaled by the slider value so the
// split panes honour it like the main map. Kept STATE-DEPENDENT (references feature-state
// hover/selected) on purpose — replacing a state-dependent fill-opacity with a bare
// constant makes the next setFeatureState throw (see Map.tsx). hover/selected bump +0.15.
function baseFillOpacity(opacity: number): maplibregl.ExpressionSpecification {
  const bump = Math.min(1, opacity + 0.15);
  return [
    'case',
    ['boolean', ['feature-state', 'hover'], false], bump,
    ['boolean', ['feature-state', 'selected'], false], bump,
    opacity,
  ] as unknown as maplibregl.ExpressionSpecification;
}

/**
 * IN-1: add/update the per-pane fine-grained grid layer with the same zoom fade
 * as the main map (Map.tsx). The postal fill fades OUT and the grid fades IN
 * across GRID_ZOOM_FADE_IN..OUT. Inserted above FILL_LAYER but below LINE_LAYER
 * so borders, the no-data hatch, and the hover ring stay on top.
 */
function syncGridLayer(
  map: maplibregl.Map,
  layer: LayerConfig,
  gridData: FeatureCollection | null | undefined,
  fillOpacity: number,
) {
  const useGrid = gridActive(layer, gridData);

  if (!useGrid) {
    // Tear the grid layer down and restore the postal fill's base opacity.
    if (map.getLayer(GRID_FILL_LAYER)) map.removeLayer(GRID_FILL_LAYER);
    if (map.getSource(GRID_SOURCE_ID)) map.removeSource(GRID_SOURCE_ID);
    if (map.getLayer(FILL_LAYER)) {
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', baseFillOpacity(fillOpacity));
    }
    return;
  }

  // Postal fill fades out as the grid fades in. CF-2: honour the opacity slider.
  if (map.getLayer(FILL_LAYER)) {
    map.setPaintProperty(FILL_LAYER, 'fill-opacity', buildFillOpacityFadeOut(fillOpacity) as maplibregl.ExpressionSpecification);
  }

  const existing = map.getSource(GRID_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(gridData!);
    map.setPaintProperty(GRID_FILL_LAYER, 'fill-color', buildFillColorExpression(layer, layer.gridProperty));
    map.setPaintProperty(GRID_FILL_LAYER, 'fill-opacity', buildGridFillOpacity(fillOpacity) as maplibregl.ExpressionSpecification);
    return;
  }

  // beforeId=LINE_LAYER requires the line layer to exist — addDataLayers always
  // adds it before calling syncGridLayer, so this is safe here.
  if (!map.getLayer(LINE_LAYER)) return;
  map.addSource(GRID_SOURCE_ID, { type: 'geojson', data: gridData! });
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
}

function addDataLayers(
  map: maplibregl.Map,
  data: FeatureCollection,
  layer: LayerConfig,
  theme: 'dark' | 'light',
  gridData: FeatureCollection | null | undefined,
  fillOpacity: number,
) {
  // If the source already exists, just refresh its data — rebuilding the
  // source + 3 layers on every data change (e.g., quality weight adjustment
  // with two maps mounted) doubles the MapLibre work unnecessarily.
  if (map.getSource(SOURCE_ID)) {
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    if (map.getLayer(FILL_LAYER)) {
      map.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer));
    }
    if (map.getLayer(NO_DATA_LAYER)) {
      map.setFilter(NO_DATA_LAYER, noDataFilter(layer.property));
    }
    syncGridLayer(map, layer, gridData, fillOpacity);
    return;
  }

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data,
    promoteId: 'pno',
  });

  map.addLayer({
    id: FILL_LAYER,
    type: 'fill',
    source: SOURCE_ID,
    paint: {
      'fill-color': buildFillColorExpression(layer),
      'fill-color-transition': { duration: 300, delay: 0 },
      'fill-opacity': baseFillOpacity(fillOpacity),
      'fill-opacity-transition': { duration: 300, delay: 0 },
    },
  }, beforeLabels(map));

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
  }, beforeLabels(map));

  // IN-1: hover/selection ring. line-opacity is feature-state driven so the
  // handler only flips state instead of re-running setFilter per frame.
  // CF-2: also light up on the 'selected' state (the click selection ring).
  map.addLayer({
    id: HIGHLIGHT_LAYER,
    type: 'line',
    source: SOURCE_ID,
    paint: {
      'line-color': theme === 'dark' ? '#f8fafc' : '#0f172a',
      'line-width': 2.5,
      'line-opacity': ['case',
        ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]],
        1, 0,
      ],
    },
  }, beforeLabels(map));

  // PO-1: diagonal-hatch fill for no-data neighborhoods. Mirrors Map.tsx —
  // excludes metro-area features and re-adds the hatch image on style reload
  // via the styleimagemissing handler wired by ensureHatchImage.
  map.addLayer({
    id: NO_DATA_LAYER,
    type: 'fill',
    source: SOURCE_ID,
    filter: noDataFilter(layer.property),
    paint: {
      'fill-pattern': ensureHatchImage(map, theme),
      'fill-opacity': 0.9,
    },
  }, beforeLabels(map));

  // IN-1: grid layer added last so LINE_LAYER already exists for beforeId.
  syncGridLayer(map, layer, gridData, fillOpacity);
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
  if (map.getLayer(HIGHLIGHT_LAYER)) {
    map.setPaintProperty(HIGHLIGHT_LAYER, 'line-color', theme === 'dark' ? '#f8fafc' : '#0f172a');
  }
  if (map.getLayer(NO_DATA_LAYER)) {
    // PO-1: swap to the theme-matched hatch image (reload-safe via ensureHatchImage).
    map.setPaintProperty(NO_DATA_LAYER, 'fill-pattern', ensureHatchImage(map, theme));
  }
}

export const SplitMapView: React.FC<SplitMapViewProps> = React.memo(({
  data,
  leftLayer,
  rightLayer,
  leftLayerConfig,
  rightLayerConfig,
  onLeftLayerChange,
  onRightLayerChange,
  colorblind = 'off',
  fillOpacity = 1,
  selectedPno = null,
  leftGridData = null,
  rightGridData = null,
  metroAverages,
  onSelectNeighborhood,
}) => {
  useI18nVersion();
  // CF-2: prefer the App-level effective (region-rescaled / colorblind) config so the
  // panes match the main map's colour scale; fall back to the base layer config.
  const leftConfig = leftLayerConfig ?? getLayerById(leftLayer);
  const rightConfig = rightLayerConfig ?? getLayerById(rightLayer);
  const leftContainerRef = useRef<HTMLDivElement>(null);
  const rightContainerRef = useRef<HTMLDivElement>(null);
  const leftMapRef = useRef<maplibregl.Map | null>(null);
  const rightMapRef = useRef<maplibregl.Map | null>(null);
  // Persistent per-map "style loaded" flags. map.isStyleLoaded() returns false
  // during an in-flight setData re-parse, not just before the one-shot 'load'
  // event — so gating on it would re-queue work on a 'load' that already fired
  // and never fires again (mirrors Map.tsx's mapStyleLoadedRef fix).
  const leftLoadedRef = useRef(false);
  const rightLoadedRef = useRef(false);
  const syncingRef = useRef(false);
  const { theme } = useTheme();
  // True when MapLibre can't create a WebGL context for either pane — show a
  // fallback message rather than throwing into the ErrorBoundary.
  const [webglFailed, setWebglFailed] = useState(false);

  // IN-1: per-pane hover tooltip state. Kept local (not the global tooltipStore)
  // so each pane shows the value for ITS OWN layer, positioned inside that pane.
  const [leftHover, setLeftHover] = useState<PaneHover | null>(null);
  const [rightHover, setRightHover] = useState<PaneHover | null>(null);

  // Grid data + select callback read inside the event/style handlers via refs so
  // those handlers stay stable (attached once) and never go stale on a grid fetch
  // completing. Synced in an effect (not during render) per the react-hooks/refs
  // rule — the handlers that read them only fire after commit, so this is safe.
  const leftGridRef = useRef(leftGridData);
  const rightGridRef = useRef(rightGridData);
  const onSelectRef = useRef(onSelectNeighborhood);
  // CF-2: effective configs + opacity + selection read by the once-attached effects.
  const leftConfigRef = useRef(leftConfig);
  const rightConfigRef = useRef(rightConfig);
  const fillOpacityRef = useRef(fillOpacity);
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    leftGridRef.current = leftGridData;
    rightGridRef.current = rightGridData;
    onSelectRef.current = onSelectNeighborhood;
    leftConfigRef.current = leftConfig;
    rightConfigRef.current = rightConfig;
    fillOpacityRef.current = fillOpacity;
  });

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
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      attributionControl: false as const,
    };

    let leftMap: maplibregl.Map;
    let rightMap: maplibregl.Map;
    // Holds the left pane once built so a failure constructing the right pane
    // can tear it down (the refs aren't assigned until after both succeed).
    let createdLeft: maplibregl.Map | null = null;
    try {
      leftMap = new maplibregl.Map({
        container: leftContainerRef.current,
        style: makeStyle(theme),
        ...commonOptions,
      });
      createdLeft = leftMap;

      rightMap = new maplibregl.Map({
        container: rightContainerRef.current,
        style: makeStyle(theme),
        ...commonOptions,
      });
    } catch (err) {
      // WebGL unavailable — tear down whichever pane was created and show the
      // fallback instead of crashing.
      console.warn('SplitMapView: failed to initialize WebGL', err);
      createdLeft?.remove();
      setWebglFailed(true);
      return;
    }

    leftMap.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    rightMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    leftMapRef.current = leftMap;
    rightMapRef.current = rightMap;

    // E5: recover from runtime WebGL context loss on EITHER pane. The
    // synchronous try/catch above only covers construction; these listeners
    // surface the same fallback UI for a transient loss and clear it if the
    // browser restores the context.
    const onLost = (ev: Event) => { ev.preventDefault(); setWebglFailed(true); };
    const onRestored = () => setWebglFailed(false);
    const leftCanvas = leftMap.getCanvas();
    const rightCanvas = rightMap.getCanvas();
    leftCanvas.addEventListener('webglcontextlost', onLost, false);
    leftCanvas.addEventListener('webglcontextrestored', onRestored, false);
    rightCanvas.addEventListener('webglcontextlost', onLost, false);
    rightCanvas.addEventListener('webglcontextrestored', onRestored, false);
    // Diagnostics only — most map 'error' events are recoverable (failed tile,
    // transient source error), so do NOT flip webglFailed here.
    leftMap.on('error', (e) => { console.warn('SplitMapView runtime error', e?.error); });
    rightMap.on('error', (e) => { console.warn('SplitMapView runtime error', e?.error); });

    // Flip the persistent loaded flag once each map's style is ready. map.once
    // auto-removes the listener, so no explicit cleanup is needed for these.
    leftMap.once('load', () => { leftLoadedRef.current = true; });
    rightMap.once('load', () => { rightLoadedRef.current = true; });

    // Set up sync handlers
    const syncLeftToRight = createSyncHandler(leftMapRef, rightMapRef);
    const syncRightToLeft = createSyncHandler(rightMapRef, leftMapRef);

    leftMap.on('move', syncLeftToRight);
    rightMap.on('move', syncRightToLeft);

    return () => {
      leftMap.off('move', syncLeftToRight);
      rightMap.off('move', syncRightToLeft);
      leftCanvas.removeEventListener('webglcontextlost', onLost, false);
      leftCanvas.removeEventListener('webglcontextrestored', onRestored, false);
      rightCanvas.removeEventListener('webglcontextlost', onLost, false);
      rightCanvas.removeEventListener('webglcontextrestored', onRestored, false);
      leftMap.remove();
      rightMap.remove();
      leftMapRef.current = null;
      rightMapRef.current = null;
      leftLoadedRef.current = false;
      rightLoadedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Switch basemap on theme change, and repaint the border colors in place.
  // Previously theme change rebuilt source + 3 layers on BOTH maps.
  useEffect(() => {
    const tiles = theme === 'dark' ? BASEMAP_DARK : BASEMAP_LIGHT;
    const labelTiles = theme === 'dark' ? BASEMAP_DARK_LABELS : BASEMAP_LIGHT_LABELS;
    const pendingListeners: { map: maplibregl.Map; fn: () => void }[] = [];
    const pairs: [React.RefObject<maplibregl.Map | null>, React.RefObject<boolean>][] = [
      [leftMapRef, leftLoadedRef],
      [rightMapRef, rightLoadedRef],
    ];
    for (const [mapRef, loadedRef] of pairs) {
      const map = mapRef.current;
      if (!map) continue;
      const source = map.getSource('carto') as maplibregl.RasterTileSource | undefined;
      if (source) {
        source.setTiles([tiles]);
      }
      const labelsSource = map.getSource(LABELS_SOURCE_ID) as maplibregl.RasterTileSource | undefined;
      if (labelsSource) {
        labelsSource.setTiles([labelTiles]);
      }
      const apply = () => updateThemeColors(map, theme);
      // Gate on the persistent loaded flag, not isStyleLoaded() — a theme toggle
      // during an in-flight setData would otherwise queue the repaint on the
      // already-fired 'load' event and the border colors would stay stale.
      if (loadedRef.current) apply();
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

    const setupMap = (
      map: maplibregl.Map | null,
      configRef: React.RefObject<LayerConfig>,
      loadedRef: React.RefObject<boolean>,
      gridRef: React.RefObject<FeatureCollection | null>,
    ) => {
      if (!map) return;
      // Read config/grid/opacity from refs so a deferred 'load' apply picks up the
      // latest effective config + grid + opacity that arrived between this effect
      // running and the style finishing loading.
      const apply = () => addDataLayers(map, data, configRef.current, theme, gridRef.current, fillOpacityRef.current);
      // Gate on the persistent loaded flag. addDataLayers is idempotent
      // (getSource/getLayer guards + setData refresh), so calling it directly
      // during an in-flight setData is safe; queuing on the one-shot 'load'
      // instead would silently drop subsequent data updates.
      if (loadedRef.current) {
        apply();
      } else {
        map.on('load', apply);
        pendingListeners.push({ map, fn: apply });
      }
    };

    setupMap(leftMapRef.current, leftConfigRef, leftLoadedRef, leftGridRef);
    setupMap(rightMapRef.current, rightConfigRef, rightLoadedRef, rightGridRef);

    return () => {
      for (const { map, fn } of pendingListeners) {
        map.off('load', fn);
      }
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update fill color (and re-sync the grid layer) when active layers or
  // colorblind mode change. A layer switch can toggle grid availability, so the
  // grid layer is rebuilt/torn down here too.
  useEffect(() => {
    if (!data) return;

    const updateFill = (
      map: maplibregl.Map | null,
      layer: LayerConfig,
      gridData: FeatureCollection | null,
    ) => {
      if (!map || !map.getLayer(FILL_LAYER)) return;
      map.setPaintProperty(FILL_LAYER, 'fill-color', buildFillColorExpression(layer));
      // PO-1: re-target the no-data hatch to the new layer's property.
      if (map.getLayer(NO_DATA_LAYER)) {
        map.setFilter(NO_DATA_LAYER, noDataFilter(layer.property));
      }
      // IN-1: add/refresh/remove the grid layer for the (possibly new) layer.
      // syncGridLayer also restores the postal fill opacity when no grid applies.
      syncGridLayer(map, layer, gridData, fillOpacity);
    };

    // CF-2: use the effective (region-rescaled) configs + opacity, so the panes match
    // the main map's colour scale and honour the opacity slider.
    updateFill(leftMapRef.current, leftConfig, leftGridData);
    updateFill(rightMapRef.current, rightConfig, rightGridData);
  }, [leftConfig, rightConfig, colorblind, data, leftGridData, rightGridData, fillOpacity]);

  // CF-2: reflect the app-level selection as a 'selected' feature-state on both panes —
  // the HIGHLIGHT_LAYER ring and the base-fill bump read it, so a click now shows a
  // visual selection. Nothing set this state before. Re-runs on `data` too because a
  // GeoJSON setData refresh clears feature-state.
  useEffect(() => {
    for (const map of [leftMapRef.current, rightMapRef.current]) {
      if (!map || !map.getSource(SOURCE_ID)) continue;
      if (prevSelectedRef.current) {
        map.setFeatureState({ source: SOURCE_ID, id: prevSelectedRef.current }, { selected: false });
      }
      if (selectedPno) {
        map.setFeatureState({ source: SOURCE_ID, id: selectedPno }, { selected: true });
      }
    }
    prevSelectedRef.current = selectedPno;
  }, [selectedPno, data]);

  // IN-1: per-pane hover (in-map tooltip + highlight ring) and click-to-open.
  // Handlers are attached once and read grid/select via refs, so they never go
  // stale on data refreshes or grid fetches. Hover positions are pane-local.
  useEffect(() => {
    const setupInteract = (
      map: maplibregl.Map | null,
      setHover: React.Dispatch<React.SetStateAction<PaneHover | null>>,
      configRef: React.RefObject<LayerConfig>,
      gridRef: React.RefObject<FeatureCollection | null>,
    ): (() => void) | undefined => {
      if (!map) return undefined;
      const hoveredIdRef = { current: null as string | null };
      let pending: maplibregl.MapMouseEvent | null = null;
      let rafId: number | null = null;

      const setHoverState = (pno: string | null) => {
        if (hoveredIdRef.current === pno) return;
        if (hoveredIdRef.current) {
          map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hover: false });
        }
        hoveredIdRef.current = pno;
        if (pno) map.setFeatureState({ source: SOURCE_ID, id: pno }, { hover: true });
      };

      const process = () => {
        rafId = null;
        const e = pending;
        pending = null;
        if (!e || !map.getSource(SOURCE_ID) || !map.getLayer(FILL_LAYER)) return;
        const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
        const feat = features[0];
        const pno = feat?.properties?.pno as string | undefined;
        if (feat && pno) {
          setHoverState(pno);
          map.getCanvas().style.cursor = 'pointer';
          // QW-8: over the pane's fine-grained grid above the crossfade, surface the
          // cell's own value (the postal fill is invisible but still hit-tested).
          let gridValue: number | null = null;
          const cfg = configRef.current;
          if (gridRef.current && cfg.gridProperty && map.getZoom() >= GRID_ZOOM_FADE_IN && map.getLayer(GRID_FILL_LAYER)) {
            const cells = map.queryRenderedFeatures(e.point, { layers: [GRID_FILL_LAYER] });
            const gv = cells[0]?.properties?.[cfg.gridProperty];
            if (typeof gv === 'number' && isFinite(gv)) gridValue = gv;
          }
          setHover({ props: feat.properties as NeighborhoodProperties, x: e.point.x, y: e.point.y, gridValue });
        } else {
          setHoverState(null);
          map.getCanvas().style.cursor = '';
          setHover(null);
        }
      };

      const onMove = (e: maplibregl.MapMouseEvent) => {
        pending = e;
        if (rafId === null) rafId = requestAnimationFrame(process);
      };
      const onLeave = () => {
        pending = null;
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        setHoverState(null);
        map.getCanvas().style.cursor = '';
        setHover(null);
      };
      const onClick = (e: maplibregl.MapMouseEvent) => {
        if (!map.getSource(SOURCE_ID) || !map.getLayer(FILL_LAYER)) return;
        const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
        const props = features[0]?.properties as NeighborhoodProperties | undefined;
        if (props?.pno) onSelectRef.current?.(props);
      };

      map.on('mousemove', onMove);
      map.on('mouseleave', FILL_LAYER, onLeave);
      map.on('click', onClick);
      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        map.off('mousemove', onMove);
        map.off('mouseleave', FILL_LAYER, onLeave);
        map.off('click', onClick);
      };
    };

    const cleanups = [
      setupInteract(leftMapRef.current, setLeftHover, leftConfigRef, leftGridRef),
      setupInteract(rightMapRef.current, setRightHover, rightConfigRef, rightGridRef),
    ];
    return () => { for (const c of cleanups) c?.(); };
    // Attach once on mount: the map instances live for the component's lifetime,
    // and grid/select are read via refs. setLeftHover/setRightHover are stable.
  }, []);

  if (webglFailed) {
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center p-8 text-center bg-surface-50 dark:bg-surface-950">
        <div className="text-4xl mb-4" aria-hidden="true">🗺️</div>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-2">
          {t('error.webgl_unavailable')}
        </h2>
        <p className="text-sm text-surface-500 dark:text-surface-400 max-w-sm mb-4">
          {t('error.webgl_context_lost_desc')}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
        >
          {t('error.reload')}
        </button>
      </div>
    );
  }

  // leftConfig / rightConfig are the effective configs computed at the top.
  return (
    <div className="relative flex h-full w-full">
      {/* Left map */}
      <div className="relative h-full w-1/2 overflow-hidden">
        <div ref={leftContainerRef} className="absolute inset-0" />
        <div className="absolute top-2 left-2 z-10">
          {onLeftLayerChange ? (
            <SplitLayerPicker value={leftLayer} onChange={onLeftLayerChange} />
          ) : (
            <div className="px-2 py-1 rounded bg-white/80 dark:bg-surface-900/80 text-xs font-medium">
              {t(leftConfig.labelKey)}
            </div>
          )}
        </div>
        <SplitPaneLegend layer={leftConfig} side="left" />
        {leftHover && (
          <SplitPaneTooltip
            hover={leftHover}
            layer={leftConfig}
            metroAverage={metroAverages?.[leftConfig.property]}
            side="left"
          />
        )}
      </div>

      {/* Vertical divider */}
      <div className="absolute left-1/2 top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-slate-400 dark:bg-slate-600 pointer-events-none" />

      {/* Right map */}
      <div className="relative h-full w-1/2 overflow-hidden">
        <div ref={rightContainerRef} className="absolute inset-0" />
        <div className="absolute top-2 left-2 z-10">
          {onRightLayerChange ? (
            <SplitLayerPicker value={rightLayer} onChange={onRightLayerChange} />
          ) : (
            <div className="px-2 py-1 rounded bg-white/80 dark:bg-surface-900/80 text-xs font-medium">
              {t(rightConfig.labelKey)}
            </div>
          )}
        </div>
        <SplitPaneLegend layer={rightConfig} side="right" />
        {rightHover && (
          <SplitPaneTooltip
            hover={rightHover}
            layer={rightConfig}
            metroAverage={metroAverages?.[rightConfig.property]}
            side="right"
          />
        )}
      </div>
    </div>
  );
});
SplitMapView.displayName = 'SplitMapView';
