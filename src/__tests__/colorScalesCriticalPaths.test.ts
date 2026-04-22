import { describe, it, expect, beforeEach, vi } from 'vitest';

let getLayerById: typeof import('../utils/colorScales').getLayerById;
let getColorForValue: typeof import('../utils/colorScales').getColorForValue;
let rescaleLayerToData: typeof import('../utils/colorScales').rescaleLayerToData;
let clearRescaleCache: typeof import('../utils/colorScales').clearRescaleCache;
let buildFillColorExpression: typeof import('../utils/colorScales').buildFillColorExpression;
let setColorblindMode: typeof import('../utils/colorScales').setColorblindMode;
let getColorblindMode: typeof import('../utils/colorScales').getColorblindMode;
let LAYERS: typeof import('../utils/colorScales').LAYERS;
let LAYER_MAP: typeof import('../utils/colorScales').LAYER_MAP;

describe('colorScales critical paths', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/colorScales');
    getLayerById = mod.getLayerById;
    getColorForValue = mod.getColorForValue;
    rescaleLayerToData = mod.rescaleLayerToData;
    clearRescaleCache = mod.clearRescaleCache;
    buildFillColorExpression = mod.buildFillColorExpression;
    setColorblindMode = mod.setColorblindMode;
    getColorblindMode = mod.getColorblindMode;
    LAYERS = mod.LAYERS;
    LAYER_MAP = mod.LAYER_MAP;
  });

  describe('getColorForValue', () => {
    it('returns gray for null', () => {
      const layer = getLayerById('median_income');
      expect(getColorForValue(layer, null)).toBe('#d1d5db');
    });

    it('returns gray for undefined', () => {
      const layer = getLayerById('median_income');
      expect(getColorForValue(layer, undefined)).toBe('#d1d5db');
    });

    it('returns first color for value below first stop', () => {
      const layer = getLayerById('median_income');
      expect(getColorForValue(layer, 1000)).toBe(layer.colors[0]);
    });

    it('returns last color for value at or above last stop', () => {
      const layer = getLayerById('median_income');
      expect(getColorForValue(layer, 100000)).toBe(layer.colors[layer.colors.length - 1]);
    });

    it('returns correct intermediate color', () => {
      const layer = getLayerById('median_income');
      // Value between stop[2] and stop[3]
      const val = (layer.stops[2] + layer.stops[3]) / 2;
      const color = getColorForValue(layer, val);
      // Should match stop[2]'s color (reverse iteration picks highest stop <= value)
      expect(color).toBe(layer.colors[2]);
    });

    it('returns correct color at exact stop boundary', () => {
      const layer = getLayerById('median_income');
      expect(getColorForValue(layer, layer.stops[3])).toBe(layer.colors[3]);
    });
  });

  describe('rescaleLayerToData', () => {
    it('rescales stops to data min/max', () => {
      const layer = getLayerById('median_income');
      const features: GeoJSON.Feature[] = [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 22000 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 38000 } },
      ];
      const rescaled = rescaleLayerToData(layer, features);
      expect(rescaled.stops[0]).toBe(22000);
      expect(rescaled.stops[rescaled.stops.length - 1]).toBe(38000);
      expect(rescaled.colors).toEqual(layer.colors);
    });

    it('returns original layer when min === max', () => {
      const layer = getLayerById('median_income');
      const features: GeoJSON.Feature[] = [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 30000 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 30000 } },
      ];
      const rescaled = rescaleLayerToData(layer, features);
      expect(rescaled).toBe(layer);
    });

    it('returns original layer when no valid values found', () => {
      const layer = getLayerById('median_income');
      const features: GeoJSON.Feature[] = [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: null } },
      ];
      const rescaled = rescaleLayerToData(layer, features);
      expect(rescaled).toBe(layer);
    });

    it('coerces string-encoded numeric values', () => {
      const layer = getLayerById('median_income');
      const features: GeoJSON.Feature[] = [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: '22000' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: '38000' } },
      ];
      const rescaled = rescaleLayerToData(layer, features);
      expect(rescaled.stops[0]).toBe(22000);
    });

    it('caches result for same layer + features reference', () => {
      const layer = getLayerById('median_income');
      const features: GeoJSON.Feature[] = [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 22000 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 38000 } },
      ];
      const r1 = rescaleLayerToData(layer, features);
      const r2 = rescaleLayerToData(layer, features);
      expect(r1).toBe(r2);
    });

    it('invalidates cache for different features', () => {
      const layer = getLayerById('median_income');
      const f1: GeoJSON.Feature[] = [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 22000 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 38000 } },
      ];
      const f2: GeoJSON.Feature[] = [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 10000 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 60000 } },
      ];
      const r1 = rescaleLayerToData(layer, f1);
      const r2 = rescaleLayerToData(layer, f2);
      expect(r1).not.toBe(r2);
      expect(r2.stops[0]).toBe(10000);
    });

    it('clearRescaleCache forces recomputation', () => {
      const layer = getLayerById('median_income');
      const features: GeoJSON.Feature[] = [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 22000 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 38000 } },
      ];
      const r1 = rescaleLayerToData(layer, features);
      clearRescaleCache();
      const r2 = rescaleLayerToData(layer, features);
      expect(r1).not.toBe(r2); // new object after cache clear
      expect(r2.stops).toEqual(r1.stops); // but same values
    });
  });

  describe('buildFillColorExpression', () => {
    it('produces a valid MapLibre case expression', () => {
      const layer = getLayerById('median_income');
      const expr = buildFillColorExpression(layer);
      expect(Array.isArray(expr)).toBe(true);
      expect(expr[0]).toBe('case');
    });

    it('uses propertyOverride when provided', () => {
      const layer = getLayerById('median_income');
      const expr = buildFillColorExpression(layer, 'custom_prop');
      const flat = JSON.stringify(expr);
      expect(flat).toContain('custom_prop');
      expect(flat).not.toContain('hr_mtu');
    });

    it('includes typeof guard for non-numeric values', () => {
      const layer = getLayerById('median_income');
      const expr = buildFillColorExpression(layer);
      const flat = JSON.stringify(expr);
      expect(flat).toContain('typeof');
      expect(flat).toContain('number');
    });
  });

  describe('colorblind mode', () => {
    it('returns base layer config when mode is off', () => {
      setColorblindMode('off');
      const layer = getLayerById('median_income');
      const baseLayers = LAYERS.find(l => l.id === 'median_income')!;
      expect(layer.colors).toEqual(baseLayers.colors);
    });

    it('substitutes colors when mode is protanopia', () => {
      setColorblindMode('protanopia');
      const layer = getLayerById('median_income');
      const baseLayers = LAYERS.find(l => l.id === 'median_income')!;
      expect(layer.colors).not.toEqual(baseLayers.colors);
      expect(layer.colors.length).toBe(baseLayers.colors.length);
      setColorblindMode('off');
    });

    it('returns stable reference for same mode and layer', () => {
      setColorblindMode('deuteranopia');
      const l1 = getLayerById('median_income');
      const l2 = getLayerById('median_income');
      expect(l1).toBe(l2); // same reference
      setColorblindMode('off');
    });

    it('clears cache when mode changes', () => {
      setColorblindMode('protanopia');
      const l1 = getLayerById('median_income');
      setColorblindMode('deuteranopia');
      const l2 = getLayerById('median_income');
      expect(l1).not.toBe(l2);
      expect(l1.colors).not.toEqual(l2.colors);
      setColorblindMode('off');
    });
  });

  describe('LAYERS configuration consistency', () => {
    it('every layer has matching colors and stops lengths', () => {
      for (const layer of LAYERS) {
        expect(layer.colors.length).toBe(layer.stops.length);
      }
    });

    it('every layer has stops in ascending order', () => {
      for (const layer of LAYERS) {
        for (let i = 1; i < layer.stops.length; i++) {
          expect(layer.stops[i]).toBeGreaterThan(layer.stops[i - 1]);
        }
      }
    });

    it('LAYER_MAP contains all layers', () => {
      expect(LAYER_MAP.size).toBe(LAYERS.length);
    });

    it('getLayerById falls back to first layer for unknown id', () => {
      const layer = getLayerById('nonexistent_layer' as any);
      expect(layer.id).toBe(LAYERS[0].id);
    });
  });
});
