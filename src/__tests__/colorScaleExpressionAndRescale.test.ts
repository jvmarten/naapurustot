import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildFillColorExpression,
  rescaleLayerToData,
  clearRescaleCache,
  getLayerById,
  getColorForValue,
  setColorblindMode,
  LAYERS,
  LAYER_MAP,
} from '../utils/colorScales';
import type { Feature } from 'geojson';

vi.mock('../utils/i18n', () => ({
  getLang: () => 'fi',
  setLang: () => {},
  t: (k: string) => k,
}));

describe('buildFillColorExpression', () => {
  it('produces case expression with typeof guard', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer);

    // Top level should be a case expression
    expect(expr[0]).toBe('case');

    // Should include typeof check for 'number'
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('typeof');
    expect(exprStr).toContain('number');
  });

  it('uses the correct property from layer config', () => {
    const layer = getLayerById('unemployment');
    const expr = buildFillColorExpression(layer);
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('unemployment_rate');
  });

  it('uses propertyOverride when provided', () => {
    const layer = getLayerById('unemployment');
    const expr = buildFillColorExpression(layer, 'custom_prop');
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('custom_prop');
    expect(exprStr).not.toContain('unemployment_rate');
  });

  it('includes all stop values in the interpolation', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer);
    const exprStr = JSON.stringify(expr);

    for (const stop of layer.stops) {
      expect(exprStr).toContain(String(stop));
    }
  });

  it('includes gray fallback color for missing values', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer);
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('#d1d5db');
  });
});

describe('rescaleLayerToData — caching and edge cases', () => {
  beforeEach(() => {
    clearRescaleCache();
  });

  it('rescales stops to span actual data range', () => {
    const layer = getLayerById('median_income');
    const features: Feature[] = [
      { type: 'Feature', properties: { hr_mtu: 20000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 60000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];

    const rescaled = rescaleLayerToData(layer, features);
    expect(rescaled.stops[0]).toBe(20000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(60000);
    expect(rescaled.colors).toEqual(layer.colors);
  });

  it('returns original layer when min equals max', () => {
    const layer = getLayerById('median_income');
    const features: Feature[] = [
      { type: 'Feature', properties: { hr_mtu: 30000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 30000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];

    const rescaled = rescaleLayerToData(layer, features);
    expect(rescaled).toBe(layer);
  });

  it('returns original layer when no valid numeric data exists', () => {
    const layer = getLayerById('median_income');
    const features: Feature[] = [
      { type: 'Feature', properties: { hr_mtu: null }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 'N/A' }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];

    const rescaled = rescaleLayerToData(layer, features);
    expect(rescaled).toBe(layer);
  });

  it('caches result for same layer + features reference', () => {
    const layer = getLayerById('median_income');
    const features: Feature[] = [
      { type: 'Feature', properties: { hr_mtu: 20000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 60000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];

    const result1 = rescaleLayerToData(layer, features);
    const result2 = rescaleLayerToData(layer, features);
    expect(result1).toBe(result2);
  });

  it('invalidates cache when layer changes', () => {
    const features: Feature[] = [
      { type: 'Feature', properties: { hr_mtu: 20000, unemployment_rate: 5 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 60000, unemployment_rate: 15 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];

    const layer1 = getLayerById('median_income');
    const rescaled1 = rescaleLayerToData(layer1, features);

    const layer2 = getLayerById('unemployment');
    const rescaled2 = rescaleLayerToData(layer2, features);

    expect(rescaled1.stops[0]).not.toBe(rescaled2.stops[0]);
  });

  it('coerces string values to numbers', () => {
    const layer = getLayerById('median_income');
    const features: Feature[] = [
      { type: 'Feature', properties: { hr_mtu: '25000' }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: '45000' }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];

    const rescaled = rescaleLayerToData(layer, features);
    expect(rescaled.stops[0]).toBe(25000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(45000);
  });

  it('produces evenly spaced stops', () => {
    const layer = getLayerById('median_income');
    const features: Feature[] = [
      { type: 'Feature', properties: { hr_mtu: 10000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 50000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];

    const rescaled = rescaleLayerToData(layer, features);
    const n = rescaled.stops.length;
    const step = (50000 - 10000) / (n - 1);

    for (let i = 0; i < n; i++) {
      expect(rescaled.stops[i]).toBeCloseTo(10000 + i * step, 5);
    }
  });
});

describe('getColorForValue — step-based mapping', () => {
  const layer = getLayerById('median_income');

  it('returns gray for null', () => {
    expect(getColorForValue(layer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    expect(getColorForValue(layer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for values below first stop', () => {
    expect(getColorForValue(layer, 0)).toBe(layer.colors[0]);
  });

  it('returns last color for values above last stop', () => {
    expect(getColorForValue(layer, 999999)).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns correct color at exact stop boundaries', () => {
    for (let i = 0; i < layer.stops.length; i++) {
      expect(getColorForValue(layer, layer.stops[i])).toBe(layer.colors[i]);
    }
  });

  it('returns correct color for value between stops', () => {
    // Value between stop[0] and stop[1] should return color[0]
    const midValue = (layer.stops[0] + layer.stops[1]) / 2;
    expect(getColorForValue(layer, midValue)).toBe(layer.colors[0]);
  });
});

describe('colorblind mode interaction', () => {
  beforeEach(() => {
    setColorblindMode('off');
  });

  it('getLayerById returns different colors in colorblind mode', () => {
    const normalLayer = getLayerById('median_income');
    const normalColors = [...normalLayer.colors];

    setColorblindMode('protanopia');
    const cbLayer = getLayerById('median_income');

    expect(cbLayer.colors).not.toEqual(normalColors);
    expect(cbLayer.stops).toEqual(normalLayer.stops);
    expect(cbLayer.id).toBe(normalLayer.id);

    setColorblindMode('off');
  });
});
