import { describe, it, expect, beforeEach } from 'vitest';
import {
  LAYERS,
  LAYER_MAP,
  getLayerById,
  getColorForValue,
  rescaleLayerToData,
  buildFillColorExpression,
  setColorblindMode,
  getColorblindMode,
} from '../utils/colorScales';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('rescaleLayerToData', () => {
  const layer = getLayerById('median_income');

  it('rescales stops to actual data range', () => {
    const features = [
      makeFeature({ hr_mtu: 22000 }),
      makeFeature({ hr_mtu: 38000 }),
    ];
    const rescaled = rescaleLayerToData(layer, features);

    expect(rescaled.stops[0]).toBe(22000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(38000);
    // Colors should remain the same
    expect(rescaled.colors).toEqual(layer.colors);
    // Stops should be evenly distributed
    expect(rescaled.stops.length).toBe(layer.stops.length);
  });

  it('returns original layer when no valid values found', () => {
    const features = [
      makeFeature({ hr_mtu: null }),
      makeFeature({ hr_mtu: undefined }),
    ];
    const result = rescaleLayerToData(layer, features);
    expect(result).toBe(layer); // same reference
  });

  it('returns original layer when min === max', () => {
    const features = [
      makeFeature({ hr_mtu: 30000 }),
      makeFeature({ hr_mtu: 30000 }),
    ];
    const result = rescaleLayerToData(layer, features);
    expect(result).toBe(layer);
  });

  it('handles string-typed numeric values', () => {
    const features = [
      makeFeature({ hr_mtu: '22000' }),
      makeFeature({ hr_mtu: '38000' }),
    ];
    const rescaled = rescaleLayerToData(layer, features);
    expect(rescaled.stops[0]).toBe(22000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(38000);
  });

  it('ignores NaN and non-numeric values', () => {
    const features = [
      makeFeature({ hr_mtu: NaN }),
      makeFeature({ hr_mtu: 'not-a-number' }),
      makeFeature({ hr_mtu: 25000 }),
      makeFeature({ hr_mtu: 35000 }),
    ];
    const rescaled = rescaleLayerToData(layer, features);
    expect(rescaled.stops[0]).toBe(25000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(35000);
  });

  it('produces evenly-spaced stops across the range', () => {
    const features = [
      makeFeature({ hr_mtu: 0 }),
      makeFeature({ hr_mtu: 100 }),
    ];
    const rescaled = rescaleLayerToData(layer, features);
    const n = rescaled.stops.length;
    for (let i = 1; i < n; i++) {
      const expectedStep = 100 / (n - 1);
      expect(rescaled.stops[i] - rescaled.stops[i - 1]).toBeCloseTo(expectedStep, 5);
    }
  });
});

describe('colorblind mode', () => {
  beforeEach(() => {
    setColorblindMode('off');
  });

  it('starts with off mode', () => {
    expect(getColorblindMode()).toBe('off');
  });

  it('can set and get protanopia mode', () => {
    setColorblindMode('protanopia');
    expect(getColorblindMode()).toBe('protanopia');
  });

  it('can set and get deuteranopia mode', () => {
    setColorblindMode('deuteranopia');
    expect(getColorblindMode()).toBe('deuteranopia');
  });

  it('can set and get tritanopia mode', () => {
    setColorblindMode('tritanopia');
    expect(getColorblindMode()).toBe('tritanopia');
  });

  it('getLayerById returns different colors in colorblind mode', () => {
    const normalLayer = getLayerById('median_income');
    const normalColors = [...normalLayer.colors];

    setColorblindMode('protanopia');
    const cbLayer = getLayerById('median_income');

    expect(cbLayer.colors).not.toEqual(normalColors);
    expect(cbLayer.colors.length).toBe(normalColors.length);
    // Other properties should be preserved
    expect(cbLayer.id).toBe(normalLayer.id);
    expect(cbLayer.stops).toEqual(normalLayer.stops);
    expect(cbLayer.property).toBe(normalLayer.property);
  });

  it('returns stable reference for same colorblind layer lookup', () => {
    setColorblindMode('protanopia');
    const first = getLayerById('median_income');
    const second = getLayerById('median_income');
    expect(first).toBe(second); // same reference (cached)
  });

  it('resample produces correct number of colors for layers with different stop counts', () => {
    setColorblindMode('deuteranopia');
    // unemployment has 10 stops, most layers have 8
    const unemployment = getLayerById('unemployment');
    expect(unemployment.colors.length).toBe(10);

    const income = getLayerById('median_income');
    expect(income.colors.length).toBe(8);
  });

  it('all colorblind colors are valid hex strings', () => {
    for (const mode of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      setColorblindMode(mode);
      for (const layer of LAYERS) {
        const cbLayer = getLayerById(layer.id);
        for (const color of cbLayer.colors) {
          expect(color).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });
});

describe('getColorForValue edge cases', () => {
  const layer = getLayerById('median_income');

  it('returns gray for null value', () => {
    expect(getColorForValue(layer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined value', () => {
    expect(getColorForValue(layer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for value below first stop', () => {
    const result = getColorForValue(layer, layer.stops[0] - 1000);
    expect(result).toBe(layer.colors[0]);
  });

  it('returns last color for value at or above last stop', () => {
    const result = getColorForValue(layer, layer.stops[layer.stops.length - 1]);
    expect(result).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns correct color for exact stop value', () => {
    for (let i = 0; i < layer.stops.length; i++) {
      const result = getColorForValue(layer, layer.stops[i]);
      expect(result).toBe(layer.colors[i]);
    }
  });

  it('returns the lower bound color for values between stops', () => {
    // getColorForValue uses step (not interpolation) — value picks highest stop ≤ value
    const mid = (layer.stops[2] + layer.stops[3]) / 2;
    const result = getColorForValue(layer, mid);
    expect(result).toBe(layer.colors[2]);
  });
});

describe('LAYER_MAP consistency', () => {
  it('contains all layers from LAYERS array', () => {
    expect(LAYER_MAP.size).toBe(LAYERS.length);
    for (const layer of LAYERS) {
      expect(LAYER_MAP.get(layer.id)).toBe(layer);
    }
  });

  it('all layers have matching colors and stops length', () => {
    for (const layer of LAYERS) {
      expect(layer.colors.length).toBe(layer.stops.length);
    }
  });

  it('all layers have ascending stops', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i]).toBeGreaterThan(layer.stops[i - 1]);
      }
    }
  });
});

describe('buildFillColorExpression', () => {
  it('uses propertyOverride when provided', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer, 'custom_prop');
    // The expression should reference 'custom_prop' not layer.property
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('custom_prop');
  });

  it('uses layer.property by default', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer);
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain(layer.property);
  });
});

describe('higherIsBetter field', () => {
  it('unemployment, air_quality, and crime_rate have higherIsBetter=false', () => {
    const falseIds = ['unemployment', 'air_quality', 'crime_rate', 'traffic_accidents',
      'light_pollution', 'noise_pollution', 'water_proximity'];
    for (const id of falseIds) {
      const layer = LAYER_MAP.get(id as any);
      if (layer) {
        expect(layer.higherIsBetter).toBe(false);
      }
    }
  });

  it('most layers default to undefined (treated as true)', () => {
    const layer = getLayerById('median_income');
    expect(layer.higherIsBetter).toBeUndefined();
  });
});
