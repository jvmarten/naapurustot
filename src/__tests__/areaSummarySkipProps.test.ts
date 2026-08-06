import { describe, it, expect } from 'vitest';
import { computeAreaSummary, SUMMARY_METRICS } from '../utils/areaSummary';

/**
 * The national quality_index ladder is built once with the DEFAULT weights
 * (scripts/build_national_ranges.mjs passes no weights), but App recomputes
 * props.quality_index in place from the user's live weights and renormalizes it
 * within-region under the 'region' comparison scope. Ranking one against the other
 * inverted strength and weakness for most areas — with the shipped "Lapsiperhe"
 * preset, 1,373 of 1,822 "weakness" chips were on areas not in the bottom quartile
 * at all. skipProps drops the metric instead of publishing that.
 */

/** A ladder that makes a mid-range value look like a strong national standing. */
function ladder(n = 3018): { ladder: number[]; n: number } {
  return { ladder: Array.from({ length: 101 }, (_, i) => i), n };
}

const props = {
  pno: '00100',
  he_vakiy: 5000,
  quality_index: 95,
  hr_mtu: 30000,
};

const ladders = {
  quality_index: ladder(),
  hr_mtu: ladder(),
};

describe('computeAreaSummary — skipProps', () => {
  it('quality_index is a summary metric, so the guard has something to drop', () => {
    expect(SUMMARY_METRICS.some((m) => m.prop === 'quality_index')).toBe(true);
  });

  it('ranks quality_index normally when no skip is requested', () => {
    const s = computeAreaSummary(props, [], { nationalLadders: ladders });
    const all = [...s.strong, ...s.weak].map((e) => e.prop);
    expect(all).toContain('quality_index');
  });

  it('drops quality_index when the caller says the value is incommensurable', () => {
    const s = computeAreaSummary(props, [], {
      nationalLadders: ladders,
      skipProps: ['quality_index'],
    });
    const all = [...s.strong, ...s.weak].map((e) => e.prop);
    expect(all).not.toContain('quality_index');
    // Every other metric is a raw, unmutated source value and must survive.
    expect(all).toContain('hr_mtu');
  });

  it('does not fabricate a rank for a skipped metric in either bucket', () => {
    const weakProps = { ...props, quality_index: 3 };
    const s = computeAreaSummary(weakProps, [], {
      nationalLadders: ladders,
      skipProps: ['quality_index'],
    });
    expect(s.weak.map((e) => e.prop)).not.toContain('quality_index');
    expect(s.strong.map((e) => e.prop)).not.toContain('quality_index');
  });

  it('defaults to skipping nothing, so the prerenderer is unaffected', () => {
    const withOpts = computeAreaSummary(props, [], { nationalLadders: ladders });
    const withEmpty = computeAreaSummary(props, [], { nationalLadders: ladders, skipProps: [] });
    expect(withEmpty).toEqual(withOpts);
  });
});
