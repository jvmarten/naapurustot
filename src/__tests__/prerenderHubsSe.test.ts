import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs build script with no type declarations
import { loadSeRegions, buildSeRegionHub, buildSeDirectorySection } from '../../scripts/prerender-hubs-se.mjs';
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
};

const regions: Region[] = loadSeRegions(ROOT);

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
