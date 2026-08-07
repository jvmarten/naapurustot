import { describe, it, expect, beforeEach } from 'vitest';
import { setQualityCohort, clearQualityCohort } from '../utils/qualityBands';
import {
  getQualityCategory, getQualityCategories, getQualityBandPosition,
} from '../utils/qualityIndex';
import { getLayerById, rampGradientCss } from '../utils/colorScales';

/**
 * The invariant these guard: the pointer on the band strip must sit inside the band
 * whose label is rendered beside it.
 *
 * The strip draws the five bands at equal width because they are quintiles of the
 * cohort. The pointer used to be placed at `left: ${score}%` — the raw value axis —
 * and the two disagree as soon as the cohort's bands are not 20 points wide each,
 * which under the shipped weights they never are. A score of 62 in a cohort whose top
 * band starts at 58 is "Excellent", but 62 % along an equal-fifths strip is the fourth
 * band, so the dot rendered over "Good" while the text read "Excellent".
 */

const BANDS = 5;

/**
 * Which fifth of the strip a position falls in.
 *
 * Bands are half-open `(min, max]`, so a score equal to a band's max belongs to THAT
 * band and its pointer sits exactly on the seam with the next one. This mirrors that:
 * an exact boundary counts as the lower fifth. (Using `floor` instead would put the
 * top of every band in the next fifth and fail on every cut value.)
 */
function fifthAt(pct: number): number {
  if (pct <= 0) return 0;
  return Math.min(BANDS - 1, Math.ceil((pct / 100) * BANDS) - 1);
}

/** Index of the band a score is labelled with. */
function labelledBand(score: number): number {
  const c = getQualityCategory(score);
  return getQualityCategories().findIndex((x) => x.label.en === c?.label.en);
}

beforeEach(() => clearQualityCohort());

describe('getQualityBandPosition', () => {
  it('puts the pointer in the band whose label is shown — the reported 62/Excellent case', () => {
    // Reproduce the reported cohort: 80 % of areas at or below 58, so p80 — the cut
    // into "Excellent" — lands exactly on 58 and the panel reads "Excellent (58–100)".
    const cohort = [
      ...Array.from({ length: 320 }, (_, i) => 25 + Math.round((i * 33) / 319)), // 25…58
      ...Array.from({ length: 80 }, (_, i) => 59 + (i % 16)), // 59…74
    ];
    setQualityCohort(cohort);

    const cat = getQualityCategory(62);
    expect(cat?.label.en).toBe('Excellent');
    expect(cat!.min).toBe(58); // cohort-relative, not the fixed 80–100
    expect(cat!.max).toBe(100);

    const pos = getQualityBandPosition(62)!;
    // The raw-value placement this replaces would have been 62 % → the fourth fifth.
    expect(fifthAt(62)).toBe(3);
    // The fix puts it in the fifth fifth, under the "Excellent" label.
    expect(fifthAt(pos)).toBe(4);
  });

  it('agrees with the rendered label across the whole 0–100 range, for many cohort shapes', () => {
    const shapes: Record<string, number[]> = {
      // Shipped defaults: composite bunched around the middle.
      middling: Array.from({ length: 400 }, (_, i) => 23 + (i % 52)),
      // One bunched factor dominating: most areas share a value near the top.
      topHeavy: Array.from({ length: 400 }, (_, i) => (i < 360 ? 97 + (i % 3) : 30 + (i % 40))),
      // Bottom-heavy mirror of the above.
      bottomHeavy: Array.from({ length: 400 }, (_, i) => (i < 360 ? i % 4 : 60 + (i % 40))),
      // Wide and flat.
      spread: Array.from({ length: 400 }, (_, i) => Math.round((i / 399) * 100)),
    };

    for (const [name, cohort] of Object.entries(shapes)) {
      clearQualityCohort();
      setQualityCohort(cohort);
      for (let score = 0; score <= 100; score++) {
        const band = labelledBand(score);
        if (band < 0) continue; // no category (shouldn't happen, but don't assert on it here)
        const pos = getQualityBandPosition(score);
        expect(pos, `${name} @ ${score}`).not.toBeNull();
        expect(pos!, `${name} @ ${score}`).toBeGreaterThanOrEqual(0);
        expect(pos!, `${name} @ ${score}`).toBeLessThanOrEqual(100);
        expect(fifthAt(pos!), `${name} @ ${score} should sit under band ${band}`).toBe(band);
      }
    }
  });

  it('is monotonically non-decreasing in the score', () => {
    setQualityCohort(Array.from({ length: 300 }, (_, i) => 20 + (i % 60)));
    let prev = -1;
    for (let score = 0; score <= 100; score++) {
      const pos = getQualityBandPosition(score);
      if (pos == null) continue;
      expect(pos).toBeGreaterThanOrEqual(prev);
      prev = pos;
    }
  });

  it('centres the pointer in a degenerate band rather than dividing by zero', () => {
    // Every area tied: the band has zero width in value space.
    setQualityCohort(Array.from({ length: 200 }, () => 50));
    const pos = getQualityBandPosition(50);
    expect(pos).not.toBeNull();
    expect(Number.isFinite(pos!)).toBe(true);
    expect(pos!).toBeGreaterThanOrEqual(0);
    expect(pos!).toBeLessThanOrEqual(100);
  });

  it('returns null for a missing score', () => {
    setQualityCohort(Array.from({ length: 200 }, (_, i) => i % 100));
    expect(getQualityBandPosition(null)).toBeNull();
    expect(getQualityBandPosition(NaN)).toBeNull();
  });

  it('falls back to the fixed bands before any cohort is registered', () => {
    // 62 is "Good" (60–80) on the fixed scale, i.e. the fourth fifth.
    expect(getQualityCategory(62)?.label.en).toBe('Good');
    expect(fifthAt(getQualityBandPosition(62)!)).toBe(3);
  });
});

describe('rampGradientCss', () => {
  const qi = getLayerById('quality_index');

  it('keeps every ramp colour inside a wide band instead of fading end to end', () => {
    // The lowest cohort band can span 0–44, crossing violet/red/orange. A plain
    // two-stop gradient would drop those and draw purple → orange.
    const css = rampGradientCss(qi, 0, 44);
    for (const color of ['#a855f7', '#ef4444', '#f97316']) {
      expect(css.toLowerCase()).toContain(color);
    }
    expect(css.startsWith('linear-gradient(to right,')).toBe(true);
  });

  it('uses the same ramp the choropleth does', () => {
    // Endpoints must be the layer's own colours, not an independent palette.
    expect(rampGradientCss(qi, 0, 100).toLowerCase()).toContain(qi.colors[0].toLowerCase());
    expect(rampGradientCss(qi, 0, 100).toLowerCase()).toContain(qi.colors[qi.colors.length - 1].toLowerCase());
  });

  it('emits ascending stop percentages', () => {
    const css = rampGradientCss(qi, 10, 90);
    const pcts = [...css.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
    expect(pcts.length).toBeGreaterThan(2);
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]);
    expect(pcts[0]).toBe(0);
    expect(pcts[pcts.length - 1]).toBe(100);
  });

  it('does not divide by zero on a degenerate range', () => {
    const css = rampGradientCss(qi, 50, 50);
    expect(css).toContain('linear-gradient');
    expect(css).not.toContain('NaN');
  });
});
