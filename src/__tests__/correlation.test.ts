import { describe, it, expect } from 'vitest';
import { pearson, bestFit, percentileRank, histogram, binIndexOf } from '../utils/correlation';

describe('percentileRank (QW-1)', () => {
  it('returns the share of values <= the target (0–100)', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileRank(v, 5)).toBe(50);
    expect(percentileRank(v, 10)).toBe(100);
    expect(percentileRank(v, 1)).toBe(10);
  });
  it('returns null for an empty set', () => {
    expect(percentileRank([], 3)).toBeNull();
  });
});

describe('histogram (QW-1)', () => {
  it('bins values into equal-width buckets with the max in the last bin', () => {
    const h = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(h).not.toBeNull();
    expect(h!.bins).toHaveLength(5);
    expect(h!.min).toBe(0);
    expect(h!.max).toBe(10);
    // Every value is counted exactly once.
    expect(h!.bins.reduce((s, b) => s + b.count, 0)).toBe(11);
    // The max (10) lands in the last bin, not a phantom 6th bin.
    expect(h!.bins[4].count).toBeGreaterThan(0);
  });
  it('returns null when all values are identical or empty', () => {
    expect(histogram([5, 5, 5], 4)).toBeNull();
    expect(histogram([], 4)).toBeNull();
  });
});

describe('binIndexOf (QW-1)', () => {
  it('clamps to the last bin for the maximum and to 0 below the minimum', () => {
    expect(binIndexOf(10, 0, 10, 5)).toBe(4);
    expect(binIndexOf(0, 0, 10, 5)).toBe(0);
    expect(binIndexOf(-5, 0, 10, 5)).toBe(0);
    expect(binIndexOf(5, 0, 10, 10)).toBe(5);
  });
  it('returns 0 for a degenerate range', () => {
    expect(binIndexOf(3, 3, 3, 5)).toBe(0);
  });
});

describe('pearson', () => {
  it('returns +1 for a perfect positive linear relationship', () => {
    const pts = [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }, { x: 4, y: 8 }];
    expect(pearson(pts)).toBeCloseTo(1, 6);
  });

  it('returns -1 for a perfect negative linear relationship', () => {
    const pts = [{ x: 1, y: 10 }, { x: 2, y: 8 }, { x: 3, y: 6 }, { x: 4, y: 4 }];
    expect(pearson(pts)).toBeCloseTo(-1, 6);
  });

  it('returns ~0 for an uncorrelated set', () => {
    const pts = [{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }];
    // zero variance on y → null (undefined correlation)
    expect(pearson(pts)).toBeNull();
  });

  it('returns null for fewer than 3 points', () => {
    expect(pearson([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
  });

  it('clamps to [-1, 1]', () => {
    const r = pearson([{ x: 1, y: 1.0001 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }]);
    expect(r).not.toBeNull();
    expect(r!).toBeLessThanOrEqual(1);
    expect(r!).toBeGreaterThanOrEqual(-1);
  });
});

describe('bestFit', () => {
  it('recovers slope and intercept of a clean line', () => {
    // y = 3x + 2
    const pts = [{ x: 0, y: 2 }, { x: 1, y: 5 }, { x: 2, y: 8 }, { x: 3, y: 11 }];
    const fit = bestFit(pts);
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBeCloseTo(3, 6);
    expect(fit!.intercept).toBeCloseTo(2, 6);
  });

  it('returns null when x has zero variance', () => {
    expect(bestFit([{ x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }])).toBeNull();
  });
});
