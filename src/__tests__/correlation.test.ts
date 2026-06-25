import { describe, it, expect } from 'vitest';
import {
  pearson, bestFit, percentileRank, histogram, binIndexOf,
  rSquared, significanceHint, groupedBestFit,
} from '../utils/correlation';

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

  it('returns null (never NaN) for zero variance on x', () => {
    // Constant x → undefined correlation. The variance discriminant can round to a
    // tiny negative, whose sqrt is NaN; the result must collapse to null, not NaN.
    const r = pearson([{ x: 7, y: 1 }, { x: 7, y: 9 }, { x: 7, y: 4 }, { x: 7, y: 2 }]);
    expect(r).toBeNull();
    expect(Number.isNaN(r as number)).toBe(false);
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

describe('rSquared (QW-3)', () => {
  it('is 1 for a perfect linear relationship (positive or negative)', () => {
    expect(rSquared([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }, { x: 4, y: 8 }])).toBeCloseTo(1, 6);
    expect(rSquared([{ x: 1, y: 10 }, { x: 2, y: 8 }, { x: 3, y: 6 }, { x: 4, y: 4 }])).toBeCloseTo(1, 6);
  });

  it('equals r² (always non-negative) for an imperfect fit', () => {
    const pts = [{ x: 1, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 6 }];
    const r = pearson(pts)!;
    const r2 = rSquared(pts)!;
    expect(r2).toBeCloseTo(r * r, 10);
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(r2).toBeLessThanOrEqual(1);
  });

  it('returns null when correlation is undefined (zero variance / too few points)', () => {
    expect(rSquared([{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }])).toBeNull();
    expect(rSquared([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
  });
});

describe('significanceHint (QW-3)', () => {
  it('is n-aware: the same modest |r| clears the bar at large n but not at small n', () => {
    // A modest correlation (~0.3) with only a handful of points is not significant…
    const small = [
      { x: 1, y: 1.0 }, { x: 2, y: 0.9 }, { x: 3, y: 1.4 },
      { x: 4, y: 1.1 }, { x: 5, y: 1.6 },
    ];
    expect(significanceHint(small)).toBe('none');

    // …but the same kind of weak-but-consistent trend over many points is.
    const large = Array.from({ length: 200 }, (_, i) => ({ x: i, y: 0.3 * i + (i % 7) * 5 }));
    expect(significanceHint(large)).not.toBe('none');
  });

  it('grades a perfect relationship as strong and an undefined one as none', () => {
    expect(significanceHint([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }, { x: 4, y: 8 }])).toBe('strong');
    expect(significanceHint([{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }])).toBe('none');
    expect(significanceHint([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe('none');
  });
});

describe('groupedBestFit (QW-3)', () => {
  it('fits each group independently and can reveal Simpson\'s paradox', () => {
    // Two clusters each sloping DOWN, but offset so the pooled trend slopes UP.
    type P = { x: number; y: number; g: string };
    const groupA: P[] = [
      { x: 1, y: 10, g: 'a' }, { x: 2, y: 9, g: 'a' }, { x: 3, y: 8, g: 'a' },
    ];
    const groupB: P[] = [
      { x: 6, y: 16, g: 'b' }, { x: 7, y: 15, g: 'b' }, { x: 8, y: 14, g: 'b' },
    ];
    const all = [...groupA, ...groupB];

    // Pooled (global) fit slopes upward…
    expect(bestFit(all)!.slope).toBeGreaterThan(0);

    // …while every per-region fit slopes downward.
    const fits = groupedBestFit(all, (p) => p.g);
    expect(fits.size).toBe(2);
    expect(fits.get('a')!.slope).toBeLessThan(0);
    expect(fits.get('b')!.slope).toBeLessThan(0);
    expect(fits.get('a')!.n).toBe(3);
  });

  it('skips groups below minPoints or with no x-variance', () => {
    const pts = [
      { x: 1, y: 1, g: 'a' }, { x: 2, y: 2, g: 'a' }, { x: 3, y: 3, g: 'a' }, // ok
      { x: 5, y: 9, g: 'b' }, { x: 6, y: 8, g: 'b' },                          // too few
      { x: 4, y: 1, g: 'c' }, { x: 4, y: 2, g: 'c' }, { x: 4, y: 3, g: 'c' },  // zero x-variance
    ];
    const fits = groupedBestFit(pts, (p) => p.g);
    expect(fits.has('a')).toBe(true);
    expect(fits.has('b')).toBe(false);
    expect(fits.has('c')).toBe(false);
  });
});
