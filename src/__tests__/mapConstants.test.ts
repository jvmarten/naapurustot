/**
 * Tests for utils/mapConstants.ts — per-region viewport map.
 *
 * Risk: if CITY_VIEWPORTS drifts from REGIONS (new region added but not wired
 * into the viewport map), the user lands in the middle of the Baltic sea when
 * switching to that city. This guards against that by asserting every region
 * has a viewport, plus sanity bounds.
 */
import { describe, it, expect } from 'vitest';
import { CITY_VIEWPORTS, DEFAULT_CENTER, DEFAULT_ZOOM, getInitialZoom } from '../utils/mapConstants';
import { REGION_IDS, REGIONS } from '../utils/regions';

describe('CITY_VIEWPORTS', () => {
  it('has an entry for every region in REGIONS', () => {
    for (const id of REGION_IDS) {
      expect(CITY_VIEWPORTS[id], `missing viewport for region ${id}`).toBeDefined();
    }
  });

  it('has an "all" viewport for the all-cities view', () => {
    expect(CITY_VIEWPORTS.all).toBeDefined();
    expect(CITY_VIEWPORTS.all.zoom).toBeLessThan(8); // continental view
  });

  it('viewports mirror REGIONS config exactly (no drift)', () => {
    for (const id of REGION_IDS) {
      const vp = CITY_VIEWPORTS[id];
      expect(vp.center).toEqual(REGIONS[id].center);
      expect(vp.zoom).toBe(REGIONS[id].zoom);
      expect(vp.bounds).toEqual(REGIONS[id].bounds);
    }
  });

  it('all bounds are 4-tuples of [minLng, minLat, maxLng, maxLat] in Finland range', () => {
    for (const id of REGION_IDS) {
      const [minLng, minLat, maxLng, maxLat] = CITY_VIEWPORTS[id].bounds;
      expect(minLng).toBeLessThan(maxLng);
      expect(minLat).toBeLessThan(maxLat);
      // Finland roughly spans [19, 59] → [32, 71]
      expect(minLng).toBeGreaterThan(18);
      expect(maxLng).toBeLessThan(33);
      expect(minLat).toBeGreaterThan(58);
      expect(maxLat).toBeLessThan(71);
    }
  });

  it('centers fall inside the corresponding bounds', () => {
    for (const id of REGION_IDS) {
      const { center, bounds } = CITY_VIEWPORTS[id];
      const [minLng, minLat, maxLng, maxLat] = bounds;
      expect(center[0]).toBeGreaterThanOrEqual(minLng);
      expect(center[0]).toBeLessThanOrEqual(maxLng);
      expect(center[1]).toBeGreaterThanOrEqual(minLat);
      expect(center[1]).toBeLessThanOrEqual(maxLat);
    }
  });
});

describe('DEFAULT_CENTER / DEFAULT_ZOOM', () => {
  it('DEFAULT_CENTER is a [lng, lat] tuple near Helsinki', () => {
    expect(DEFAULT_CENTER).toHaveLength(2);
    // Helsinki roughly (24.94, 60.17) — env override is possible but Finland-bound.
    expect(DEFAULT_CENTER[0]).toBeGreaterThan(19);
    expect(DEFAULT_CENTER[0]).toBeLessThan(33);
    expect(DEFAULT_CENTER[1]).toBeGreaterThan(58);
    expect(DEFAULT_CENTER[1]).toBeLessThan(71);
  });

  it('DEFAULT_ZOOM is a sensible city-level zoom', () => {
    expect(DEFAULT_ZOOM).toBeGreaterThan(5);
    expect(DEFAULT_ZOOM).toBeLessThan(20);
    expect(getInitialZoom()).toBe(DEFAULT_ZOOM);
  });
});
