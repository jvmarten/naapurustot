import { describe, it, expect } from 'vitest';
import { computeQualityCoverage, FACTOR_THIN_COVERAGE_THRESHOLD, getDefaultWeights } from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

describe('computeQualityCoverage (CF-8)', () => {
  it('counts only factors with data, and dimension sums match the totals', () => {
    const p = { violent_crime_rate: 50, hr_mtu: 30000, unemployment_rate: 8 } as unknown as NeighborhoodProperties;
    const cov = computeQualityCoverage(p);
    expect(cov.total).toBeGreaterThan(0);
    // safety (violent crime), income (hr_mtu) and employment (unemployment) all have
    // data. Safety reads violent_crime_rate, not crime_index — the latter is now the
    // opt-in total_crime factor (defaultWeight 0), which the default lens excludes.
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
  // from a factor that is thin everywhere. Transit used to be the canonical thin
  // factor (~11%) but is nationwide as of CF-17 (Digiroad); school_quality
  // (~10.3% coverage) is now the thin exemplar.
  describe('national coverage honesty (PO-11)', () => {
    const factorById = (cov: ReturnType<typeof computeQualityCoverage>, id: string) =>
      cov.dimensions.flatMap((d) => d.factors).find((f) => f.id === id)!;

    it('marks the now-nationwide transit factor as well-covered (CF-17)', () => {
      // The fixture (__COVERAGE_PCT__ in vitest.config.ts) carries the real, post
      // CF-17 transit_stop_density coverage of 100%.
      const cov = computeQualityCoverage({} as unknown as NeighborhoodProperties);
      const transit = factorById(cov, 'transit');
      expect(transit.nationalCoveragePct).toBeCloseTo(100, 1);
      expect(transit.nationallyThin).toBe(false);
    });

    // school_quality is zero-weighted by default; activate it via a custom lens so
    // the thin-coverage annotation (it is ~10.3% nationally) is exercised.
    const withSchoolWeight = (): Record<string, number> => ({ ...getDefaultWeights(), school_quality: 50 });

    it('annotates the thin school_quality factor with its real national coverage', () => {
      const cov = computeQualityCoverage({} as unknown as NeighborhoodProperties, withSchoolWeight());
      const school = factorById(cov, 'school_quality');
      expect(school.nationalCoveragePct).toBeCloseTo(10.3, 1);
      expect(school.nationalCoveragePct!).toBeLessThan(FACTOR_THIN_COVERAGE_THRESHOLD);
      expect(school.nationallyThin).toBe(true);
    });

    it('counts a missing thin factor as thin-nationwide, not a local hole', () => {
      // Area with no school-quality signal: missing AND sparse everywhere.
      const cov = computeQualityCoverage({ violent_crime_rate: 50 } as unknown as NeighborhoodProperties, withSchoolWeight());
      const school = factorById(cov, 'school_quality');
      expect(school.present).toBe(false);
      expect(cov.missingThinNationally).toBeGreaterThanOrEqual(1);
    });

    it('does not count a present thin factor toward thin-nationwide misses', () => {
      const w = withSchoolWeight();
      const withSchool = computeQualityCoverage(
        { school_quality_score: 7.5 } as unknown as NeighborhoodProperties, w,
      );
      const without = computeQualityCoverage({} as unknown as NeighborhoodProperties, w);
      expect(factorById(withSchool, 'school_quality').present).toBe(true);
      // Having local school data removes it from the thin-nationwide miss count.
      expect(withSchool.missingThinNationally).toBe(without.missingThinNationally - 1);
    });
  });
});
