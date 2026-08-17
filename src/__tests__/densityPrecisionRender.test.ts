/**
 * Regression guard: a fine-grained density must never RENDER as zero.
 *
 * The pipeline stores per-km² densities at 4 decimals (prepare_data.POI_DENSITY_DECIMALS)
 * precisely because the median Finnish postal area is 52 km², so one real facility is
 * ~0.019/km² and a 1-decimal value rounds it to exactly 0.0 across three-quarters of the
 * country. That fix was undone at RENDER time: a local `toFixed(1)` in NeighborhoodPanel
 * and copies of it in the export, the wizard's fit reasons, the comparison table, the
 * score card and the prerendered ranking column. Measured against the shipped GeoJSON,
 * 3,169 (area, metric) pairs over the six OSM densities held a real value below 0.05 and
 * printed "0,0 /km²" over an actual measurement.
 *
 * These tests pin the rendered output rather than the implementation, so the guard holds
 * however the formatting is refactored — the one thing that must stay true is that a
 * nonzero measurement never reads as zero.
 */
import { describe, it, expect } from 'vitest';
import { formatFineDensity, formatFineNumber, formatDensity } from '../utils/formatting';
import { ALL_STATS } from '../utils/comparisonStats';

/** Strip locale spacing/unit and normalise the decimal comma so assertions are locale-proof. */
function digits(s: string): string {
  return s.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.').replace('/km²', '');
}

/** The value one real facility produces in a median (52 km²) Finnish postal area. */
const ONE_FACILITY_MEDIAN_AREA = 1 / 52; // 0.01923…

describe('formatFineNumber', () => {
  it('returns the em dash for null and undefined', () => {
    expect(formatFineNumber(null)).toBe('—');
    expect(formatFineNumber(undefined)).toBe('—');
  });

  it('keeps two significant digits below 1 instead of collapsing to zero', () => {
    expect(digits(formatFineNumber(0.0312))).toBe('0.031');
    expect(digits(formatFineNumber(ONE_FACILITY_MEDIAN_AREA))).toBe('0.019');
  });

  it('renders one decimal at and above 1, like the density formatter', () => {
    expect(digits(formatFineNumber(13.84))).toBe('13.8');
    expect(digits(formatFineNumber(1))).toBe('1.0');
  });

  it('renders a true zero as zero — the sub-1 branch is for real values only', () => {
    // Matches formatFineDensity's long-standing "0,0 /km²": a measured absence of
    // facilities is honestly zero, and only a NONZERO value must never read as one.
    expect(digits(formatFineNumber(0))).toBe('0.0');
  });

  it('agrees with formatFineDensity apart from the unit', () => {
    for (const v of [0.0004, 0.019, 0.049, 0.5, 1, 13.84, 237]) {
      expect(digits(formatFineDensity(v))).toBe(digits(formatFineNumber(v)));
    }
  });
});

describe('a real measurement below 0.05/km² never renders as zero', () => {
  // Every value here is a plausible real density: one to a handful of facilities
  // spread over a large rural postal area.
  const realButTiny = [0.0004, 0.0031, 0.0192, 0.0312, 0.0499];

  it('formatFineDensity keeps them nonzero', () => {
    for (const v of realButTiny) {
      expect(digits(formatFineDensity(v))).not.toBe('0');
      expect(digits(formatFineDensity(v))).not.toBe('0.0');
    }
  });

  it('the comparison table keeps them nonzero for every density metric it shows', () => {
    const densityStats = ALL_STATS.filter((s) => s.key.endsWith('_density'));
    // Guard the guard: if the comparison table stops showing densities entirely this
    // test would pass vacuously, which is exactly how the original bug survived.
    expect(densityStats.length).toBeGreaterThan(0);
    for (const stat of densityStats) {
      for (const v of realButTiny) {
        const out = digits(String(stat.format(v)));
        expect(out, `${stat.key} rendered ${v} as "${out}"`).not.toBe('0');
        expect(out, `${stat.key} rendered ${v} as "${out}"`).not.toBe('0.0');
      }
    }
  });
});

describe('formatDensity', () => {
  // The coarse formatter stays coarse at and above 1 — population density in a town is a
  // large number and decimals there are noise. This pins the distinction from
  // formatFineDensity so the two are not merged by mistake.
  it('rounds to whole numbers at and above 1', () => {
    expect(digits(formatDensity(1234.6))).toBe('1235');
    expect(digits(formatDensity(1.4))).toBe('1');
  });

  // ...but sub-1 is real, not absent. Inari Keskus holds 1,194 residents over 3,423 km²
  // — 0.35/km² — and a whole-number round published "0 /km²" for an inhabited area,
  // 177 of them nationally.
  it('keeps a sub-1 density visible instead of printing zero', () => {
    expect(digits(formatDensity(0.35))).toBe('0.35');
    expect(digits(formatDensity(0.22))).toBe('0.22');
    expect(digits(formatDensity(0.049))).not.toBe('0');
  });

  it('still renders a true zero as zero', () => {
    expect(digits(formatDensity(0))).toBe('0');
    expect(formatDensity(null)).toBe('—');
  });
});
