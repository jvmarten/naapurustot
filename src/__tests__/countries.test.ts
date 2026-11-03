import { describe, it, expect } from 'vitest';
import {
  COUNTRIES, COUNTRY_IDS, HOME_COUNTRY, PREFIXED_COUNTRIES, areaCountry, countryDef, forCountry, regionCountry,
} from '../utils/countries';
import { countryOf, countryOfId, isAreaId } from '../utils/areaId';
import { REGION_IDS } from '../utils/regions';
import { LAYERS, ONLY_LAYERS, COUNTRY_LAYERS, layerInCountry } from '../utils/colorScales';
import { QUALITY_FACTORS } from '../utils/qualityIndex';

describe('country registry', () => {
  it('has HOME first, unprefixed, and every other country prefixed `xx_`', () => {
    expect(COUNTRIES[0].id).toBe(HOME_COUNTRY);
    expect(countryDef(HOME_COUNTRY).regionPrefix).toBe('');
    for (const c of PREFIXED_COUNTRIES) expect(c.regionPrefix, c.id).toMatch(/^[a-z]{2}_$/);
    expect(new Set(COUNTRIES.map((c) => c.iso3)).size).toBe(COUNTRIES.length);
  });

  it('keeps area-id patterns disjoint, so an id names its country', () => {
    const samples: Record<string, string> = { fi: '00100', se: '0180C1090' };
    for (const c of COUNTRIES) {
      const id = samples[c.id];
      expect(id, `add a sample id for ${c.id}`).toBeDefined();
      expect(COUNTRIES.filter((o) => o.area.test(id)).map((o) => o.id)).toEqual([c.id]);
      expect(areaCountry(id)).toBe(c.id);
      expect(countryOf(id)).toBe(c.id);
      expect(countryOfId(id)).toBe(c.id);
      expect(isAreaId(id)).toBe(true);
    }
    expect(areaCountry('all')).toBeNull();
  });

  it('assigns every region to a country by its prefix', () => {
    for (const id of REGION_IDS) {
      const c = regionCountry(id);
      expect(countryOfId(id)).toBe(c);
      expect(id.startsWith(countryDef(c).regionPrefix)).toBe(true);
    }
    for (const c of COUNTRY_IDS) expect(REGION_IDS.some((id) => regionCountry(id) === c), c).toBe(true);
  });

  it('looks per-country tables up with a HOME fallback', () => {
    const table = { se: 'own' };
    expect(forCountry(table, 'se', 'home')).toBe('own');
    expect(forCountry(table, 'fi', 'home')).toBe('home');
    expect(forCountry(table, null, 'home')).toBe('home');
    expect(forCountry(undefined, 'se', 'home')).toBe('home');
  });
});

describe('per-country tables name only known countries', () => {
  const known = new Set<string>(COUNTRY_IDS);
  const keysOf = (o: object | undefined) => Object.keys(o ?? {});

  it('layers', () => {
    for (const l of LAYERS) for (const k of keysOf(l.byCountry)) expect(known.has(k) && k !== HOME_COUNTRY, `${l.id}.${k}`).toBe(true);
    for (const k of [...keysOf(ONLY_LAYERS), ...keysOf(COUNTRY_LAYERS)]) expect(known.has(k) && k !== HOME_COUNTRY, k).toBe(true);
  });

  it('quality factors', () => {
    for (const f of QUALITY_FACTORS) for (const k of keysOf(f.byCountry)) expect(known.has(k) && k !== HOME_COUNTRY, `${f.id}.${k}`).toBe(true);
  });

  it("HOME has every layer but the other countries' own", () => {
    for (const l of LAYERS) {
      const foreignOnly = Object.values(ONLY_LAYERS).some((s) => s.has(l.id));
      expect(layerInCountry(l.id, HOME_COUNTRY), l.id).toBe(!foreignOnly);
    }
  });
});
