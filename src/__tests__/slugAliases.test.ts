import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs build script with no type declarations
import { toSlug, computeCurrentSlugs, mergeAliases, buildStubHtml } from '../../scripts/update_slug_aliases.mjs';

/**
 * IN-8: a renamed area must produce a redirect stub (canonical + refresh), not a 404.
 */
describe('slug aliases (IN-8)', () => {
  it('toSlug transliterates Finnish letters consistently with the prerenderer', () => {
    expect(toSlug('00100', 'Helsinki keskusta - Etu-Töölö')).toBe('00100-helsinki-keskusta-etu-toolo');
    expect(toSlug('33100', 'Tampere Keskus')).toBe('33100-tampere-keskus');
  });

  it('records old-slug → pno when an area is renamed', () => {
    const prev = { aliases: {}, slugs: { '00100': '00100-old-name' } };
    const features = [{ properties: { pno: '00100', nimi: 'New Name' } }];
    const next = mergeAliases(prev, computeCurrentSlugs(features));
    expect(next.slugs['00100']).toBe('00100-new-name');
    expect(next.aliases['00100-old-name']).toBe('00100'); // the retired slug now points at the pno
  });

  it('keeps existing aliases across runs and adds new ones', () => {
    const prev = { aliases: { '00100-ancient': '00100' }, slugs: { '00100': '00100-old', '00200': '00200-x' } };
    const features = [
      { properties: { pno: '00100', nimi: 'Newer' } },
      { properties: { pno: '00200', nimi: 'X' } },
    ];
    const next = mergeAliases(prev, computeCurrentSlugs(features));
    expect(next.aliases['00100-ancient']).toBe('00100'); // preserved
    expect(next.aliases['00100-old']).toBe('00100'); // newly retired
    expect(next.aliases['00200-x']).toBeUndefined(); // 00200 unchanged
  });

  it('does not alias a retired slug that is now another area\'s live slug', () => {
    // 00100 was "shared-slug"; 00200 now *is* "shared-slug" — no stub, it would shadow a live page.
    const prev = { aliases: {}, slugs: { '00100': 'shared-slug', '00200': '00200-old' } };
    const features = [
      { properties: { pno: '00100', nimi: 'Moved' } },
      { properties: { pno: '00200', nimi: 'Shared Slug' } }, // -> "00200-shared-slug", not "shared-slug"
    ];
    const next = mergeAliases(prev, computeCurrentSlugs(features));
    // 00100's old "shared-slug" is not any current slug, so it IS aliased (the guard only
    // fires on an exact collision). Verify the collision guard with an exact match:
    const prev2 = { aliases: {}, slugs: { '00100': '00200-x' } };
    const features2 = [
      { properties: { pno: '00100', nimi: 'Moved' } },          // 00100 -> 00100-moved
      { properties: { pno: '00200', nimi: 'X' } },              // 00200 -> 00200-x (== 00100's old slug)
    ];
    const next2 = mergeAliases(prev2, computeCurrentSlugs(features2));
    expect(next2.aliases['00200-x']).toBeUndefined(); // would shadow 00200's live page
    expect(next.aliases['shared-slug']).toBe('00100'); // safe alias retained
  });

  it('buildStubHtml emits a noindex canonical + meta refresh to the new URL', () => {
    const html = buildStubHtml('00100-old', '00100-new', 'en');
    expect(html).toContain('<link rel="canonical" href="https://naapurustot.fi/en/area/00100-new/" />');
    expect(html).toContain('http-equiv="refresh" content="0; url=https://naapurustot.fi/en/area/00100-new/"');
    expect(html).toContain('noindex');
  });
});
