import { describe, it, expect } from 'vitest';
import { getColorForValue, LAYERS, type LayerConfig } from '../utils/colorScales';

const testLayer: LayerConfig = {
  id: 'median_income',
  labelKey: 'layer.median_income',
  property: 'hr_mtu',
  unit: '€',
  colors: ['#111111', '#333333', '#555555', '#777777', '#999999'],
  stops: [10, 20, 30, 40, 50],
  format: (v: number) => `${v}`,
};

describe('getColorForValue — step-based color mapping', () => {
  it('returns first color for value below first stop', () => {
    expect(getColorForValue(testLayer, 5)).toBe('#111111');
  });

  it('returns first color for value exactly at first stop', () => {
    expect(getColorForValue(testLayer, 10)).toBe('#111111');
  });

  it('returns second color for value at second stop', () => {
    expect(getColorForValue(testLayer, 20)).toBe('#333333');
  });

  it('returns last color for value at last stop', () => {
    expect(getColorForValue(testLayer, 50)).toBe('#999999');
  });

  it('returns last color for value above last stop', () => {
    expect(getColorForValue(testLayer, 100)).toBe('#999999');
  });

  it('returns gray for null', () => {
    expect(getColorForValue(testLayer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    expect(getColorForValue(testLayer, undefined)).toBe('#d1d5db');
  });

  it('handles value between stops (takes lower bracket)', () => {
    // 25 is between stop 20 (index 1) and 30 (index 2)
    // Algorithm: last stop where value >= stop → index 1 → #333333
    expect(getColorForValue(testLayer, 25)).toBe('#333333');
  });

  it('handles negative stops correctly', () => {
    const layer: LayerConfig = {
      ...testLayer,
      stops: [-30, -20, -10, 0, 10],
      colors: ['#aa0000', '#bb0000', '#cc0000', '#dd0000', '#ee0000'],
    };
    expect(getColorForValue(layer, -25)).toBe('#aa0000'); // between -30 and -20, >= -30
    expect(getColorForValue(layer, -30)).toBe('#aa0000');
    expect(getColorForValue(layer, -20)).toBe('#bb0000');
    expect(getColorForValue(layer, 0)).toBe('#dd0000');
    expect(getColorForValue(layer, -50)).toBe('#aa0000'); // below range
  });

  it('works with all real LAYERS configs', () => {
    for (const layer of LAYERS) {
      // Each layer should return a valid color for mid-range value
      const midValue = (layer.stops[0] + layer.stops[layer.stops.length - 1]) / 2;
      const color = getColorForValue(layer, midValue);
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);

      // Null should always return gray
      expect(getColorForValue(layer, null)).toBe('#d1d5db');
    }
  });
});
