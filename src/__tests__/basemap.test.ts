import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AttributionControl, LayerSpecification, Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
import {
  trimBoundaryLayer,
  basemapStyleUrl,
  firstOverlayLayerId,
  carryDataLayers,
  addBasemapAttribution,
  ATTRIBUTION_FOLD_MS,
  BASEMAP_STYLE_LIGHT,
  BASEMAP_STYLE_DARK,
  BASEMAP_ATTRIBUTION,
} from '../utils/basemap';

// A trimmed-down stand-in for an OpenFreeMap-style base style: background + water,
// then a road (transportation) layer, then a label (symbol) layer. Both positron and
// dark share the `openmaptiles` vector source, which is what lets a theme swap carry
// the app's own layers over.
function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      ne2_shaded: { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'], tileSize: 256 },
    },
    layers: [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
      { id: 'road_major', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
      { id: 'place_label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
    ] as unknown as LayerSpecification[],
  };
}

describe('basemapStyleUrl', () => {
  it('resolves the OpenFreeMap positron (light) and dark styles by theme', () => {
    expect(basemapStyleUrl('light')).toBe(BASEMAP_STYLE_LIGHT);
    expect(basemapStyleUrl('dark')).toBe(BASEMAP_STYLE_DARK);
  });

  it('defaults to the keyless OpenFreeMap endpoints (no env override in tests)', () => {
    expect(basemapStyleUrl('light')).toBe('https://tiles.openfreemap.org/styles/positron');
    expect(basemapStyleUrl('dark')).toBe('https://tiles.openfreemap.org/styles/dark');
  });
});

