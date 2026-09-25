/**
 * Tests for utils/fillOpacity.ts and the grid opacity in utils/gridFade.ts —
 * the data-layer overlay eases down slightly at close zoom.
 *
 * Risk: MapLibre accepts only one zoom curve per expression, at the top level.
 * A shape it rejects is not an exception anyone sees — setPaintProperty warns
 * and keeps the previous opacity — so every builder is parsed here with
 * MapLibre's own style-spec, exactly as setPaintProperty validates it, and then
 * evaluated at real zooms with and without hover state.
 */
import { describe, it, expect } from 'vitest';
import { createPropertyExpression, latest, type StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  CLOSE_ZOOM_DAMP_END,
  CLOSE_ZOOM_DAMP_FACTOR,
  CLOSE_ZOOM_DAMP_START,
  buildFillOpacity,
  buildPaneFillOpacity,
} from '../utils/fillOpacity';
import { GRID_ZOOM_FADE_IN, GRID_ZOOM_FADE_OUT, buildGridFillOpacity } from '../utils/gridFade';
import { REGIONS } from '../utils/regions';

const FILL_OPACITY_SPEC = latest.paint_fill['fill-opacity'] as StylePropertySpecification;

/** Parse like setPaintProperty's validation does; fail the test on any error. */
function parse(expr: unknown) {
  const result = createPropertyExpression(expr, FILL_OPACITY_SPEC);
  if (result.result === 'error') {
    throw new Error(result.value.map((e) => e.message).join('; '));
  }
  return result.value;
}

function evalAt(expr: unknown, zoom: number, state: Record<string, boolean> = {}, properties: Record<string, unknown> = {}) {
  return parse(expr).evaluate({ zoom }, { type: 'Polygon', properties } as never, state) as number;
}

