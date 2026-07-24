/**
 * CF-2: tests for the plain-language area summary.
 *
 * Verifies the structured strengths/weaknesses are direction-aware (high raw value
 * is a strength for income but a weakness for crime), that sparse cohorts are not
 * ranked, and that sentence composition templates real percentiles into terse,
 * resolvable copy shared by the panel and the prerenderer.
 */
import { describe, it, expect } from 'vitest';
import {
  computeAreaSummary,
  composeSummarySentences,
  renderSummarySentences,
  fillTemplate,
  SUMMARY_METRICS,
  type AreaSummary,
} from '../utils/areaSummary';

/** Build a cohort of N areas with linearly spaced values for a set of props. */
function cohort(n: number, props: Record<string, (i: number) => number>): Array<{ properties: Record<string, number> }> {
  return Array.from({ length: n }, (_, i) => {
    const p: Record<string, number> = {};
    for (const [k, fn] of Object.entries(props)) p[k] = fn(i);
    return { properties: p };
  });
}

describe('computeAreaSummary', () => {
  it('flags a high-income, low-crime area as strong on both (direction-aware)', () => {
    // Income ramps 20000..29900 (higher better); crime ramps 1..100 (lower better).
    const sources = cohort(100, {
      hr_mtu: (i) => 20000 + i * 100,
      crime_index: (i) => i + 1,
    });
    // The richest, safest area: top income, lowest crime.
    const props = { hr_mtu: 29900, crime_index: 1 };
    const { strong, weak } = computeAreaSummary(props, sources);

    const strongProps = strong.map((e) => e.prop);
    expect(strongProps).toContain('hr_mtu');
    expect(strongProps).toContain('crime_index');
    expect(weak).toHaveLength(0);
    // Best standing → topPct is small (top few %).
    expect(strong[0].topPct).toBeLessThanOrEqual(5);
  });

  it('flags the poorest, most crime-ridden area as weak on both', () => {
    const sources = cohort(100, {
      hr_mtu: (i) => 20000 + i * 100,
      crime_index: (i) => i + 1,
    });
    const props = { hr_mtu: 20000, crime_index: 100 };
    const { strong, weak } = computeAreaSummary(props, sources);
    const weakProps = weak.map((e) => e.prop);
    expect(weakProps).toContain('hr_mtu');
    expect(weakProps).toContain('crime_index');
    expect(strong).toHaveLength(0);
  });

  it('does not rank when the cohort is below the minimum sample size', () => {
    const sources = cohort(5, { hr_mtu: (i) => 20000 + i * 1000 });
    const props = { hr_mtu: 24000 };
    const { strong, weak } = computeAreaSummary(props, sources);
    expect(strong).toHaveLength(0);
    expect(weak).toHaveLength(0);
  });

  it('ignores missing and non-positive income placeholders', () => {
    const sources = cohort(50, { hr_mtu: (i) => 20000 + i * 100 });
    // Area has no income value at all → income contributes nothing.
    const props = { crime_index: 1 };
    const { strong, weak } = computeAreaSummary(props, sources);
    expect(strong.find((e) => e.prop === 'hr_mtu')).toBeUndefined();
    expect(weak.find((e) => e.prop === 'hr_mtu')).toBeUndefined();
  });

  it('treats a high property price as a weakness with the expensive kind', () => {
    const sources = cohort(50, { property_price_sqm: (i) => 2000 + i * 100 });
    const props = { property_price_sqm: 6900 }; // most expensive in cohort
    const { weak } = computeAreaSummary(props, sources);
    const entry = weak.find((e) => e.prop === 'property_price_sqm');
    expect(entry).toBeDefined();
    expect(entry?.weakKind).toBe('expensive');
    // The most-expensive area: small bottomPct ("most expensive ~2%"), large topPct.
    expect(entry?.bottomPct).toBeLessThanOrEqual(5);
    expect(entry?.topPct).toBeGreaterThanOrEqual(95);
  });

  it('sorts strengths best-first and weaknesses worst-first', () => {
    // quality_index excellent, education middling-good, both strengths but quality stronger.
    const sources = cohort(100, {
      quality_index: (i) => i,
      higher_education_rate: (i) => i,
    });
    const props = { quality_index: 99, higher_education_rate: 80 };
    const { strong } = computeAreaSummary(props, sources);
    // Quality (topPct ~1) should precede education (topPct ~20).
    expect(strong[0].prop).toBe('quality_index');
    expect(strong[0].topPct).toBeLessThanOrEqual(strong[strong.length - 1].topPct);
  });

  it('CF-2: ranks against the national ladder when supplied, ignoring the sources cohort', () => {
    const ladder = Array.from({ length: 101 }, (_, i) => 1 + (i / 100) * 99); // p0=1 .. p100=100
    const props = { crime_index: 5 };
    // Empty sources — a result here proves the ranking came from the ladder, not the cohort.
    const { strong } = computeAreaSummary(props, [], {
      nationalLadders: { crime_index: { ladder, n: 3000 } },
    });
    expect(strong.map((e) => e.prop)).toContain('crime_index');
    // crime is lower-is-better; value 5 near the bottom of 1..100 → a top-few-% standing.
    expect(strong.find((e) => e.prop === 'crime_index')!.topPct).toBeLessThanOrEqual(10);
  });

  it('CF-2: skips a metric whose national ladder is below the coverage floor', () => {
    const ladder = Array.from({ length: 101 }, (_, i) => i); // 0..100
    const props = { transit_reachability_score: 95 };
    const { strong, weak } = computeAreaSummary(props, [], {
      nationalLadders: { transit_reachability_score: { ladder, n: 183 } },
      minNationalN: 500,
    });
    expect(strong.find((e) => e.prop === 'transit_reachability_score')).toBeUndefined();
    expect(weak.find((e) => e.prop === 'transit_reachability_score')).toBeUndefined();
  });

  it('CF-2: a tiny-population area makes no national standing claim', () => {
    const ladder = Array.from({ length: 101 }, (_, i) => i);
    const props = { crime_index: 0, he_vakiy: 40 };
    const { strong, weak } = computeAreaSummary(props, [], {
      nationalLadders: { crime_index: { ladder, n: 3000 } },
      population: 40,
      minPopulation: 200,
    });
    expect(strong).toHaveLength(0);
    expect(weak).toHaveLength(0);
  });
});

