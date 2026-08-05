import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import {
  QUALITY_FACTORS, computeQualityIndices, getDefaultWeights, FACTOR_DIMENSION,
  type QualityWeights, type QualityFactor,
} from '../utils/qualityIndex';

/**
 * Guards the direction model: `invert` reconciles the raw column with the factor's
 * LABEL (a data fact), and the SIGN of the weight carries the user's preferred
 * direction. Before they were split these were one flag plus an undocumented second
 * one that silently cancelled it out, so the invariants below are the whole point.
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
 * How each factor scored a HIGH raw value under the ORIGINAL single-`invert` model,
 * at its then-positive default weight. Anything that changes here changes a shipped
 * score, so it must be deliberate.
 */
const LEGACY_INVERTED = new Set([
  'safety', 'property_crime', 'total_crime', 'employment', 'air_quality', 'low_income',
  'traffic_accidents', 'light_pollution', 'noise_pollution', 'water_proximity',
  'health_index', 'radon', 'flood_risk', 'unemployment_change',
]);

/** Factors whose LABEL names a hazard, so the default weighting points negative. */
const HAZARD_LABELLED = [
  'property_crime', 'total_crime', 'low_income', 'traffic_accidents', 'light_pollution',
  'noise_pollution', 'health_index', 'radon', 'flood_risk', 'unemployment_change',
];

const PARTY_FACTORS = [
  'party_kok', 'party_sdp', 'party_ps', 'party_kesk',
  'party_vihr', 'party_vas', 'party_rkp', 'political_lean',
];

describe('direction model — every factor is signed', () => {
  it('no factor carries a leftover polarity field', () => {
    for (const f of QUALITY_FACTORS) {
      expect(f, `${f.id}`).not.toHaveProperty('polarity');
    }
  });

  it('a hazard-labelled factor points negative by default, never positive', () => {
    for (const id of HAZARD_LABELLED) {
      const f = QUALITY_FACTORS.find((x) => x.id === id);
      expect(f, `factor ${id} exists`).toBeDefined();
      expect(f!.defaultWeight, `${id} defaultWeight`).toBeLessThanOrEqual(0);
      // The label names the raw quantity, so invert has no work to do.
      expect(f!.invert, `${id} invert`).toBe(false);
    }
  });

  it('the two hazards that carry default weight are exactly -8 and -7', () => {
    const w = getDefaultWeights();
    expect(w.traffic_accidents).toBe(-8);
    expect(w.noise_pollution).toBe(-7);
  });
});

describe('direction model — the default weighting is unchanged', () => {
  // Every factor is signed now, and ten of them flipped their default's sign to say
  // so. This is the guard that the re-encoding changed no shipped score: scored at
  // its own default weight, each factor must still rank areas exactly as it used to.
  const weighted = QUALITY_FACTORS.filter((f) => f.defaultWeight !== 0);

  it('covers every default-weighted factor', () => {
    expect(weighted.length).toBeGreaterThan(10);
  });

  it.each(weighted.map((f) => [f.id, f] as const))(
    '%s ranks areas the same as the legacy invert flag did',
    (_id, factor) => {
      expect(scoreHi(factor, factor.defaultWeight)).toBe(LEGACY_INVERTED.has(factor.id) ? 0 : 100);
    },
  );
});

describe('direction model — "+" means the same thing on every slider', () => {
  it.each(QUALITY_FACTORS.map((f) => [f.id, f] as const))(
    '%s: +100 favours more of the labelled quantity, -100 favours less',
    (_id, factor) => {
      // The labelled quantity runs with the raw column unless `invert` says otherwise
      // (water_proximity_m is a distance; its label is "Veden läheisyys").
      const hiHasMoreOfLabel = !factor.invert;
      expect(scoreHi(factor, 100)).toBe(hiHasMoreOfLabel ? 100 : 0);
      expect(scoreHi(factor, -100)).toBe(hiHasMoreOfLabel ? 0 : 100);
    },
  );

  it('magnitude, not sign, sets a factor\'s share of the index', () => {
    const a = mk('00100', { transit_stop_density: 40, hr_mtu: 60000 });
    const b = mk('00200', { transit_stop_density: 1, hr_mtu: 20000 });
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 50;
    weights.transit = -50;
    computeQualityIndices([a, b], weights);
    // A: income 100, transit mirrored to 0 → 50. B: income 0, transit mirrored to 100 → 50.
    expect((a.properties as { quality_index: number }).quality_index).toBe(50);
    expect((b.properties as { quality_index: number }).quality_index).toBe(50);
  });
});

