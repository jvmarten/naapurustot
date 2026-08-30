import { describe, it, expect } from 'vitest';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import {
  basemapStyleUrl,
  firstOverlayLayerId,
  carryDataLayers,
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
});

describe('firstOverlayLayerId', () => {
  it('returns the first transportation (road) layer id', () => {
    expect(firstOverlayLayerId(baseStyle().layers)).toBe('road_major');
  });

  it('falls back to the first symbol layer when there is no transportation layer', () => {
    const layers = [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
      { id: 'label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
    ] as unknown as LayerSpecification[];
    expect(firstOverlayLayerId(layers)).toBe('label');
  });

  it('returns undefined when there is neither a road nor a label layer', () => {
    const layers = [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
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
      // As the app builds it: data layers sit just below the road layer.
      layers: [s.layers[0], s.layers[1], ...dataLayers, s.layers[2], s.layers[3]] as unknown as LayerSpecification[],
    };
  }

  it('returns the incoming style unchanged on the initial load (no previous style)', () => {
    const next = baseStyle();
    expect(carryDataLayers(undefined, next)).toBe(next);
  });

  it('carries the app data sources across the swap and drops nothing base', () => {
    const merged = carryDataLayers(styleWithData(), baseStyle());
    expect(Object.keys(merged.sources).sort()).toEqual(
      ['grid-cells', 'ne2_shaded', 'neighborhoods', 'openmaptiles'].sort(),
    );
  });

  it('re-inserts the data layers below the new base road/label layer, in order', () => {
    const merged = carryDataLayers(styleWithData(), baseStyle());
    const ids = merged.layers.map((l) => l.id);
    // Base layers preserved; data layers land immediately before the road layer.
    expect(ids).toEqual([
      'background',
      'water',
      'neighborhoods-fill',
      'neighborhoods-line',
      'grid-fill',
      'road_major',
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
