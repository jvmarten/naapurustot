import { describe, it, expect } from 'vitest';
import {
  terrainShadowMask,
  terrainZoomFor,
  clipLevelToExtent,
  selectTerrainLevel,
  hasTerrain,
  type HeightField,
} from '../live/terrain';
import manifest from '../data/terrain_manifest.json';
import { solarFrame } from '../utils/sun';

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

/**
 * Unmapped ground is unknown, and must not be answered for.
 *
 * The pyramid is tiered, so a viewport routinely reaches past the level serving
 * it, and a tile inside a level's extent can still 404 where the mirror has a
 * gap. Those cells used to stay at the Float32Array's allocated 0 under the
 * comment "stays 0 — sea level", which nothing downstream could tell apart from
 * a measured coastline: it rendered as flat, fully-lit plain with a hard seam
 * where coverage stopped (CLAUDE.md terrain invariant 16). They carry NaN now,
 * and the sweep has to say nothing about them rather than guess — in either
 * direction, since `NaN >= ceiling` is false and the naive branch would have
 * declared every unmeasured cell shadowed.
 */
describe('ground the pyramid does not cover', () => {
  /** A flat field with the right half unmeasured. */
  function halfUnknown(size: number, base: number): HeightField {
    const f = flatField(size, base);
    for (let y = 0; y < size; y++) {
      for (let x = size / 2; x < size; x++) f.data[y * size + x] = NaN;
    }
    return f;
  }

  it('draws neither shade nor light on cells with no measurement', () => {
    const field = halfUnknown(8, 0);
    const mask = terrainShadowMask(field, 30, 90)!;
    expect(mask).not.toBeNull();
    for (let y = 0; y < 8; y++) {
      for (let x = 4; x < 8; x++) {
        expect(at(mask, field, x, y), `unknown cell ${x},${y} must be silent`).toBe(0);
      }
    }
  });

  it('still shades known ground that a known ridge casts over', () => {
    // A ridge in column 1, sun from the east so shadows run west — the cells to
    // its west are measured and must still come out shadowed.
    const field = flatField(8, 0);
    field.data[3 * 8 + 6] = 100;
    const mask = terrainShadowMask(field, 20, 270)!;
    expect(at(mask, field, 6, 3)).toBe(0);
    expect(at(mask, field, 4, 3)).toBe(255);
  });

  it('carries a shadow across an unmapped gap onto measured ground beyond', () => {
    // The gap tells us nothing about the terrain, but the shadow's height above
    // sea level at a given distance is set by its caster and the sun — so the
    // measured ground past the gap is still in shade, and resetting at the gap
    // would draw a lit stripe that nothing casts.
    const size = 16;
    const field = flatField(size, 0);
    field.data[8 * size + 14] = 400;
    for (let y = 0; y < size; y++) {
      for (let x = 8; x < 12; x++) field.data[y * size + x] = NaN;
    }
    const mask = terrainShadowMask(field, 10, 270)!;
    expect(at(mask, field, 14, 8), 'the ridge itself is lit').toBe(0);
    expect(at(mask, field, 10, 8), 'the gap says nothing').toBe(0);
    expect(at(mask, field, 6, 8), 'measured ground past the gap is still shaded').toBe(255);
  });

  it('says nothing about a field with no measurements at all', () => {
    const size = 8;
    const field = flatField(size, 0);
    field.data.fill(NaN);
    const mask = terrainShadowMask(field, 30, 90)!;
    expect([...mask].every((v) => v === 0)).toBe(true);
  });
});

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

/**
 * The sun across a continental field.
 *
 * These pin the defect that made the zoomed-out map unreadable: one solar
 * altitude, taken at the map's centre pixel, applied to two thousand kilometres
 * of ground. At 02:18 UTC on 2026-08-12 the sun is 7° BELOW the horizon over the
 * North Sea and 5° above it over Karelia, on the same screen.
 */
