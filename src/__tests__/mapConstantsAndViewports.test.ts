/**
 * Tests for mapConstants.ts — ensures every region has a valid viewport
 * and the CITY_VIEWPORTS map includes the "all" view.
 *
 * Bugs here cause the map to initialize at the wrong location or zoom level
 * when switching regions.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_CENTER, DEFAULT_ZOOM, CITY_VIEWPORTS, getInitialZoom } from '../utils/mapConstants';
import { REGION_IDS } from '../utils/regions';

describe('DEFAULT_CENTER and DEFAULT_ZOOM', () => {
  it('defaults to Helsinki area coordinates', () => {
    expect(DEFAULT_CENTER[0]).toBeCloseTo(24.94, 1); // longitude
    expect(DEFAULT_CENTER[1]).toBeCloseTo(60.17, 1); // latitude
  });

  it('has a reasonable default zoom', () => {
    expect(DEFAULT_ZOOM).toBeGreaterThan(5);
    expect(DEFAULT_ZOOM).toBeLessThan(15);
  });

  it('getInitialZoom returns DEFAULT_ZOOM', () => {
    expect(getInitialZoom()).toBe(DEFAULT_ZOOM);
  });
});

describe('CITY_VIEWPORTS', () => {
  it('has an entry for every region', () => {
    for (const id of REGION_IDS) {
      expect(CITY_VIEWPORTS).toHaveProperty(id);
    }
  });

  it('has an "all" entry for the Finland-wide view', () => {
    expect(CITY_VIEWPORTS).toHaveProperty('all');
  });

  it('every viewport has valid center, zoom, and bounds', () => {
    for (const [key, vp] of Object.entries(CITY_VIEWPORTS)) {
      expect(vp.center).toHaveLength(2);
      expect(typeof vp.center[0]).toBe('number');
      expect(typeof vp.center[1]).toBe('number');
      expect(isFinite(vp.center[0])).toBe(true);
      expect(isFinite(vp.center[1])).toBe(true);

      expect(typeof vp.zoom).toBe('number');
      expect(vp.zoom).toBeGreaterThan(0);

      expect(vp.bounds).toHaveLength(4);
      expect(vp.bounds[2]).toBeGreaterThan(vp.bounds[0]); // maxLng > minLng
      expect(vp.bounds[3]).toBeGreaterThan(vp.bounds[1]); // maxLat > minLat
    }
  });

  it('region viewport centers are within their bounds', () => {
    for (const id of REGION_IDS) {
      const vp = CITY_VIEWPORTS[id];
      expect(vp.center[0]).toBeGreaterThanOrEqual(vp.bounds[0]); // lng >= minLng
      expect(vp.center[0]).toBeLessThanOrEqual(vp.bounds[2]); // lng <= maxLng
      expect(vp.center[1]).toBeGreaterThanOrEqual(vp.bounds[1]); // lat >= minLat
      expect(vp.center[1]).toBeLessThanOrEqual(vp.bounds[3]); // lat <= maxLat
    }
  });
});
