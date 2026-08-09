import { describe, it, expect } from 'vitest';
import {
  parseHeightTag,
  parseLevelsTag,
  heightFromTags,
  offsetPoint,
  sweptRings,
  emitSweptPath,
  signedArea2,
  signedArea2Flat,
  shadowLengthMetres,
  simplifyProjected,
  lonLatToMercator,
  mercatorToLonLat,
  prepareBuilding,
  projectPrepared,
  padBbox,
  bboxAreaKm2,
  bboxContains,
  bboxIntersects,
  bboxSubtract,
  MAX_SHADOW_METRES,
  type Affine,
  type Bbox,
  type Pt,
  type Ring,
} from '../live/shadows';
import { defaultEnabledFeeds, sanitizeEnabled, ALL_FEEDS } from '../live/feeds';

describe('parseHeightTag', () => {
  it('accepts the forms OSM actually contains', () => {
    expect(parseHeightTag('12')).toBe(12);
    expect(parseHeightTag('12 m')).toBe(12);
    expect(parseHeightTag('12m')).toBe(12);
    expect(parseHeightTag('12.5')).toBe(12.5);
    expect(parseHeightTag('12,5')).toBe(12.5);
    expect(parseHeightTag('8 metres')).toBe(8);
  });

  it('rejects rather than coerces unusable values', () => {
    // A building silently given height 0 is indistinguishable from one that has
    // no height at all, which would corrupt the coverage ratio the UI reports.
    expect(parseHeightTag('0')).toBeNull();
    expect(parseHeightTag('-3')).toBeNull();
    expect(parseHeightTag('tall')).toBeNull();
    expect(parseHeightTag('')).toBeNull();
    expect(parseHeightTag(undefined)).toBeNull();
  });
});

describe('parseLevelsTag', () => {
  it('converts a floor count to metres', () => {
    expect(parseLevelsTag('4')).toBeCloseTo(12.8, 6);
    expect(parseLevelsTag('1')).toBeCloseTo(3.2, 6);
  });

  it('rejects zero, negative and non-numeric floor counts', () => {
    expect(parseLevelsTag('0')).toBeNull();
    expect(parseLevelsTag('-1')).toBeNull();
    expect(parseLevelsTag('ground')).toBeNull();
    expect(parseLevelsTag(undefined)).toBeNull();
  });
});

describe('heightFromTags', () => {
  it('prefers a measured height and marks it as not estimated', () => {
    expect(heightFromTags({ height: '18', 'building:levels': '4' })).toEqual({
      height: 18,
      estimated: false,
    });
  });

  it('falls back to floor count and flags the result as an estimate', () => {
    const resolved = heightFromTags({ 'building:levels': '5' });
    expect(resolved?.estimated).toBe(true);
    expect(resolved?.height).toBeCloseTo(16, 6);
  });

  it('returns null when neither tag is usable', () => {
    expect(heightFromTags({ building: 'yes' })).toBeNull();
    expect(heightFromTags(undefined)).toBeNull();
    // A junk height must not silently promote the floor-count path's flag.
    expect(heightFromTags({ height: 'tall' })).toBeNull();
  });
});

describe('offsetPoint', () => {
  it('moves north for bearing 0 and east for bearing 90', () => {
    const [, northLat] = offsetPoint(24.9384, 60.1699, 100, 0);
    expect(northLat).toBeGreaterThan(60.1699);
    const [eastLon] = offsetPoint(24.9384, 60.1699, 100, 90);
    expect(eastLon).toBeGreaterThan(24.9384);
  });

  it('moves south for bearing 180 and west for bearing 270', () => {
    const [, southLat] = offsetPoint(24.9384, 60.1699, 100, 180);
    expect(southLat).toBeLessThan(60.1699);
    const [westLon] = offsetPoint(24.9384, 60.1699, 100, 270);
    expect(westLon).toBeLessThan(24.9384);
  });

  it('displaces by about the requested number of metres', () => {
    const [, lat] = offsetPoint(24.9384, 60.1699, 1113.2, 0);
    // 1113.2 m north is very close to 0.01° of latitude.
    expect((lat - 60.1699) * 111_320).toBeCloseTo(1113.2, 0);
  });

  it('widens the longitude step with latitude', () => {
    // The same eastward distance is more degrees of longitude further north.
    const [southLon] = offsetPoint(24.9384, 60.0, 1000, 90);
    const [northLon] = offsetPoint(24.9384, 69.9, 1000, 90);
    expect(northLon - 24.9384).toBeGreaterThan(southLon - 24.9384);
  });
});

