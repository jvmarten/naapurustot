import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs build script with no type declarations
import { loadSeRegions, loadSeMunicipalities, buildSeRegionHub, buildSeMunicipalityHub, buildSeDirectorySection } from '../../scripts/prerender-hubs-se.mjs';
// @ts-expect-error — plain .mjs build script with no type declarations
import { escapeHtml } from '../../scripts/prerender-lib.mjs';
import fi from '../locales/fi.json';
import en from '../locales/en.json';
import sv from '../locales/sv.json';

/**
 * Sweden's FA25 region hubs (scripts/prerender-hubs-se.mjs). The page shell is
 * prerender-hubs.mjs's own (stubbed here to return its inputs); what is tested is what
 * the Swedish module puts in it.
 */
type Lang = 'fi' | 'en' | 'sv';
type Region = { id: string; count: number; totalPop: number; features: { properties: Record<string, unknown> }[] };
// vitest runs at the repo root; the app tsconfig carries no Node types, hence the cast.
const ROOT = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const LOCALES = { fi, en, sv } as Record<Lang, Record<string, string>>;
const PREFIX = { fi: '/kaupunki', en: '/en/city', sv: '/sv/stad' };
const AREA = { fi: '/alue', en: '/en/area', sv: '/sv/omrade' };
const MUNI = { fi: '/kunta', en: '/en/municipality', sv: '/sv/kommun' };
const h = {
  escapeHtml,
  fmtNum: (n: number) => String(Math.round(Number(n))),
  getRegionName: (id: string, lang: Lang) => LOCALES[lang][`city.${id}`] ?? id,
  toSlug: (pno: string, nimi: string) => `${pno.toLowerCase()}-${nimi.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  htmlPage: (o: Record<string, unknown>) => o,
  safeJson: (o: unknown) => JSON.stringify(o),
  cityUrl: (id: string, lang: Lang) => `https://naapurustot.fi${PREFIX[lang]}/${id}/`,
  dirUrl: (lang: Lang) => `https://naapurustot.fi/${lang}/`,
  LOCALES, LOCALE_TAG: { fi: 'fi-FI', en: 'en-US', sv: 'sv-SE' }, ORIGIN: 'https://naapurustot.fi',
  TEXT: { fi: { dirCrumb: 'Kaikki alueet' }, en: { dirCrumb: 'All areas' }, sv: { dirCrumb: 'Alla områden' } },
  AREA_PREFIX: AREA, CITY_PREFIX: PREFIX, DIRECTORY_PATH: { fi: '/kaupungit/', en: '/en/cities/', sv: '/sv/stader/' },
  MUNI_PREFIX: MUNI,
  muniUrl: (slug: string, lang: Lang) => `https://naapurustot.fi${MUNI[lang]}/${slug}/`,
};
// prerender-hubs.mjs's slugify.
const slugify = (t: string) => t.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/å/g, 'a')
  .normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const regions: Region[] = loadSeRegions(ROOT);
type Muni = { name: string; code: string; slug: string; regionId: string; count: number; kommun: Record<string, number> };
const munis: Muni[] = loadSeMunicipalities(regions, slugify, new Set(['espoo']));

describe('Swedish region hubs', () => {
  it('cover all 71 FA25 regions and every DeSO once', () => {
    expect(regions).toHaveLength(71);
    expect(regions.every((r) => r.id.startsWith('se_'))).toBe(true);
    expect(regions.reduce((s, r) => s + r.count, 0)).toBe(6160);
  });

  it('link every area of the region to its profile page, in each language', () => {
    const r = regions.find((x) => x.id === 'se_lulea')!;
    for (const lang of ['fi', 'en', 'sv'] as Lang[]) {
      const page = buildSeRegionHub(r, lang, h) as { body: string; canonical: string; alternates: Record<Lang, string>; footer: string };
      expect(page.canonical).toBe(`https://naapurustot.fi${PREFIX[lang]}/se_lulea/`);
      expect(page.alternates.sv).toBe('https://naapurustot.fi/sv/stad/se_lulea/');
      const links = page.body.match(new RegExp(`href="${AREA[lang]}/[^"]+/"`, 'g')) ?? [];
      expect(links).toHaveLength(r.count);
      // SCB's figures in kronor; nothing in euros, nothing credited to Statistics Finland.
      expect(page.body).toMatch(/ kr</);
      expect(page.body).not.toMatch(/€/);
      expect(page.footer).toMatch(/SCB/);
    }
  });

  it('list the Swedish regions on the directory page', () => {
    const html = buildSeDirectorySection(regions, 'en', h);
    expect(html.match(/href="\/en\/city\/se_[^"]+\/"/g)).toHaveLength(71);
  });
});

describe('Swedish kommun pages', () => {
  it('cover every kommun of a multi-kommun region, each DeSO once, with unique slugs', () => {
    // 290 kommuner, of which 25 are alone in their FA25 region (the region hub is their page).
    expect(munis).toHaveLength(265);
    expect(new Set(munis.map((m) => m.slug)).size).toBe(265);
    const multi = regions.filter((r) => new Set(r.features.map((f) => f.properties.municipality)).size > 1);
    expect(munis.reduce((s, m) => s + m.count, 0)).toBe(multi.reduce((s, r) => s + r.count, 0));
  });

  it('give a shared slug the kommun code (Habo and Håbo)', () => {
    const habo = munis.filter((m) => m.slug.startsWith('habo'));
    expect(habo.map((m) => m.slug).sort()).toEqual(habo.map((m) => `habo-${m.code}`).sort());
    expect(habo).toHaveLength(2);
  });

  it('show a kommun figure only where every DeSO carries the same value', () => {
    const sthlm = munis.find((m) => m.name === 'Stockholm')!;
    // Rent is per city district in Stockholm, so it is no single kommun figure.
    expect(sthlm.kommun.rent_sqm_month_sek).toBeUndefined();
    expect(sthlm.kommun.he_kika).toBeGreaterThan(30);
  });

  it('link the kommun\'s areas and its region, and are linked from the region hub', () => {
    const m = munis.find((x) => x.name === 'Solna')!;
    const region = regions.find((r) => r.id === m.regionId)!;
    for (const lang of ['fi', 'en', 'sv'] as Lang[]) {
      const page = buildSeMunicipalityHub(m, lang, h) as { body: string; canonical: string };
      expect(page.canonical).toBe(`https://naapurustot.fi${MUNI[lang]}/${m.slug}/`);
      expect(page.body.match(new RegExp(`href="${AREA[lang]}/[^"]+/"`, 'g'))).toHaveLength(m.count);
      expect(page.body).toContain(`href="${PREFIX[lang]}/${m.regionId}/"`);
      expect(page.body).not.toMatch(/€/);
      const hub = buildSeRegionHub(region, lang, h) as { body: string };
      expect(hub.body).toContain(`href="${MUNI[lang]}/${m.slug}/"`);
    }
  });
});
