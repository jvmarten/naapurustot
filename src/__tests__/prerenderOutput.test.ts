import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs build script with no type declarations
import { escapeHtml, assertHeadIntegrity, replaceOnce, stripHomeOnlyPreloads } from '../../scripts/prerender-lib.mjs';

/**
 * IN-6: prerender output regression tests.
 *
 * scripts/prerender.mjs assembles ~9,000 SEO pages with first-match head-token
 * regexes. CLAUDE.md warns that a doubled `<title>`/`</head>`/JSON-LD token silently
 * corrupts EVERY page. `assertHeadIntegrity` is the build-time guard that turns that
 * silent corruption into a loud failure; these tests pin its invariants on fixtures
 * so the guard itself can't regress.
 */

/** A realistic, well-formed profile <head> + body payload, mirroring generatePage(). */
function goodProfileHtml(): string {
  const place = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Place', name: 'Kamppi' });
  const crumb = JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [] });
  const faq = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [{ '@type': 'Question', name: 'How big is Kamppi?', acceptedAnswer: { '@type': 'Answer', text: 'About 8,000.' } }],
  });
  const payload = JSON.stringify({ p: { pno: '00100', nimi: 'Kamppi', he_vakiy: 8000 }, avg: { he_vakiy: 5000 } });
  return `<!doctype html>
<html lang="fi">
  <head>
    <title>Kamppi (00100) – naapurustot.fi</title>
    <meta name="description" content="Kamppi (00100)." />
    <link rel="canonical" href="https://naapurustot.fi/alue/00100-kamppi/" />
    <link rel="alternate" hreflang="fi" href="https://naapurustot.fi/alue/00100-kamppi/" />
    <link rel="alternate" hreflang="en" href="https://naapurustot.fi/en/area/00100-kamppi/" />
    <link rel="alternate" hreflang="sv" href="https://naapurustot.fi/sv/omrade/00100-kamppi/" />
    <link rel="alternate" hreflang="x-default" href="https://naapurustot.fi/alue/00100-kamppi/" />
    <meta property="og:url" content="https://naapurustot.fi/alue/00100-kamppi/" />
    <script type="application/ld+json">${place}</script>
    <script type="application/ld+json">${crumb}</script>
    <script type="application/ld+json">${faq}</script>
  </head>
  <body>
    <div id="root"></div>
    <script id="__naapurustot_profile__" type="application/json">${payload}</script>
  </body>
</html>`;
}

/** A non-profile page (data-sources/privacy) that keeps the homepage JSON-LD but has
 *  no profile payload and no own FAQ — the homepage FAQPage is present and allowed. */
function goodSourcesHtml(): string {
  const homepageFaq = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] });
  const dataset = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Dataset', name: 'Sources' });
  return `<!doctype html>
<html lang="fi">
  <head>
    <title>Tietolähteet – naapurustot.fi</title>
    <link rel="canonical" href="https://naapurustot.fi/tietolahteet/" />
    <link rel="alternate" hreflang="fi" href="https://naapurustot.fi/tietolahteet/" />
    <link rel="alternate" hreflang="en" href="https://naapurustot.fi/en/data-sources/" />
    <link rel="alternate" hreflang="sv" href="https://naapurustot.fi/sv/datakallor/" />
    <link rel="alternate" hreflang="x-default" href="https://naapurustot.fi/tietolahteet/" />
    <meta property="og:url" content="https://naapurustot.fi/tietolahteet/" />
    <script type="application/ld+json">${homepageFaq}</script>
    <script type="application/ld+json">${dataset}</script>
  </head>
  <body><div id="root"></div></body>
</html>`;
}

/** IN-2: a well-formed hub/ranking/directory/landing page mirroring
 *  prerender-hubs.mjs htmlPage(): ItemList + BreadcrumbList JSON-LD, a full
 *  fi/en/sv + x-default hreflang cluster, single canonical/og:url/title, and NO
 *  FAQPage / NO profile payload (the default-flag guard htmlPage() now runs). */
function goodHubHtml(): string {
  const itemList = JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: [] });
  const crumb = JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [] });
  return `<!doctype html>
<html lang="fi">
  <head>
    <title>Helsingin seutukunta – naapurustot.fi</title>
    <meta name="description" content="Helsingin seutukunnan postinumeroalueet." />
    <link rel="canonical" href="https://naapurustot.fi/kaupunki/helsinki/" />
    <link rel="alternate" hreflang="fi" href="https://naapurustot.fi/kaupunki/helsinki/" />
    <link rel="alternate" hreflang="en" href="https://naapurustot.fi/en/city/helsinki/" />
    <link rel="alternate" hreflang="sv" href="https://naapurustot.fi/sv/stad/helsinki/" />
    <link rel="alternate" hreflang="x-default" href="https://naapurustot.fi/kaupunki/helsinki/" />
    <meta property="og:url" content="https://naapurustot.fi/kaupunki/helsinki/" />
    <script type="application/ld+json">${itemList}</script>
    <script type="application/ld+json">${crumb}</script>
  </head>
  <body><main></main></body>
</html>`;
}