/**
 * A 40x20 px rectangle in SCREEN space — the coordinates the renderer actually
 * feeds the emitter. These tests deliberately target `emitSweptPath`/`sweptRings`
 * rather than any lon/lat twin: the render path is where the winding bug lived,
 * and a test that guards a parallel implementation guards nothing.
 */
const RECT: Pt[] = [
  [100, 100],
  [140, 100],
  [140, 120],
  [100, 120],
  [100, 100],
];

/** Winding number of a set of rings about a point. Non-zero => nonzero-fill paints it. */
function windingAt(rings: Pt[][], px: number, py: number): number {
  let w = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      const side = (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
      if (y1 <= py) {
        if (y2 > py && side > 0) w++;
      } else if (y2 <= py && side < 0) {
        w--;
      }
    }
  }
  return w;
}

describe('shadowLengthMetres', () => {
  it('lengthens as the sun drops and vanishes below the horizon', () => {
    expect(shadowLengthMetres(20, 45)).toBeCloseTo(20, 5);
    expect(shadowLengthMetres(20, 10)).toBeGreaterThan(shadowLengthMetres(20, 60));
    expect(shadowLengthMetres(20, 0)).toBe(0);
    expect(shadowLengthMetres(20, -5)).toBe(0);
  });

  it('clamps only at the very last fraction of a degree above the horizon', () => {
    // At 0.05 degrees a 20 m building would geometrically cast ~23 km.
    expect(shadowLengthMetres(20, 0.05)).toBe(MAX_SHADOW_METRES);
  });

  it('keeps a tower and a shed distinguishable through sunset', () => {
    // The clamp used to be 2 km, which is SHORTER than the hour either side of
    // sunset actually casts — so every building taller than about 17 m threw the
    // same 2 km shadow and the skyline flattened at exactly the time of day it is
    // most legible. These two must stay an order of magnitude apart.
    const shed = shadowLengthMetres(5, 0.5);
    const tower = shadowLengthMetres(100, 0.5);
    expect(shed).toBeLessThan(600);
    expect(tower).toBeGreaterThan(5_000);
    expect(tower / shed).toBeCloseTo(20, 0);
  });

  it('still casts a useful shadow an hour before sunset', () => {
    // The sun is ~5-6 degrees up an hour before it sets at this latitude.
    expect(shadowLengthMetres(20, 5)).toBeGreaterThan(200);
    expect(shadowLengthMetres(20, 5)).toBeLessThan(MAX_SHADOW_METRES);
  });
});

