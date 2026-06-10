import { describe, it, expect } from 'vitest';
import {
  getPersonaWeights,
  computeQualityCoverage,
  QUALITY_FACTORS,
  QUALITY_DIMENSIONS,
  getFactorDimension,
  type QualityWeights,
} from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

describe('CF-1 Quality Index credibility', () => {
  it('Balanced persona gives each evaluative dimension an equal ~25 share', () => {
    const w = getPersonaWeights('balanced');
    const dimSums: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) {
      const d = getFactorDimension(f.id);
      dimSums[d] = (dimSums[d] ?? 0) + (w[f.id] ?? 0);
    }
    const evaluative = QUALITY_DIMENSIONS.filter((d) => d.defaultWeight !== 0);
    expect(evaluative.length).toBe(4);
    for (const d of evaluative) {
      // Integer-weight rounding can't hit exactly 25 in every dimension; ±2 is honest "equal".
      expect(Math.abs((dimSums[d.id] ?? 0) - 25)).toBeLessThanOrEqual(2);
    }
    // Descriptive dimensions (housing/demographics) stay at zero.
    for (const d of QUALITY_DIMENSIONS.filter((x) => x.defaultWeight === 0)) {
      expect(dimSums[d.id] ?? 0).toBe(0);
    }
  });

  it('computeQualityCoverage audits the live-weighted factors, not the default set', () => {
    const props = { light_pollution: 1, crime_index: 50 } as unknown as NeighborhoodProperties;

    // light_pollution has a zero DEFAULT weight, so the default audit omits it.
    const def = computeQualityCoverage(props);
    const defIds = def.dimensions.flatMap((d) => d.factors).map((f) => f.id);
    expect(defIds).not.toContain('light_pollution');

    // A lens that weights only light_pollution audits exactly that factor.
    const lens: QualityWeights = {};
    for (const f of QUALITY_FACTORS) lens[f.id] = 0;
    lens.light_pollution = 10;
    const cov = computeQualityCoverage(props, lens);
    const ids = cov.dimensions.flatMap((d) => d.factors).map((f) => f.id);
    expect(ids).toContain('light_pollution');
    expect(ids).not.toContain('crime_index'); // weighted 0 under this lens
    expect(cov.total).toBe(1);
  });

  it('computeQualityCoverage without a lens matches the documented default behaviour', () => {
    const props = { crime_index: 50, hr_mtu: 30000 } as unknown as NeighborhoodProperties;
    const a = computeQualityCoverage(props);
    // The default set audits every factor with a non-zero default weight.
    const expectedTotal = QUALITY_FACTORS.filter((f) => f.defaultWeight !== 0).length;
    expect(a.total).toBe(expectedTotal);
  });
});