describe('terrainShadowMask with a solar frame', () => {
  const INSTANT = new Date('2026-08-12T02:18:00Z');

  /** A 64x4 strip spanning lon 5°E..40°E at 62°N — one screenful, zoomed out. */
  function strip(): HeightField {
    return {
      data: new Float32Array(64 * 4),
      width: 64,
      height: 4,
      cellMetres: 1000,
      bbox: [5, 61, 40, 63],
    };
  }

  /** Column index for a longitude in the strip's bbox. */
  const col = (lon: number) => Math.round(((lon - 5) / 35) * 63);

  it('casts nothing where the sun has already set, however high the ground', () => {
    // A 2 km peak at 10°E, where the sun is ~6° below the horizon. With a single
    // centre altitude this threw a shadow the length of the field; there is no
    // such shadow, because there is no sun. The twilight wash shades that ground.
    const field = strip();
    const x = col(10);
    for (let r = 0; r < field.height; r++) field.data[r * field.width + x] = 2000;

    const mask = terrainShadowMask(field, 0.1, 90, solarFrame(INSTANT))!;
    expect(mask).not.toBeNull();
    for (let x2 = 0; x2 <= col(24); x2++) {
      expect(at(mask, field, x2, 1), `column ${x2} is past the terminator`).toBe(0);
    }
  });

  it('still casts on the sunlit half of the same field', () => {
    // The other half of the point: a viewport straddling the terminator is not
    // "night", and returning no mask for it would blank the relief on the side
    // where the sun is genuinely up.
    const field = strip();
    const x = col(35);
    for (let r = 0; r < field.height; r++) field.data[r * field.width + x] = 2000;

    const mask = terrainShadowMask(field, 0.1, 90, solarFrame(INSTANT))!;
    expect(at(mask, field, x, 1)).toBe(0); // the peak is what casts
    expect(at(mask, field, x + 1, 1)).toBe(255);
    expect(at(mask, field, x + 5, 1)).toBe(255);
  });

  it('shortens the shadow where the sun is higher, over one field', () => {
    // Shadow length is cot(altitude), so the same peak must throw a much shorter
    // shadow at 40°E (sun ~5.6°) than at 30°E (sun ~1.4°). A single altitude
    // makes these identical, which is what painted the country in streaks.
    const lengthAt = (lon: number): number => {
      const field = strip();
      const x = col(lon);
      for (let r = 0; r < field.height; r++) field.data[r * field.width + x] = 1000;
      const mask = terrainShadowMask(field, 0.1, 90, solarFrame(INSTANT))!;
      let n = 0;
      while (x + 1 + n < field.width && at(mask, field, x + 1 + n, 1) === 255) n++;
      return n;
    };
    const low = lengthAt(30);
    const high = lengthAt(38);
    expect(high).toBeGreaterThan(0);
    expect(low).toBeGreaterThan(high);
  });

  it('returns no mask when the whole field is past the terminator', () => {
    // "Everything is shaded" stays the caller's flood fill — the frame just makes
    // the test per-field instead of per-centre-pixel.
    const field = strip();
    field.bbox = [-30, 61, -10, 63]; // mid-Atlantic: deep night at this instant
    expect(terrainShadowMask(field, 0.1, 90, solarFrame(INSTANT))).toBeNull();
  });

  it('reproduces the uniform-sun answer when given no frame', () => {
    // The old contract is still the contract for callers that do not pass a
    // frame — a small field where one altitude IS the truth.
    const field = flatField(21);
    field.data[10 * field.width + 10] = 10;
    const mask = terrainShadowMask(field, 45, 90)!;
    expect(at(mask, field, 11, 10)).toBe(255);
    expect(at(mask, field, 9, 10)).toBe(0);
  });
});

/**
 * A heightfield row is a MERCATOR row, not a latitude.
 *
 * Everything below turns on that. The grid is a slab of Web Mercator tiles, so
 * row index is linear in Mercator y and nonlinear in latitude — and Mercator's
 * mid-row sits well poleward of the arithmetic mid-latitude. Code that walks the
 * grid by row and interpolates latitude linearly is not making a rounding error;
 * on a continental field it is off by degrees, one-signed, so it never averages
 * out.
 *
 * Computed here from the projection definition rather than imported, so these
 * assertions state independently where a row IS.
 */
function rowForLat(lat: number, bbox: [number, number, number, number], height: number): number {
  const merc = (d: number) => Math.log(Math.tan(Math.PI / 4 + (d * Math.PI) / 360));
  const yN = merc(bbox[3]);
  const yS = merc(bbox[1]);
  return Math.round(((merc(lat) - yN) / (yS - yN)) * (height - 1));
}

