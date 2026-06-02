import { describe, it, expect } from 'vitest';
import { computeQualityCoverage } from '../utils/qualityIndex';
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
});
