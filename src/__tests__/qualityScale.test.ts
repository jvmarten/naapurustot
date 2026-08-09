import { describe, it, expect, afterAll } from 'vitest';
import regionProps from '../data/region_properties.json';
import { computeQualityIndices } from '../utils/qualityIndex';
import {
  applyQualityScale, setQualityScaleMode, getQualityScaleMode,
  scaleUsesFixedBands, QUALITY_SCALE_MODES, type QualityScaleMode,
} from '../utils/qualityScale';

/**
 * The four selectable presentations of the composite, checked against the real national
 * cohort. The band shares are the whole point of the choice, so they are asserted: the
 * trade between them is exactly how evenly the five verdicts get used.
 */

const { keys, cols } = regionProps as unknown as { keys: string[]; cols: unknown[][] };
const feats: { type: 'Feature'; geometry: null; properties: Record<string, unknown> }[] = [];
for (let i = 0; i < cols[0].length; i++) {
  const p: Record<string, unknown> = {};
  keys.forEach((k, j) => { p[k] = cols[j][i]; });
  feats.push({ type: 'Feature', geometry: null, properties: p });
}
computeQualityIndices(feats as never);

const original = getQualityScaleMode();
afterAll(() => setQualityScaleMode(original));

function sharesUnder(mode: QualityScaleMode): number[] {
  setQualityScaleMode(mode);
  applyQualityScale(feats);
  const vals = feats.map((f) => f.properties.quality_display as number | null).filter((v): v is number => v != null);
  const bands = [0, 0, 0, 0, 0];
  vals.forEach((v) => { bands[Math.min(4, Math.floor(v / 20))]++; });
  return bands.map((c) => (c / vals.length) * 100);
}

describe('quality display scales', () => {
  it('defaults to raw, which leaves the composite untouched', () => {
    setQualityScaleMode('raw');
    applyQualityScale(feats);
    for (const f of feats) {
      expect(f.properties.quality_display).toBe(f.properties.quality_index);
    }
    expect(scaleUsesFixedBands()).toBe(false); // raw needs cohort-relative bands
  });

  it('every non-raw mode spans 0–100 and can use fixed bands', () => {
    for (const mode of QUALITY_SCALE_MODES.filter((m) => m !== 'raw')) {
      setQualityScaleMode(mode);
      expect(scaleUsesFixedBands(), mode).toBe(true);
      applyQualityScale(feats);
      const vals = feats.map((f) => f.properties.quality_display as number).filter(Number.isFinite);
      expect(Math.min(...vals), `${mode} min`).toBeLessThanOrEqual(2);
      expect(Math.max(...vals), `${mode} max`).toBeGreaterThanOrEqual(98);
    }
  });

  it('spreads the five verdicts progressively better across the modes', () => {
    // raw: the composite is 38–67, so fixed cuts collapse it — this is exactly why raw
    // uses cohort-relative bands instead.
    expect(Math.max(...sharesUnder('raw'))).toBeGreaterThan(90);
    // stretch: usable, but still middle-heavy.
    const stretch = sharesUnder('stretch');
    expect(Math.max(...stretch)).toBeGreaterThan(45);
    expect(Math.max(...stretch)).toBeLessThan(70);
    // winsorized: every band meaningfully populated.
    for (const s of sharesUnder('winsorized')) expect(s).toBeGreaterThan(8);
    // percentile: near-uniform by construction.
    for (const s of sharesUnder('percentile')) { expect(s).toBeGreaterThan(15); expect(s).toBeLessThan(25); }
  });

  it('preserves order in every mode — a better composite is never displayed lower', () => {
    for (const mode of QUALITY_SCALE_MODES) {
      setQualityScaleMode(mode);
      applyQualityScale(feats);
      const pairs = feats
        .map((f) => [f.properties.quality_index as number, f.properties.quality_display as number])
        .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
        .sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < pairs.length; i++) {
        expect(pairs[i][1], `${mode}: ${pairs[i - 1][0]}->${pairs[i][0]}`).toBeGreaterThanOrEqual(pairs[i - 1][1]);
      }
    }
  });

  it('leaves a degenerate cohort alone rather than inventing a spread', () => {
    const tied = Array.from({ length: 100 }, () => ({ properties: { quality_index: 50 } as Record<string, unknown> }));
    for (const mode of QUALITY_SCALE_MODES) {
      setQualityScaleMode(mode);
      applyQualityScale(tied);
      const vals = tied.map((f) => f.properties.quality_display as number);
      expect(new Set(vals).size, `${mode} must not split a tie`).toBe(1);
      expect(Number.isFinite(vals[0])).toBe(true);
    }
  });
});