describe('BASEMAP_ATTRIBUTION', () => {
  it('credits OpenFreeMap, OpenMapTiles and OpenStreetMap', () => {
    expect(BASEMAP_ATTRIBUTION).toContain('openfreemap.org');
    expect(BASEMAP_ATTRIBUTION).toContain('openmaptiles.org');
    expect(BASEMAP_ATTRIBUTION).toContain('openstreetmap.org');
  });

  it('is exactly the tile source TileJSON attribution, so MapLibre shows one copy', () => {
    // MapLibre dedupes a source attribution against the custom one only on an exact
    // string match; this is what tiles.openfreemap.org/planet served on 2026-10-27.
    expect(BASEMAP_ATTRIBUTION).toBe(
      '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    );
  });
});

describe('addBasemapAttribution', () => {
  afterEach(() => vi.useRealTimers());

  /** Stands in for maplibregl.AttributionControl in its post-onAdd, compact-expanded state. */
  function setup() {
    const created: { options: unknown; _container: HTMLElement }[] = [];
    class FakeControl {
      options: unknown;
      _container = document.createElement('details');
      constructor(options: unknown) {
        this.options = options;
        this._container.classList.add('maplibregl-compact', 'maplibregl-compact-show');
        created.push(this);
      }
    }
    const map = { addControl: vi.fn() };
    addBasemapAttribution(
      map as unknown as MaplibreMap,
      FakeControl as unknown as typeof AttributionControl,
      'bottom-right',
    );
    return { map, ctrl: created[0] };
  }

  it('adds a compact control carrying the basemap credit', () => {
    vi.useFakeTimers();
    const { map, ctrl } = setup();
    expect(ctrl.options).toEqual({ compact: true, customAttribution: BASEMAP_ATTRIBUTION });
    expect(map.addControl).toHaveBeenCalledWith(ctrl, 'bottom-right');
  });

  it('shows the credit on load and folds it to the (i) after five seconds', () => {
    vi.useFakeTimers();
    const { ctrl } = setup();
    vi.advanceTimersByTime(ATTRIBUTION_FOLD_MS - 1);
    expect(ctrl._container.classList.contains('maplibregl-compact-show')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ctrl._container.classList.contains('maplibregl-compact-show')).toBe(false);
    expect(ctrl._container.classList.contains('maplibregl-compact')).toBe(true);
    expect(ATTRIBUTION_FOLD_MS).toBeGreaterThanOrEqual(5000); // OSMF: an automatic collapse no sooner than 5 s
  });

  it('does not fold a control the viewer has already tapped', () => {
    vi.useFakeTimers();
    const { ctrl } = setup();
    ctrl._container.click();
    vi.advanceTimersByTime(ATTRIBUTION_FOLD_MS);
    expect(ctrl._container.classList.contains('maplibregl-compact-show')).toBe(true);
  });
});

describe('firstOverlayLayerId', () => {
  it('returns the first place-name label layer id (choropleth goes above roads, below place names)', () => {
    expect(firstOverlayLayerId(baseStyle().layers)).toBe('place_label');
  });

  it('picks the place label even when other symbol layers (e.g. road names) come first', () => {
    const layers = [
      { id: 'background', type: 'background' },
      { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
      { id: 'road_name', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name' },
      { id: 'place_label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
    ] as unknown as LayerSpecification[];
    expect(firstOverlayLayerId(layers)).toBe('place_label');
  });

  it('falls back to the first symbol layer when there is no place label', () => {
    const layers = [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
      { id: 'water_name', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name' },
    ] as unknown as LayerSpecification[];
    expect(firstOverlayLayerId(layers)).toBe('water_name');
  });

  it('returns undefined when there is no label (symbol) layer at all', () => {
    const layers = [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
      { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
    ] as unknown as LayerSpecification[];
    expect(firstOverlayLayerId(layers)).toBeUndefined();
  });
});

describe('carryDataLayers', () => {
  const dataLayers = [
    { id: 'neighborhoods-fill', type: 'fill', source: 'neighborhoods' },
    { id: 'neighborhoods-line', type: 'line', source: 'neighborhoods' },
    { id: 'grid-fill', type: 'fill', source: 'grid-cells' },
  ] as unknown as LayerSpecification[];

  function styleWithData(): StyleSpecification {
    const s = baseStyle();
    return {
      ...s,
      sources: {
        ...s.sources,
        neighborhoods: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        'grid-cells': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      // As the app builds it: data layers sit just below the place-name label,
      // i.e. above the base roads.
      layers: [s.layers[0], s.layers[1], s.layers[2], ...dataLayers, s.layers[3]] as unknown as LayerSpecification[],
    };
  }

  it('returns the incoming style unchanged on the initial load (no previous style)', () => {
    // A copy (the borders are trimmed into a new layers array), equal when there are none.
    const next = baseStyle();
    expect(carryDataLayers(undefined, next)).toEqual(next);
  });

  it('carries the app data sources across the swap and drops nothing base', () => {
    const merged = carryDataLayers(styleWithData(), baseStyle());
    expect(Object.keys(merged.sources).sort()).toEqual(
      ['grid-cells', 'ne2_shaded', 'neighborhoods', 'openmaptiles'].sort(),
    );
  });

  it('re-inserts the data layers below the new base place-name label, in order', () => {
    const merged = carryDataLayers(styleWithData(), baseStyle());
    const ids = merged.layers.map((l) => l.id);
    // Base layers preserved; data layers land above the roads, immediately before
    // the place-name label — so roads stay under the fill after a theme swap too.
    expect(ids).toEqual([
      'background',
      'water',
      'road_major',
      'neighborhoods-fill',
      'neighborhoods-line',
      'grid-fill',
      'place_label',
    ]);
  });

  it('does not treat base layers (openmaptiles / ne2_shaded / background) as app layers', () => {
    const merged = carryDataLayers(styleWithData(), baseStyle());
    // Exactly one of each base layer — no duplication from mis-detecting them as custom.
    expect(merged.layers.filter((l) => l.id === 'road_major')).toHaveLength(1);
    expect(merged.layers.filter((l) => l.id === 'background')).toHaveLength(1);
  });
});

describe('trimBoundaryLayer', () => {
  const line = (id: string, filter: unknown, sourceLayer = 'boundary') =>
    ({ id, type: 'line', source: 'openmaptiles', 'source-layer': sourceLayer, filter }) as LayerSpecification;

  // The two OpenFreeMap styles' boundary layers, as they ship.
  const darkState = line('boundary_state', ['==', ['get', 'admin_level'], 4]);
  const darkCountry = line('boundary_country_z5-', ['==', ['get', 'admin_level'], 2]);
  const positron3 = line('boundary_3', ['all', ['>=', ['get', 'admin_level'], 3], ['<=', ['get', 'admin_level'], 6], ['!=', ['get', 'maritime'], 1]]);
  const positron2 = line('boundary_2', ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]]);

  it('hides sub-national borders', () => {
    expect(trimBoundaryLayer(darkState)).toBeNull();
    expect(trimBoundaryLayer(positron3)).toBeNull();
  });

  it('keeps country borders but drops their sea segments', () => {
    const t = trimBoundaryLayer(darkCountry) as LayerSpecification & { filter: unknown };
    expect(t.filter).toEqual(['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]]);
    expect(trimBoundaryLayer(t)).toBe(t);
    expect(trimBoundaryLayer(positron2)).toBe(positron2);
  });

  it('leaves non-boundary layers alone', () => {
    const water = line('water', ['==', ['get', 'class'], 'lake'], 'water');
    expect(trimBoundaryLayer(water)).toBe(water);
  });
});