describe('field rows are Mercator, not latitude', () => {
  const INSTANT = new Date('2026-08-12T02:18:00Z');

  it('gives a row the sun of the latitude it is actually at', () => {
    // The regression: the solar lattice placed its nodes by interpolating
    // latitude LINEARLY across the rows while the sweep read them by a linear
    // scale over Mercator rows. On a field like this one that handed a row up to
    // 6.5 degrees of latitude from where it really is — enough to hand genuinely
    // sunlit ground a below-horizon sun and declare it night, casting nothing.
    const bbox: [number, number, number, number] = [24, 41, 24.5, 79];
    const height = 512;
    const width = 8;

    // 69N at this instant and longitude is comfortably sunlit; the arithmetic-mid
    // reading of the same row lands far enough south to be below the horizon.
    const row = rowForLat(69, bbox, height);
    const field: HeightField = {
      data: new Float32Array(width * height),
      width,
      height,
      cellMetres: 1000,
      bbox,
    };
    for (let x = 0; x < width; x++) field.data[row * width + x] = 0;
    field.data[row * width + 1] = 3000;

    const mask = terrainShadowMask(field, 0.1, 90, solarFrame(INSTANT))!;
    expect(mask).not.toBeNull();
    // Sunlit ground casts. Under the linear-degrees bug this row read as night
    // and the whole line came back 0.
    expect(mask[row * width + 2]).toBe(255);
  });

  it('scales the descent rate by each row own cell size', () => {
    // A Mercator cell shrinks as cos(latitude), so one figure for a field
    // spanning tens of degrees makes shadows tens of per cent too long in the
    // south and too short in the north. With a UNIFORM sun (no frame) the only
    // thing that can differ between two rows is that scaling, which is what makes
    // this a clean test of it.
    const bbox: [number, number, number, number] = [24, 20, 25, 70];
    const height = 256;
    const width = 96;
    const field: HeightField = {
      data: new Float32Array(width * height),
      width,
      height,
      cellMetres: 1000,
      bbox,
    };
    const north = rowForLat(68, bbox, height);
    const south = rowForLat(22, bbox, height);
    field.data[north * width + 2] = 4000;
    field.data[south * width + 2] = 4000;

    const mask = terrainShadowMask(field, 45, 90)!;
    const run = (row: number): number => {
      let n = 0;
      while (3 + n < width && mask[row * width + 3 + n] === 255) n++;
      return n;
    };
    // Same peak, same sun: the northern cells are smaller ground, so the same
    // metric shadow covers more of them. Equal counts mean one cell size is
    // being used everywhere.
    expect(run(north)).toBeGreaterThan(run(south));
  });
});

