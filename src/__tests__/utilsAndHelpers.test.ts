/**
 * Priority 4 & 5: Utility functions and integration points
 *
 * Tests slug generation (URL routing), color scale consistency,
 * formatting edge cases, geometry filtering, and the data pipeline
 * integration between quality index + metro averages + change metrics.
 */
import { describe, it, expect } from 'vitest';
import { toSlug, parseSlug } from '../utils/slug';
import { formatNumber, formatEuro, formatPct, formatDiff, escapeHtml, diffColor } from '../utils/formatting';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import { LAYERS, getLayerById, getColorForValue, rescaleLayerToData, buildFillColorExpression, LAYER_MAP } from '../utils/colorScales';
import { computeQualityIndices } from '../utils/qualityIndex';
import { computeMetroAverages, computeChangeMetrics, computeQuickWinMetrics } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

// --- Slug utilities ---

describe('toSlug / parseSlug — URL routing', () => {
  it('creates valid slug from postal code and Finnish name', () => {
    expect(toSlug('00100', 'Helsinki keskusta - Etu-Töölö')).toBe('00100-helsinki-keskusta-etu-toolo');
  });

  it('handles Finnish characters ä, ö, å', () => {
    expect(toSlug('02100', 'Tapiola Länsi-Tapiola')).toBe('02100-tapiola-lansi-tapiola');
    expect(toSlug('00200', 'Sörnäinen')).toBe('00200-sornainen');
    expect(toSlug('00300', 'Åvik')).toBe('00300-avik');
  });

  it('strips leading/trailing hyphens', () => {
    expect(toSlug('00100', '-Test-')).toBe('00100-test');
  });

  it('parseSlug extracts postal code', () => {
    expect(parseSlug('00100-helsinki-keskusta')).toBe('00100');
    expect(parseSlug('02100-tapiola')).toBe('02100');
  });

  it('parseSlug returns null for invalid slugs', () => {
    expect(parseSlug('abcde-test')).toBeNull();
    expect(parseSlug('0010')).toBeNull();  // too short
    expect(parseSlug('')).toBeNull();
  });
});

// --- Formatting ---

describe('formatting edge cases', () => {
  it('formatNumber handles null, undefined, NaN, Infinity', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber(NaN)).toBe('—');
    expect(formatNumber(Infinity)).toBe('—');
  });

  it('formatEuro formats correctly', () => {
    const result = formatEuro(25000);
    expect(result).toContain('25');
    expect(result).toContain('€');
  });

  it('formatPct handles custom decimal places', () => {
    expect(formatPct(12.345, 2)).toBe('12.35 %');
    expect(formatPct(12.345, 0)).toBe('12 %');
  });

  it('formatDiff shows sign correctly', () => {
    expect(formatDiff(110, 100)).toBe('+10.0');
    expect(formatDiff(90, 100)).toBe('-10.0');
    expect(formatDiff(100, 100)).toBe('0.0');
  });

  it('formatDiff returns empty string for null inputs', () => {
    expect(formatDiff(null, 100)).toBe('');
    expect(formatDiff(100, null)).toBe('');
  });

  it('escapeHtml prevents XSS', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(escapeHtml("it's a test")).toBe("it&#39;s a test");
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('diffColor returns correct class based on higherIsBetter', () => {
    expect(diffColor(110, 100, true)).toBe('text-emerald-400');  // higher is better, value > avg
    expect(diffColor(90, 100, true)).toBe('text-rose-400');      // higher is better, value < avg
    expect(diffColor(110, 100, false)).toBe('text-rose-400');    // lower is better, value > avg
    expect(diffColor(90, 100, false)).toBe('text-emerald-400');  // lower is better, value < avg
  });

  it('diffColor handles equal values as positive', () => {
    expect(diffColor(100, 100, true)).toBe('text-emerald-400');
  });

  it('diffColor returns neutral for null values', () => {
    expect(diffColor(null, 100)).toBe('text-surface-400');
    expect(diffColor(100, null)).toBe('text-surface-400');
  });

  it('formatNumber accepts string input and coerces', () => {
    const result = formatNumber('12345');
    expect(result).not.toBe('—');
  });
});

