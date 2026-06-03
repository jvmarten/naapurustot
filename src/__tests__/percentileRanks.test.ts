import { describe, it, expect } from 'vitest';
import {
  readMetric,
  distributionFor,
  percentileRankSorted,
  percentileRank,
  topPercentileFromRank,
  metricPercentile,
  computeNeighbourhoodPercentiles,
  PERCENTILE_METRICS,
} from '../utils/percentileRanks';

/** Build a feature-like object with a properties bag. */
function feat(props: Record<string, unknown>) {
  return { properties: props };
}

describe('percentileRanks — readMetric', () => {
  it('reads from a .properties bag', () => {
    expect(readMetric(feat({ quality_index: 70 }), 'quality_index')).toBe(70);
  });
  it('reads from a bare property object', () => {
    expect(readMetric({ quality_index: 55 }, 'quality_index')).toBe(55);
  });
  it('returns null for missing / non-finite values', () => {
    expect(readMetric(feat({ quality_index: null }), 'quality_index')).toBeNull();
    expect(readMetric(feat({}), 'quality_index')).toBeNull();
    expect(readMetric(null, 'quality_index')).toBeNull();
    expect(readMetric(feat({ quality_index: 'NaN' }), 'quality_index')).toBeNull();
  });
});

describe('percentileRanks — distributionFor', () => {
  it('collects finite values sorted ascending and skips missing', () => {
    const sources = [feat({ x: 3 }), feat({ x: 1 }), feat({ x: null }), feat({ x: 2 })];
    expect(distributionFor(sources, 'x')).toEqual([1, 2, 3]);
  });
  it('drops non-positive values when requirePositive is set', () => {
    const sources = [feat({ x: 0 }), feat({ x: -5 }), feat({ x: 10 })];
    expect(distributionFor(sources, 'x', { requirePositive: true })).toEqual([10]);
  });
});

describe('percentileRanks — percentileRankSorted', () => {
  it('returns the share (%) of values <= the target', () => {
    const sorted = [10, 20, 30, 40, 50];
    // 30 is <= by 10,20,30 → 3/5 = 60%
    expect(percentileRankSorted(sorted, 30)).toBe(60);
    // top value → 100%
    expect(percentileRankSorted(sorted, 50)).toBe(100);
    // below all → 0%
    expect(percentileRankSorted(sorted, 5)).toBe(0);
  });
  it('returns null for empty distribution or non-finite value', () => {
    expect(percentileRankSorted([], 5)).toBeNull();
    expect(percentileRankSorted([1, 2], NaN)).toBeNull();
  });
});

describe('percentileRanks — percentileRank convenience', () => {
  it('derives the distribution then ranks', () => {
    const sources = [feat({ q: 1 }), feat({ q: 2 }), feat({ q: 3 }), feat({ q: 4 })];
    expect(percentileRank(sources, 'q', 3)).toBe(75); // 1,2,3 of 4
  });
});

describe('percentileRanks — topPercentileFromRank', () => {
  it('converts a high rank into a small top% for higher-is-better metrics', () => {
    expect(topPercentileFromRank(97, true)).toBe(3);
    expect(topPercentileFromRank(100, true)).toBe(1); // floored at 1, never "top 0%"
  });
  it('passes the rank straight through for lower-is-better metrics', () => {
    expect(topPercentileFromRank(8, false)).toBe(8);
  });
  it('returns null for a null rank', () => {
    expect(topPercentileFromRank(null, true)).toBeNull();
  });
});

describe('percentileRanks — metricPercentile (national + regional)', () => {
  // National cohort: quality_index spread across the country.
  const national = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => feat({ quality_index: v }));
  // Regional cohort: a subset around the lower-middle of the country.
  const regional = [30, 40, 50].map((v) => feat({ quality_index: v }));

  it('computes national and regional ranks + top% for a higher-is-better metric', () => {
    const r = metricPercentile(90, PERCENTILE_METRICS.quality, national, regional);
    // 90 is <= by 9 of 10 nationally → 90th percentile → top 10%.
    expect(r.national).toBe(90);
    expect(r.nationalTop).toBe(10);
    // Regionally 90 beats all 3 (and isn't in the cohort, but the value is still ranked
    // against the regional distribution) → 100% → top 1%.
    expect(r.regional).toBe(100);
    expect(r.regionalTop).toBe(1);
  });

  it('returns all-null for a null value', () => {
    const r = metricPercentile(null, PERCENTILE_METRICS.quality, national, regional);
    expect(r).toEqual({ national: null, regional: null, nationalTop: null, regionalTop: null });
  });
});

describe('percentileRanks — computeNeighbourhoodPercentiles', () => {
  const national = [
    feat({ quality_index: 50, hr_mtu: 22000, transit_reachability_score: 20 }),
    feat({ quality_index: 60, hr_mtu: 24000, transit_reachability_score: 30 }),
    feat({ quality_index: 70, hr_mtu: 26000, transit_reachability_score: 40 }),
    feat({ quality_index: 80, hr_mtu: 28000, transit_reachability_score: 50 }),
    // An income placeholder that must be excluded from the income distribution.
    feat({ quality_index: 90, hr_mtu: 0, transit_reachability_score: 60 }),
  ];
  const regional = national.slice(0, 3);

  it('bundles quality / income / transit national percentiles from real values', () => {
    const subject = { quality_index: 80, hr_mtu: 28000, transit_reachability_score: 50 };
    const r = computeNeighbourhoodPercentiles(subject, national, regional);
    // quality 80: <= by 50,60,70,80 of 5 → 80%.
    expect(r.quality.national).toBe(80);
    // income 28000 ranked against the 4 positive incomes (0 excluded): top value → 100%.
    expect(r.income.national).toBe(100);
    expect(r.income.nationalTop).toBe(1);
    // transit 50: <= by 20,30,40,50 of 5 → 80% → top 20%.
    expect(r.transit.national).toBe(80);
    expect(r.transit.nationalTop).toBe(20);
  });

  it('excludes non-positive income from the distribution (no placeholder pollution)', () => {
    // If 0 were counted, the distribution would be [0,22000,24000,26000,28000] (n=5)
    // and 22000 would rank 40%. Excluding it, [22000,24000,26000,28000] (n=4) → 25%.
    const subject = { quality_index: 50, hr_mtu: 22000, transit_reachability_score: 20 };
    const r = computeNeighbourhoodPercentiles(subject, national, regional);
    expect(r.income.national).toBe(25);
  });

  it('yields null percentiles when a metric is absent', () => {
    const subject = { quality_index: 70 };
    const r = computeNeighbourhoodPercentiles(subject, national, regional);
    expect(r.income.national).toBeNull();
    expect(r.transit.national).toBeNull();
    expect(r.quality.national).toBe(60); // 50,60,70 of 5
  });
});
