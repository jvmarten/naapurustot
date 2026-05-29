/**
 * National-reference normalization (CF-1 phase C).
 *
 * Verifies that `computeQualityIndices` normalizes against the supplied national
 * ranges (the default "Whole of Finland" scope) instead of the loaded feature
 * set, that scores are therefore comparable across disjoint sets, that a metric
 * absent from the artifact falls back to the loaded-set range, and that the
 * shipped national_ranges.json covers every default-weighted factor.
 */
import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  QUALITY_FACTORS,
  type QualityWeights,
  type MinMax,
} from '../utils/qualityIndex';
import { getNationalRanges } from '../utils/nationalRanges';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki', ...props } as NeighborhoodProperties,
  };
}

/** Weights with a single factor active at 100 (all others zeroed). */
function onlyFactor(id: string): QualityWeights {
  const w: QualityWeights = {};
  for (const f of QUALITY_FACTORS) w[f.id] = 0;
  w[id] = 100;
  return w;
}

const qi = (f: Feature) => (f.properties as NeighborhoodProperties).quality_index;

describe('Quality Index — national reference ranges', () => {
  it('normalizes against national ranges, not the loaded set', () => {
    // Loaded set spans 30k–50k; nationally 30k sits at the midpoint (10k–50k).
    const national = new Map<string, MinMax>([
      ['hr_mtu', { min: 10000, max: 50000, avg: 30000 }],
    ]);
    const features = [makeFeature({ hr_mtu: 30000 }), makeFeature({ hr_mtu: 50000 })];

    computeQualityIndices(features, onlyFactor('income'), national);
    // 30000 → (30000-10000)/(50000-10000) = 50; 50000 → 100.
    expect(qi(features[0])).toBe(50);
    expect(qi(features[1])).toBe(100);

    // Region scope (no national ranges) min-maxes over the loaded set: 30000 → 0.
    computeQualityIndices(features, onlyFactor('income'), null);
    expect(qi(features[0])).toBe(0);
    expect(qi(features[1])).toBe(100);
  });

  it('produces comparable scores across disjoint feature sets', () => {
    const national = new Map<string, MinMax>([
      ['hr_mtu', { min: 10000, max: 50000, avg: 30000 }],
    ]);
    // Two "regions" whose local ranges differ wildly, but both contain a 30k PC.
    const regionA = [makeFeature({ hr_mtu: 12000 }), makeFeature({ hr_mtu: 30000 })];
    const regionB = [makeFeature({ hr_mtu: 30000 }), makeFeature({ hr_mtu: 48000 })];

    computeQualityIndices(regionA, onlyFactor('income'), national);
    computeQualityIndices(regionB, onlyFactor('income'), national);

    // Same raw income → same national score, regardless of region context.
    expect(qi(regionA[1])).toBe(50);
    expect(qi(regionB[0])).toBe(50);
  });

  it('falls back to the loaded-set range for a property absent from the artifact', () => {
    // National ranges contain income but NOT crime: crime must min-max locally.
    const national = new Map<string, MinMax>([
      ['hr_mtu', { min: 10000, max: 50000, avg: 30000 }],
    ]);
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['income'] = 50;
    weights['safety'] = 50;

    const features = [
      makeFeature({ hr_mtu: 30000, crime_index: 50 }),  // income→50 (national); crime→best→100
      makeFeature({ hr_mtu: 50000, crime_index: 150 }), // income→100 (national); crime→worst→0
    ];
    computeQualityIndices(features, weights, national);

    // f0: (income 50·50 + safety 100·50)/100 = 75; f1: (100·50 + 0·50)/100 = 50.
    expect(qi(features[0])).toBe(75);
    expect(qi(features[1])).toBe(50);
  });

  it('imputes a neutral 50 for a missing metric under national scope (no directional bias)', () => {
    // transit_stop_density has zero coverage in most regions; its national mean
    // normalizes to 25 — NOT neutral. Missing data must not drag the score there.
    const national = new Map<string, MinMax>([
      ['transit_stop_density', { min: 0, max: 40, avg: 10 }],
    ]);
    const features = [makeFeature({})]; // transit_stop_density absent

    computeQualityIndices(features, onlyFactor('transit'), national);
    // National scope: absent → neutral midpoint 50, not normalize(avg)=25.
    expect(qi(features[0])).toBe(50);

    // Region scope: no national ranges and no local signal → factor dropped → null.
    computeQualityIndices(features, onlyFactor('transit'), null);
    expect(qi(features[0])).toBeNull();
  });

  it('shipped national_ranges.json covers every default-weighted factor', () => {
    const ranges = getNationalRanges();
    const defaults = getDefaultWeights();
    for (const f of QUALITY_FACTORS) {
      if ((defaults[f.id] ?? 0) <= 0) continue;
      for (const prop of f.properties) {
        const r = ranges.get(prop as string);
        expect(r, `national range missing for ${String(prop)} (factor ${f.id})`).toBeDefined();
        expect(r!.min).toBeLessThanOrEqual(r!.max);
        expect(Number.isFinite(r!.avg)).toBe(true);
      }
    }
  });
});
