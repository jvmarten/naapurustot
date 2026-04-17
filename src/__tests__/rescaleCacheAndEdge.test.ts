import { describe, it, expect, beforeEach } from 'vitest';
import { rescaleLayerToData, clearRescaleCache, buildFillColorExpression, type LayerConfig } from '../utils/colorScales';

function feat(prop: string, value: number | string | null): GeoJSON.Feature {
  return { type: 'Feature', properties: { [prop]: value }, geometry: null as unknown as GeoJSON.Geometry };
}

const baseLayer: LayerConfig = {
  id: 'median_income',
  labelKey: 'layer.median_income',
  property: 'hr_mtu',
  unit: '€',
  colors: ['#aaa', '#bbb', '#ccc', '#ddd'],
  stops: [10000, 20000, 30000, 40000],
  format: (v: number) => `${v}`,
};

describe('rescaleLayerToData — cache behavior', () => {
  beforeEach(() => {
    clearRescaleCache();
  });

  it('returns cached result for same layer and features reference', () => {
    const features = [feat('hr_mtu', 100), feat('hr_mtu', 500)];
    const first = rescaleLayerToData(baseLayer, features);
    const second = rescaleLayerToData(baseLayer, features);
    expect(second).toBe(first);
  });

  it('recomputes when features array reference changes', () => {
    const features1 = [feat('hr_mtu', 100), feat('hr_mtu', 500)];
    const features2 = [feat('hr_mtu', 200), feat('hr_mtu', 800)];
    const first = rescaleLayerToData(baseLayer, features1);
    const second = rescaleLayerToData(baseLayer, features2);
    expect(second).not.toBe(first);
    expect(second.stops[0]).toBe(200);
    expect(second.stops[3]).toBe(800);
  });

  it('recomputes when layer id changes', () => {
    const features = [feat('hr_mtu', 100), feat('hr_mtu', 500)];
    const otherLayer: LayerConfig = { ...baseLayer, id: 'unemployment' };
    rescaleLayerToData(baseLayer, features);
    const second = rescaleLayerToData(otherLayer, features);
    expect(second.id).toBe('unemployment');
  });

  it('clearRescaleCache forces recomputation', () => {
    const features = [feat('hr_mtu', 100), feat('hr_mtu', 500)];
    const first = rescaleLayerToData(baseLayer, features);
    clearRescaleCache();
    const second = rescaleLayerToData(baseLayer, features);
    expect(second).not.toBe(first);
    expect(second.stops).toEqual(first.stops);
  });
});

describe('rescaleLayerToData — single stop edge case', () => {
  beforeEach(() => {
    clearRescaleCache();
  });

  it('returns original layer when stops.length is 1', () => {
    const singleStopLayer: LayerConfig = {
      ...baseLayer,
      colors: ['#aaa'],
      stops: [20000],
    };
    const features = [feat('hr_mtu', 100), feat('hr_mtu', 500)];
    const result = rescaleLayerToData(singleStopLayer, features);
    expect(result).toBe(singleStopLayer);
  });

  it('returns original layer when stops.length is 0', () => {
    const emptyStopLayer: LayerConfig = {
      ...baseLayer,
      colors: [],
      stops: [],
    };
    const features = [feat('hr_mtu', 100), feat('hr_mtu', 500)];
    const result = rescaleLayerToData(emptyStopLayer, features);
    expect(result).toBe(emptyStopLayer);
  });
});

describe('buildFillColorExpression', () => {
  it('generates a valid MapLibre expression with case/interpolation', () => {
    const expr = buildFillColorExpression(baseLayer);
    expect(Array.isArray(expr)).toBe(true);
    expect(expr[0]).toBe('case');
    const condition = expr[1] as unknown[];
    expect(condition[0]).toBe('all');
  });

  it('uses property from layer config by default', () => {
    const expr = buildFillColorExpression(baseLayer);
    const condition = expr[1] as unknown[];
    const hasProp = condition[1] as unknown[];
    expect(hasProp).toEqual(['has', 'hr_mtu']);
  });

  it('uses propertyOverride when provided', () => {
    const expr = buildFillColorExpression(baseLayer, 'custom_prop');
    const condition = expr[1] as unknown[];
    const hasProp = condition[1] as unknown[];
    expect(hasProp).toEqual(['has', 'custom_prop']);
  });

  it('falls back to gray (#d1d5db) for missing/non-numeric values', () => {
    const expr = buildFillColorExpression(baseLayer);
    const fallback = expr[expr.length - 1];
    expect(fallback).toBe('#d1d5db');
  });

  it('includes type check for number in the condition', () => {
    const expr = buildFillColorExpression(baseLayer);
    const condition = expr[1] as unknown[];
    const typeCheck = condition[3] as unknown[];
    expect(typeCheck[0]).toBe('==');
    expect((typeCheck[1] as unknown[])[0]).toBe('typeof');
  });

  it('includes all stops and colors in the interpolation', () => {
    const expr = buildFillColorExpression(baseLayer);
    const interpolation = expr[2] as unknown[];
    expect(interpolation[0]).toBe('interpolate');
    expect(interpolation[1]).toEqual(['linear']);
    for (let i = 0; i < baseLayer.stops.length; i++) {
      expect(interpolation[3 + i * 2]).toBe(baseLayer.stops[i]);
      expect(interpolation[4 + i * 2]).toBe(baseLayer.colors[i]);
    }
  });
});
