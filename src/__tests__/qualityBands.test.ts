import { describe, it, expect, beforeEach } from 'vitest';
import {
  setQualityCohort, getQualityCohort, bandsAreDegenerate, clearQualityCohort,
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


beforeEach(() => clearQualityCohort());

describe('qualityBands — cohort statistics', () => {
  it('reports nothing before a cohort is registered', () => {
    expect(getQualityCohort()).toBeNull();
    expect(bandsAreDegenerate()).toBe(false);
  });

  it('records the cohort size and how many distinct scores it holds', () => {
    setQualityCohort([40, 41, 41, 42, Number.NaN]);
    expect(getQualityCohort()).toEqual({ n: 4, distinct: 3 });
  });

  it('leaves the verdict bands at the fixed fifths', () => {
    // CF-15: the bands bin `quality_percentile`, which is uniform on 0–100, so the cuts
    // no longer move with the cohort. They were only ever moved because the raw composite
    // spans 38–67, which put 94.9 % of Finland in one fixed band.
    setQualityCohort(Array.from({ length: 300 }, (_, i) => 23 + Math.round((i / 299) * 51)));
    expect(getQualityCategories()).toEqual(QUALITY_CATEGORIES);
    expect(getQualityCategory(85)?.label.en).toBe('Excellent');
    expect(getQualityCategory(85)?.min).toBe(80);
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
      const p = (f.properties as { quality_percentile?: number | null }).quality_percentile;
      return p != null && getQualityCategory(p)?.label.en === topLabel;
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
