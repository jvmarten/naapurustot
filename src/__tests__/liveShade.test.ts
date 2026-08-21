import { describe, it, expect } from 'vitest';
import { nightAlpha, deepenAlpha255 } from '../live/shade';

/**
 * The two pure numbers behind the twilight wash. The point of testing them here
 * is the twilight NIGHT fast-path in LivePage: when the whole viewport is provably
 * past civil twilight it skips the ~21,800-sample lattice and paints a uniform
 * wash, which is only correct if `nightAlpha` saturates cleanly at −6° and both
 * paths use the same `deepenAlpha255`.
 */

const DAY = 0.45;
const NIGHT = 0.62;

describe('nightAlpha', () => {
  it('is the daytime tone at the horizon', () => {
    expect(nightAlpha(0, DAY, NIGHT)).toBeCloseTo(DAY, 12);
  });

  it('saturates to the full night tone at −6° and stays there below it', () => {
    // The whole basis of the night fast-path: at or past the end of civil
    // twilight there is ONE night alpha, not a field, so a viewport entirely
    // below −6° has a single uniform answer.
    expect(nightAlpha(-6, DAY, NIGHT)).toBeCloseTo(NIGHT, 12);
    expect(nightAlpha(-6.0001, DAY, NIGHT)).toBeCloseTo(NIGHT, 12);
    expect(nightAlpha(-40, DAY, NIGHT)).toBeCloseTo(NIGHT, 12);
  });

  it('ramps linearly between the horizon and −6°', () => {
    expect(nightAlpha(-3, DAY, NIGHT)).toBeCloseTo(DAY + (NIGHT - DAY) * 0.5, 12);
  });

  it('clamps a sun above the horizon to the daytime tone', () => {
    expect(nightAlpha(10, DAY, NIGHT)).toBeCloseTo(DAY, 12);
  });
});

describe('deepenAlpha255', () => {
  it('is zero when the night tone equals the day tone (nothing to deepen)', () => {
    expect(deepenAlpha255(DAY, DAY)).toBe(0);
  });

  it('inverts source-over so day + deepen·(1−day) lands on the night tone', () => {
    const da = deepenAlpha255(NIGHT, DAY);
    const composited = DAY + (da / 255) * (1 - DAY);
    expect(composited).toBeCloseTo(NIGHT, 2);
  });

  it('is what the uniform night fast-path and the lattice both compute at −6°', () => {
    // The lattice writes deepenAlpha255(nightAlpha(alt), day) per cell; below −6°
    // nightAlpha === night, so every cell equals the fast-path's single fill.
    const latticeCellBelowSix = deepenAlpha255(nightAlpha(-8, DAY, NIGHT), DAY);
    const uniformFastPath = deepenAlpha255(NIGHT, DAY);
    expect(latticeCellBelowSix).toBe(uniformFastPath);
  });
});
