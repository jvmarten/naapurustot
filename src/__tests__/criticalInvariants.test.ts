/**
 * Critical invariants — tests that pin down behaviors where a silent regression
 * causes the worst user-visible problems:
 *
 *  - Similarity must NEVER return the target neighborhood itself
 *    (would break the "similar neighborhoods" panel by suggesting self-matches).
 *  - Quality index rounding is integer — the badge UI assumes `Number.isInteger`.
 *  - filterSmallIslands must keep single-polygon features untouched
 *    (a regression here silently drops mainland polygons for coastal areas).
 *  - getFeatureCenter bbox midpoint is stable — used for flyTo animation and
 *    similarity distance ordering.
 *  - parseSlug must only accept exactly-5-digit prefixes (URL lookup key).
 *  - parseTrendSeries rejects malformed JSON and single-point series
 *    (single point → can't compute change; UI divides by the first value).
 */
import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import { findSimilarNeighborhoods } from '../utils/similarity';
import { computeQualityIndices } from '../utils/qualityIndex';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import { parseSlug, toSlug } from '../utils/slug';
import {
  parseTrendSeries,
  computeChangeMetrics,
  type NeighborhoodProperties,
} from '../utils/metrics';

function feat(props: Partial<NeighborhoodProperties>, coords: [number, number] = [24.9, 60.2]): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: {
      pno: '00100',
      nimi: 'X',
      namn: 'X',
      kunta: '091',
      city: 'helsinki_metro',
      ...props,
    } as NeighborhoodProperties,
  };
}

describe('similarity — target exclusion invariant', () => {
  it('never includes the target neighborhood in its own results', () => {
    const features: Feature[] = [
      feat({ pno: '00100', hr_mtu: 40000, unemployment_rate: 5, higher_education_rate: 40, foreign_language_pct: 10, ownership_rate: 55, transit_stop_density: 30, property_price_sqm: 5000, crime_index: 50, population_density: 3000, child_ratio: 20 }),
      feat({ pno: '00200', hr_mtu: 40100, unemployment_rate: 5.1, higher_education_rate: 41, foreign_language_pct: 11, ownership_rate: 56, transit_stop_density: 31, property_price_sqm: 5100, crime_index: 51, population_density: 3100, child_ratio: 21 }),
      feat({ pno: '00300', hr_mtu: 20000, unemployment_rate: 20, higher_education_rate: 10, foreign_language_pct: 5, ownership_rate: 20, transit_stop_density: 5, property_price_sqm: 2000, crime_index: 150, population_density: 500, child_ratio: 5 }),
    ];
    const target = features[0].properties as NeighborhoodProperties;
    const result = findSimilarNeighborhoods(target, features, 10);
    expect(result.some((r) => r.properties.pno === '00100')).toBe(false);
    // The near-twin (00200) must be ranked first.
    expect(result[0].properties.pno).toBe('00200');
  });

  it('returns an empty array if the dataset contains only the target', () => {
    const features = [feat({ pno: '00100', hr_mtu: 40000, unemployment_rate: 5, higher_education_rate: 40, foreign_language_pct: 10, ownership_rate: 55, transit_stop_density: 30, property_price_sqm: 5000, crime_index: 50, population_density: 3000, child_ratio: 20 })];
    expect(findSimilarNeighborhoods(features[0].properties as NeighborhoodProperties, features)).toEqual([]);
  });

  it('respects the count parameter', () => {
    const features: Feature[] = Array.from({ length: 12 }, (_, i) =>
      feat({ pno: `0010${i}`.slice(-5), hr_mtu: 30000 + i * 1000, unemployment_rate: 5 + i, higher_education_rate: 30 + i, foreign_language_pct: 10 + i, ownership_rate: 50 + i, transit_stop_density: 10 + i, property_price_sqm: 3000 + i * 100, crime_index: 50 + i * 2, population_density: 1000 + i * 100, child_ratio: 10 + i }),
    );
    const target = features[0].properties as NeighborhoodProperties;
    expect(findSimilarNeighborhoods(target, features, 3)).toHaveLength(3);
    expect(findSimilarNeighborhoods(target, features, 7)).toHaveLength(7);
  });
});

