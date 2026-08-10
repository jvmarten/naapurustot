/**
 * QW-3: comparison-table honesty.
 *
 * The deepest compare step omitted the flagship quality_index and crowned the most
 * EXPENSIVE finalist "Best" (property_price_sqm was higher-is-better). These pin the
 * neutral-direction treatment and the new rows.
 */
import { describe, it, expect } from 'vitest';
import { findBest, refDeltaOf, STAT_SECTIONS } from '../utils/comparisonStats';
import type { NeighborhoodProperties } from '../utils/metrics';

const area = (pno: string, o: Record<string, number>) =>
  ({ pno, ...o } as unknown as NeighborhoodProperties);

const allStats = STAT_SECTIONS.flatMap((s) => s.stats);
const statFor = (key: string) => allStats.find((s) => s.key === key)!;

describe('findBest (QW-3)', () => {
  const pinned = [area('00100', { property_price_sqm: 9000, crime_index: 90 }), area('00200', { property_price_sqm: 3000, crime_index: 10 })];

  it('returns null for a neutral (null) direction — no area is crowned "Best"', () => {
    expect(findBest(pinned, 'property_price_sqm', null)).toBeNull();
  });

  it('picks the lowest for a lower-is-better metric', () => {
    expect(findBest(pinned, 'crime_index', false)).toBe('00200');
  });

  it('picks the highest for a higher-is-better metric', () => {
    expect(findBest(pinned, 'property_price_sqm', true)).toBe('00100');
  });
});

describe('refDeltaOf (QW-3)', () => {
  it('stays neutral-coloured for a null-direction metric', () => {
    const d = refDeltaOf(9000, 6000, null);
    expect(d?.text).toBe('+50%');
    expect(d?.cls).toMatch(/surface-400/);
  });

  it('colours a higher-is-better gain green and a loss red', () => {
    expect(refDeltaOf(7000, 6000, true)?.cls).toMatch(/emerald/);
    expect(refDeltaOf(5000, 6000, true)?.cls).toMatch(/rose/);
  });

  it('inverts colouring for a lower-is-better metric', () => {
    expect(refDeltaOf(8, 10, false)?.cls).toMatch(/emerald/); // lower crime = better
    expect(refDeltaOf(12, 10, false)?.cls).toMatch(/rose/);
  });
});

describe('STAT_SECTIONS (QW-3)', () => {
  it('includes the flagship quality_index row', () => {
    expect(allStats.some((s) => s.key === 'quality_index')).toBe(true);
  });

  it('adds crime and walkability rows', () => {
    expect(allStats.some((s) => s.key === 'crime_index')).toBe(true);
    expect(allStats.some((s) => s.key === 'walkability_index')).toBe(true);
  });

  it('marks price, foreign-language share and the ownership/rental complement as neutral', () => {
    expect(statFor('property_price_sqm').higherIsBetter).toBeNull();
    expect(statFor('foreign_language_est_pct').higherIsBetter).toBeNull();
    expect(statFor('ownership_rate').higherIsBetter).toBeNull();
    expect(statFor('rental_rate').higherIsBetter).toBeNull();
  });
});