describe('direction model — invert and sign compose (the case that used to cancel)', () => {
  // water_proximity is the shape the old model broke on: two flips applied in
  // sequence made the negative half a silent no-op.
  const factor = QUALITY_FACTORS.find((f) => f.id === 'water_proximity')!;

  it('is invert:true — the raw column is a distance, the label is proximity', () => {
    expect(factor.invert).toBe(true);
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

  it('-100 prefers being away from water', () => {
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

describe('direction model — hazards are now signable too', () => {
  it('a negative noise weight is what the default does; positive seeks noise', () => {
    const loud = mk('00100', { noise_pollution: 80 });
    const quiet = mk('00200', { noise_pollution: 5 });
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;

    weights.noise_pollution = -50;
    computeQualityIndices([loud, quiet], weights);
    expect((quiet.properties as { quality_index: number }).quality_index).toBe(100);

    weights.noise_pollution = 50;
    computeQualityIndices([loud, quiet], weights);
    expect((loud.properties as { quality_index: number }).quality_index).toBe(100);
  });
});

describe('party-support factors', () => {
  it('all eight exist, are opt-in, and sit in the descriptive dimension', () => {
    for (const id of PARTY_FACTORS) {
      const f = QUALITY_FACTORS.find((x) => x.id === id);
      expect(f, `factor ${id} exists`).toBeDefined();
      expect(f!.defaultWeight, `${id} defaultWeight`).toBe(0);
      expect(f!.primary, `${id} primary`).toBe(false);
      expect(f!.invert, `${id} invert`).toBe(false);
      expect(FACTOR_DIMENSION[id], `${id} dimension`).toBe('demographics');
    }
  });

  it('each reads a real vote-share property that exists in the dataset', () => {
    const expected: Record<string, string> = {
      party_kok: 'party_vote_kok_pct', party_sdp: 'party_vote_sdp_pct',
      party_ps: 'party_vote_ps_pct', party_kesk: 'party_vote_kesk_pct',
      party_vihr: 'party_vote_vihr_pct', party_vas: 'party_vote_vas_pct',
      party_rkp: 'party_vote_rkp_pct', political_lean: 'political_lean_index',
    };
    for (const [id, prop] of Object.entries(expected)) {
      const f = QUALITY_FACTORS.find((x) => x.id === id)!;
      expect(f.properties).toEqual([prop]);
    }
  });

  it('carry zero default weight, so the published index is untouched', () => {
    const base = mk('00100', { hr_mtu: 30000, unemployment_rate: 8 });
    const withParties = mk('00200', {
      hr_mtu: 30000, unemployment_rate: 8,
      party_vote_kok_pct: 40, party_vote_vas_pct: 2, political_lean_index: 90,
    });
    computeQualityIndices([base, withParties]);
    expect((base.properties as { quality_index: number }).quality_index)
      .toBe((withParties.properties as { quality_index: number }).quality_index);
  });

  it('a negative party weight seeks areas where that party polls lower', () => {
    const red = mk('00100', { party_vote_vas_pct: 25 });
    const blue = mk('00200', { party_vote_vas_pct: 3 });
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.party_vas = -60;
    computeQualityIndices([red, blue], weights);
    expect((blue.properties as { quality_index: number }).quality_index).toBe(100);
    expect((red.properties as { quality_index: number }).quality_index).toBe(0);
  });
});
