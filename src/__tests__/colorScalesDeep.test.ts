import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock i18n before importing colorScales
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

import {
  LAYERS,
  getLayerById,
  getColorForValue,
  buildFillColorExpression,
  setColorblindMode,
  getColorblindMode,
  type LayerId,
  type LayerConfig,
} from '../utils/colorScales';

describe('LAYERS data integrity', () => {
  it('every layer has unique ID', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every layer has matching colors and stops length', () => {
    for (const layer of LAYERS) {
      expect(layer.colors.length).toBe(layer.stops.length);
    }
  });

  it('every layer has at least 2 stops', () => {
    for (const layer of LAYERS) {
      expect(layer.stops.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every layer has sorted stops in ascending order', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i]).toBeGreaterThan(layer.stops[i - 1]);
      }
    }
  });

  it('every layer has valid hex colors', () => {
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('every layer has a non-empty property name', () => {
    for (const layer of LAYERS) {
      expect(layer.property).toBeTruthy();
    }
  });

  it('every layer has a labelKey', () => {
    for (const layer of LAYERS) {
      expect(layer.labelKey).toBeTruthy();
    }
  });

  it('every layer format function works with a sample number', () => {
    for (const layer of LAYERS) {
      const result = layer.format(42);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

describe('getLayerById', () => {
  beforeEach(() => {
    setColorblindMode('off');
  });

  it('returns correct layer for each known ID', () => {
    for (const layer of LAYERS) {
      const result = getLayerById(layer.id);
      expect(result.id).toBe(layer.id);
      expect(result.property).toBe(layer.property);
    }
  });

  it('returns first layer (quality_index) for unknown ID', () => {
    const result = getLayerById('nonexistent_layer' as LayerId);
    expect(result.id).toBe('quality_index');
  });

  it('returns O(1) cached layer without colorblind mode', () => {
    const a = getLayerById('median_income');
    const b = getLayerById('median_income');
    // Same object identity when no colorblind mode
    expect(a).toBe(b);
  });

  it('applies colorblind palette substitution', () => {
    const normalLayer = getLayerById('median_income');
    setColorblindMode('protanopia');
    const cbLayer = getLayerById('median_income');

    expect(cbLayer.id).toBe('median_income');
    expect(cbLayer.property).toBe(normalLayer.property);
    expect(cbLayer.stops).toEqual(normalLayer.stops);
    // Colors should be different
    expect(cbLayer.colors).not.toEqual(normalLayer.colors);
    // Same length
    expect(cbLayer.colors.length).toBe(normalLayer.colors.length);
  });

  it('applies all three colorblind modes', () => {
    const modes = ['protanopia', 'deuteranopia', 'tritanopia'] as const;
    const palettes: string[][] = [];
    for (const mode of modes) {
      setColorblindMode(mode);
      palettes.push(getLayerById('median_income').colors);
    }
    // All three modes should produce different palettes
    expect(palettes[0]).not.toEqual(palettes[1]);
    expect(palettes[1]).not.toEqual(palettes[2]);
    expect(palettes[0]).not.toEqual(palettes[2]);
  });

  it('preserves layer stops and property when colorblind mode is active', () => {
    setColorblindMode('deuteranopia');
    for (const layer of LAYERS) {
      const cbLayer = getLayerById(layer.id);
      expect(cbLayer.stops).toEqual(layer.stops);
      expect(cbLayer.property).toBe(layer.property);
      expect(cbLayer.id).toBe(layer.id);
    }
  });
});

describe('getColorForValue', () => {
  const layer: LayerConfig = {
    id: 'median_income' as LayerId,
    labelKey: 'test',
    property: 'hr_mtu',
    unit: '€',
    colors: ['#aaa', '#bbb', '#ccc', '#ddd'],
    stops: [10, 20, 30, 40],
    format: (v) => String(v),
  };

  it('returns gray for null', () => {
    expect(getColorForValue(layer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    expect(getColorForValue(layer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for value below all stops', () => {
    expect(getColorForValue(layer, 5)).toBe('#aaa');
  });

  it('returns last color for value above all stops', () => {
    expect(getColorForValue(layer, 50)).toBe('#ddd');
  });

  it('returns correct color for exact stop values', () => {
    expect(getColorForValue(layer, 10)).toBe('#aaa');
    expect(getColorForValue(layer, 20)).toBe('#bbb');
    expect(getColorForValue(layer, 30)).toBe('#ccc');
    expect(getColorForValue(layer, 40)).toBe('#ddd');
  });

  it('returns the correct bucket color for in-between values', () => {
    // 15 is >= 10 but < 20, so bucket is stop[0]
    expect(getColorForValue(layer, 15)).toBe('#aaa');
    // 25 is >= 20 but < 30, so bucket is stop[1]
    expect(getColorForValue(layer, 25)).toBe('#bbb');
  });

  it('handles negative stops correctly', () => {
    const changeLayer: LayerConfig = {
      id: 'income_change' as LayerId,
      labelKey: 'test',
      property: 'income_change_pct',
      unit: '%',
      colors: ['#red1', '#red2', '#green1', '#green2'],
      stops: [-20, -10, 10, 20],
      format: (v) => String(v),
    };
    expect(getColorForValue(changeLayer, -30)).toBe('#red1');
    expect(getColorForValue(changeLayer, -15)).toBe('#red1');
    expect(getColorForValue(changeLayer, -10)).toBe('#red2');
    expect(getColorForValue(changeLayer, 0)).toBe('#red2');
    expect(getColorForValue(changeLayer, 10)).toBe('#green1');
    expect(getColorForValue(changeLayer, 25)).toBe('#green2');
  });
});

describe('buildFillColorExpression', () => {
  const layer: LayerConfig = {
    id: 'median_income' as LayerId,
    labelKey: 'test',
    property: 'hr_mtu',
    unit: '€',
    colors: ['#aaa', '#bbb', '#ccc'],
    stops: [10, 20, 30],
    format: (v) => String(v),
  };

  it('produces a case expression with null check', () => {
    const expr = buildFillColorExpression(layer) as unknown[];
    expect(expr[0]).toBe('case');
    // The condition checks for property existence
    const condition = expr[1] as unknown[];
    expect(condition[0]).toBe('all');
    // The fallback color is gray
    expect(expr[3]).toBe('#d1d5db');
  });

  it('includes interpolation with all stops and colors', () => {
    const expr = buildFillColorExpression(layer) as unknown[];
    const interpolation = expr[2] as unknown[];
    expect(interpolation[0]).toBe('interpolate');
    expect(interpolation[1]).toEqual(['linear']);
    expect(interpolation[2]).toEqual(['to-number', ['get', 'hr_mtu']]);
    // Should have 3 stop-color pairs
    expect(interpolation[3]).toBe(10);
    expect(interpolation[4]).toBe('#aaa');
    expect(interpolation[5]).toBe(20);
    expect(interpolation[6]).toBe('#bbb');
    expect(interpolation[7]).toBe(30);
    expect(interpolation[8]).toBe('#ccc');
  });
});

describe('colorblindMode state', () => {
  beforeEach(() => {
    setColorblindMode('off');
  });

  it('defaults to off', () => {
    expect(getColorblindMode()).toBe('off');
  });

  it('can be set to each mode', () => {
    setColorblindMode('protanopia');
    expect(getColorblindMode()).toBe('protanopia');
    setColorblindMode('deuteranopia');
    expect(getColorblindMode()).toBe('deuteranopia');
    setColorblindMode('tritanopia');
    expect(getColorblindMode()).toBe('tritanopia');
    setColorblindMode('off');
    expect(getColorblindMode()).toBe('off');
  });
});
