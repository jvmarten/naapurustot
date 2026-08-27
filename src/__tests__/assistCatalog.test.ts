import { describe, it, expect } from 'vitest';
import { buildAssistCatalog, assistCriteriaToFilters } from '../utils/assistCatalog';
import { LAYER_MAP, type LayerId } from '../utils/colorScales';
import type { AssistCriterion } from '../utils/api';

describe('buildAssistCatalog', () => {
  const catalog = buildAssistCatalog();
  const ids = new Set(catalog.map((c) => c.id));

  it('only lists real, shipped layers', () => {
    expect(catalog.length).toBeGreaterThan(10);
    for (const entry of catalog) {
      expect(LAYER_MAP.has(entry.id as LayerId)).toBe(true);
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.higherIsBetter).toBe('boolean');
    }
  });

  it('includes everyday livability layers', () => {
    for (const id of ['tree_canopy', 'crime_rate', 'rental_price', 'transit_access']) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('excludes political, change/trend, and sensitive demographic layers', () => {
    for (const id of [
      'political_lean', 'party_kok', 'voter_turnout', 'party_diversity',
      'income_change', 'population_projection', 'crime_index_change',
      'violent_crime', 'property_crime',
      'foreign_lang', 'foreign_lang_municipal', 'gender_ratio',
    ]) {
      expect(ids.has(id)).toBe(false);
    }
  });

  it('reflects the layer direction (crime is lower-is-better, tree cover higher)', () => {
    const crime = catalog.find((c) => c.id === 'crime_rate');
    const trees = catalog.find((c) => c.id === 'tree_canopy');
    expect(crime?.higherIsBetter).toBe(false);
    expect(trees?.higherIsBetter).toBe(true);
  });
});

describe('assistCriteriaToFilters', () => {
  it('keeps valid layers and stamps percentile mode', () => {
    const input: AssistCriterion[] = [
      { layerId: 'tree_canopy', min: 60, max: 100, mode: 'percentile' },
      { layerId: 'crime_rate', min: 0, max: 30, mode: 'percentile' },
    ];
    const out = assistCriteriaToFilters(input);
    expect(out).toEqual([
      { layerId: 'tree_canopy', min: 60, max: 100, mode: 'percentile' },
      { layerId: 'crime_rate', min: 0, max: 30, mode: 'percentile' },
    ]);
  });

  it('drops unknown and excluded layers', () => {
    const out = assistCriteriaToFilters([
      { layerId: 'not_a_real_layer', min: 0, max: 50, mode: 'percentile' },
      { layerId: 'political_lean', min: 0, max: 50, mode: 'percentile' },
      { layerId: 'tree_canopy', min: 10, max: 90, mode: 'percentile' },
    ] as AssistCriterion[]);
    expect(out.map((c) => c.layerId)).toEqual(['tree_canopy']);
  });

  it('clamps ranks to [0,100] and repairs reversed bounds', () => {
    const out = assistCriteriaToFilters([
      { layerId: 'rental_price', min: 200, max: -10, mode: 'percentile' },
    ] as AssistCriterion[]);
    // 200 -> 100, -10 -> 0, then swapped so min <= max
    expect(out).toEqual([{ layerId: 'rental_price', min: 0, max: 100, mode: 'percentile' }]);
  });

  it('drops non-finite bounds', () => {
    const out = assistCriteriaToFilters([
      { layerId: 'tree_canopy', min: Number.NaN, max: 50, mode: 'percentile' },
    ] as AssistCriterion[]);
    expect(out).toEqual([]);
  });
});
