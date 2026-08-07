import { describe, it, expect, beforeEach } from 'vitest';
import { setQualityCohort, clearQualityCohort } from '../utils/qualityBands';
import {
  getQualityCategory, getQualityCategories, getQualityBandPosition,
} from '../utils/qualityIndex';
import { getLayerById, getInterpolatedColor, rampGradientCss } from '../utils/colorScales';

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

const QI = getLayerById('quality_index');

/** The ramp colour a score is drawn in: the ramp applied to its RELATIVE position. */
function colorOf(score: number): string | null {
  const pos = getQualityBandPosition(score);
  if (pos == null) return null;
  const lo = QI.stops[0];
  const hi = QI.stops[QI.stops.length - 1];
  return getInterpolatedColor(QI, lo + (pos / 100) * (hi - lo));
}

function rgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
function dist(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a); const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

describe('verdict colour follows the ramp continuously', () => {
  // Two defects this replaces. (1) Ramp over the RAW score: the word is cohort-relative
  // and the colour was not, so 80 and 58 could both read "Excellent" in green and yellow
  // respectively. (2) One flat colour per band: the word and colour agreed but a single
  // point flipped the whole hue — 58 was a yellow "Good", 59 a green "Excellent".
  const COHORTS: Record<string, number[]> = {
    middling: Array.from({ length: 400 }, (_, i) => 23 + (i % 52)),
    topHeavy: Array.from({ length: 400 }, (_, i) => (i < 360 ? 97 + (i % 3) : 30 + (i % 40))),
    spread: Array.from({ length: 400 }, (_, i) => Math.round((i / 399) * 100)),
    narrow: Array.from({ length: 400 }, (_, i) => 44 + (i % 12)),
  };

  // The steepest the ramp itself gets, per 1 unit of position. Derived from the ramp's
  // segments rather than sampled at whole percents — sampling straddles stop boundaries
  // and averages the steepest segment down, which understates the true bound.
  const RAMP_MAX_STEP = (() => {
    const span = QI.stops[QI.stops.length - 1] - QI.stops[0];
    let max = 0;
    for (let i = 0; i < QI.colors.length - 1; i++) {
      const width = ((QI.stops[i + 1] - QI.stops[i]) / span) * 100; // in position units
      if (width > 0) max = Math.max(max, dist(QI.colors[i], QI.colors[i + 1]) / width);
    }
    return max;
  })();

  it('never jumps the hue faster than the score moves through the cohort', () => {
    // The real invariant, and the one flat per-band colours broke: colour is a
    // continuous function of POSITION, so a band edge is not special. A tied cohort may
    // still move a long way for one point — that is an honest jump in rank, not a cliff
    // — so the bound is proportional to the position moved rather than a flat constant.
    for (const [name, cohort] of Object.entries(COHORTS)) {
      clearQualityCohort();
      setQualityCohort(cohort);
      for (let score = 0; score < 100; score++) {
        const a = colorOf(score), b = colorOf(score + 1);
        if (!a || !b) continue;
        const dPos = Math.abs(getQualityBandPosition(score + 1)! - getQualityBandPosition(score)!);
        const edge = labelledBand(score) !== labelledBand(score + 1);
        // +2 covers 8-bit quantisation: lerpHex rounds each channel, so a measured
        // distance can exceed the ideal linear one by up to ~sqrt(3) across two endpoints.
        expect(dist(a, b), `${name}: ${score}->${score + 1}${edge ? ' (band edge)' : ''}`)
          .toBeLessThanOrEqual(RAMP_MAX_STEP * dPos + 2);
      }
    }
  });

  it('reproduces the reported 58/59 pair as neighbouring colours, not a hue flip', () => {
    clearQualityCohort();
    setQualityCohort([
      ...Array.from({ length: 320 }, (_, i) => 25 + Math.round((i * 33) / 319)), // …58
      ...Array.from({ length: 80 }, (_, i) => 59 + (i % 16)),
    ]);
    expect(getQualityCategory(58)?.label.en).toBe('Good');
    expect(getQualityCategory(59)?.label.en).toBe('Excellent');
    // Different verdicts, adjacent scores — so adjacent colours. Flat per-band colours
    // put a full palette step (~180) here.
    expect(dist(colorOf(58)!, colorOf(59)!)).toBeLessThan(40);
  });

  it('keeps every verdict in its own fifth of the ramp whatever the weighting', () => {
    // "Excellent" is drawn from the green end and "Bad" from the red end in every
    // cohort — the property the raw-value ramp lost.
    for (const [name, cohort] of Object.entries(COHORTS)) {
      clearQualityCohort();
      setQualityCohort(cohort);
      for (let score = 0; score <= 100; score++) {
        const label = getQualityCategory(score)?.label.en;
        const c = colorOf(score);
        if (!c || !label) continue;
        const [r, g] = rgb(c);
        if (label === 'Excellent') expect(g, `${name} @ ${score} Excellent must be green-side`).toBeGreaterThan(r);
        if (label === 'Bad') expect(r, `${name} @ ${score} Bad must be red-side`).toBeGreaterThan(g);
      }
    }
  });

});

describe('rampGradientCss', () => {
  it('keeps every ramp colour instead of fading end to end', () => {
    const css = rampGradientCss(QI, 0, 100);
    for (const color of QI.colors) expect(css.toLowerCase()).toContain(color.toLowerCase());
    expect(css.startsWith('linear-gradient(to right,')).toBe(true);
  });

  it('emits ascending stop percentages from 0 to 100', () => {
    const css = rampGradientCss(QI, 0, 100);
    const pcts = [...css.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
    expect(pcts[0]).toBe(0);
    expect(pcts[pcts.length - 1]).toBe(100);
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]);
  });

  it('does not divide by zero on a degenerate range', () => {
    const css = rampGradientCss(QI, 50, 50);
    expect(css).toContain('linear-gradient');
    expect(css).not.toContain('NaN');
  });
});
