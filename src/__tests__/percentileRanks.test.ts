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
  valueAtPercentileSorted,
  valueAtPercentile,
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

describe('percentileRanks — valueAtPercentileSorted (CF-7 quantile)', () => {
  it('returns the min at p=0 and the max at p=100', () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(valueAtPercentileSorted(sorted, 0)).toBe(10);
    expect(valueAtPercentileSorted(sorted, 100)).toBe(50);
  });
  it('returns the exact value when the percentile lands on an observation', () => {
    const sorted = [10, 20, 30, 40, 50];
    // p=50 over a 5-element array → index 2 → 30
    expect(valueAtPercentileSorted(sorted, 50)).toBe(30);
  });
  it('linearly interpolates between straddling observations', () => {
    const sorted = [0, 100];
    // pos = 0.25 * 1 = 0.25 → 0 + (100-0)*0.25 = 25
    expect(valueAtPercentileSorted(sorted, 25)).toBe(25);
    expect(valueAtPercentileSorted(sorted, 75)).toBe(75);
  });
  it('clamps out-of-range percentiles to the rails', () => {
    const sorted = [5, 15];
    expect(valueAtPercentileSorted(sorted, -10)).toBe(5);
    expect(valueAtPercentileSorted(sorted, 250)).toBe(15);
  });
  it('handles single-element and empty distributions', () => {
    expect(valueAtPercentileSorted([42], 37)).toBe(42);
    expect(valueAtPercentileSorted([], 50)).toBeNull();
    expect(valueAtPercentileSorted([1, 2], NaN)).toBeNull();
  });
  it('round-trips with percentileRankSorted on observation points', () => {
    const sorted = [10, 20, 30, 40, 50];
    // percentileRank of 30 is 60; value at p=60 is... index 2.4 → between 30 and 40.
    // But value at the rank's own observation index is exact:
    const v = valueAtPercentileSorted(sorted, 50); // index 2 → 30
    expect(v).toBe(30);
    expect(percentileRankSorted(sorted, v!)).toBe(60);
  });
});

describe('percentileRanks — valueAtPercentile convenience', () => {
  it('derives the distribution then resolves the quantile', () => {
    const sources = [feat({ q: 4 }), feat({ q: 2 }), feat({ q: 1 }), feat({ q: 3 })];
    // sorted [1,2,3,4]; p=100 → 4, p=0 → 1
    expect(valueAtPercentile(sources, 'q', 100)).toBe(4);
    expect(valueAtPercentile(sources, 'q', 0)).toBe(1);
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

describe('percentileRanks — direction of new CF-8 metrics', () => {
  it('marks crime_index and air_quality_index as lower-is-better', () => {
    expect(PERCENTILE_METRICS.crime).toEqual({ prop: 'crime_index', higherIsBetter: false });
    expect(PERCENTILE_METRICS.air).toEqual({ prop: 'air_quality_index', higherIsBetter: false });
  });
  it('marks tree canopy, education and employment as higher-is-better', () => {
    expect(PERCENTILE_METRICS.treeCanopy).toEqual({ prop: 'tree_canopy_pct', higherIsBetter: true });
    expect(PERCENTILE_METRICS.education).toEqual({ prop: 'higher_education_rate', higherIsBetter: true });
    expect(PERCENTILE_METRICS.employment).toEqual({ prop: 'employment_rate', higherIsBetter: true });
  });
});

describe('percentileRanks — computeNeighbourhoodPercentiles', () => {
  const national = [
    feat({ quality_index: 50, hr_mtu: 22000, transit_reachability_score: 20, crime_index: 90, air_quality_index: 80, tree_canopy_pct: 10, higher_education_rate: 20, employment_rate: 55 }),
    feat({ quality_index: 60, hr_mtu: 24000, transit_reachability_score: 30, crime_index: 70, air_quality_index: 70, tree_canopy_pct: 20, higher_education_rate: 30, employment_rate: 60 }),
    feat({ quality_index: 70, hr_mtu: 26000, transit_reachability_score: 40, crime_index: 50, air_quality_index: 60, tree_canopy_pct: 30, higher_education_rate: 40, employment_rate: 65 }),
    feat({ quality_index: 80, hr_mtu: 28000, transit_reachability_score: 50, crime_index: 30, air_quality_index: 50, tree_canopy_pct: 40, higher_education_rate: 50, employment_rate: 70 }),
    // An income placeholder that must be excluded from the income distribution.
    feat({ quality_index: 90, hr_mtu: 0, transit_reachability_score: 60, crime_index: 10, air_quality_index: 40, tree_canopy_pct: 50, higher_education_rate: 60, employment_rate: 75 }),
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

  it('ranks lower-is-better metrics (crime, air) from the favourable low end', () => {
    // Lowest crime_index in the cohort (10) — best safety.
    const safest = { crime_index: 10, air_quality_index: 40 };
    const r = computeNeighbourhoodPercentiles(safest, national, regional);
    // crime 10: only itself is <= 10 of 5 → 20th percentile. Lower-is-better, so
    // topPercentile = rank = 20 → "top 20%" for safety.
    expect(r.crime.national).toBe(20);
    expect(r.crime.nationalTop).toBe(20);
    // air 40 is the lowest of 5 → 20th percentile → top 20% for air quality.
    expect(r.air.national).toBe(20);
    expect(r.air.nationalTop).toBe(20);
  });

  it('ranks higher-is-better CF-8 metrics from the favourable top end', () => {
    const greenEducatedEmployed = { tree_canopy_pct: 50, higher_education_rate: 60, employment_rate: 75 };
    const r = computeNeighbourhoodPercentiles(greenEducatedEmployed, national, regional);
    // Each is the top value of 5 → 100th percentile → top 1%.
    expect(r.treeCanopy.national).toBe(100);
    expect(r.treeCanopy.nationalTop).toBe(1);
    expect(r.education.national).toBe(100);
    expect(r.education.nationalTop).toBe(1);
    expect(r.employment.national).toBe(100);
    expect(r.employment.nationalTop).toBe(1);
  });

  it('yields null CF-8 percentiles when those metrics are absent', () => {
    const r = computeNeighbourhoodPercentiles({ quality_index: 70 }, national, regional);
    expect(r.crime.national).toBeNull();
    expect(r.air.national).toBeNull();
    expect(r.treeCanopy.national).toBeNull();
    expect(r.education.national).toBeNull();
    expect(r.employment.national).toBeNull();
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