// --- Geometry filtering ---

describe('filterSmallIslands', () => {
  it('removes polygons smaller than 15% of the largest', () => {
    const bigPoly = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const tinyPoly = [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]]; // 0.01% of big

    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [bigPoly, tinyPoly] },
      properties: {},
    };

    const result = filterSmallIslands([feature]);
    // Tiny polygon should be removed, leaving a Polygon (not MultiPolygon)
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('keeps polygons above the 15% threshold', () => {
    const poly1 = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const poly2 = [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]]; // 25% of poly1

    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [poly1, poly2] },
      properties: {},
    };

    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates).toHaveLength(2);
  });

  it('does not modify single-polygon features', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      properties: {},
    };

    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // Same reference
  });
});

describe('getFeatureCenter', () => {
  it('returns midpoint of bounding box for polygon', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([5, 5]);
  });

  it('returns point coordinates directly', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([24.9, 60.2]);
  });

  it('returns [0, 0] for feature with no geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: null as unknown as Polygon,
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });
});

// --- Color scales consistency ---

describe('LAYERS — layer configuration integrity', () => {
  it('all layers have matching colors and stops arrays', () => {
    for (const layer of LAYERS) {
      expect(layer.colors.length).toBe(layer.stops.length);
    }
  });

  it('all layers have stops in ascending order', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i]).toBeGreaterThan(layer.stops[i - 1]);
      }
    }
  });

  it('all layer IDs are unique', () => {
    const ids = LAYERS.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('LAYER_MAP contains all layers', () => {
    expect(LAYER_MAP.size).toBe(LAYERS.length);
    for (const layer of LAYERS) {
      expect(LAYER_MAP.get(layer.id)).toBe(layer);
    }
  });

  it('getLayerById returns first layer for unknown ID', () => {
    const result = getLayerById('nonexistent_id' as never);
    expect(result.id).toBe(LAYERS[0].id);
  });

  it('all format functions handle numeric input without throwing', () => {
    for (const layer of LAYERS) {
      expect(() => layer.format(0)).not.toThrow();
      expect(() => layer.format(100)).not.toThrow();
      expect(() => layer.format(-1)).not.toThrow();
      expect(() => layer.format(999999)).not.toThrow();
    }
  });

  it('all colors are valid hex codes', () => {
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe('getColorForValue', () => {
  const layer = LAYERS.find(l => l.id === 'median_income')!;

  it('returns gray for null value', () => {
    expect(getColorForValue(layer, null)).toBe('#d1d5db');
    expect(getColorForValue(layer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for values below all stops', () => {
    expect(getColorForValue(layer, 0)).toBe(layer.colors[0]);
  });

  it('returns last color for values above all stops', () => {
    expect(getColorForValue(layer, 999999)).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns correct color at exact stop boundaries', () => {
    for (let i = 0; i < layer.stops.length; i++) {
      expect(getColorForValue(layer, layer.stops[i])).toBe(layer.colors[i]);
    }
  });
});

describe('rescaleLayerToData', () => {
  const layer = LAYERS.find(l => l.id === 'median_income')!;

  it('rescales stops to data min/max', () => {
    const features: Feature[] = [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 20000 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 40000 } },
    ];
    const rescaled = rescaleLayerToData(layer, features);
    expect(rescaled.stops[0]).toBe(20000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(40000);
    expect(rescaled.colors).toEqual(layer.colors); // Colors unchanged
  });

  it('returns original layer when no valid data exists', () => {
    const features: Feature[] = [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: null } },
    ];
    expect(rescaleLayerToData(layer, features)).toBe(layer);
  });

  it('returns original layer when all values are the same', () => {
    const features: Feature[] = [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 30000 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { hr_mtu: 30000 } },
    ];
    expect(rescaleLayerToData(layer, features)).toBe(layer);
  });
});

describe('buildFillColorExpression', () => {
  it('produces a valid MapLibre expression structure', () => {
    const layer = LAYERS[0];
    const expr = buildFillColorExpression(layer);
    // Should be ['case', condition, interpolation, fallbackColor]
    expect(expr[0]).toBe('case');
    expect(expr[expr.length - 1]).toBe('#d1d5db'); // fallback gray
  });

  it('uses propertyOverride when provided', () => {
    const layer = LAYERS[0];
    const expr = buildFillColorExpression(layer, 'custom_prop');
    // The expression should reference 'custom_prop' not layer.property
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('custom_prop');
  });
});

// --- Integration: full data pipeline ---

describe('Data pipeline integration', () => {
  function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki', ...props } as NeighborhoodProperties,
    };
  }

  it('full pipeline: quality index → change metrics → quick wins → metro averages', () => {
    const features = [
      makeFeature({
        pno: '00100', he_vakiy: 2000,
        crime_index: 50, hr_mtu: 35000, unemployment_rate: 4, higher_education_rate: 55,
        transit_stop_density: 40, healthcare_density: 8, school_density: 5, daycare_density: 6,
        grocery_density: 10, air_quality_index: 22,
        income_history: '[[2018,30000],[2020,35000]]',
        population_history: '[[2018,1800],[2020,2000]]',
        pt_tyoll: 900, pt_vakiy: 1200, pt_tyott: 50,
        ko_yl_kork: 400, ko_al_kork: 200, ko_ika18y: 1500,
        te_omis_as: 500, te_taly: 800, te_vuok_as: 250,
        he_0_2: 50, he_3_6: 60, pinta_ala: 1000000,
        he_18_19: 40, he_20_24: 100, he_25_29: 80,
        he_naiset: 1020, he_miehet: 980,
        he_65_69: 100, he_70_74: 80, he_75_79: 60, he_80_84: 30, he_85_: 10,
      }),
      makeFeature({
        pno: '00200', he_vakiy: 3000,
        crime_index: 100, hr_mtu: 25000, unemployment_rate: 8, higher_education_rate: 30,
        transit_stop_density: 15, healthcare_density: 3, school_density: 2, daycare_density: 2,
        grocery_density: 4, air_quality_index: 35,
        income_history: '[[2018,22000],[2020,25000]]',
        population_history: '[[2018,2800],[2020,3000]]',
        pt_tyoll: 1200, pt_vakiy: 2000, pt_tyott: 200,
        ko_yl_kork: 300, ko_al_kork: 150, ko_ika18y: 2200,
        te_omis_as: 400, te_taly: 1200, te_vuok_as: 700,
        he_0_2: 80, he_3_6: 100, pinta_ala: 2000000,
        he_18_19: 60, he_20_24: 150, he_25_29: 120,
        he_naiset: 1500, he_miehet: 1500,
        he_65_69: 200, he_70_74: 150, he_75_79: 100, he_80_84: 50, he_85_: 20,
      }),
    ];

    // Run pipeline in the same order as dataLoader.ts
    computeQualityIndices(features);
    computeChangeMetrics(features);
    computeQuickWinMetrics(features);
    const metroAverages = computeMetroAverages(features);

    // Verify quality indices were computed
    const p1 = features[0].properties as NeighborhoodProperties;
    const p2 = features[1].properties as NeighborhoodProperties;
    expect(p1.quality_index).not.toBeNull();
    expect(p2.quality_index).not.toBeNull();
    expect(p1.quality_index!).toBeGreaterThan(p2.quality_index!); // Better neighborhood

    // Verify change metrics
    expect(p1.income_change_pct).toBeCloseTo((35000 - 30000) / 30000 * 100, 0);

    // Verify quick win metrics
    expect(p1.youth_ratio_pct).toBeCloseTo((40 + 100 + 80) / 2000 * 100, 1);
    expect(p1.gender_ratio).toBeCloseTo(1020 / 980, 2);

    // Verify metro averages make sense
    expect(metroAverages.he_vakiy).toBe(5000);
    expect(metroAverages.hr_mtu).toBeGreaterThan(0);
    expect(metroAverages.unemployment_rate).toBeGreaterThan(0);
    expect(metroAverages.quality_index).toBeGreaterThan(0);
  });
});