describe('quality index — integer output', () => {
  it('produces integer scores (the badge UI renders Number directly)', () => {
    const features: Feature[] = [
      feat({ pno: '00100', crime_index: 100, hr_mtu: 30000, unemployment_rate: 8, higher_education_rate: 35, transit_stop_density: 20, healthcare_density: 3, school_density: 2, daycare_density: 3, grocery_density: 4, air_quality_index: 30 }),
      feat({ pno: '00200', crime_index: 30, hr_mtu: 50000, unemployment_rate: 3, higher_education_rate: 60, transit_stop_density: 50, healthcare_density: 6, school_density: 5, daycare_density: 5, grocery_density: 8, air_quality_index: 20 }),
      feat({ pno: '00300', crime_index: 70, hr_mtu: 40000, unemployment_rate: 6, higher_education_rate: 45, transit_stop_density: 35, healthcare_density: 4, school_density: 3, daycare_density: 4, grocery_density: 6, air_quality_index: 25 }),
    ];
    computeQualityIndices(features);
    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index!;
      expect(Number.isInteger(qi)).toBe(true);
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }
  });
});

describe('filterSmallIslands invariants', () => {
  it('leaves single-polygon features untouched (no geometry drop)', () => {
    const original: Feature = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.25], [24.9, 60.2]]],
      },
    };
    const [out] = filterSmallIslands([original]);
    // Same geometry instance preserved (no copy, no wrapping in MultiPolygon).
    expect(out.geometry).toBe(original.geometry);
  });

  it('leaves MultiPolygon with a single polygon untouched', () => {
    const original: Feature = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.25], [24.9, 60.2]]]],
      },
    };
    const [out] = filterSmallIslands([original]);
    expect(out.geometry).toBe(original.geometry);
  });

  it('drops tiny islands (< 15% of largest) and collapses to a Polygon if only one remains', () => {
    const big = [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]];
    const tiny = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]; // 1/10000 of big
    const original: Feature = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [big, tiny],
      },
    };
    const [out] = filterSmallIslands([original]);
    expect(out.geometry.type).toBe('Polygon');
    expect((out.geometry as GeoJSON.Polygon).coordinates).toEqual(big);
  });

  it('keeps all polygons when all are above the 15% threshold', () => {
    const a = [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]];
    const b = [[[0, 0], [80, 0], [80, 80], [0, 80], [0, 0]]]; // 64% of a
    const original: Feature = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: { type: 'MultiPolygon', coordinates: [a, b] },
    };
    const [out] = filterSmallIslands([original]);
    expect(out.geometry.type).toBe('MultiPolygon');
    expect((out.geometry as GeoJSON.MultiPolygon).coordinates).toHaveLength(2);
  });

  it('returns non-polygon features unchanged', () => {
    const pt: Feature = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    };
    const [out] = filterSmallIslands([pt]);
    expect(out).toBe(pt);
  });
});

describe('getFeatureCenter — bbox midpoint', () => {
  it('returns midpoint of a simple square', () => {
    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]],
      },
    };
    expect(getFeatureCenter(f)).toEqual([5, 10]);
  });

  it('returns the Point coordinate directly', () => {
    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    };
    expect(getFeatureCenter(f)).toEqual([24.9, 60.2]);
  });

  it('returns [0, 0] for a feature with no geometry', () => {
    const f: Feature = { type: 'Feature', properties: {}, geometry: null as unknown as GeoJSON.Geometry };
    expect(getFeatureCenter(f)).toEqual([0, 0]);
  });

  it('handles MultiPolygon by spanning all polygons', () => {
    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
          [[[90, 90], [100, 90], [100, 100], [90, 100], [90, 90]]],
        ],
      },
    };
    // bbox spans 0..100, 0..100 → midpoint 50,50
    expect(getFeatureCenter(f)).toEqual([50, 50]);
  });
});

