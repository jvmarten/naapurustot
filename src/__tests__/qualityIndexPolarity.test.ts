import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import {
  QUALITY_FACTORS, computeQualityIndices, isPreferenceFactor,
  type QualityWeights, type QualityFactor,
} from '../utils/qualityIndex';

/**
 * Guards the factor-polarity model: `invert` reconciles the raw column with the
 * factor's LABEL (a data fact), `polarity` decides whether the user may choose a
 * direction (a product decision). Before the split these were one flag plus an
 * undocumented second one, and they silently cancelled each other out whenever
 * both applied — so the invariants below are the whole point of the refactor.
 */

// Two areas per factor: HI carries the top of every source property, LO the bottom.
// 1 rather than 0 for LO because getFactorScore treats hr_mtu <= 0 as missing.
const HI_RAW = 100;
const LO_RAW = 1;

function mk(pno: string, props: Record<string, number>): Feature {
  return { type: 'Feature', geometry: null as unknown as Feature['geometry'], properties: { pno, ...props } };
}

function featurePair(factor: QualityFactor): [Feature, Feature] {
  const hi: Record<string, number> = {};
  const lo: Record<string, number> = {};
  for (const p of factor.properties) { hi[p as string] = HI_RAW; lo[p as string] = LO_RAW; }
  return [mk('00100', hi), mk('00200', lo)];
}

/** Score the HI area with `factor` as the only active weight. */
function scoreHi(factor: QualityFactor, weight: number): number {
  const [hi, lo] = featurePair(factor);
  const weights: QualityWeights = {};
  for (const f of QUALITY_FACTORS) weights[f.id] = 0;
  weights[factor.id] = weight;
  computeQualityIndices([hi, lo], weights);
  return (hi.properties as { quality_index: number }).quality_index;
}

/**
 * The factors that carried `invert: true` before the polarity split. Under the old
 * single-flag model a positive weight on one of these scored the HIGH-raw area 0.
 * Anything that changes here changes a shipped score, so it must be deliberate.
 */
const LEGACY_INVERTED = new Set([
  'safety', 'property_crime', 'total_crime', 'employment', 'air_quality', 'low_income',
  'traffic_accidents', 'light_pollution', 'noise_pollution', 'water_proximity',
  'health_index', 'radon', 'flood_risk', 'unemployment_change',
]);

/** Fixed-direction factors: hazards, plus utilities whose negative half is incoherent. */
const FIXED_DIRECTION = [
  'safety', 'property_crime', 'total_crime', 'employment', 'air_quality', 'low_income',
  'traffic_accidents', 'light_pollution', 'noise_pollution', 'health_index', 'radon',
  'flood_risk', 'broadband', 'school_quality', 'employment_rate', 'tree_canopy',
  'income_change', 'unemployment_change',
];