describe('buildFillOpacity (main map postal fill)', () => {
  it('is a valid, state-dependent, zoom-dependent MapLibre expression', () => {
    const parsed = parse(buildFillOpacity(1));
    expect(parsed.kind).toBe('composite');
    expect(parsed.kind === 'composite' && parsed.isStateDependent).toBe(true);
  });

  it('is unchanged up to the damping start — city overviews look as before', () => {
    for (const z of [4.8, 8.5, 9.2, CLOSE_ZOOM_DAMP_START]) {
      expect(evalAt(buildFillOpacity(1), z)).toBeCloseTo(0.65);
      expect(evalAt(buildFillOpacity(1), z, { hover: true })).toBeCloseTo(0.85);
      expect(evalAt(buildFillOpacity(1), z, { selected: true })).toBeCloseTo(0.85);
    }
  });

  it('lowers every state by the damping factor from the damping end on', () => {
    for (const z of [CLOSE_ZOOM_DAMP_END, 16]) {
      expect(evalAt(buildFillOpacity(1), z)).toBeCloseTo(0.65 * CLOSE_ZOOM_DAMP_FACTOR);
      expect(evalAt(buildFillOpacity(1), z, { hover: true })).toBeCloseTo(0.85 * CLOSE_ZOOM_DAMP_FACTOR);
      expect(evalAt(buildFillOpacity(1), z, { selected: true })).toBeCloseTo(0.85 * CLOSE_ZOOM_DAMP_FACTOR);
    }
  });

  it('eases down monotonically in between, and only a little', () => {
    let prev = Infinity;
    for (let z = CLOSE_ZOOM_DAMP_START; z <= CLOSE_ZOOM_DAMP_END; z += 0.25) {
      const v = evalAt(buildFillOpacity(1), z);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    // "not much but a little": a visible step, never a fade-out.
    expect(CLOSE_ZOOM_DAMP_FACTOR).toBeGreaterThanOrEqual(0.7);
    expect(CLOSE_ZOOM_DAMP_FACTOR).toBeLessThan(1);
  });

  it('still scales by the opacity slider', () => {
    expect(evalAt(buildFillOpacity(0.5), 9)).toBeCloseTo(0.325);
    expect(evalAt(buildFillOpacity(0.5), 16)).toBeCloseTo(0.325 * CLOSE_ZOOM_DAMP_FACTOR);
    expect(evalAt(buildFillOpacity(0), 16, { hover: true })).toBe(0);
  });

  it('keeps filter/wizard dimming, damped the same way', () => {
    const expr = buildFillOpacity(1, {
      matchExpr: ['in', ['get', 'pno'], ['literal', ['00100']]],
      matchVal: 0.8,
      dimVal: 0.15,
    });
    expect(evalAt(expr, 9, {}, { pno: '00100' })).toBeCloseTo(0.8);
    expect(evalAt(expr, 9, {}, { pno: '00200' })).toBeCloseTo(0.15);
    expect(evalAt(expr, 16, {}, { pno: '00100' })).toBeCloseTo(0.8 * CLOSE_ZOOM_DAMP_FACTOR);
    expect(evalAt(expr, 16, {}, { pno: '00200' })).toBeCloseTo(0.15 * CLOSE_ZOOM_DAMP_FACTOR);
    expect(evalAt(expr, 16, { hover: true }, { pno: '00200' })).toBeCloseTo(0.85 * CLOSE_ZOOM_DAMP_FACTOR);
  });
});

describe('buildPaneFillOpacity (split view postal fill)', () => {
  it('is valid and state-dependent', () => {
    const parsed = parse(buildPaneFillOpacity(1));
    expect(parsed.kind).toBe('composite');
    expect(parsed.kind === 'composite' && parsed.isStateDependent).toBe(true);
  });

  it('keeps the +0.15 hover bump and damps at close zoom', () => {
    expect(evalAt(buildPaneFillOpacity(0.6), 9)).toBeCloseTo(0.6);
    expect(evalAt(buildPaneFillOpacity(0.6), 9, { hover: true })).toBeCloseTo(0.75);
    expect(evalAt(buildPaneFillOpacity(0.6), 16)).toBeCloseTo(0.6 * CLOSE_ZOOM_DAMP_FACTOR);
    expect(evalAt(buildPaneFillOpacity(1), 16, { selected: true })).toBeCloseTo(CLOSE_ZOOM_DAMP_FACTOR);
  });
});

describe('buildGridFillOpacity (fine-grained grid overlay)', () => {
  it('is a valid expression (one zoom curve holding both ramps)', () => {
    expect(parse(buildGridFillOpacity(1)).kind).toBe('camera');
  });

  it('fades in, holds, then eases down at close zoom', () => {
    expect(evalAt(buildGridFillOpacity(1), GRID_ZOOM_FADE_IN)).toBe(0);
    expect(evalAt(buildGridFillOpacity(1), GRID_ZOOM_FADE_OUT)).toBeCloseTo(0.8);
    expect(evalAt(buildGridFillOpacity(1), CLOSE_ZOOM_DAMP_START)).toBeCloseTo(0.8);
    expect(evalAt(buildGridFillOpacity(1), 16)).toBeCloseTo(0.8 * CLOSE_ZOOM_DAMP_FACTOR);
  });
});

describe('damping range', () => {
  it('sits on integer zooms (composite values are exact there)', () => {
    expect(Number.isInteger(CLOSE_ZOOM_DAMP_START)).toBe(true);
    expect(Number.isInteger(CLOSE_ZOOM_DAMP_END)).toBe(true);
    expect(CLOSE_ZOOM_DAMP_END).toBeGreaterThan(CLOSE_ZOOM_DAMP_START);
  });

  it('starts after the grid hand-off, so the grid ramp stops ascend', () => {
    expect(GRID_ZOOM_FADE_OUT).toBeLessThan(CLOSE_ZOOM_DAMP_START);
  });

  it('starts at or above every region preset zoom — no preset opens inside the ramp', () => {
    for (const region of Object.values(REGIONS)) {
      expect(region.zoom).toBeLessThanOrEqual(CLOSE_ZOOM_DAMP_START);
    }
  });
});
