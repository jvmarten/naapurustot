import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs build script with no type declarations
import { generateSePage } from '../../scripts/prerender-se.mjs';
// @ts-expect-error — plain .mjs build script with no type declarations
import { escapeHtml, assertHeadIntegrity } from '../../scripts/prerender-lib.mjs';
import template from '../../index.html?raw';
import fi from '../locales/fi.json';
import en from '../locales/en.json';
import sv from '../locales/sv.json';

/**
 * Sweden's profile pages (scripts/prerender-se.mjs): 18,480 pages cloned from the same
 * template as Finland's, so the same head-integrity guard has to hold — and none of the
 * Finland-derived parts (FAQ, percentiles, Statistics Finland attribution) may leak in.
 */
const feature = {
  properties: {
    pno: '0180C1090', nimi: 'Farsta 5', namn: 'Farsta 5', municipality: 'Stockholm', city: 'se_stockholm_solna',
    lat: 59.24, lon: 18.09, he_vakiy: 1559, economic_standard_median: 305000, unemployment_rate: 6.8,
    ownership_rate: null,
  },
};
const ctx = {
  template,
  LOCALES: { fi, en, sv } as Record<string, Record<string, string>>,
  LOCALE_TAG: { fi: 'fi-FI', en: 'en-US', sv: 'sv-SE' },
  escapeHtml,
  toSlug: (pno: string, nimi: string) => `${pno.toLowerCase()}-${nimi.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  getRegionName: (city: string, lang: 'fi' | 'en' | 'sv') => ({ fi, en, sv }[lang] as Record<string, string>)[`city.${city}`] ?? '',
  localizeOgLocale: (html: string) => html,
  BUILD_DATE: '2026-10-27',
  regionAverages: { se_stockholm_solna: { he_vakiy: 2952877 } },
};

describe('Swedish profile pages', () => {
  for (const lang of ['fi', 'en', 'sv'] as const) {
    it(`builds a well-formed ${lang} page`, () => {
      const html: string = generateSePage(feature, lang, ctx);
      expect(() => assertHeadIntegrity(html, { context: lang, expectProfilePayload: true })).not.toThrow();
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toMatch(/hreflang="fi" href="https:\/\/naapurustot\.fi\/alue\/0180c1090-farsta-5\/"/);
      expect(html).toMatch(/hreflang="sv" href="https:\/\/naapurustot\.fi\/sv\/omrade\/0180c1090-farsta-5\/"/);
    });
  }

  it('attributes SCB, places the area in Sweden, and carries nothing derived from Finland', () => {
    const html: string = generateSePage(feature, 'en', ctx);
    expect(html).toContain('Data: Statistics Sweden (SCB), CC0');
    expect(html).toContain('"addressCountry":"SE"');
    expect(html).not.toContain('FAQPage');
    expect(html).not.toContain('Statistics Finland');
    expect(html).toContain('305,000 kr');
    // A suppressed or absent value is left out, never printed as 0.
    expect(html).not.toMatch(/Residents in owned homes/);
  });

  it("embeds the area and its region's averages for the client page", () => {
    const html: string = generateSePage(feature, 'fi', ctx);
    const m = html.match(/<script id="__naapurustot_profile__" type="application\/json">([\s\S]*?)<\/script>/);
    const payload = JSON.parse(m![1]);
    expect(payload.p.pno).toBe('0180C1090');
    expect(payload.avg.he_vakiy).toBe(2952877);
    expect(payload.pct).toBeNull();
  });
});