describe('factor polarity — model integrity', () => {
  it('every factor declares a polarity, and isPreferenceFactor agrees with it', () => {
    for (const f of QUALITY_FACTORS) {
      expect(['more-is-better', 'less-is-better', 'preference'], `${f.id} polarity`).toContain(f.polarity);
      expect(isPreferenceFactor(f), `${f.id} isPreferenceFactor`).toBe(f.polarity === 'preference');
    }
  });

  it('exactly the hazard/utility factors are fixed-direction; everything else is signed', () => {
    const fixed = QUALITY_FACTORS.filter((f) => f.polarity !== 'preference').map((f) => f.id);
    expect(fixed.sort()).toEqual([...FIXED_DIRECTION].sort());
    expect(QUALITY_FACTORS.filter(isPreferenceFactor)).toHaveLength(QUALITY_FACTORS.length - FIXED_DIRECTION.length);
  });

  it('no fixed-direction factor carries a negative default weight', () => {
    for (const f of QUALITY_FACTORS) {
      if (f.polarity !== 'preference') expect(f.defaultWeight, `${f.id}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('factor polarity — behaviour is unchanged for positive weights', () => {
  // The refactor re-encodes direction across all 61 factors. This is the guard that
  // it re-encoded rather than redirected: every shipped (non-negative) weight must
  // score exactly as it did under the single `invert` flag.
  it.each(QUALITY_FACTORS.map((f) => [f.id, f] as const))(
    '%s scores the same as the legacy invert flag at +100',
    (_id, factor) => {
      expect(scoreHi(factor, 100)).toBe(LEGACY_INVERTED.has(factor.id) ? 0 : 100);
    },
  );
});

describe('factor polarity — fixed-direction factors ignore the sign', () => {
  // A hand-crafted `?qw=radon:-80` passes every validator (they only range-check
  // -100..100), so the compute path itself has to refuse to flip a hazard.
  it.each(FIXED_DIRECTION)('%s scores identically at -100 and +100', (id) => {
    const factor = QUALITY_FACTORS.find((f) => f.id === id)!;
    expect(scoreHi(factor, -100)).toBe(scoreHi(factor, 100));
  });
});

describe('factor polarity — "+" means the same thing on every signed slider', () => {
  it.each(QUALITY_FACTORS.filter(isPreferenceFactor).map((f) => [f.id, f] as const))(
    '%s: +100 favours more of the labelled quantity, -100 favours less',
    (_id, factor) => {
      // The labelled quantity runs with the raw column unless `invert` says otherwise
      // (water_proximity_m is a distance; its label is "proximity").
      const hiHasMoreOfLabel = !factor.invert;
      expect(scoreHi(factor, 100)).toBe(hiHasMoreOfLabel ? 100 : 0);
      expect(scoreHi(factor, -100)).toBe(hiHasMoreOfLabel ? 0 : 100);
    },
  );
});

describe('factor polarity — invert and preference compose (the case that used to cancel)', () => {
  // water_proximity is the only invert:true signed factor, and the exact shape the
  // old model broke on: two flips applied in sequence made the negative half a no-op.
  const factor = QUALITY_FACTORS.find((f) => f.id === 'water_proximity')!;

  it('is invert:true with polarity preference', () => {
    expect(factor.invert).toBe(true);
    expect(factor.polarity).toBe('preference');
  });

  it('+100 prefers being near water (a low distance in metres)', () => {
    const near = mk('00100', { water_proximity_m: 50 });
    const far = mk('00200', { water_proximity_m: 5000 });
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.water_proximity = 100;
    computeQualityIndices([near, far], weights);
    expect((near.properties as { quality_index: number }).quality_index).toBe(100);
    expect((far.properties as { quality_index: number }).quality_index).toBe(0);
  });

  it('-100 prefers being away from water — the half that silently did nothing before', () => {
    const near = mk('00100', { water_proximity_m: 50 });
    const far = mk('00200', { water_proximity_m: 5000 });
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.water_proximity = -100;
    computeQualityIndices([near, far], weights);
    expect((near.properties as { quality_index: number }).quality_index).toBe(0);
    expect((far.properties as { quality_index: number }).quality_index).toBe(100);
  });
});

describe('factor polarity — the newly signed factors', () => {
  // The point of the change: "I want a quiet rural spot" was previously inexpressible.
  it('a negative transit weight ranks the areas with fewest stops highest', () => {
    const urban = mk('00100', { transit_stop_density: 40 });
    const rural = mk('00200', { transit_stop_density: 1 });
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.transit = -80;
    computeQualityIndices([urban, rural], weights);
    expect((rural.properties as { quality_index: number }).quality_index).toBe(100);
    expect((urban.properties as { quality_index: number }).quality_index).toBe(0);
  });

  it('magnitude, not sign, sets a signed factor\'s share of the index', () => {
    const a = mk('00100', { transit_stop_density: 40, hr_mtu: 60000 });
    const b = mk('00200', { transit_stop_density: 1, hr_mtu: 20000 });
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 50;
    weights.transit = -50;
    computeQualityIndices([a, b], weights);
    // A: income 100, transit flipped to 0 → 50. B: income 0, transit flipped to 100 → 50.
    expect((a.properties as { quality_index: number }).quality_index).toBe(50);
    expect((b.properties as { quality_index: number }).quality_index).toBe(50);
  });
});