describe('emitSweptPath', () => {
  it('emits nothing for a degenerate footprint', () => {
    expect(sweptRings([[0, 0], [1, 1], [0, 0]] as Pt[], 10, 10)).toEqual([]);
  });

  it('emits just the footprint when there is no offset', () => {
    const rings = sweptRings(RECT, 0, 0);
    expect(rings).toHaveLength(1);
  });

  it('gives every emitted ring the same orientation', () => {
    // The nonzero fill rule unions a set of polygons only when they all wind the
    // same way; mixed orientations SUBTRACT where they overlap.
    for (const [dx, dy] of [[30, 0], [0, 40], [25, 25], [-60, 15], [-10, -80]]) {
      const signs = sweptRings(RECT, dx, dy)
        .map((r) => Math.sign(signedArea2(r)))
        .filter((sign) => sign !== 0);
      expect(signs.length, `offset ${dx},${dy} produced no drawable rings`).toBeGreaterThan(0);
      expect(new Set(signs).size, `offset ${dx},${dy} produced mixed winding`).toBe(1);
    }
  });

  it('keeps the corridor filled for a long offset, in every direction', () => {
    // THE regression: with mixed winding the sweep quads cancel to a winding
    // number of zero once the offset is long, and the shadow renders invisible —
    // worst at a low sun, which is exactly when shadows matter most.
    for (const [dx, dy] of [[300, 0], [0, 300], [200, 200], [-250, 120], [-90, -300]]) {
      const rings = sweptRings(RECT, dx, dy);
      // Midpoint between the footprint centre and where it lands.
      const cx = 120 + dx / 2;
      const cy = 110 + dy / 2;
      expect(
        windingAt(rings, cx, cy),
        `corridor cancelled to winding 0 for offset ${dx},${dy} — it would render invisible`,
      ).not.toBe(0);
    }
  });

  it('covers both the footprint and its landing point', () => {
    const rings = sweptRings(RECT, 300, 0);
    expect(windingAt(rings, 120, 110), 'footprint unfilled').not.toBe(0);
    expect(windingAt(rings, 420, 110), 'translated copy unfilled').not.toBe(0);
  });

  it('leaves the area outside the sweep alone', () => {
    const rings = sweptRings(RECT, 300, 0);
    // Well behind the building, opposite the shadow direction.
    expect(windingAt(rings, -200, 110)).toBe(0);
    // Far to the side.
    expect(windingAt(rings, 120, 900)).toBe(0);
  });

  it('writes straight into a Path2D-shaped sink without allocating rings', () => {
    let ops = 0;
    emitSweptPath(
      { moveTo: () => { ops++; }, lineTo: () => { ops++; }, closePath: () => { ops++; } },
      RECT,
      50,
      50,
    );
    expect(ops).toBeGreaterThan(0);
  });
});

describe('simplifyProjected', () => {
  it('drops sub-pixel detail but keeps the ring closed', () => {
    const dense: Pt[] = [[0, 0], [0.2, 0], [0.4, 0], [40, 0], [40, 20], [0, 20], [0, 0]];
    const out = simplifyProjected(dense, 1.5);
    expect(out.length).toBeLessThan(dense.length);
    expect(out[0]).toEqual(dense[0]);
    expect(out[out.length - 1]).toEqual(dense[dense.length - 1]);
  });

  it('never collapses a ring below a drawable triangle', () => {
    const tiny: Pt[] = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]];
    expect(simplifyProjected(tiny, 50).length).toBeGreaterThanOrEqual(4);
  });
});

describe('Web Mercator', () => {
  it('round-trips a Finnish coordinate', () => {
    const [x, y] = lonLatToMercator(24.9384, 60.1699);
    const [lon, lat] = mercatorToLonLat(x, y);
    expect(lon).toBeCloseTo(24.9384, 9);
    expect(lat).toBeCloseTo(60.1699, 9);
  });

  it('puts the origin at the centre of the unit square and grows y southward', () => {
    expect(lonLatToMercator(0, 0)).toEqual([0.5, 0.5]);
    const [, north] = lonLatToMercator(24.9, 61);
    const [, south] = lonLatToMercator(24.9, 60);
    // Screen and Mercator y both point down, which is what lets the renderer
    // treat the projection as an orientation-PRESERVING affine map.
    expect(south).toBeGreaterThan(north);
  });

  it('stays finite at the poles rather than diverging', () => {
    expect(Number.isFinite(lonLatToMercator(0, 90)[1])).toBe(true);
    expect(Number.isFinite(lonLatToMercator(0, -90)[1])).toBe(true);
  });
});

/** A 1:1 Mercator→screen transform scaled up so a building spans real pixels. */
const SCALE = 200_000_000;
const FLAT: Affine = { ox: 0, oy: 0, px: 0, py: 0, ax: SCALE, ay: 0, bx: 0, by: SCALE };

/** A small square building near Helsinki centre, given clockwise on screen. */
const SQUARE: Ring = [
  [24.9500, 60.1700],
  [24.9505, 60.1700],
  [24.9505, 60.1703],
  [24.9500, 60.1703],
  [24.9500, 60.1700],
];

