import { describe, it, expect } from 'vitest';
import {
  REGIONS, REGION_IDS, REGION_IDS_WITH_DATA, ALL_FINLAND_VIEWPORT,
  getAllMunicipalityCodes, getRegionByMunicipality, type RegionId,
} from '../utils/regions';

describe('REGIONS config — structural integrity', () => {
  it('every region has required fields', () => {
    for (const id of REGION_IDS) {
      const r = REGIONS[id];
      expect(r.labelKey).toBeTruthy();
      expect(r.center).toHaveLength(2);
      expect(r.zoom).toBeGreaterThan(0);
      expect(r.bounds).toHaveLength(4);
      expect(r.municipalityCodes.length).toBeGreaterThan(0);
      expect(r.dataFile).toMatch(/\.topojson$/);
    }
  });

  it('center coordinates are within Finland', () => {
    for (const id of REGION_IDS) {
      const [lng, lat] = REGIONS[id].center;
      expect(lng).toBeGreaterThan(19);
      expect(lng).toBeLessThan(32);
      expect(lat).toBeGreaterThan(59);
      expect(lat).toBeLessThan(71);
    }
  });

  it('bounds are valid (min < max) and center is within bounds', () => {
    for (const id of REGION_IDS) {
      const [minLng, minLat, maxLng, maxLat] = REGIONS[id].bounds;
      expect(minLng).toBeLessThan(maxLng);
      expect(minLat).toBeLessThan(maxLat);
      const [lng, lat] = REGIONS[id].center;
      expect(lng).toBeGreaterThanOrEqual(minLng);
      expect(lng).toBeLessThanOrEqual(maxLng);
      expect(lat).toBeGreaterThanOrEqual(minLat);
      expect(lat).toBeLessThanOrEqual(maxLat);
    }
  });

  it('no duplicate municipality codes across regions', () => {
    const seen = new Map<string, RegionId>();
    for (const id of REGION_IDS) {
      for (const code of REGIONS[id].municipalityCodes) {
        expect(seen.has(code)).toBe(false);
        seen.set(code, id);
      }
    }
  });

  it('municipality codes are 3-digit strings', () => {
    for (const id of REGION_IDS) {
      for (const code of REGIONS[id].municipalityCodes) {
        expect(code).toMatch(/^\d{3}$/);
      }
    }
  });

  it('REGION_IDS_WITH_DATA only includes hasData: true', () => {
    for (const id of REGION_IDS_WITH_DATA) {
      expect(REGIONS[id].hasData).toBe(true);
    }
  });
});

describe('region lookup functions', () => {
  it('getAllMunicipalityCodes returns all codes', () => {
    const all = getAllMunicipalityCodes();
    let expected = 0;
    for (const id of REGION_IDS) expected += REGIONS[id].municipalityCodes.length;
    expect(all).toHaveLength(expected);
    expect(all).toContain('091');
  });

  it('getRegionByMunicipality returns correct region', () => {
    expect(getRegionByMunicipality('091')).toBe('helsinki_metro');
    expect(getRegionByMunicipality('853')).toBe('turku');
    expect(getRegionByMunicipality('999')).toBeNull();
  });
});

describe('ALL_FINLAND_VIEWPORT', () => {
  it('bounds encompass all regions', () => {
    const [minLng, minLat, maxLng, maxLat] = ALL_FINLAND_VIEWPORT.bounds;
    for (const id of REGION_IDS) {
      const [rMinLng, rMinLat, rMaxLng, rMaxLat] = REGIONS[id].bounds;
      expect(rMinLng).toBeGreaterThanOrEqual(minLng);
      expect(rMinLat).toBeGreaterThanOrEqual(minLat);
      expect(rMaxLng).toBeLessThanOrEqual(maxLng);
      expect(rMaxLat).toBeLessThanOrEqual(maxLat);
    }
  });
});
