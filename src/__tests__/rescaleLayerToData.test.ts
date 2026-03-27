import { describe, it, expect } from 'vitest';
import { rescaleLayerToData, LAYERS, type LayerConfig } from '../utils/colorScales';

/** Helper to create a feature with a single property */
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

describe('rescaleLayerToData', () => {
  it('rescales stops to span actual data range', () => {
    const features = [feat('hr_mtu', 5000), feat('hr_mtu', 15000)];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops[0]).toBe(5000);
    expect(result.stops[result.stops.length - 1]).toBe(15000);
    expect(result.colors).toEqual(baseLayer.colors); // colors unchanged
  });

  it('evenly distributes intermediate stops', () => {
    const features = [feat('hr_mtu', 0), feat('hr_mtu', 300)];
    const result = rescaleLayerToData(baseLayer, features);
    // 4 stops: 0, 100, 200, 300
    expect(result.stops).toEqual([0, 100, 200, 300]);
  });

  it('returns original layer when all values are the same (min === max)', () => {
    const features = [feat('hr_mtu', 25000), feat('hr_mtu', 25000)];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result).toBe(baseLayer); // same reference
  });

  it('returns original layer when no valid values exist', () => {
    const features = [feat('hr_mtu', null), feat('hr_mtu', null)];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result).toBe(baseLayer);
  });

  it('returns original layer for empty features array', () => {
    const result = rescaleLayerToData(baseLayer, []);
    expect(result).toBe(baseLayer);
  });

  it('ignores NaN and Infinity values', () => {
    const features = [
      feat('hr_mtu', NaN),
      feat('hr_mtu', Infinity),
      feat('hr_mtu', -Infinity),
      feat('hr_mtu', 100),
      feat('hr_mtu', 200),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops[0]).toBe(100);
    expect(result.stops[result.stops.length - 1]).toBe(200);
  });

  it('coerces string values to numbers', () => {
    const features = [feat('hr_mtu', '1000'), feat('hr_mtu', '5000')];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops[0]).toBe(1000);
    expect(result.stops[result.stops.length - 1]).toBe(5000);
  });

  it('handles negative data ranges correctly', () => {
    const layer: LayerConfig = { ...baseLayer, stops: [-30, -20, -10, 0] };
    const features = [feat('hr_mtu', -50), feat('hr_mtu', -10)];
    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBeCloseTo(-50);
    expect(result.stops[3]).toBeCloseTo(-10);
  });

  it('preserves all non-stop properties', () => {
    const features = [feat('hr_mtu', 100), feat('hr_mtu', 400)];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result.id).toBe(baseLayer.id);
    expect(result.property).toBe(baseLayer.property);
    expect(result.format).toBe(baseLayer.format);
    expect(result.labelKey).toBe(baseLayer.labelKey);
  });

  it('handles single valid value among many nulls', () => {
    const features = [feat('hr_mtu', null), feat('hr_mtu', 5000), feat('hr_mtu', null)];
    // Only one valid value → min === max → returns original
    const result = rescaleLayerToData(baseLayer, features);
    expect(result).toBe(baseLayer);
  });

  it('works with actual LAYERS configs', () => {
    const incomeLayer = LAYERS.find((l) => l.id === 'median_income')!;
    const features = [feat('hr_mtu', 18000), feat('hr_mtu', 42000)];
    const result = rescaleLayerToData(incomeLayer, features);
    expect(result.stops[0]).toBe(18000);
    expect(result.stops[result.stops.length - 1]).toBe(42000);
    expect(result.stops.length).toBe(incomeLayer.stops.length);
    // Verify monotonically increasing
    for (let i = 1; i < result.stops.length; i++) {
      expect(result.stops[i]).toBeGreaterThan(result.stops[i - 1]);
    }
  });
});