describe('composeSummarySentences', () => {
  const label = (k: string) => ({
    'layer.median_income': 'median income',
    'layer.transit_reachability': 'transit',
    'layer.air_quality': 'air quality',
    'layer.crime_rate': 'crime',
    'layer.property_price': 'housing',
  }[k] ?? k);

  const summary: AreaSummary = {
    strong: [
      { prop: 'hr_mtu', labelKey: 'layer.median_income', higherIsBetter: true, topPct: 8, bottomPct: 92 },
      { prop: 'transit_reachability_score', labelKey: 'layer.transit_reachability', higherIsBetter: true, topPct: 12, bottomPct: 88 },
    ],
    weak: [
      { prop: 'air_quality_index', labelKey: 'layer.air_quality', higherIsBetter: false, topPct: 90, bottomPct: 10 },
      { prop: 'property_price_sqm', labelKey: 'layer.property_price', higherIsBetter: false, topPct: 85, bottomPct: 15, weakKind: 'expensive' },
    ],
  };

  it('emits a strong sentence using the leading top-percentile and joined labels', () => {
    const specs = composeSummarySentences(summary, { label, and: 'and' });
    const top = specs.find((s) => s.key === 'summary.sentence.top');
    expect(top).toBeDefined();
    expect(top?.tokens.pct).toBe('8');
    expect(top?.tokens.metrics).toBe('median income and transit');
  });

  it('uses the bottom-percentile (not top) for the weak sentence', () => {
    const specs = composeSummarySentences(summary, { label, and: 'and' });
    const bottom = specs.find((s) => s.key === 'summary.sentence.bottom');
    // air quality bottomPct is 10 → "weakest 10%", never the favourable 90.
    expect(bottom?.tokens.pct).toBe('10');
  });

  it('splits housing cost into its own expensive clause using its bottom-percentile', () => {
    const specs = composeSummarySentences(summary, { label, and: 'and' });
    const bottom = specs.find((s) => s.key === 'summary.sentence.bottom');
    const expensive = specs.find((s) => s.key === 'summary.sentence.expensive');
    expect(bottom?.tokens.metrics).toBe('air quality'); // housing excluded
    expect(expensive?.tokens.pct).toBe('15');
  });

  it('returns nothing when there is no notable signal', () => {
    const specs = composeSummarySentences({ strong: [], weak: [] }, { label, and: 'and' });
    expect(specs).toHaveLength(0);
  });

  it('PO-1: uses the national templates by default', () => {
    const specs = composeSummarySentences(summary, { label, and: 'and' });
    expect(specs.some((s) => s.key === 'summary.sentence.top')).toBe(true);
    expect(specs.every((s) => !s.key.endsWith('_region'))).toBe(true);
    expect(specs.every((s) => s.tokens.region === undefined)).toBe(true);
  });

  it('PO-1: switches to the region templates + region token when scope=region', () => {
    const specs = composeSummarySentences(summary, { label, and: 'and', scope: 'region', region: 'Helsingin seutu' });
    const top = specs.find((s) => s.key === 'summary.sentence.top_region');
    expect(top?.tokens.region).toBe('Helsingin seutu');
    expect(specs.find((s) => s.key === 'summary.sentence.bottom_region')).toBeDefined();
    expect(specs.find((s) => s.key === 'summary.sentence.expensive_region')?.tokens.region).toBe('Helsingin seutu');
    // No national-template specs leak through.
    expect(specs.every((s) => s.key.endsWith('_region'))).toBe(true);
  });

  it('PO-1: stays national when scope=region but no region name is supplied', () => {
    const specs = composeSummarySentences(summary, { label, and: 'and', scope: 'region', region: '' });
    expect(specs.some((s) => s.key === 'summary.sentence.top')).toBe(true);
    expect(specs.every((s) => !s.key.endsWith('_region'))).toBe(true);
  });

  it('renders finished strings via injected templates', () => {
    const tpl = (k: string) => ({
      'summary.sentence.top': 'Top {pct}% nationally for {metrics}',
      'summary.sentence.bottom': 'Among the weakest {pct}% for {metrics}',
      'summary.sentence.expensive': 'Among the most expensive {pct}%',
    }[k] ?? k);
    const rendered = renderSummarySentences(summary, { label, and: 'and', tpl });
    expect(rendered[0]).toBe('Top 8% nationally for median income and transit');
    expect(rendered).toContain('Among the most expensive 15%');
  });
});

describe('fillTemplate', () => {
  it('substitutes known tokens and leaves unknown ones intact', () => {
    expect(fillTemplate('Top {pct}% for {metrics}', { pct: '5', metrics: 'x' })).toBe('Top 5% for x');
    expect(fillTemplate('{missing}', {})).toBe('{missing}');
  });
});

describe('SUMMARY_METRICS', () => {
  it('every metric has a non-empty label key and explicit direction', () => {
    for (const m of SUMMARY_METRICS) {
      expect(m.prop).toBeTruthy();
      expect(m.labelKey.startsWith('layer.')).toBe(true);
      expect(typeof m.higherIsBetter).toBe('boolean');
    }
  });
});
