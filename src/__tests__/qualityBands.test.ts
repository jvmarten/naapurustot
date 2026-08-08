import { describe, it, expect, beforeEach } from 'vitest';
import {
  setQualityCohort, getQualityBands, bandsAreDegenerate, clearQualityCohort,
} from '../utils/qualityBands';
import {
  getQualityCategory, getQualityCategories, QUALITY_CATEGORIES,
  computeQualityIndices, getDefaultWeights, QUALITY_FACTORS, type QualityWeights,
} from '../utils/qualityIndex';

/**
 * The rule these guard: whatever the user weights, areas must not all be able to
 * land in the top band at once. The composite stays an absolute 0-100 number; it is
 * the five bands that are cut at the cohort's own quantiles.
 */

const cats = () => getQualityCategories();

function mk(pno: string, props: Record<string, number>): GeoJSON.Feature {
  return { type: 'Feature', geometry: null as never, properties: { pno, ...props } };
}

/** Which band index each score falls in, for a cohort already registered. */
function bandOf(score: number): number {
  const c = getQualityCategory(score);
  return cats().findIndex((x) => x.label.en === c?.label.en);
}

beforeEach(() => clearQualityCohort());

describe('qualityBands — cohort quantiles', () => {
  it('falls back to the fixed breakpoints before any cohort is registered', () => {
    expect(getQualityBands()).toBeNull();
    expect(getQualityCategories()).toEqual(QUALITY_CATEGORIES);
    expect(getQualityCategory(85)?.label.en).toBe('Excellent');
  });

  it('falls back for a cohort too small to quantile meaningfully', () => {
    setQualityCohort([40, 41, 42]);
    expect(getQualityCategories()).toEqual(QUALITY_CATEGORIES);
  });

  it('cuts the bands at the cohort quantiles, not at 20/40/60/80', () => {
    // A realistic compressed cohort: the shipped defaults span roughly 23..74.
    const values = Array.from({ length: 300 }, (_, i) => 23 + Math.round((i / 299) * 51));
    setQualityCohort(values);
    const t = getQualityBands()!.thresholds;
    expect(t).toHaveLength(4);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
    // Nothing near 20 or 80 — the fixed cuts would have put everything in one band.
    expect(t[0]).toBeGreaterThan(25);
    expect(t[3]).toBeLessThan(75);
    expect(cats()[4].min).toBe(t[3]);
    expect(cats()[0].min).toBe(0);
    expect(cats()[4].max).toBe(100);
  });

  it('a compressed cohort no longer collapses into a single band', () => {
    const values = Array.from({ length: 300 }, (_, i) => 45 + Math.round((i / 299) * 8));
    setQualityCohort(values);
    const occupied = new Set(values.map(bandOf));
    expect(occupied.size, 'a 45..53 spread should still use several bands').toBeGreaterThan(2);
  });

  it('produces strictly ascending ramp stops even on a heavily tied cohort', () => {
    // 90% identical, the shape that broke a linear rescale.
    const values = [...Array.from({ length: 270 }, () => 100), ...Array.from({ length: 30 }, (_, i) => i)];
    setQualityCohort(values);
    const stops = getQualityBands()!.stops;
    expect(stops).toHaveLength(8);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i], `stop ${i} must exceed stop ${i - 1} for MapLibre interpolate`)
        .toBeGreaterThan(stops[i - 1]);
    }
  });

  it('reports a degenerate scale rather than pretending to spread a tie', () => {
    setQualityCohort(Array.from({ length: 300 }, () => 100));
    expect(bandsAreDegenerate()).toBe(true);
    setQualityCohort(Array.from({ length: 300 }, (_, i) => i % 100));
    expect(bandsAreDegenerate()).toBe(false);
  });
});

describe('qualityBands — the rule: not everything can be excellent at once', () => {
  const zero = (): QualityWeights => {
    const w: QualityWeights = {};
    for (const f of QUALITY_FACTORS) w[f.id] = 0;
    return w;
  };

  // 400 synthetic areas spanning each metric, so a single-factor weighting has a
  // real distribution to be cut against.
  function cohort(): GeoJSON.Feature[] {
    return Array.from({ length: 400 }, (_, i) =>
      mk(String(10000 + i), {
        hr_mtu: 15000 + i * 60,
        // Bunched at one end on purpose: 90% share the top value, like the real
        // water-proximity column where 92.4% read exactly 0 m.
        water_proximity_m: i < 360 ? 0 : 100 + i,
        transit_stop_density: i % 40,
      }));
  }

  function topBandShare(weights: QualityWeights): number {
    const feats = cohort();
    computeQualityIndices(feats, weights);
    const topLabel = cats()[cats().length - 1].label.en;
    const inTop = feats.filter((f) => {
      const qi = (f.properties as { quality_index: number | null }).quality_index;
      return qi != null && getQualityCategory(qi)?.label.en === topLabel;
    }).length;
    return inTop / feats.length;
  }

  it('a well-spread factor does not put most areas in the top band', () => {
    expect(topBandShare({ ...zero(), income: 100 })).toBeLessThan(0.5);
  });

  it('the shipped default weighting does not put most areas in the top band', () => {
    expect(topBandShare(getDefaultWeights())).toBeLessThan(0.5);
  });

  it('even a bunched factor cannot make a majority "Excellent"', () => {
    // Under the fixed 80-100 band this weighting put ~90% of areas in the top
    // category simultaneously — the exact complaint this addresses. A tie still
    // cannot be split, so the guarantee is "not a majority", not "exactly 20%".
    expect(topBandShare({ ...zero(), water_proximity: 100 })).toBeLessThan(0.5);
  });
});
