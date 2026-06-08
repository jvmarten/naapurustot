import { describe, it, expect } from 'vitest';
import { computeQualityCoverage, FACTOR_THIN_COVERAGE_THRESHOLD } from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

describe('computeQualityCoverage (CF-8)', () => {
  it('counts only factors with data, and dimension sums match the totals', () => {
    const p = { crime_index: 50, hr_mtu: 30000, unemployment_rate: 8 } as unknown as NeighborhoodProperties;
    const cov = computeQualityCoverage(p);
    expect(cov.total).toBeGreaterThan(0);
    // safety (crime), income (hr_mtu) and employment (unemployment) all have data.
    expect(cov.present).toBe(3);
    expect(cov.present).toBeLessThanOrEqual(cov.total);
    expect(cov.dimensions.reduce((s, d) => s + d.present, 0)).toBe(cov.present);
    expect(cov.dimensions.reduce((s, d) => s + d.total, 0)).toBe(cov.total);
  });

  it('treats suppressed income (hr_mtu <= 0) as missing', () => {
    const present = computeQualityCoverage({ hr_mtu: 30000 } as unknown as NeighborhoodProperties).present;
    const suppressed = computeQualityCoverage({ hr_mtu: 0 } as unknown as NeighborhoodProperties).present;
    expect(present).toBe(1);
    expect(suppressed).toBe(0);
  });

  it('reports zero present but a positive total for an all-empty area', () => {
    const cov = computeQualityCoverage({} as unknown as NeighborhoodProperties);
    expect(cov.present).toBe(0);
    expect(cov.total).toBeGreaterThan(0);
  });

  // PO-11: per-factor national coverage so the panel can tell a genuine local gap
  // from a factor that is thin everywhere (e.g. transit ~11%).
  describe('national coverage honesty (PO-11)', () => {
    const transitFactor = (cov: ReturnType<typeof computeQualityCoverage>) =>
      cov.dimensions.flatMap((d) => d.factors).find((f) => f.id === 'transit')!;

    it('annotates the thin transit factor with its real national coverage', () => {
      // The test fixture (__COVERAGE_PCT__ in vitest.config.ts) carries the real
      // measured transit_stop_density coverage of ~10.9%.
      const cov = computeQualityCoverage({} as unknown as NeighborhoodProperties);
      const transit = transitFactor(cov);
      expect(transit.nationalCoveragePct).toBeCloseTo(10.9, 1);
      expect(transit.nationalCoveragePct!).toBeLessThan(FACTOR_THIN_COVERAGE_THRESHOLD);
      expect(transit.nationallyThin).toBe(true);
    });

    it('counts a missing transit factor as thin-nationwide, not a local hole', () => {
      // Area with no transit signal: transit is missing AND sparse everywhere.
      const cov = computeQualityCoverage({ crime_index: 50 } as unknown as NeighborhoodProperties);
      const transit = transitFactor(cov);
      expect(transit.present).toBe(false);
      expect(cov.missingThinNationally).toBeGreaterThanOrEqual(1);
    });

    it('does not count a present transit factor toward thin-nationwide misses', () => {
      const withTransit = computeQualityCoverage(
        { transit_stop_density: 12 } as unknown as NeighborhoodProperties,
      );
      const without = computeQualityCoverage({} as unknown as NeighborhoodProperties);
      expect(transitFactor(withTransit).present).toBe(true);
      // Having local transit data removes transit from the thin-nationwide miss count.
      expect(withTransit.missingThinNationally).toBe(without.missingThinNationally - 1);
    });
  });
});
