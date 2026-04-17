import { describe, it, expect } from 'vitest';
import { envNum, DEFAULT_CENTER, DEFAULT_ZOOM, MAP_MIN_ZOOM, MAP_MAX_ZOOM, getInitialZoom, CITY_VIEWPORTS } from '../utils/mapConstants';

describe('envNum', () => {
  it('returns fallback for null/undefined env var', () => {
    expect(envNum('NONEXISTENT_VAR', 42)).toBe(42);
  });

  it('returns fallback for empty string env var', () => {
    expect(envNum('', 42)).toBe(42);
  });

  it('returns fallback for non-numeric env var value', () => {
    const orig = import.meta.env['VITE_TEST_VAR'];
    import.meta.env['VITE_TEST_VAR'] = 'not_a_number';
    expect(envNum('VITE_TEST_VAR', 99)).toBe(99);
    if (orig === undefined) {
      delete import.meta.env['VITE_TEST_VAR'];
    } else {
      import.meta.env['VITE_TEST_VAR'] = orig;
    }
  });

  it('returns the numeric value for valid numeric env var', () => {
    import.meta.env['VITE_TEST_NUM'] = '123.45';
    expect(envNum('VITE_TEST_NUM', 0)).toBe(123.45);
    delete import.meta.env['VITE_TEST_NUM'];
  });

  it('returns fallback for NaN string', () => {
    import.meta.env['VITE_TEST_NAN'] = 'NaN';
    expect(envNum('VITE_TEST_NAN', 5)).toBe(5);
    delete import.meta.env['VITE_TEST_NAN'];
  });

  it('returns fallback for Infinity string', () => {
    import.meta.env['VITE_TEST_INF'] = 'Infinity';
    expect(envNum('VITE_TEST_INF', 5)).toBe(5);
    delete import.meta.env['VITE_TEST_INF'];
  });
});

describe('default map constants', () => {
  it('DEFAULT_CENTER is a valid [lng, lat] tuple', () => {
    expect(DEFAULT_CENTER).toHaveLength(2);
    expect(DEFAULT_CENTER[0]).toBeGreaterThan(20);
    expect(DEFAULT_CENTER[0]).toBeLessThan(30);
    expect(DEFAULT_CENTER[1]).toBeGreaterThan(59);
    expect(DEFAULT_CENTER[1]).toBeLessThan(65);
  });

  it('DEFAULT_ZOOM is a reasonable zoom level', () => {
    expect(DEFAULT_ZOOM).toBeGreaterThan(5);
    expect(DEFAULT_ZOOM).toBeLessThan(15);
  });

  it('MAP_MIN_ZOOM < MAP_MAX_ZOOM', () => {
    expect(MAP_MIN_ZOOM).toBeLessThan(MAP_MAX_ZOOM);
  });

  it('getInitialZoom returns DEFAULT_ZOOM', () => {
    expect(getInitialZoom()).toBe(DEFAULT_ZOOM);
  });
});

describe('CITY_VIEWPORTS', () => {
  it('has an "all" viewport for Finland-wide view', () => {
    expect(CITY_VIEWPORTS['all']).toBeDefined();
    expect(CITY_VIEWPORTS['all'].center).toHaveLength(2);
    expect(CITY_VIEWPORTS['all'].zoom).toBeGreaterThan(0);
    expect(CITY_VIEWPORTS['all'].bounds).toHaveLength(4);
  });

  it('has viewports for all region IDs', () => {
    expect(CITY_VIEWPORTS['helsinki_metro']).toBeDefined();
    expect(CITY_VIEWPORTS['helsinki_metro'].center).toHaveLength(2);
  });

  it('all viewports have valid bounds [minLng, minLat, maxLng, maxLat]', () => {
    for (const [_key, vp] of Object.entries(CITY_VIEWPORTS)) {
      const [minLng, minLat, maxLng, maxLat] = vp.bounds;
      expect(minLng).toBeLessThan(maxLng);
      expect(minLat).toBeLessThan(maxLat);
    }
  });
});