describe('projectPrepared', () => {
  it('projects through the affine transform and reports the screen bounds', () => {
    const p = prepareBuilding({ ring: SQUARE, height: 20, estimated: false });
    projectPrepared(p, FLAT, 0);
    expect(p.sn).toBe(SQUARE.length);
    const [mx, my] = lonLatToMercator(SQUARE[0][0], SQUARE[0][1]);
    // Winding normalisation may reverse the ring, but a closed ring's first
    // vertex is its last, so vertex 0 is the same point either way.
    expect(p.sx[0]).toBeCloseTo(mx * SCALE, 3);
    expect(p.sy[0]).toBeCloseTo(my * SCALE, 3);
    expect(p.maxX).toBeGreaterThan(p.minX);
    expect(p.maxY).toBeGreaterThan(p.minY);
  });

  it('normalises winding whichever way the source ring runs', () => {
    // Mixed winding is what makes the nonzero union SUBTRACT instead of merge,
    // and city-model and OSM footprints do not agree on a convention.
    for (const ring of [SQUARE, [...SQUARE].reverse() as Ring]) {
      const p = prepareBuilding({ ring, height: 20, estimated: false });
      projectPrepared(p, FLAT, 0);
      expect(signedArea2Flat(p.sx, p.sy, p.sn)).toBeGreaterThan(0);
    }
  });

  it('drops sub-pixel vertices but never below a drawable ring', () => {
    // Same square with three extra vertices microscopically close together.
    const dense: Ring = [
      [24.95, 60.17],
      [24.950001, 60.17],
      [24.950002, 60.17],
      [24.9505, 60.17],
      [24.9505, 60.1703],
      [24.95, 60.1703],
      [24.95, 60.17],
    ];
    const p = prepareBuilding({ ring: dense, height: 20, estimated: false });
    projectPrepared(p, FLAT, 1.5);
    expect(p.sn).toBeLessThan(dense.length);
    expect(p.sn).toBeGreaterThanOrEqual(4);

    // A tolerance far larger than the building collapses the ring to a line, so
    // it is stood in with its own bounding box: five vertices, still drawable,
    // and indistinguishable from the real outline at the size that triggers it.
    const tiny = prepareBuilding({ ring: dense, height: 20, estimated: false });
    projectPrepared(tiny, FLAT, 1e9);
    expect(tiny.sn).toBe(5);
    expect([...tiny.sx.slice(0, 5)].sort((a, b) => a - b)).toEqual(
      [tiny.minX, tiny.minX, tiny.minX, tiny.maxX, tiny.maxX].sort((a, b) => a - b),
    );
    expect(signedArea2Flat(tiny.sx, tiny.sy, tiny.sn)).toBeGreaterThan(0);
  });

  it('keeps the ring closed after simplification', () => {
    const p = prepareBuilding({ ring: SQUARE, height: 20, estimated: false });
    projectPrepared(p, FLAT, 1.5);
    expect(p.sx[0]).toBeCloseTo(p.sx[p.sn - 1], 9);
    expect(p.sy[0]).toBeCloseTo(p.sy[p.sn - 1], 9);
  });

  it('reuses its buffers across cameras instead of reallocating', () => {
    const p = prepareBuilding({ ring: SQUARE, height: 20, estimated: false });
    const { sx, sy } = p;
    projectPrepared(p, FLAT, 0);
    const firstMinX = p.minX;
    const firstMinY = p.minY;
    projectPrepared(p, { ...FLAT, px: 500, py: 250 }, 0);
    expect(p.sx).toBe(sx);
    expect(p.sy).toBe(sy);
    // The second camera is the first translated by (500, 250), and the cached
    // bounds have to follow the camera or the viewport cull drops live buildings.
    expect(p.minX).toBeCloseTo(firstMinX + 500, 6);
    expect(p.minY).toBeCloseTo(firstMinY + 250, 6);
  });
});

/** Plain degree area, so strips at different latitudes stay additive. */
const degArea = (b: Bbox) => (b.north - b.south) * (b.east - b.west);

