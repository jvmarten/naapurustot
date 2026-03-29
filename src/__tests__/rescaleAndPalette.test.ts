import { describe, it, expect } from 'vitest';
import { rescaleLayerToData, LAYERS, getLayerById, setColorblindMode, getColorblindMode } from '../utils/colorScales';
import type { LayerConfig } from '../utils/colorScales';

const TEST_LAYER: LayerConfig = {
  id: 'median_income',
  labelKey: 'layer.median_income',
  property: 'hr_mtu',
  unit: '€',
  colors: ['#aaa', '#bbb', '#ccc', '#ddd'],
  stops: [10000, 20000, 30000, 40000],
  format: (v: number) => `${v} €`,
};

function makeFeature(value: number | null | string): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { hr_mtu: value },
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

describe('rescaleLayerToData', () => {
  it('rescales stops to actual data range', () => {
    const features = [makeFeature(15000), makeFeature(25000), makeFeature(35000)];
    const rescaled = rescaleLayerToData(TEST_LAYER, features);
    expect(rescaled.stops[0]).toBe(15000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(35000);
    expect(rescaled.colors).toEqual(TEST_LAYER.colors); // colors unchanged
  });

  it('returns original layer when no valid values exist', () => {
    const features = [makeFeature(null), makeFeature(null)];
    const rescaled = rescaleLayerToData(TEST_LAYER, features);
    expect(rescaled).toBe(TEST_LAYER); // same reference — unchanged
  });

  it('returns original layer when min === max (single distinct value)', () => {
    const features = [makeFeature(20000), makeFeature(20000)];
    const rescaled = rescaleLayerToData(TEST_LAYER, features);
    expect(rescaled).toBe(TEST_LAYER);
  });

  it('returns original layer for empty features array', () => {
    const rescaled = rescaleLayerToData(TEST_LAYER, []);
    expect(rescaled).toBe(TEST_LAYER);
  });

  it('evenly distributes stops across the range', () => {
    const features = [makeFeature(0), makeFeature(300)];
    const rescaled = rescaleLayerToData(TEST_LAYER, features);
    // 4 stops: [0, 100, 200, 300]
    expect(rescaled.stops).toEqual([0, 100, 200, 300]);
  });

  it('handles string-encoded numeric values in features', () => {
    const features = [makeFeature('5000' as unknown as string), makeFeature('15000' as unknown as string)];
    const rescaled = rescaleLayerToData(TEST_LAYER, features);
    expect(rescaled.stops[0]).toBe(5000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(15000);
  });

  it('ignores NaN/Infinity values', () => {
    const features = [makeFeature(NaN), makeFeature(Infinity), makeFeature(1000), makeFeature(2000)];
    const rescaled = rescaleLayerToData(TEST_LAYER, features);
    expect(rescaled.stops[0]).toBe(1000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(2000);
  });
});

describe('colorblind mode and palette resampling', () => {
  it('getLayerById returns original colors when colorblind mode is off', () => {
    setColorblindMode('off');
    const layer = getLayerById('quality_index');
    const original = LAYERS.find((l) => l.id === 'quality_index')!;
    expect(layer.colors).toEqual(original.colors);
  });

  it('getLayerById substitutes palette when colorblind mode is on', () => {
    setColorblindMode('protanopia');
    const layer = getLayerById('quality_index');
    const original = LAYERS.find((l) => l.id === 'quality_index')!;
    // Colors should differ from original
    expect(layer.colors).not.toEqual(original.colors);
    // But should have the same count
    expect(layer.colors.length).toBe(original.colors.length);
    // Each color should be a valid hex string
    layer.colors.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
    setColorblindMode('off');
  });

  it('deuteranopia and tritanopia modes also produce valid palettes', () => {
    for (const mode of ['deuteranopia', 'tritanopia'] as const) {
      setColorblindMode(mode);
      expect(getColorblindMode()).toBe(mode);
      const layer = getLayerById('median_income');
      expect(layer.colors.length).toBe(LAYERS.find((l) => l.id === 'median_income')!.colors.length);
      layer.colors.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
    }
    setColorblindMode('off');
  });

  it('resampled palette has correct number of stops for layers with different color counts', () => {
    setColorblindMode('protanopia');
    // Unemployment has 10 colors, more than the 8-stop CB palette → needs interpolation
    const unemployment = getLayerById('unemployment');
    expect(unemployment.colors.length).toBe(10);
    unemployment.colors.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
    setColorblindMode('off');
  });
});