describe('assertHeadIntegrity — hub pages (IN-2)', () => {
  it('accepts a well-formed hub with no FAQ/payload (default flags)', () => {
    expect(assertHeadIntegrity(goodHubHtml(), { context: 'kaupunki/helsinki' })).toBe(true);
  });

  it('throws when a head token is duplicated in a hub', () => {
    const html = goodHubHtml().replace('</head>', '    <title>Injected</title>\n  </head>');
    expect(() => assertHeadIntegrity(html, { context: 'dup-title-hub' })).toThrow();
  });

  it('throws when a hub is left with a single (lonely) hreflang link', () => {
    const html = goodHubHtml()
      .replace(/<link rel="alternate" hreflang="en"[^>]*>\n\s*/, '')
      .replace(/<link rel="alternate" hreflang="sv"[^>]*>\n\s*/, '')
      .replace(/<link rel="alternate" hreflang="x-default"[^>]*>\n\s*/, '');
    expect(() => assertHeadIntegrity(html, { context: 'lonely-hreflang-hub' })).toThrow();
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`Tom & "Jerry" <b>'x'</b>`)).toBe(
      'Tom &amp; &quot;Jerry&quot; &lt;b&gt;&#39;x&#39;&lt;/b&gt;',
    );
  });

  it('coerces non-strings and leaves safe text untouched', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml('Kamppi 00100')).toBe('Kamppi 00100');
  });
});

describe('assertHeadIntegrity — well-formed pages pass', () => {
  it('accepts a complete profile page (FAQ + payload expected)', () => {
    expect(assertHeadIntegrity(goodProfileHtml(), { context: 'alue/00100-kamppi', expectFaq: true, expectProfilePayload: true })).toBe(true);
  });

  it('accepts a data-sources page that keeps the homepage FAQ but has no own FAQ/payload', () => {
    expect(assertHeadIntegrity(goodSourcesHtml(), { context: 'tietolahteet' })).toBe(true);
  });
});

describe('assertHeadIntegrity — corruption is caught loudly', () => {
  it('throws when <title> appears twice (the classic silent-corruption mode)', () => {
    const html = goodProfileHtml().replace('</head>', '<title>Injected</title>\n  </head>');
    expect(() => assertHeadIntegrity(html, { context: 'dup-title' })).toThrow(/expected exactly 1 <title>, found 2/);
  });

  it('throws when </head> appears twice', () => {
    const html = goodProfileHtml().replace('</head>', '</head>\n  </head>');
    expect(() => assertHeadIntegrity(html, { context: 'dup-head' })).toThrow(/expected exactly 1 <\/head>, found 2/);
  });

  it('throws when the canonical link is duplicated', () => {
    const html = goodProfileHtml().replace(
      '<meta property="og:url"',
      '<link rel="canonical" href="https://naapurustot.fi/dup/" />\n    <meta property="og:url"',
    );
    expect(() => assertHeadIntegrity(html, { context: 'dup-canonical' })).toThrow(/expected exactly 1 canonical/);
  });

  it('throws when og:url is duplicated', () => {
    const html = goodProfileHtml().replace(
      '<meta property="og:url" content="https://naapurustot.fi/alue/00100-kamppi/" />',
      '<meta property="og:url" content="https://naapurustot.fi/alue/00100-kamppi/" />\n    <meta property="og:url" content="https://naapurustot.fi/x/" />',
    );
    expect(() => assertHeadIntegrity(html, { context: 'dup-ogurl' })).toThrow(/at most 1 og:url, found 2/);
  });

  it('throws when only a single (self-referential) hreflang link is present', () => {
    const html = goodProfileHtml()
      .replace(/<link rel="alternate" hreflang="en"[^>]*>\n\s*/, '')
      .replace(/<link rel="alternate" hreflang="sv"[^>]*>\n\s*/, '')
      .replace(/<link rel="alternate" hreflang="x-default"[^>]*>\n\s*/, '');
    expect(() => assertHeadIntegrity(html, { context: 'lonely-hreflang' })).toThrow(/single hreflang link/);
  });

  it('throws when a JSON-LD block is not parseable', () => {
    const html = goodProfileHtml().replace(
      /<script type="application\/ld\+json">\{"@context":"https:\/\/schema.org","@type":"Place"[^<]*<\/script>/,
      '<script type="application/ld+json">{ broken json,, }</script>',
    );
    expect(() => assertHeadIntegrity(html, { context: 'bad-jsonld' })).toThrow(/unparseable JSON-LD/);
  });
});

describe('assertHeadIntegrity — FAQ expectations', () => {
  it('throws when a FAQPage is required but absent', () => {
    const html = goodProfileHtml().replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema.org","@type":"FAQPage"[^<]*<\/script>/, '');
    expect(() => assertHeadIntegrity(html, { context: 'no-faq', expectFaq: true })).toThrow(/expected exactly 1 FAQPage JSON-LD, found 0/);
  });

  it('throws when two FAQPage blocks survive (e.g. homepage JSON-LD not stripped)', () => {
    const extraFaq = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] });
    const html = goodProfileHtml().replace('</head>', `<script type="application/ld+json">${extraFaq}</script>\n  </head>`);
    expect(() => assertHeadIntegrity(html, { context: 'two-faq', expectFaq: true })).toThrow(/expected exactly 1 FAQPage JSON-LD, found 2/);
  });
});