describe('bbox helpers', () => {
  const view: Bbox = { south: 60.16, west: 24.92, north: 60.18, east: 24.96 };

  it('pads by about the requested number of metres on every side', () => {
    const padded = padBbox(view, 1000);
    expect((padded.north - view.north) * 111_320).toBeCloseTo(1000, 0);
    expect((view.south - padded.south) * 111_320).toBeCloseTo(1000, 0);
    // Longitude degrees are shorter this far north, so the box grows more of them.
    const eastMetres =
      (padded.east - view.east) * 111_320 * Math.cos((60.17 * Math.PI) / 180);
    expect(eastMetres).toBeCloseTo(1000, 0);
  });

  it('measures area in km² allowing for the meridian convergence', () => {
    // 0.02 deg lat = 2.226 km; 0.04 deg lon at 60.17 deg N = 2.215 km.
    expect(bboxAreaKm2(view)).toBeCloseTo(4.931, 2);
    expect(bboxAreaKm2({ south: 1, north: 1, west: 1, east: 2 })).toBe(0);
  });

  it('answers containment and intersection', () => {
    const padded = padBbox(view, 500);
    expect(bboxContains(padded, view)).toBe(true);
    expect(bboxContains(view, padded)).toBe(false);
    expect(bboxContains(view, view)).toBe(true);
    expect(bboxIntersects(view, padded)).toBe(true);
    expect(bboxIntersects(view, { south: 0, west: 0, north: 1, east: 1 })).toBe(false);
  });
});

describe('bboxSubtract', () => {
  const area: Bbox = { south: 0, west: 0, north: 10, east: 10 };

  it('returns the whole area when nothing is cut out of it', () => {
    expect(bboxSubtract(area, { south: 20, west: 20, north: 30, east: 30 })).toEqual([area]);
  });

  it('returns nothing when the hole swallows the area', () => {
    expect(bboxSubtract(area, { south: -1, west: -1, north: 11, east: 11 })).toEqual([]);
  });

  it('decomposes a central hole into disjoint strips that conserve area', () => {
    const hole: Bbox = { south: 2, west: 3, north: 6, east: 7 };
    const parts = bboxSubtract(area, hole);
    expect(parts).toHaveLength(4);
    // Disjoint: overlapping strips would double-count buildings in the coverage
    // denominator and draw the same footprint twice.
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        expect(bboxIntersects(parts[i], parts[j]), `strips ${i} and ${j} overlap`).toBe(false);
      }
    }
    const covered = parts.reduce((sum, p) => sum + degArea(p), 0);
    expect(covered + degArea(hole)).toBeCloseTo(degArea(area), 9);
  });

  it('handles a hole that reaches an edge', () => {
    // Hole covers the whole top of the area — one strip below it, nothing else.
    const parts = bboxSubtract(area, { south: 6, west: -1, north: 11, east: 11 });
    expect(parts).toEqual([{ south: 0, west: 0, north: 6, east: 10 }]);
    const covered = parts.reduce((sum, p) => sum + degArea(p), 0);
    expect(covered).toBeCloseTo(degArea(area) - 10 * 4, 9);
  });

  it('clips strips to the area rather than to the hole', () => {
    // A hole hanging off the left edge: only a right strip survives, and it must
    // not extend past the area it was cut from.
    const parts = bboxSubtract(area, { south: -5, west: -5, north: 15, east: 4 });
    expect(parts).toEqual([{ south: 0, west: 4, north: 10, east: 10 }]);
  });
});

describe('feed registry', () => {
  it('only switches on feeds that are actually live', () => {
    const on = defaultEnabledFeeds();
    for (const id of on) {
      expect(ALL_FEEDS.find((f) => f.id === id)?.status).toBe('live');
    }
  });

  it('drops persisted ids that no longer name a live feed', () => {
    // A feed reverted from 'live' to 'planned', or renamed, must not come back
    // from localStorage as a toggle nothing responds to.
    //
    // The planned id is read OUT OF THE REGISTRY rather than named here. This
    // test used to hard-code 'trains', so wiring that feed up broke it — and a
    // test that fails when a feed goes live was pinning the registry's current
    // contents, not the behaviour of sanitizeEnabled.
    const planned = ALL_FEEDS.find((f) => f.status === 'planned');
    expect(planned, 'the registry should still list a planned feed').toBeDefined();
    const restored = sanitizeEnabled(['shadows', planned!.id, 'a_feed_that_never_existed']);
    expect(restored.has('shadows')).toBe(true);
    expect(restored.has(planned!.id)).toBe(false);
    expect(restored.has('a_feed_that_never_existed')).toBe(false);
  });

  it('gives every feed a label key and a unique id', () => {
    const ids = ALL_FEEDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const feed of ALL_FEEDS) expect(feed.labelKey).toMatch(/^live\.feed\./);
  });
});
