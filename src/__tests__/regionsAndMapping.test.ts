/**
 * Tests for regions.ts utility functions and data integrity.
 *
 * getRegionByMunicipality is used to route incoming data to the correct
 * region — a bug here means neighborhoods appear in the wrong city or
 * don't appear at all.
 */
import { describe, it, expect } from 'vitest';
import {
  REGIONS,
  REGION_IDS,
  REGION_IDS_WITH_DATA,
  ALL_FINLAND_VIEWPORT,
  getAllMunicipalityCodes,
  getRegionByMunicipality,
} from '../utils/regions';

describe('REGIONS data integrity', () => {
  it('REGION_IDS matches REGIONS keys', () => {
    expect(REGION_IDS).toEqual(Object.keys(REGIONS));
  });

  it('every region has a valid center within Finland bounding box', () => {
    for (const id of REGION_IDS) {
      const { center } = REGIONS[id];
      expect(center[0]).toBeGreaterThan(19); // longitude
      expect(center[0]).toBeLessThan(32);
      expect(center[1]).toBeGreaterThan(59); // latitude
      expect(center[1]).toBeLessThan(71);
    }
  });

  it('every region has at least one municipality code', () => {
    for (const id of REGION_IDS) {
      expect(REGIONS[id].municipalityCodes.length).toBeGreaterThan(0);
    }
  });

  it('every region has a valid zoom level', () => {
    for (const id of REGION_IDS) {
      expect(REGIONS[id].zoom).toBeGreaterThan(0);
      expect(REGIONS[id].zoom).toBeLessThan(20);
    }
  });

  it('every region bounds has correct order [minLng, minLat, maxLng, maxLat]', () => {
    for (const id of REGION_IDS) {
      const [minLng, minLat, maxLng, maxLat] = REGIONS[id].bounds;
      expect(maxLng).toBeGreaterThan(minLng);
      expect(maxLat).toBeGreaterThan(minLat);
    }
  });

  it('every region has a dataFile ending in .topojson', () => {
    for (const id of REGION_IDS) {
      expect(REGIONS[id].dataFile).toMatch(/\.topojson$/);
    }
  });
});

describe('REGION_IDS_WITH_DATA', () => {
  it('is a subset of REGION_IDS', () => {
    for (const id of REGION_IDS_WITH_DATA) {
      expect(REGION_IDS).toContain(id);
    }
  });

  it('includes at least helsinki_metro', () => {
    expect(REGION_IDS_WITH_DATA).toContain('helsinki_metro');
  });
});

describe('getAllMunicipalityCodes', () => {
  it('returns all codes from all regions', () => {
    const codes = getAllMunicipalityCodes();
    let expectedCount = 0;
    for (const id of REGION_IDS) {
      expectedCount += REGIONS[id].municipalityCodes.length;
    }
    expect(codes.length).toBe(expectedCount);
  });

  it('no municipality code appears in multiple regions', () => {
    const seen = new Map<string, string>();
    for (const id of REGION_IDS) {
      for (const code of REGIONS[id].municipalityCodes) {
        if (seen.has(code)) {
          // This would be a data bug — fail with a clear message
          expect.fail(`Municipality ${code} in both ${seen.get(code)} and ${id}`);
        }
        seen.set(code, id);
      }
    }
  });
});

describe('getRegionByMunicipality', () => {
  it('returns helsinki_metro for Helsinki code 091', () => {
    expect(getRegionByMunicipality('091')).toBe('helsinki_metro');
  });

  it('returns turku for Turku code 853', () => {
    expect(getRegionByMunicipality('853')).toBe('turku');
  });

  it('returns tampere for Tampere code 837', () => {
    expect(getRegionByMunicipality('837')).toBe('tampere');
  });

  it('returns null for unknown municipality code', () => {
    expect(getRegionByMunicipality('999')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getRegionByMunicipality('')).toBeNull();
  });

  it('finds every municipality code in the system', () => {
    const allCodes = getAllMunicipalityCodes();
    for (const code of allCodes) {
      const region = getRegionByMunicipality(code);
      expect(region).not.toBeNull();
    }
  });
});

describe('ALL_FINLAND_VIEWPORT', () => {
  it('covers the full extent of Finland', () => {
    expect(ALL_FINLAND_VIEWPORT.bounds[0]).toBeLessThan(20); // west
    expect(ALL_FINLAND_VIEWPORT.bounds[1]).toBeLessThan(60); // south
    expect(ALL_FINLAND_VIEWPORT.bounds[2]).toBeGreaterThan(30); // east
    expect(ALL_FINLAND_VIEWPORT.bounds[3]).toBeGreaterThan(69); // north
  });

  it('has a zoomed-out level suitable for seeing all of Finland', () => {
    expect(ALL_FINLAND_VIEWPORT.zoom).toBeLessThan(6);
  });
});
