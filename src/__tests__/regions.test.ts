/**
 * Tests for regions.ts — region configuration integrity.
 *
 * Bugs here cause wrong data loading, broken city selectors,
 * or municipalities mapped to the wrong region.
 */
import { describe, it, expect } from 'vitest';
import {
  REGIONS,
  REGION_IDS,
  REGION_IDS_WITH_DATA,
  ALL_FINLAND_VIEWPORT,
  getAllMunicipalityCodes,
  getRegionByMunicipality,
  regionCountry,
} from '../utils/regions';

describe('REGIONS configuration integrity', () => {
  it('has a non-empty set of regions', () => {
    expect(REGION_IDS.length).toBeGreaterThan(0);
  });

  it('every region has required fields', () => {
    for (const id of REGION_IDS) {
      const r = REGIONS[id];
      expect(r.labelKey).toBeTruthy();
      expect(r.center).toHaveLength(2);
      // Finland's or Sweden's longitude / latitude range, by the region's country.
      const [w, e, s, n] = regionCountry(id) === 'se' ? [10.5, 24.5, 55, 69.5] : [19, 32, 59, 71];
      expect(r.center[0]).toBeGreaterThan(w);
      expect(r.center[0]).toBeLessThan(e);
      expect(r.center[1]).toBeGreaterThan(s);
      expect(r.center[1]).toBeLessThan(n);
      expect(r.zoom).toBeGreaterThan(0);
      expect(r.bounds).toHaveLength(4);
      expect(r.municipalityCount ?? r.municipalityCodes.length).toBeGreaterThan(0);
      expect(r.dataFile).toMatch(/\.topojson$/);
    }
  });

  it('no municipality code appears in more than one region', () => {
    const seen = new Map<string, string>();
    for (const id of REGION_IDS) {
      for (const code of REGIONS[id].municipalityCodes) {
        if (seen.has(code)) {
          throw new Error(
            `Municipality ${code} appears in both ${seen.get(code)} and ${id}`,
          );
        }
        seen.set(code, id);
      }
    }
  });

  it('municipality codes are 3-digit (Finland) or 4-digit (Sweden) strings', () => {
    for (const id of REGION_IDS) {
      const re = regionCountry(id) === 'se' ? /^\d{4}$/ : /^\d{3}$/;
      for (const code of REGIONS[id].municipalityCodes) {
        expect(code).toMatch(re);
      }
    }
  });

  it("Sweden's 71 FA25 regions cover all 290 municipalities once", () => {
    const se = REGION_IDS.filter((id) => regionCountry(id) === 'se');
    expect(se).toHaveLength(71);
    expect(se.reduce((n, id) => n + (REGIONS[id].municipalityCount ?? 0), 0)).toBe(290);
  });

  it('bounds enclose the center point', () => {
    for (const id of REGION_IDS) {
      const r = REGIONS[id];
      const [west, south, east, north] = r.bounds;
      expect(r.center[0]).toBeGreaterThanOrEqual(west);
      expect(r.center[0]).toBeLessThanOrEqual(east);
      expect(r.center[1]).toBeGreaterThanOrEqual(south);
      expect(r.center[1]).toBeLessThanOrEqual(north);
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

  it('covers every region — all 69 seutukunnat are populated', () => {
    expect(REGION_IDS_WITH_DATA.length).toBe(REGION_IDS.length);
  });
});

describe('getAllMunicipalityCodes', () => {
  it('returns all codes from all regions', () => {
    const codes = getAllMunicipalityCodes();
    let expected = 0;
    for (const id of REGION_IDS) {
      expected += REGIONS[id].municipalityCodes.length;
    }
    expect(codes.length).toBe(expected);
  });

  it('returns array of strings', () => {
    const codes = getAllMunicipalityCodes();
    for (const code of codes) {
      expect(typeof code).toBe('string');
    }
  });
});

describe('getRegionByMunicipality', () => {
  it('finds Helsinki (091) → helsinki_metro', () => {
    expect(getRegionByMunicipality('091')).toBe('helsinki_metro');
  });

  it('finds Turku (853) → turku', () => {
    expect(getRegionByMunicipality('853')).toBe('turku');
  });

  it('returns null for unknown municipality code', () => {
    expect(getRegionByMunicipality('999')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getRegionByMunicipality('')).toBeNull();
  });

  it('finds every configured municipality code', () => {
    for (const id of REGION_IDS) {
      for (const code of REGIONS[id].municipalityCodes) {
        expect(getRegionByMunicipality(code)).toBe(id);
      }
    }
  });
});

describe('ALL_FINLAND_VIEWPORT', () => {
  it('has valid center within Finland', () => {
    expect(ALL_FINLAND_VIEWPORT.center[0]).toBeGreaterThan(19);
    expect(ALL_FINLAND_VIEWPORT.center[0]).toBeLessThan(32);
    expect(ALL_FINLAND_VIEWPORT.center[1]).toBeGreaterThan(59);
    expect(ALL_FINLAND_VIEWPORT.center[1]).toBeLessThan(71);
  });

  it('bounds cover all Finnish region centers', () => {
    const [west, south, east, north] = ALL_FINLAND_VIEWPORT.bounds;
    for (const id of REGION_IDS.filter((r) => regionCountry(r) === 'fi')) {
      const [lng, lat] = REGIONS[id].center;
      expect(lng).toBeGreaterThanOrEqual(west);
      expect(lng).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
  });
});
