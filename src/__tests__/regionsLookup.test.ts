import { describe, it, expect } from 'vitest';
import { REGIONS, REGION_IDS, REGION_IDS_WITH_DATA, ALL_FINLAND_VIEWPORT, getAllMunicipalityCodes, getRegionByMunicipality } from '../utils/regions';

describe('REGIONS — structural integrity', () => {
  it('every region has required fields', () => {
    for (const id of REGION_IDS) {
      const r = REGIONS[id];
      expect(r.labelKey).toBeTruthy();
      expect(r.center).toHaveLength(2);
      expect(typeof r.center[0]).toBe('number');
      expect(typeof r.center[1]).toBe('number');
      expect(typeof r.zoom).toBe('number');
      expect(r.bounds).toHaveLength(4);
      expect(r.municipalityCodes.length).toBeGreaterThan(0);
      expect(r.dataFile).toMatch(/\.topojson$/);
    }
  });

  it('all region IDs match keys in REGIONS object', () => {
    expect(REGION_IDS).toEqual(Object.keys(REGIONS));
  });

  it('REGION_IDS_WITH_DATA is a subset of REGION_IDS', () => {
    for (const id of REGION_IDS_WITH_DATA) {
      expect(REGION_IDS).toContain(id);
      expect(REGIONS[id].hasData).toBe(true);
    }
  });

  it('no duplicate municipality codes across regions', () => {
    const seen = new Set<string>();
    for (const id of REGION_IDS) {
      for (const code of REGIONS[id].municipalityCodes) {
        expect(seen.has(code)).toBe(false);
        seen.add(code);
      }
    }
  });

  it('bounds are valid (minLon < maxLon, minLat < maxLat)', () => {
    for (const id of REGION_IDS) {
      const [minLon, minLat, maxLon, maxLat] = REGIONS[id].bounds;
      expect(minLon).toBeLessThan(maxLon);
      expect(minLat).toBeLessThan(maxLat);
    }
  });

  it('center is within bounds for each region', () => {
    for (const id of REGION_IDS) {
      const [lng, lat] = REGIONS[id].center;
      const [minLon, minLat, maxLon, maxLat] = REGIONS[id].bounds;
      expect(lng).toBeGreaterThanOrEqual(minLon);
      expect(lng).toBeLessThanOrEqual(maxLon);
      expect(lat).toBeGreaterThanOrEqual(minLat);
      expect(lat).toBeLessThanOrEqual(maxLat);
    }
  });
});

describe('getRegionByMunicipality', () => {
  it('returns correct region for Helsinki (091)', () => {
    expect(getRegionByMunicipality('091')).toBe('helsinki_metro');
  });

  it('returns correct region for Turku (853)', () => {
    expect(getRegionByMunicipality('853')).toBe('turku');
  });

  it('returns correct region for Tampere (837)', () => {
    expect(getRegionByMunicipality('837')).toBe('tampere');
  });

  it('returns null for unknown municipality code', () => {
    expect(getRegionByMunicipality('999')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getRegionByMunicipality('')).toBeNull();
  });

  it('finds region for every municipality code returned by getAllMunicipalityCodes', () => {
    const allCodes = getAllMunicipalityCodes();
    for (const code of allCodes) {
      const region = getRegionByMunicipality(code);
      expect(region).not.toBeNull();
    }
  });
});

describe('getAllMunicipalityCodes', () => {
  it('returns all codes from all regions', () => {
    const allCodes = getAllMunicipalityCodes();
    let expectedCount = 0;
    for (const id of REGION_IDS) {
      expectedCount += REGIONS[id].municipalityCodes.length;
    }
    expect(allCodes.length).toBe(expectedCount);
  });

  it('contains Helsinki code 091', () => {
    expect(getAllMunicipalityCodes()).toContain('091');
  });
});

describe('ALL_FINLAND_VIEWPORT', () => {
  it('has valid center and zoom', () => {
    expect(ALL_FINLAND_VIEWPORT.center).toHaveLength(2);
    expect(ALL_FINLAND_VIEWPORT.zoom).toBeGreaterThan(0);
  });

  it('bounds cover Finland (roughly 60-70°N, 20-30°E)', () => {
    const [minLon, minLat, maxLon, maxLat] = ALL_FINLAND_VIEWPORT.bounds;
    expect(minLat).toBeLessThan(60);
    expect(maxLat).toBeGreaterThan(69);
    expect(minLon).toBeLessThan(21);
    expect(maxLon).toBeGreaterThan(29);
  });
});
