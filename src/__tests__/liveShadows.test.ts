import { describe, it, expect } from 'vitest';
import {
  parseHeightTag,
  parseLevelsTag,
  heightFromTags,
  offsetPoint,
  sweptRings,
  emitSweptPath,
  signedArea2,
  shadowLengthMetres,
  simplifyProjected,
  type Pt,
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

  it('clamps a near-horizon shadow instead of emitting a kilometres-long smear', () => {
    // At 0.05 degrees a 20 m building would geometrically cast ~23 km.
    expect(shadowLengthMetres(20, 0.05)).toBe(2000);
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
    const restored = sanitizeEnabled(['shadows', 'trains', 'a_feed_that_never_existed']);
    expect(restored.has('shadows')).toBe(true);
    expect(restored.has('trains')).toBe(false);
    expect(restored.has('a_feed_that_never_existed')).toBe(false);
  });

  it('gives every feed a label key and a unique id', () => {
    const ids = ALL_FEEDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const feed of ALL_FEEDS) expect(feed.labelKey).toMatch(/^live\.feed\./);
  });
});