describe('slug — URL routing invariants', () => {
  it('parseSlug accepts exactly-5-digit prefix', () => {
    expect(parseSlug('00100-kallio')).toBe('00100');
    expect(parseSlug('00530-something-with-dashes')).toBe('00530');
  });

  it('parseSlug rejects non-numeric or short prefixes', () => {
    expect(parseSlug('abcde-kallio')).toBeNull();
    expect(parseSlug('1234-kallio')).toBeNull();
    expect(parseSlug('00a00-kallio')).toBeNull();
    expect(parseSlug('')).toBeNull();
  });

  it('toSlug strips Finnish diacritics to ASCII', () => {
    expect(toSlug('00100', 'Länsi-Hämeentie')).toBe('00100-lansi-hameentie');
    expect(toSlug('00100', 'Töölö')).toBe('00100-toolo');
  });

  it('toSlug collapses non-alphanumeric runs to single hyphens, trimmed', () => {
    expect(toSlug('00100', 'Etu-Töölö / Länsisatama')).toBe('00100-etu-toolo-lansisatama');
  });

  it('toSlug lowercases names with mixed case', () => {
    expect(toSlug('00100', 'ETU-TÖÖLÖ')).toBe('00100-etu-toolo');
  });
});

describe('trend series parsing', () => {
  it('rejects null, undefined, empty, and non-JSON inputs', () => {
    expect(parseTrendSeries(null)).toBeNull();
    expect(parseTrendSeries(undefined)).toBeNull();
    expect(parseTrendSeries('')).toBeNull();
    expect(parseTrendSeries('not json')).toBeNull();
  });

  it('rejects single-point series (cannot compute change)', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, 100]]))).toBeNull();
  });

  it('rejects series containing non-numeric or non-finite points', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, 'x'], [2021, 100]]))).toBeNull();
    expect(parseTrendSeries(JSON.stringify([[2020, Infinity], [2021, 100]]))).toBeNull();
  });

  it('rejects malformed tuples (length !== 2)', () => {
    expect(parseTrendSeries(JSON.stringify([[2020], [2021, 100]]))).toBeNull();
    expect(parseTrendSeries(JSON.stringify([[2020, 100, 'extra'], [2021, 100]]))).toBeNull();
  });

  it('accepts two-or-more valid numeric points', () => {
    const out = parseTrendSeries(JSON.stringify([[2020, 100], [2021, 110]]));
    expect(out).toEqual([[2020, 100], [2021, 110]]);
  });
});

describe('computeChangeMetrics', () => {
  it('computes change % from first to last history entry', () => {
    const features: Feature[] = [
      feat({
        pno: '00100',
        income_history: JSON.stringify([[2019, 20000], [2020, 22000], [2021, 25000]]),
        population_history: JSON.stringify([[2019, 1000], [2020, 1100]]),
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeCloseTo(25, 6); // (25000-20000)/20000 * 100
    expect(p.population_change_pct).toBeCloseTo(10, 6);
    // No history → null change pct. The function sets this property each call.
    expect(p.unemployment_change_pct).toBeNull();
  });

  it('handles negative change correctly', () => {
    const features: Feature[] = [feat({ pno: '00100', income_history: JSON.stringify([[2019, 30000], [2020, 25000]]) })];
    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeCloseTo(-16.67, 1);
  });

  it('returns null when the first value is zero (avoids division by zero)', () => {
    const features: Feature[] = [feat({ pno: '00100', income_history: JSON.stringify([[2019, 0], [2020, 100]]) })];
    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('uses absolute value of first entry so negative baselines do not flip the sign', () => {
    // (last - first) / |first| * 100 — for a first value of -10, a last of 10
    // should yield +200% (improvement), not -200%.
    const features: Feature[] = [feat({ pno: '00100', income_history: JSON.stringify([[2019, -10], [2020, 10]]) })];
    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBe(200);
  });
});
