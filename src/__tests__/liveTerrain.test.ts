import { describe, it, expect } from 'vitest';
import { terrainShadowMask, terrainZoomFor, hasTerrain, type HeightField } from '../live/terrain';

/**
 * Terrain shadow sweep.
 *
 * The sweep is the one piece of this layer with no visual fallback: a footprint
 * that fails to project is a missing building, but a sweep with the sign flipped
 * shades the SUNNY side of every hill in Finland and still looks like a shadow
 * map. So the direction, the length and the "no false shadows on flat ground"
 * property are all pinned here against hand-computed answers.
 */

/** A field of `size`² cells, 1 m each, flat at `base` metres. */
function flatField(size: number, base = 0): HeightField {
  return {
    data: new Float32Array(size * size).fill(base),
    width: size,
    height: size,
    cellMetres: 1,
    bbox: [24, 60, 24.1, 60.1],
  };
}

function at(mask: Uint8ClampedArray, field: HeightField, x: number, y: number): number {
  return mask[y * field.width + x];
}

describe('terrainShadowMask', () => {
  it('returns no mask once the sun is at or below the horizon', () => {
    // "Everything is shaded" is the caller's flood fill, not a mask — computing
    // an all-255 grid would be the same picture the expensive way.
    expect(terrainShadowMask(flatField(8), 0, 90)).toBeNull();
    expect(terrainShadowMask(flatField(8), -3, 90)).toBeNull();
  });

  it('casts nothing on flat ground', () => {
    // The failure this guards is a quantisation terrace reading as a slope: a
    // heightfield with no relief must produce a mask with no shade, or every
    // plain in the country picks up stripes at a low sun.
    const field = flatField(16, 120);
    const mask = terrainShadowMask(field, 5, 90)!;
    expect(mask).not.toBeNull();
    expect([...mask].every((v) => v === 0)).toBe(true);
  });

  it('throws the shadow AWAY from the sun, not toward it', () => {
    // bearing 90 is the direction the SHADOW runs (east), i.e. a sun in the west.
    const field = flatField(21);
    const cx = 10;
    const cy = 10;
    field.data[cy * field.width + cx] = 10;
    const mask = terrainShadowMask(field, 45, 90)!;

    // East of the peak is shaded; west of it is lit.
    expect(at(mask, field, cx + 1, cy)).toBe(255);
    expect(at(mask, field, cx + 3, cy)).toBe(255);
    expect(at(mask, field, cx - 1, cy)).toBe(0);
    expect(at(mask, field, cx - 3, cy)).toBe(0);
    // The peak itself is lit — it is what is doing the casting.
    expect(at(mask, field, cx, cy)).toBe(0);
  });

  it('runs the shadow north when the sun is in the south', () => {
    // Row 0 is the NORTH edge, so a northward shadow means decreasing y. Getting
    // this inverted is invisible in code and obvious only on screen.
    const field = flatField(21);
    const cx = 10;
    const cy = 10;
    field.data[cy * field.width + cx] = 10;
    const mask = terrainShadowMask(field, 45, 0)!;
    expect(at(mask, field, cx, cy - 2)).toBe(255);
    expect(at(mask, field, cx, cy + 2)).toBe(0);
  });

  it('lengthens the shadow as the sun drops, by cot(altitude)', () => {
    const shadowRun = (altitude: number): number => {
      const field = flatField(81);
      const cx = 5;
      const cy = 40;
      field.data[cy * field.width + cx] = 10;
      const mask = terrainShadowMask(field, altitude, 90)!;
      let run = 0;
      for (let x = cx + 1; x < field.width; x++) {
        if (at(mask, field, x, cy) !== 255) break;
        run++;
      }
      return run;
    };
    // A 10 m peak on 1 m cells: 45° gives ~10 cells, 26.57° (cot = 2) gives ~20.
    expect(shadowRun(45)).toBeGreaterThanOrEqual(9);
    expect(shadowRun(45)).toBeLessThanOrEqual(10);
    const low = shadowRun((Math.atan(0.5) * 180) / Math.PI);
    expect(low).toBeGreaterThanOrEqual(19);
    expect(low).toBeLessThanOrEqual(20);
    expect(low).toBeGreaterThan(shadowRun(45));
  });

  it('lets a taller peak cast further than a short one', () => {
    const runFor = (peak: number): number => {
      const field = flatField(81);
      const cy = 40;
      field.data[cy * field.width + 5] = peak;
      const mask = terrainShadowMask(field, 45, 90)!;
      let run = 0;
      for (let x = 6; x < field.width; x++) {
        if (at(mask, field, x, cy) !== 255) break;
        run++;
      }
      return run;
    };
    expect(runFor(20)).toBeGreaterThan(runFor(5));
  });

  it('lets a higher ridge behind a lower one keep casting over it', () => {
    // The running-ceiling sweep exists for exactly this: a small bump inside a
    // big ridge's shadow must not "reset" the shadow and relight the ground
    // behind it, which is what a naive nearest-neighbour test would do.
    const field = flatField(41);
    const cy = 20;
    field.data[cy * field.width + 5] = 40; // tall ridge
    field.data[cy * field.width + 12] = 3; // low bump, deep in its shadow
    const mask = terrainShadowMask(field, 45, 90)!;
    expect(at(mask, field, 12, cy)).toBe(255);
    expect(at(mask, field, 14, cy)).toBe(255);
  });

  it('covers every cell, including lines that drift in from a side edge', () => {
    // A diagonal sun means lines entering through the top or bottom edge, not
    // just the left. Seeding only one edge leaves a triangle of the grid never
    // visited — which renders as a hard-edged unlit wedge.
    const field = flatField(24);
    field.data[12 * field.width + 12] = 30;
    const mask = terrainShadowMask(field, 30, 45)!;
    expect(mask.length).toBe(field.width * field.height);
    // Every cell got a decision: with one peak the mask must contain both.
    expect([...mask].some((v) => v === 255)).toBe(true);
    expect([...mask].some((v) => v === 0)).toBe(true);
  });
});

describe('terrainZoomFor', () => {
  it('stays inside the levels the pyramid actually holds', () => {
    if (!hasTerrain()) return;
    for (const mapZoom of [0, 4, 8, 11, 13, 16, 20]) {
      const z = terrainZoomFor(mapZoom);
      expect(Number.isInteger(z)).toBe(true);
      expect(z).toBeGreaterThanOrEqual(6);
      expect(z).toBeLessThanOrEqual(8);
    }
  });

  it('never gets finer as the camera pulls back', () => {
    if (!hasTerrain()) return;
    let prev = terrainZoomFor(20);
    for (let mapZoom = 19; mapZoom >= 0; mapZoom--) {
      const z = terrainZoomFor(mapZoom);
      expect(z).toBeLessThanOrEqual(prev);
      prev = z;
    }
  });
});
