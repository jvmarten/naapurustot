/**
 * Strengths & weaknesses for Swedish areas: ranked against Sweden's own percentile
 * ladders (src/data/percentiles_se.json), never Finland's.
 */
import { describe, it, expect } from 'vitest';
import regionProps from '../data/region_properties.json';
import fiLadders from '../data/national_percentiles.json';
import seLadders from '../data/percentiles_se.json';
import { decodeColumnar } from '../utils/columnar';
import { countryOfId } from '../utils/areaId';
import { computeAreaSummary, SUMMARY_METRICS } from '../utils/areaSummary';
import type { NationalLadder } from '../utils/nationalRanges';

type Row = Record<string, unknown> & { pno: string; he_vakiy?: number | null };
const rows = decodeColumnar<Row>(regionProps as never);
const se = rows.filter((r) => countryOfId(r.pno) === 'se');
const SE = (seLadders as { metrics: Record<string, NationalLadder>; areaCount: number });
const FI = (fiLadders as { metrics: Record<string, NationalLadder> });

describe('Swedish percentile ladders', () => {
  it('cover every Swedish area and every summary metric Sweden publishes', () => {
    expect(SE.areaCount).toBe(se.length);
    for (const m of SUMMARY_METRICS) {
      const has = se.some((r) => typeof r[m.prop] === 'number');
      if (m.prop === 'quality_index') continue; // derived, not in region_properties
      expect(!!SE.metrics[m.prop], m.prop).toBe(has);
    }
    expect(SE.metrics.quality_index).toBeDefined();
  });

  it('keep Sweden\'s income measure out of Finland\'s ladders and vice versa', () => {
    expect(SE.metrics.economic_standard_median).toBeDefined();
    expect(FI.metrics.economic_standard_median).toBeUndefined();
    expect(SE.metrics.hr_mtu).toBeUndefined();
  });

  it('give a Swedish area a summary ranked within Sweden', () => {
    const top = [...se].filter((r) => typeof r.economic_standard_median === 'number' && (r.he_vakiy ?? 0) > 500)
      .sort((a, b) => (b.economic_standard_median as number) - (a.economic_standard_median as number))[0];
    const s = computeAreaSummary(top, [], { nationalLadders: SE.metrics, population: top.he_vakiy ?? null });
    const income = s.strong.find((e) => e.prop === 'economic_standard_median');
    expect(income?.topPct).toBe(1);
  });
});