describe('assertHeadIntegrity — profile payload', () => {
  it('throws when the embedded profile payload is missing', () => {
    const html = goodProfileHtml().replace(/<script id="__naapurustot_profile__"[\s\S]*?<\/script>/, '');
    expect(() => assertHeadIntegrity(html, { context: 'no-payload', expectProfilePayload: true })).toThrow(/missing embedded __naapurustot_profile__/);
  });

  it('throws when the embedded profile payload is not valid JSON', () => {
    const html = goodProfileHtml().replace(
      /<script id="__naapurustot_profile__" type="application\/json">[\s\S]*?<\/script>/,
      '<script id="__naapurustot_profile__" type="application/json">{not json}</script>',
    );
    expect(() => assertHeadIntegrity(html, { context: 'bad-payload', expectProfilePayload: true })).toThrow(/unparseable __naapurustot_profile__/);
  });

  it('throws when the payload parses but lacks its `p` properties object', () => {
    const html = goodProfileHtml().replace(
      /<script id="__naapurustot_profile__" type="application\/json">[\s\S]*?<\/script>/,
      '<script id="__naapurustot_profile__" type="application/json">{"avg":{}}</script>',
    );
    expect(() => assertHeadIntegrity(html, { context: 'no-p', expectProfilePayload: true })).toThrow(/missing its `p`/);
  });
});

describe('stripHomeOnlyPreloads', () => {
  // Mirrors what vite.config.ts injectHomePreloads emits into dist/index.html.
  const homeHead = [
    '    <script type="module" crossorigin src="/assets/index-Byjamx2s.js"></script>',
    '    <link rel="modulepreload" crossorigin href="/assets/vendor-U9-9Ekmn.js">',
    '    <link rel="stylesheet" crossorigin href="/assets/index-CwKi8MFi.css">',
    '    <link rel="modulepreload" crossorigin href="/assets/App-DCYJ3ijF.js" data-home-preload>',
    '    <link rel="modulepreload" crossorigin href="/assets/maplibre-Bw_DjpE9.js" data-home-preload>',
    '    <link rel="preload" as="style" crossorigin href="/assets/maplibre-B2k4QVOw.css" data-home-preload>',
  ].join('\n');

  it('removes every data-home-preload tag (App + maplibre js + maplibre css)', () => {
    const out = stripHomeOnlyPreloads(homeHead);
    expect(out).not.toContain('data-home-preload');
    expect(out).not.toContain('App-DCYJ3ijF.js');
    expect(out).not.toContain('maplibre-Bw_DjpE9.js');
    expect(out).not.toContain('maplibre-B2k4QVOw.css');
  });

  it('keeps the entry script, vendor modulepreload, and index stylesheet (unmarked tags)', () => {
    const out = stripHomeOnlyPreloads(homeHead);
    expect(out).toContain('/assets/index-Byjamx2s.js');
    expect(out).toContain('/assets/vendor-U9-9Ekmn.js');
    expect(out).toContain('/assets/index-CwKi8MFi.css');
  });

  it('is a safe no-op when there are no marked tags', () => {
    const plain = '<head>\n    <link rel="stylesheet" href="/assets/index.css">\n  </head>';
    expect(stripHomeOnlyPreloads(plain)).toBe(plain);
  });

  it('tolerates attribute-order variation (marker not last)', () => {
    const html = '    <link data-home-preload rel="modulepreload" crossorigin href="/assets/App-x.js">\n';
    expect(stripHomeOnlyPreloads(html)).toBe('');
  });
});

describe('replaceOnce', () => {
  it('replaces a single match', () => {
    expect(replaceOnce('<title>old</title>', /<title>[^<]*<\/title>/, '<title>new</title>')).toBe('<title>new</title>');
  });

  it('throws when there are zero matches', () => {
    expect(() => replaceOnce('<head></head>', /<title>[^<]*<\/title>/, 'x', 'no-title')).toThrow(/expected 1 match.*found 0/);
  });

  it('throws when there are multiple matches', () => {
    expect(() => replaceOnce('<title>a</title><title>b</title>', /<title>[^<]*<\/title>/, 'x', 'dup')).toThrow(/found 2/);
  });
});
