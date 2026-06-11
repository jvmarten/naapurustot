/**
 * PO-2: per-layer coverage helpers.
 *
 * coverage_pct is computed by the data pipeline (scripts/build_region_data.mjs)
 * into build_metadata.json and inlined at build time via the `__COVERAGE_PCT__`
 * Vite define. These tests run against the small real slice mirrored into
 * vitest.config.ts's define, verifying the read/threshold/format plumbing that
 * backs the sources-page column, the legend caption, and the low-coverage banner.
 */
import { describe, it, expect } from 'vitest';
import {
  getCoveragePct,
  isPartialCoverage,
  isLowCoverage,
  formatCoveragePct,
  PARTIAL_COVERAGE_THRESHOLD,
  LOW_COVERAGE_THRESHOLD,
} from '../utils/metrics';

describe('getCoveragePct', () => {
  it('returns the real coverage for a metric present in the map', () => {
    expect(getCoveragePct('quality_index')).toBe(100);
    expect(getCoveragePct('transit_stop_density')).toBe(100); // CF-17: now nationwide
    expect(getCoveragePct('property_price_sqm')).toBe(36.3);
  });

  it('returns null for a metric absent from the coverage map', () => {
    expect(getCoveragePct('totally_made_up_property')).toBeNull();
  });
});

describe('isPartialCoverage', () => {
  it('flags sparse layers below the partial threshold', () => {
    expect(isPartialCoverage('school_quality_score')).toBe(true); // 10.3
    expect(isPartialCoverage('property_price_sqm')).toBe(true); // 36.3
  });

  it('does not flag near-complete or full layers', () => {
    expect(isPartialCoverage('hr_mtu')).toBe(false); // 97.5
    expect(isPartialCoverage('quality_index')).toBe(false); // 100
    expect(isPartialCoverage('transit_stop_density')).toBe(false); // CF-17: 100
  });

  it('does not flag a metric with no coverage value', () => {
    expect(isPartialCoverage('totally_made_up_property')).toBe(false);
  });
});

describe('isLowCoverage', () => {
  it('flags only genuinely sparse layers (below the low threshold)', () => {
    expect(isLowCoverage('school_quality_score')).toBe(true); // 10.3
    expect(isLowCoverage('rental_price_sqm')).toBe(true); // 18.2
    expect(isLowCoverage('property_price_sqm')).toBe(true); // 36.3
  });

  it('does not flag partial-but-broad or full layers', () => {
    expect(isLowCoverage('hr_mtu')).toBe(false); // 97.5
    expect(isLowCoverage('quality_index')).toBe(false); // 100
  });
});

describe('thresholds', () => {
  it('low threshold is stricter than the partial threshold', () => {
    expect(LOW_COVERAGE_THRESHOLD).toBeLessThan(PARTIAL_COVERAGE_THRESHOLD);
  });
});

describe('formatCoveragePct', () => {
  it('renders whole numbers without a decimal', () => {
    expect(formatCoveragePct(100)).toBe('100');
    expect(formatCoveragePct(87)).toBe('87');
  });

  it('renders fractional values with one decimal', () => {
    expect(formatCoveragePct(10.9)).toBe('10.9');
    expect(formatCoveragePct(30.3)).toBe('30.3');
  });
});
