import { describe, it, expect, beforeAll } from 'vitest';
import regionProps from '../data/region_properties.json';
import { computeQualityIndices, getQualityCategory, getQualityCategories, QUALITY_CATEGORIES } from '../utils/qualityIndex';
import { midrankPercentileSorted, percentileRankSorted } from '../utils/percentileRanks';
import { getLayerById, getInterpolatedColor } from '../utils/colorScales';

/**
 * CF-15. The displayed quality score is a PERCENTILE, so that the number, the verdict
 * word, the strip position and the colour are all the same 0–100 quantity.
 *
 * They used to be three different scales: an absolute composite for the number, cohort
 * quintiles for the word, and a 0–100 ramp for the colour. Re-weighting moved one and not
 * the others, which is how "Excellent" could render yellow and how a one-point change
 * flipped a whole band.
 */

type Feat = { type: 'Feature'; geometry: null; properties: Record<string, unknown> };

let feats: Feat[];

beforeAll(() => {
  const { keys, cols } = regionProps as unknown as { keys: string[]; cols: unknown[][] };
  feats = [];
  for (let i = 0; i < cols[0].length; i++) {
    const p: Record<string, unknown> = {};
    keys.forEach((k, j) => { p[k] = cols[j][i]; });
    feats.push({ type: 'Feature', geometry: null, properties: p });
  }
  computeQualityIndices(feats as never);
});

const pcts = () => feats.map((f) => f.properties.quality_percentile as number | null)
  .filter((v): v is number => v != null);

describe('midrankPercentileSorted', () => {
  it('centres a tied block instead of crediting it with the whole block', () => {
    const sorted = [1, 2, 2, 2, 3];
    // Three of five observations are 2, sitting above one and below one.
    expect(midrankPercentileSorted(sorted, 2)).toBe(50);
    // The weak convention credits the whole block, pushing it to the top of the ties.
    expect(percentileRankSorted(sorted, 2)).toBe(80);
  });

  it('spans the ends and handles empties', () => {
    const sorted = [10, 20, 30, 40];
    expect(midrankPercentileSorted(sorted, 10)).toBeLessThan(50);
    expect(midrankPercentileSorted(sorted, 40)).toBeGreaterThan(50);
    expect(midrankPercentileSorted([], 5)).toBeNull();
    expect(midrankPercentileSorted(sorted, NaN)).toBeNull();
  });
});

describe('the national cohort', () => {
  it('scores every area and ranks every scored area', () => {
    const scored = feats.filter((f) => f.properties.quality_index != null);
    expect(scored.length).toBe(3018);
    expect(pcts().length).toBe(scored.length);
  });

  it('uses the whole 0–100 range, which the raw composite cannot', () => {
    const raw = feats.map((f) => f.properties.quality_index as number).filter(Number.isFinite);
    // The composite is stuck in the middle third — this is the reason for ranking.
    expect(Math.min(...raw)).toBeGreaterThan(30);
    expect(Math.max(...raw)).toBeLessThan(75);
    // The percentile is not.
    expect(Math.min(...pcts())).toBeLessThanOrEqual(2);
    expect(Math.max(...pcts())).toBeGreaterThanOrEqual(98);
  });

  it('fills each fixed band with roughly its fifth of the country', () => {
    const counts = [0, 0, 0, 0, 0];
    pcts().forEach((p) => { counts[Math.min(4, Math.floor(p / 20))]++; });
    const shares = counts.map((c) => (c / pcts().length) * 100);
    for (const [i, share] of shares.entries()) {
      expect(share, `band ${i} share ${share.toFixed(1)}%`).toBeGreaterThan(12);
      expect(share, `band ${i} share ${share.toFixed(1)}%`).toBeLessThan(30);
    }
    // Fixed bands over the RAW composite put 94.9 % of Finland in one band.
    const rawCounts = [0, 0, 0, 0, 0];
    feats.forEach((f) => {
      const v = f.properties.quality_index as number | null;
      if (v != null) rawCounts[Math.min(4, Math.floor(v / 20))]++;
    });
    expect(Math.max(...rawCounts) / 3018).toBeGreaterThan(0.9);
  });
});

describe('number, verdict and colour are one scale', () => {
  const QI = getLayerById('quality_index');

  it('paints the percentile, not the composite', () => {
    expect(QI.property).toBe('quality_percentile');
  });

  it('uses the plain fixed fifths again', () => {
    expect(getQualityCategories()).toEqual(QUALITY_CATEGORIES);
    expect(getQualityCategory(85)?.label.en).toBe('Excellent');
    expect(getQualityCategory(85)?.min).toBe(80);
    expect(getQualityCategory(45)?.label.en).toBe('Okay');
  });

  it('keeps every verdict in its own fifth of the ramp', () => {
    const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    for (let p = 0; p <= 100; p++) {
      const label = getQualityCategory(p)?.label.en;
      const [r, g] = rgb(getInterpolatedColor(QI, p));
      if (label === 'Excellent') expect(g, `p=${p}`).toBeGreaterThan(r);
      if (label === 'Bad') expect(r, `p=${p}`).toBeGreaterThan(g);
    }
  });

  it('has no cliff: one percentile point never jumps the hue', () => {
    const dist = (a: string, b: string) => {
      const p = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      const [r1, g1, b1] = p(a); const [r2, g2, b2] = p(b);
      return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
    };
    for (let p = 0; p < 100; p++) {
      expect(dist(getInterpolatedColor(QI, p), getInterpolatedColor(QI, p + 1)), `p=${p}`).toBeLessThan(20);
    }
  });
});
