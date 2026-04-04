/**
 * Color scales — critical path tests for rescaleLayerToData edge cases,
 * buildFillColorExpression with propertyOverride, and colorblind mode lifecycle.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  rescaleLayerToData,
  buildFillColorExpression,
  getLayerById,
  getColorForValue,
  setColorblindMode,
  getColorblindMode,
  type LayerConfig,
} from '../utils/colorScales';
import type { Feature } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: { pno: '00100', ...props } as NeighborhoodProperties,
  };
}

beforeEach(() => {
  setColorblindMode('off');
});

describe('rescaleLayerToData — edge cases', () => {
  const baseLayer = getLayerById('quality_index');

  it('returns original layer when all property values are null', () => {
    const features = [
      makeFeature({ quality_index: null }),
      makeFeature({ quality_index: null }),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops).toEqual(baseLayer.stops);
  });

  it('returns original layer when all values are NaN', () => {
    const features = [
      makeFeature({ quality_index: NaN }),
      makeFeature({ quality_index: NaN }),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops).toEqual(baseLayer.stops);
  });

  it('returns original layer when min === max (single unique value)', () => {
    const features = [
      makeFeature({ quality_index: 50 }),
      makeFeature({ quality_index: 50 }),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops).toEqual(baseLayer.stops);
  });

  it('rescales stops to span actual data range', () => {
    const features = [
      makeFeature({ quality_index: 30 }),
      makeFeature({ quality_index: 70 }),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops[0]).toBe(30);
    expect(result.stops[result.stops.length - 1]).toBe(70);
    // Intermediate stops should be evenly distributed
    for (let i = 1; i < result.stops.length; i++) {
      expect(result.stops[i]).toBeGreaterThan(result.stops[i - 1]);
    }
  });

  it('preserves colors when rescaling', () => {
    const features = [
      makeFeature({ quality_index: 10 }),
      makeFeature({ quality_index: 90 }),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result.colors).toEqual(baseLayer.colors);
  });

  it('handles negative data range', () => {
    // Use a layer with the income change property
    const layer = getLayerById('property_price_change');
    const features = [
      makeFeature({ property_price_change_pct: -20 }),
      makeFeature({ property_price_change_pct: -5 }),
    ];
    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(-20);
    expect(result.stops[result.stops.length - 1]).toBe(-5);
  });

  it('ignores Infinity values when computing range', () => {
    const features = [
      makeFeature({ quality_index: Infinity }),
      makeFeature({ quality_index: 20 }),
      makeFeature({ quality_index: 80 }),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops[0]).toBe(20);
    expect(result.stops[result.stops.length - 1]).toBe(80);
  });

  it('handles empty features array', () => {
    const result = rescaleLayerToData(baseLayer, []);
    expect(result.stops).toEqual(baseLayer.stops);
  });

  it('returns original when only one valid value exists', () => {
    const features = [
      makeFeature({ quality_index: 42 }),
      makeFeature({ quality_index: null }),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    // min === max → returns original
    expect(result.stops).toEqual(baseLayer.stops);
  });
});

describe('buildFillColorExpression — structure and overrides', () => {
  it('produces valid MapLibre expression with correct property', () => {
    const layer = getLayerById('quality_index');
    const expr = buildFillColorExpression(layer);

    // Should be ['case', condition, interpolation, fallback]
    expect(expr[0]).toBe('case');
    // Fallback color should be gray
    expect(expr[expr.length - 1]).toBe('#d1d5db');
  });

  it('uses propertyOverride when provided', () => {
    const layer = getLayerById('quality_index');
    const expr = buildFillColorExpression(layer, 'my_custom_property');

    // The expression should reference 'my_custom_property' instead of layer.property
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('my_custom_property');
    expect(exprStr).not.toContain(layer.property);
  });

  it('includes typeof check for number values', () => {
    const layer = getLayerById('quality_index');
    const expr = buildFillColorExpression(layer);

    // Should include typeof check to reject non-numeric strings
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('typeof');
    expect(exprStr).toContain('number');
  });

  it('includes all stops from the layer config', () => {
    const layer = getLayerById('quality_index');
    const expr = buildFillColorExpression(layer);
    const exprStr = JSON.stringify(expr);

    // Each stop value should appear in the interpolation
    for (const stop of layer.stops) {
      expect(exprStr).toContain(String(stop));
    }
  });
});

describe('colorblind mode — lifecycle', () => {
  it('defaults to off', () => {
    expect(getColorblindMode()).toBe('off');
  });

  it('persists mode changes', () => {
    setColorblindMode('protanopia');
    expect(getColorblindMode()).toBe('protanopia');
  });

  it('getLayerById returns different colors in colorblind mode', () => {
    const normalLayer = getLayerById('quality_index');

    setColorblindMode('protanopia');
    const cbLayer = getLayerById('quality_index');

    // Colors should differ (colorblind palette replaces original)
    expect(cbLayer.colors).not.toEqual(normalLayer.colors);
    // But stops and property should be the same
    expect(cbLayer.stops).toEqual(normalLayer.stops);
    expect(cbLayer.property).toBe(normalLayer.property);
  });

  it('reverts to normal colors when set back to off', () => {
    const normalLayer = getLayerById('quality_index');

    setColorblindMode('deuteranopia');
    setColorblindMode('off');
    const afterRevert = getLayerById('quality_index');

    expect(afterRevert.colors).toEqual(normalLayer.colors);
  });

  it('all three colorblind modes produce valid color arrays', () => {
    for (const mode of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      setColorblindMode(mode);
      const layer = getLayerById('quality_index');
      expect(layer.colors.length).toBe(layer.stops.length);
      for (const c of layer.colors) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
      setColorblindMode('off');
    }
  });
});

describe('getColorForValue — boundary behavior', () => {
  it('returns first color for value well below first stop', () => {
    const layer = getLayerById('quality_index');
    const color = getColorForValue(layer, -100);
    expect(color).toBe(layer.colors[0]);
  });

  it('returns last color for value well above last stop', () => {
    const layer = getLayerById('quality_index');
    const color = getColorForValue(layer, 999);
    expect(color).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns gray for null', () => {
    const layer = getLayerById('quality_index');
    const color = getColorForValue(layer, null as unknown as number);
    expect(color).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    const layer = getLayerById('quality_index');
    const color = getColorForValue(layer, undefined as unknown as number);
    expect(color).toBe('#d1d5db');
  });
});
