/**
 * QW-2: direction- and percentile-aware "Best match" scoring.
 *
 * The old FilterPanel ranking normalized raw values against the stored bounds —
 * which are 0–100 percentile ranks in percentile mode (so that term dominated the
 * sort) — and always rewarded higher values, so a safety/noise filter surfaced the
 * WORST areas first under the "Best match" label. bestMatchScore fixes both.
 */
import { describe, it, expect } from 'vitest';
import { bestMatchScore, type ScoredCriterion } from '../utils/filterUtils';
import type { NeighborhoodProperties } from '../utils/metrics';

const props = (o: Record<string, number>) => o as unknown as NeighborhoodProperties;

describe('bestMatchScore (QW-2)', () => {
  it('rewards higher values for higher-is-better metrics', () => {
    const c: ScoredCriterion[] = [{ property: 'hr_mtu', valueMin: 20000, valueMax: 40000, higherIsBetter: true }];
    const rich = bestMatchScore(props({ hr_mtu: 38000 }), c);
    const poor = bestMatchScore(props({ hr_mtu: 22000 }), c);
    expect(rich).toBeGreaterThan(poor);
    expect(rich).toBeCloseTo(0.9, 5);
    expect(poor).toBeCloseTo(0.1, 5);
  });

  it('rewards LOWER values for lower-is-better metrics (the core bug)', () => {
    const c: ScoredCriterion[] = [{ property: 'crime_index', valueMin: 0, valueMax: 100, higherIsBetter: false }];
    const safe = bestMatchScore(props({ crime_index: 10 }), c);
    const dangerous = bestMatchScore(props({ crime_index: 90 }), c);
    // Safer (lower crime) must rank higher — previously it ranked LAST.
    expect(safe).toBeGreaterThan(dangerous);
    expect(safe).toBeCloseTo(0.9, 5);
    expect(dangerous).toBeCloseTo(0.1, 5);
  });

  it('clamps out-of-bounds (at-rail outlier) values into [0,1]', () => {
    const c: ScoredCriterion[] = [{ property: 'hr_mtu', valueMin: 20000, valueMax: 40000, higherIsBetter: true }];
    expect(bestMatchScore(props({ hr_mtu: 80000 }), c)).toBe(1);
    expect(bestMatchScore(props({ hr_mtu: 5000 }), c)).toBe(0);
  });

  it('treats a zero-width range as a full match', () => {
    const c: ScoredCriterion[] = [{ property: 'hr_mtu', valueMin: 30000, valueMax: 30000, higherIsBetter: true }];
    expect(bestMatchScore(props({ hr_mtu: 30000 }), c)).toBe(1);
  });

  it('averages over scored criteria and skips non-numeric / missing values', () => {
    const c: ScoredCriterion[] = [
      { property: 'hr_mtu', valueMin: 0, valueMax: 100, higherIsBetter: true }, // value 100 → 1
      { property: 'crime_index', valueMin: 0, valueMax: 100, higherIsBetter: false }, // value 0 → 1
    ];
    expect(bestMatchScore(props({ hr_mtu: 100, crime_index: 0 }), c)).toBe(1);
    // Missing crime_index → only the income term counts (mean over 1 scored criterion).
    expect(bestMatchScore(props({ hr_mtu: 100 }), c)).toBe(1);
    // No scorable criteria → 0, never NaN.
    expect(bestMatchScore(props({}), c)).toBe(0);
  });

  it('does not let a percentile-mode criterion explode the score (resolved bounds are concrete)', () => {
    // After resolveCriterionBounds, bounds are concrete values, so a percentile criterion
    // contributes a normal 0–1 term rather than (raw_value - 0)/(100 - 0) in the hundreds.
    const c: ScoredCriterion[] = [{ property: 'property_price_sqm', valueMin: 3000, valueMax: 9000, higherIsBetter: true }];
    const s = bestMatchScore(props({ property_price_sqm: 6000 }), c);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeCloseTo(0.5, 5);
  });
});
