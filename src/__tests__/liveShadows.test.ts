import { describe, it, expect } from 'vitest';
import {
  parseHeightTag,
  parseLevelsTag,
  heightFromTags,
  offsetPoint,
  shadowRings,
  type Building,
  type Ring,
} from '../live/shadows';
import { defaultEnabledFeeds, sanitizeEnabled, ALL_FEEDS } from '../live/feeds';

/** A 20 m square building, roughly 20 m on a side, near Helsinki centre. */
const SQUARE: Ring = [
  [24.9384, 60.1699],
  [24.93876, 60.1699],
  [24.93876, 60.17008],
  [24.9384, 60.17008],
  [24.9384, 60.1699],
];
const BUILDING: Building = { ring: SQUARE, height: 20, estimated: false };

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

describe('shadowRings', () => {
  it('casts nothing once the sun is at or below the horizon', () => {
    expect(shadowRings(BUILDING, 0, 180)).toEqual([]);
    expect(shadowRings(BUILDING, -10, 180)).toEqual([]);
  });

  it('returns the footprint, its translation, and one sweep quad per edge', () => {
    const rings = shadowRings(BUILDING, 45, 0);
    // SQUARE is closed, so it has 5 points = 4 edges.
    expect(rings).toHaveLength(2 + 4);
    expect(rings[0]).toEqual(SQUARE);
  });

  it('translates the shadow along the shadow bearing, not the sun bearing', () => {
    // Bearing 0 = due north, so every translated vertex must move north.
    const rings = shadowRings(BUILDING, 45, 0);
    const translated = rings[1];
    for (let i = 0; i < SQUARE.length; i++) {
      expect(translated[i][1]).toBeGreaterThan(SQUARE[i][1]);
    }
  });

  it('lengthens the shadow as the sun drops', () => {
    const northLatAt = (altitude: number) => shadowRings(BUILDING, altitude, 0)[1][0][1];
    expect(northLatAt(20)).toBeGreaterThan(northLatAt(60));
  });

  it('clamps an extreme near-horizon shadow instead of emitting a kilometres-long smear', () => {
    // At 0.05° a 20 m building would geometrically cast ~23 km.
    const translated = shadowRings(BUILDING, 0.05, 0)[1];
    const metresNorth = (translated[0][1] - SQUARE[0][1]) * 111_320;
    expect(metresNorth).toBeLessThanOrEqual(2001);
    expect(metresNorth).toBeGreaterThan(1999);
  });

  it('produces sweep quads that join each footprint edge to its translation', () => {
    const rings = shadowRings(BUILDING, 45, 0);
    const quad = rings[2];
    expect(quad).toHaveLength(5);
    expect(quad[0]).toEqual(SQUARE[0]);
    expect(quad[1]).toEqual(SQUARE[1]);
    expect(quad[4]).toEqual(SQUARE[0]);
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
