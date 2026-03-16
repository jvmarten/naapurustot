import { describe, it, expect } from 'vitest';
import {
  LAYERS,
  getLayerById,
  getColorForValue,
  buildFillColorExpression,
} from '../utils/colorScales';

describe('LAYERS', () => {
  it('has matching length of colors and stops arrays for each layer', () => {
    for (const layer of LAYERS) {
      expect(layer.colors.length).toBe(layer.stops.length);
    }
  });

  it('has stops in ascending order for each layer', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i]).toBeGreaterThan(layer.stops[i - 1]);
      }
    }
  });

  it('has unique IDs', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has valid hex color codes', () => {
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(color).toMatch(hexRegex);
      }
    }
  });
});

describe('getLayerById', () => {
  it('returns correct layer for valid ID', () => {
    const layer = getLayerById('median_income');
    expect(layer.id).toBe('median_income');
    expect(layer.property).toBe('hr_mtu');
  });

  it('returns quality_index (first layer) as fallback for unknown ID', () => {
    const layer = getLayerById('nonexistent' as any);
    expect(layer.id).toBe('quality_index');
  });
});

describe('getColorForValue', () => {
  const layer = getLayerById('quality_index');

  it('returns gray for null value', () => {
    expect(getColorForValue(layer, null)).toBe('#333');
  });

  it('returns gray for undefined value', () => {
    expect(getColorForValue(layer, undefined)).toBe('#333');
  });

  it('returns first color for value below first stop', () => {
    expect(getColorForValue(layer, -10)).toBe(layer.colors[0]);
  });

  it('returns last color for value at or above last stop', () => {
    expect(getColorForValue(layer, 100)).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns correct color for value exactly at a stop', () => {
    // Value at stop[3] = 45 → should return colors[3]
    expect(getColorForValue(layer, 45)).toBe(layer.colors[3]);
  });

  it('returns the lower-bound color for value between stops', () => {
    // Value between stop[2]=30 and stop[3]=45 → colors[2]
    expect(getColorForValue(layer, 35)).toBe(layer.colors[2]);
  });
});

describe('buildFillColorExpression', () => {
  it('produces a valid MapLibre expression structure', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer) as unknown as unknown[];

    expect(expr[0]).toBe('case');
    // Condition for has + not-null
    expect((expr[1] as unknown[])[0]).toBe('all');
    // Interpolation expression
    const interpolation = expr[2] as unknown[];
    expect(interpolation[0]).toBe('interpolate');
    expect(interpolation[1]).toEqual(['linear']);
    expect(interpolation[2]).toEqual(['get', 'hr_mtu']);
    // Fallback gray
    expect(expr[3]).toBe('#d1d5db');
  });

  it('includes all stops and colors in interpolation', () => {
    const layer = getLayerById('unemployment');
    const expr = buildFillColorExpression(layer) as unknown as unknown[];
    const interpolation = expr[2] as unknown[];
    // 3 header items + 2 per stop (value, color)
    expect(interpolation.length).toBe(3 + layer.stops.length * 2);
  });
});

describe('layer format functions', () => {
  it('formats quality_index as plain number', () => {
    const layer = getLayerById('quality_index');
    expect(layer.format(75)).toBe('75');
  });

  it('formats median_income as euro with locale grouping', () => {
    const layer = getLayerById('median_income');
    const formatted = layer.format(35000);
    expect(formatted).toContain('€');
    expect(formatted).toContain('35');
  });

  it('formats unemployment as percentage', () => {
    const layer = getLayerById('unemployment');
    expect(layer.format(12.5)).toBe('12.5 %');
  });

  it('formats population_density with /km²', () => {
    const layer = getLayerById('population_density');
    const formatted = layer.format(5000);
    expect(formatted).toContain('/km²');
  });

  it('formats apt_size with m²', () => {
    const layer = getLayerById('apt_size');
    expect(layer.format(65.3)).toBe('65.3 m²');
  });

  it('formats property_price with €/m²', () => {
    const layer = getLayerById('property_price');
    const formatted = layer.format(4500);
    expect(formatted).toContain('€/m²');
  });
});
