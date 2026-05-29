import { describe, it, expect } from 'vitest';
import { pearson, bestFit } from '../utils/correlation';

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
