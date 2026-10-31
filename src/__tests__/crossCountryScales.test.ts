import { describe, it, expect } from 'vitest';
import { expression } from '@maplibre/maplibre-gl-style-spec';
import {
  LAYERS, getLayerById, layerForCountry, layerInCountry, buildFillColorExpression, getColorForValue, SE_ONLY_LAYERS,
} from '../utils/colorScales';

// Shared metrics are either comparable across the border (one scale, Finland's stops,
// maybe a legend note) or not (stopsSe: each country on its own scale, also when both
// are on the map). This pins which is which, so a layer cannot drift between them.
const NOT_COMPARABLE = [
  'unemployment', 'education', 'ownership', 'rental', 'detached_houses', 'families_with_children',
  'single_parent_hh', 'violent_crime', 'property_crime', 'crime_rate', 'traffic_accidents', 'party_diversity',
].sort();

const fill = (layerId: string, props: Record<string, unknown>) => {
  const e = expression.createExpression(buildFillColorExpression(getLayerById(layerId as never)), {
    type: 'color', 'property-type': 'data-driven', expression: { interpolated: true, parameters: ['zoom', 'feature'] },
  } as never);
  if (e.result !== 'success') throw new Error(JSON.stringify(e.value));
  const c = e.value.evaluate({ zoom: 8 }, { type: 'Polygon', properties: props } as never) as { toString(): string };
  return c.toString();
};

describe('cross-country scales', () => {
  it('flags exactly the not-comparable shared layers with Sweden\'s own stops', () => {
    const shared = LAYERS.filter((l) => layerInCountry(l.id, 'se') && !SE_ONLY_LAYERS.has(l.id));
    expect(shared.filter((l) => l.stopsSe).map((l) => l.id).sort()).toEqual(NOT_COMPARABLE);
  });

  it('colours a Swedish area of a not-comparable layer on Sweden\'s scale, in one valid expression', () => {
    const l = getLayerById('unemployment');
    // The same value lands in different places on the two scales.
    const v = 7;
    expect(fill('unemployment', { city: 'helsinki_metro', unemployment_rate: v }))
      .not.toBe(fill('unemployment', { city: 'se_stockholm_solna', unemployment_rate: v }));
    expect(fill('unemployment', { city: 'se_stockholm_solna', unemployment_rate: l.stopsSe![0] }))
      .toBe(fill('unemployment', { city: 'helsinki_metro', unemployment_rate: l.stops[0] }));
  });

  it('keeps one scale for a comparable layer', () => {
    expect(fill('elderly_ratio', { city: 'helsinki_metro', elderly_ratio_pct: 20 }))
      .toBe(fill('elderly_ratio', { city: 'se_stockholm_solna', elderly_ratio_pct: 20 }));
  });

  it('a Sweden-only map takes Sweden\'s stops as the stops and drops the second scale', () => {
    const l = getLayerById('unemployment');
    const se = layerForCountry(l, 'se');
    expect(se.stops).toEqual(l.stopsSe);
    expect(se.stopsSe).toBeUndefined();
  });

  it('ranking swatches follow the area\'s country', () => {
    const l = getLayerById('crime_rate');
    expect(getColorForValue(l, l.stopsSe![0], 'se')).toBe(l.colors[0]);
    expect(getColorForValue(l, l.stopsSe![0], 'fi')).not.toBe(l.colors[0]);
  });
});
