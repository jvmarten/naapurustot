import { describe, it, expect } from 'vitest';
import {
  REGIONS,
  REGION_IDS,
  REGION_IDS_WITH_DATA,
  ALL_FINLAND_VIEWPORT,
  getAllMunicipalityCodes,
  getRegionByMunicipality,
  type RegionId,
} from '../utils/regions';

describe('regions', () => {
  describe('REGIONS config integrity', () => {
    it('has all REGION_IDS as keys', () => {
      const keys = Object.keys(REGIONS) as RegionId[];
      expect(keys).toEqual(REGION_IDS);
    });

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

    it('center coordinates are within bounds', () => {
      for (const id of REGION_IDS) {
        const r = REGIONS[id];
        const [minLon, minLat, maxLon, maxLat] = r.bounds;
        const [lon, lat] = r.center;
        expect(lon).toBeGreaterThanOrEqual(minLon);
        expect(lon).toBeLessThanOrEqual(maxLon);
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

    it('bounds have valid ordering (min < max)', () => {
      for (const id of REGION_IDS) {
        const [minLon, minLat, maxLon, maxLat] = REGIONS[id].bounds;
        expect(maxLon).toBeGreaterThan(minLon);
        expect(maxLat).toBeGreaterThan(minLat);
      }
    });
  });

  describe('REGION_IDS_WITH_DATA', () => {
    it('only includes regions with hasData: true', () => {
      for (const id of REGION_IDS_WITH_DATA) {
        expect(REGIONS[id].hasData).toBe(true);
      }
    });

    it('is a subset of REGION_IDS', () => {
      for (const id of REGION_IDS_WITH_DATA) {
        expect(REGION_IDS).toContain(id);
      }
    });

    it('includes helsinki_metro, turku, and tampere', () => {
      expect(REGION_IDS_WITH_DATA).toContain('helsinki_metro');
      expect(REGION_IDS_WITH_DATA).toContain('turku');
      expect(REGION_IDS_WITH_DATA).toContain('tampere');
    });
  });

  describe('getAllMunicipalityCodes', () => {
    it('returns all codes from all regions', () => {
      const all = getAllMunicipalityCodes();
      let expected = 0;
      for (const id of REGION_IDS) {
        expected += REGIONS[id].municipalityCodes.length;
      }
      expect(all).toHaveLength(expected);
    });

    it('includes Helsinki code 091', () => {
      expect(getAllMunicipalityCodes()).toContain('091');
    });

    it('includes Turku code 853', () => {
      expect(getAllMunicipalityCodes()).toContain('853');
    });
  });

  describe('getRegionByMunicipality', () => {
    it('returns helsinki_metro for Helsinki (091)', () => {
      expect(getRegionByMunicipality('091')).toBe('helsinki_metro');
    });

    it('returns helsinki_metro for Espoo (049)', () => {
      expect(getRegionByMunicipality('049')).toBe('helsinki_metro');
    });

    it('returns turku for Turku (853)', () => {
      expect(getRegionByMunicipality('853')).toBe('turku');
    });

    it('returns tampere for Tampere (837)', () => {
      expect(getRegionByMunicipality('837')).toBe('tampere');
    });

    it('returns null for unknown municipality code', () => {
      expect(getRegionByMunicipality('999')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(getRegionByMunicipality('')).toBeNull();
    });

    it('finds every municipality code from every region', () => {
      for (const id of REGION_IDS) {
        for (const code of REGIONS[id].municipalityCodes) {
          expect(getRegionByMunicipality(code)).toBe(id);
        }
      }
    });
  });

  describe('ALL_FINLAND_VIEWPORT', () => {
    it('has valid center coordinates in Finland', () => {
      const [lon, lat] = ALL_FINLAND_VIEWPORT.center;
      expect(lon).toBeGreaterThan(19);
      expect(lon).toBeLessThan(32);
      expect(lat).toBeGreaterThan(59);
      expect(lat).toBeLessThan(71);
    });

    it('bounds cover all of Finland', () => {
      const [minLon, minLat, maxLon, maxLat] = ALL_FINLAND_VIEWPORT.bounds;
      // All region centers should be within the all-Finland viewport
      for (const id of REGION_IDS) {
        const [lon, lat] = REGIONS[id].center;
        expect(lon).toBeGreaterThanOrEqual(minLon);
        expect(lon).toBeLessThanOrEqual(maxLon);
        expect(lat).toBeGreaterThanOrEqual(minLat);
        expect(lat).toBeLessThanOrEqual(maxLat);
      }
    });
  });
});
