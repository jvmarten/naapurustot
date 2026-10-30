/**
 * Sweden's quality index: every area is scored against its own country's ranges,
 * income reads SCB's ekonomisk standard, and a factor Sweden has no source for drops
 * out of the Swedish score rather than scoring every area a neutral 50.
 */
import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  computeQualityCoverage,
  getDefaultWeights,
  mapQuantile,
  QUALITY_FACTORS,
  type QualityWeights,
  type MinMax,
} from '../utils/qualityIndex';
import { getCountryRanges } from '../utils/nationalRanges';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

const feature = (pno: string, props: Partial<NeighborhoodProperties>): Feature => ({
  type: 'Feature',
  geometry: null as unknown as Feature['geometry'],
  properties: { pno, nimi: pno, namn: pno, ...props } as NeighborhoodProperties,
});

const only = (...ids: string[]): QualityWeights => {
  const w: QualityWeights = {};
  for (const f of QUALITY_FACTORS) w[f.id] = 0;
  for (const id of ids) w[id] = QUALITY_FACTORS.find((f) => f.id === id)!.defaultWeight;
  return w;
};

const qi = (f: Feature) => (f.properties as NeighborhoodProperties).quality_index;

describe('Swedish quality index', () => {
  const fi: Map<string, MinMax> = new Map([['unemployment_rate', { min: 0, max: 10, avg: 5 }]]);
  const se: Map<string, MinMax> = new Map([
    ['unemployment_rate', { min: 0, max: 20, avg: 5 }],
    ['economic_standard_median', { min: 200_000, max: 400_000, avg: 300_000 }],
  ]);

  it('scores each area against its own country', () => {
    const a = feature('00100', { unemployment_rate: 5 });
    const b = feature('0180C1090', { unemployment_rate: 5 });
    computeQualityIndices([a, b], only('employment'), { fi, se });
    expect(qi(a)).toBe(50); // 5 % of Finland's 0–10
    expect(qi(b)).toBe(75); // 5 % of Sweden's 0–20
  });

  it('reads ekonomisk standard for Swedish income, never hr_mtu', () => {
    const b = feature('0180C1090', { economic_standard_median: 350_000, hr_mtu: 1 });
    computeQualityIndices([b], only('income'), { fi, se });
    expect(qi(b)).toBe(75);
  });

  it('drops a factor Sweden has no range for instead of scoring it 50', () => {
    const b = feature('0180C1090', { unemployment_rate: 0 });
    // safety has no Swedish range: the score is employment's alone (100), not (100 + 50) / 2.
    computeQualityIndices([b], only('employment', 'safety'), { fi, se });
    expect(qi(b)).toBe(100);
  });

  it('leaves Swedish areas unscored when given only Finland’s ranges', () => {
    const b = feature('0180C1090', { unemployment_rate: 5 });
    computeQualityIndices([b], only('employment'), fi);
    expect(qi(b)).toBeNull();
  });

  it('in region scope ranges each country over its own loaded areas', () => {
    const feats = [
      feature('00100', { unemployment_rate: 2 }), feature('00200', { unemployment_rate: 4 }),
      feature('0180C1090', { unemployment_rate: 10 }), feature('0180C1100', { unemployment_rate: 20 }),
    ];
    computeQualityIndices(feats, only('employment'), null);
    expect(feats.map(qi)).toEqual([100, 0, 100, 0]);
  });

  it('the shipped artifact gives Sweden a range for the factors it has data for', () => {
    const r = getCountryRanges().se;
    for (const prop of ['unemployment_rate', 'economic_standard_median', 'higher_education_rate',
      'transit_stop_density', 'air_quality_index', 'walkability_index', 'violent_crime_rate',
      'traffic_accident_rate', 'noise_pollution', 'light_pollution']) {
      expect(r.has(prop), prop).toBe(true);
    }
    // Paavo's income is Finland's alone: Sweden scores income on economic standard.
    for (const prop of ['hr_mtu', 'property_price_sqm']) {
      expect(r.has(prop), prop).toBe(false);
    }
  });

  it('mapQuantile carries a value to the same quantile of the other curve', () => {
    const from = [0, 10, 20, 40];
    const to = [10, 30, 50, 90];
    expect(mapQuantile(-5, from, to)).toBe(10);
    expect(mapQuantile(10, from, to)).toBe(30);
    expect(mapQuantile(30, from, to)).toBe(70); // halfway between p2/3 and p3/3
    expect(mapQuantile(99, from, to)).toBe(90);
  });

  it('puts Sweden on Finland’s scale under the default weights, and only then', () => {
    const calibration = { fi: [20, 40, 60], se: [10, 20, 30] };
    const props = { unemployment_rate: 10 }; // employment-only areas score 50 raw
    const run = (weights?: QualityWeights) => {
      const f = feature('0180C1090', props);
      computeQualityIndices([f], weights, { fi, se, calibration });
      return qi(f);
    };
    // Raw composite 50 under the defaults (every other default factor has no range here)
    // sits past the top of Sweden's curve, so it maps to Finland's top: 60.
    expect(run()).toBe(60);
    // A custom lens is left uncalibrated.
    expect(run(only('employment'))).toBe(50);
  });

  it('the shipped calibration curves ascend and give both countries the same quantiles', () => {
    const c = getCountryRanges().calibration!;
    for (const curve of [c.fi!, c.se!]) {
      expect(curve.length).toBe(21);
      for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    }
  });

  it('coverage marks a factor with no Swedish source as a national gap', () => {
    const p = { pno: '0180C1090', unemployment_rate: 5 } as NeighborhoodProperties;
    const cov = computeQualityCoverage(p, getDefaultWeights(), se);
    const factors = cov.dimensions.flatMap((d) => d.factors);
    const safety = factors.find((f) => f.id === 'safety')!;
    expect(safety.present).toBe(false);
    expect(safety.nationallyThin).toBe(true);
    expect(factors.find((f) => f.id === 'employment')!.present).toBe(true);
  });
});