describe('selectTerrainLevel', () => {
  const view = (west: number, south: number, east: number, north: number) => ({
    west,
    south,
    east,
    north,
  });

  it('does not climb into a level that does not hold the viewport', () => {
    if (!hasTerrain()) return;
    // Trondheim. The fine levels are Finland-only, so a camera here has to be
    // served by a coarse one. The bug this pins: the budget-spending climb asked
    // only whether a finer level FIT, on the reasoning that the descent had
    // already settled coverage — true while every level shared one bbox, false
    // the moment they stopped. It climbed into z8, found nothing in range, and
    // blanked the layer over the most mountainous ground in the dataset.
    const level = selectTerrainLevel(view(10.2, 63.3, 10.6, 63.5), 10)!;
    expect(level).not.toBeNull();
    expect(level.covered).toBe(true);
    const entry = (manifest.zooms as Record<string, { minX: number; maxX: number }>)[
      String(level.z)
    ];
    expect(entry, `level ${level.z} must exist in the manifest`).toBeDefined();
    expect(level.tx0).toBeGreaterThanOrEqual(entry.minX);
    expect(level.tx1).toBeLessThanOrEqual(entry.maxX);
  });

  it('still gives Helsinki the finest level at street zoom', () => {
    if (!hasTerrain()) return;
    // The other half: coverage-gating must not cost the zooms it was tuned for.
    const level = selectTerrainLevel(view(24.9, 60.15, 25.0, 60.2), 15)!;
    expect(level.z).toBe(Math.max(...Object.keys(manifest.zooms).map(Number)));
    expect(level.covered).toBe(true);
  });

  it('never asks for more tiles than the budget', () => {
    if (!hasTerrain()) return;
    for (const zoom of [3, 5, 6, 8, 10, 12, 15]) {
      const level = selectTerrainLevel(view(4, 54, 40, 71), zoom)!;
      const tiles = (level.tx1 - level.tx0 + 1) * (level.ty1 - level.ty0 + 1);
      expect(tiles, `map zoom ${zoom} -> z${level.z} asked for ${tiles} tiles`).toBeLessThanOrEqual(
        12,
      );
    }
  });

  /**
   * The budget's one hole, and where it is actually closed.
   *
   * The descent in `selectTerrainLevel` breaks unconditionally at the pyramid's
   * floor (`z <= AVAILABLE[0]`), so `count <= MAX_TILES` is never applied there.
   * /live/'s map sets no minZoom and no maxBounds, so a pinch-out to a world
   * view reaches it: z3 spans 8x8 tiles for the whole world against a budget of
   * twelve — a 16 MB field and four million swept cells. `clipLevelToExtent` is
   * what holds the bound, because tiles outside the level's extent do not exist.
   */
  it('bounds a world view at the pyramid floor, where the descent cannot', () => {
    if (!hasTerrain()) return;
    const world = selectTerrainLevel(view(-180, -85, 180, 85), 1)!;
    expect(world).not.toBeNull();
    const clipped = clipLevelToExtent(world)!;
    expect(clipped, 'the pyramid must still hold something at world view').not.toBeNull();
    const tiles = (clipped.tx1 - clipped.tx0 + 1) * (clipped.ty1 - clipped.ty0 + 1);
    expect(tiles, `world view -> z${clipped.z} asked for ${tiles} tiles`).toBeLessThanOrEqual(12);
    // And the clip is what did it — unclipped, the same level is over budget.
    const raw = (world.tx1 - world.tx0 + 1) * (world.ty1 - world.ty0 + 1);
    expect(raw).toBeGreaterThan(tiles);
  });

  it('reports nothing for a viewport that misses the level entirely', () => {
    if (!hasTerrain()) return;
    const entry = (manifest.zooms as Record<string, { minX: number; maxX: number; minY: number; maxY: number }>)[
      String(Math.max(...Object.keys(manifest.zooms).map(Number)))
    ];
    const z = Math.max(...Object.keys(manifest.zooms).map(Number));
    // A rectangle placed well past the extent's eastern edge at the same level.
    const off = { z, tx0: entry.maxX + 5, ty0: entry.minY, tx1: entry.maxX + 8, ty1: entry.maxY, covered: false };
    expect(clipLevelToExtent(off)).toBeNull();
  });
});

describe('terrainZoomFor', () => {
  it('stays inside the levels the pyramid actually holds', () => {
    if (!hasTerrain()) return;
    // Read from the manifest rather than pinned to literals. The pyramid is
    // tiered and its floor moves when coverage is extended — this assertion is
    // about the clamp honouring what was built, not about which levels exist.
    const levels = Object.keys(manifest.zooms).map(Number);
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    for (const mapZoom of [0, 4, 8, 11, 13, 16, 20]) {
      const z = terrainZoomFor(mapZoom);
      expect(Number.isInteger(z)).toBe(true);
      expect(z).toBeGreaterThanOrEqual(min);
      expect(z).toBeLessThanOrEqual(max);
    }
  });

  it('has a floor coarse enough for a camera framing the whole country', () => {
    if (!hasTerrain()) return;
    // The regression this pins: the pyramid used to bottom out at z6, whose tiles
    // are ~295 km across, so a continental camera could not be served within the
    // tile budget and fell back to a field that covered a fraction of the screen.
    // A level at z5 or coarser is what makes the zoomed-out view answerable.
    expect(Math.min(...Object.keys(manifest.zooms).map(Number))).toBeLessThanOrEqual(5);
  });

  it('covers the Nordics at its coarse levels and Finland at its fine ones', () => {
    // Relief outside the mirrored bbox reads as elevation zero — flat, lit ground
    // with a straight edge where coverage stops. A camera framing Finland frames
    // Norway too, so the levels such a camera reads have to reach it.
    const zooms = manifest.zooms as Record<string, { bbox?: number[] }>;
    const coarse = zooms['5']?.bbox;
    expect(coarse, 'z5 must declare the extent it was built for').toBeDefined();
    // Norway's western coast and the Danish straits, which a Finland-framing
    // viewport shows and which used to render as sea.
    expect(coarse![0]).toBeLessThanOrEqual(5);
    expect(coarse![3]).toBeGreaterThanOrEqual(70);
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
