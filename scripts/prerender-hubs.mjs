/**
 * Prerender regional hub pages and the all-areas directory as static HTML.
 *
 * These are standalone, self-contained HTML pages (no React, no app bundle):
 * fast, fully crawlable link hubs that connect the ~9,000 neighbourhood
 * profile pages into a clean hierarchy for search engines and language models.
 *
 *   dist/kaupungit/index.html          all-areas directory   (fi)
 *   dist/en/cities/index.html                                (en)
 *   dist/sv/stader/index.html                                (sv)
 *   dist/kaupunki/{region}/index.html  per-region hub        (fi)
 *   dist/en/city/{region}/index.html                         (en)
 *   dist/sv/stad/{region}/index.html                         (sv)
 *
 * Run after `npm run build`:  node scripts/prerender-hubs.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
// CF-11: per-region social card (area count + population), so hub/directory previews
// stop using the generic shared image.
import { buildSocialCardSvg } from './social-card.mjs';
// IN-2: shared head-integrity guard — fail the build loudly if a head token
// doubled, the hreflang cluster broke, or a JSON-LD block is unparseable, instead
// of silently shipping corrupted hub/ranking/directory/landing pages. htmlPage()
// is the single choke point every hub builder returns through.
import { assertHeadIntegrity } from './prerender-lib.mjs';
// CF-12: reuse the app's data-processing so ranking pages score quality_index and
// the quick-win metrics (child_ratio etc.) exactly as the map does. Type-only
// imports → Node's TypeScript stripping (22.18+/24) loads them without a build.
import { computeQualityIndices } from '../src/utils/qualityIndex.ts';
import { computeChangeMetrics, computeQuickWinMetrics } from '../src/utils/metrics.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const GEOJSON_PATH = join(ROOT, 'public', 'data', 'metro_neighborhoods.geojson');

const geojson = JSON.parse(readFileSync(GEOJSON_PATH, 'utf-8'));
// CF-12: derive computed metrics in place (same order as scripts/prerender.mjs)
// so quality_index and the quick-win props are present on every feature.
computeQualityIndices(geojson.features);
computeChangeMetrics(geojson.features);
computeQuickWinMetrics(geojson.features);
// CF-11b: data-source registry, for the Dataset JSON-LD on hub pages.
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'data_sources.json'), 'utf-8'));
// PO-4: dataset build date drives the citation year (the data vintage, not page age).
const BUILD_METADATA = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'build_metadata.json'), 'utf-8')); }
  catch { return { generated: '' }; }
})();
const CITE_YEAR = String(BUILD_METADATA.generated || '').slice(0, 4) || '2026';

const LOCALES = {
  fi: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'fi.json'), 'utf-8')),
  en: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'en.json'), 'utf-8')),
  sv: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'sv.json'), 'utf-8')),
};

const LANGS = ['fi', 'en', 'sv'];
const LOCALE_TAG = { fi: 'fi-FI', en: 'en-US', sv: 'sv-SE' };
// og:locale uses underscore-format locale identifiers (not the BCP-47 hyphen
// tags in LOCALE_TAG used for number formatting). Mirrors index.html.
const OG_LOCALE = { fi: 'fi_FI', en: 'en_US', sv: 'sv_FI' };
const AREA_PREFIX = { fi: '/alue', en: '/en/area', sv: '/sv/omrade' };
const CITY_PREFIX = { fi: '/kaupunki', en: '/en/city', sv: '/sv/stad' };
const DIRECTORY_PATH = { fi: '/kaupungit/', en: '/en/cities/', sv: '/sv/stader/' };

const ORIGIN = 'https://naapurustot.fi';

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toSlug(pno, nimi) {
  return `${pno}-${slugify(nimi)}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n, lang) {
  return Number(n).toLocaleString(LOCALE_TAG[lang], { maximumFractionDigits: 0 });
}

function getRegionName(city, lang) {
  if (!city) return '';
  const key = `city.${city}`;
  return LOCALES[lang]?.[key] || LOCALES.fi[key] || LOCALES.en[key] || city;
}

function getDisplayName(props, lang) {
  if (lang === 'sv' && props.namn) return props.namn;
  return props.nimi;
}

function featureCenter(feature) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const coords = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;
  for (const poly of coords) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

// Escape every `<` as the JSON escape so a literal `</script>` cannot break
// out of the inline <script type="application/ld+json"> element.
const safeJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// CF-11b: localized Dataset name/description for the hub-page Dataset JSON-LD.
const DATASET_TEXT = {
  fi: { name: (r) => `${r} – naapurustojen tilastot`, desc: (r) => `Avoimeen julkiseen dataan perustuvat naapurustojen tilastot alueella ${r}.` },
  en: { name: (r) => `${r} – neighbourhood statistics`, desc: (r) => `Neighbourhood statistics for ${r}, compiled from open public data.` },
  sv: { name: (r) => `${r} – statistik per område`, desc: (r) => `Områdesstatistik för ${r}, sammanställd från öppna offentliga data.` },
};

// PO-10: localized topical keywords for the hub Dataset — the data domains the
// registry actually covers (income, housing, services, safety, environment,
// transport, demographics). Fixed, real descriptors; no fabricated values.
const DATASET_KEYWORDS = {
  fi: ['naapurustot', 'postinumeroalueet', 'väestö', 'tulot', 'asuminen', 'palvelut', 'turvallisuus', 'ympäristö', 'joukkoliikenne'],
  en: ['neighbourhoods', 'postal code areas', 'demographics', 'income', 'housing', 'services', 'safety', 'environment', 'public transport'],
  sv: ['bostadsområden', 'postnummerområden', 'befolkning', 'inkomst', 'boende', 'tjänster', 'säkerhet', 'miljö', 'kollektivtrafik'],
};

// PO-10: temporalCoverage derived from the registry vintages. Every vintage is
// either a single year (number) or an `YYYY–YYYY` range string; pull all 4-digit
// years from all of them and express the span as an ISO 8601 interval `min/max`.
const TEMPORAL_COVERAGE = (() => {
  const years = [];
  for (const m of Object.values(REGISTRY.metrics ?? {})) {
    const matches = String(m.vintage).match(/\d{4}/g);
    if (matches) for (const y of matches) years.push(Number(y));
  }
  if (years.length === 0) return undefined;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}/${max}`;
})();

/** CF-11b: Dataset JSON-LD describing the open datasets behind a hub, with each
 *  registry publisher as a creator — strengthens discoverability for answer engines.
 *  PO-10: also carries spatialCoverage (region centre), keywords and temporalCoverage
 *  so each hub Dataset is fully described. `center` is the region's [lon, lat]. */
function buildHubDataset(lang, regionName, url, center) {
  const t = DATASET_TEXT[lang] ?? DATASET_TEXT.en;
  const ds = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: t.name(regionName),
    description: t.desc(regionName),
    url,
    inLanguage: lang,
    isAccessibleForFree: true,
    license: 'https://creativecommons.org/licenses/by/4.0/',
    keywords: DATASET_KEYWORDS[lang] ?? DATASET_KEYWORDS.en,
    creator: Object.values(REGISTRY.publishers ?? {}).map((p) => ({ '@type': 'Organization', name: p.name, url: p.url })),
    // PO-10: spatial extent of this hub's datasets — the region itself, located
    // at its computed centroid. Lets answer engines place the data geographically.
    spatialCoverage: {
      '@type': 'Place',
      name: regionName,
      geo: {
        '@type': 'GeoCoordinates',
        latitude: Math.round(center[1] * 1e5) / 1e5,
        longitude: Math.round(center[0] * 1e5) / 1e5,
      },
    },
    // Google's Dataset spec only accepts URL or Dataset for `isPartOf`; a WebSite
    // there triggers "Invalid object type for field 'isPartOf'". Express the
    // catalog membership with `includedInDataCatalog` → DataCatalog instead.
    includedInDataCatalog: { '@type': 'DataCatalog', name: 'naapurustot.fi', url: ORIGIN },
  };
  if (TEMPORAL_COVERAGE) ds.temporalCoverage = TEMPORAL_COVERAGE;
  return ds;
}

const STYLE = `:root{color-scheme:light dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#1a2230;background:#f5f6f8}
main{max-width:900px;margin:0 auto;padding:1.5rem 1.25rem 3rem}
a{color:#005ea8;text-decoration:none}
a:hover{text-decoration:underline}
h1{font-size:1.85rem;line-height:1.25;margin:.4rem 0 .6rem}
h2{font-size:1.2rem;margin:2rem 0 .6rem}
p{margin:.5rem 0}
.lead{font-size:1.05rem}
.muted{color:#5a6577}
.crumbs{font-size:.85rem;color:#5a6577;margin:0 0 .25rem}
.summary{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;margin:.75rem 0 1rem;font-weight:600}
.cta{display:inline-block;margin:.5rem 0;padding:.6rem 1.1rem;background:#005ea8;color:#fff;border-radius:8px;font-weight:600}
.cta:hover{background:#00498a;text-decoration:none}
table{width:100%;border-collapse:collapse;margin:.5rem 0 1rem;font-size:.95rem}
caption{text-align:left;color:#5a6577;font-size:.85rem;padding:.25rem 0}
th,td{text-align:left;padding:.5rem .55rem;border-bottom:1px solid #e2e5ea}
thead th{border-bottom:2px solid #cdd2da;font-size:.82rem;text-transform:uppercase;letter-spacing:.03em;color:#5a6577}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.site-header,.site-footer{padding:.85rem 1.25rem;max-width:900px;margin:0 auto;display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;justify-content:space-between}
.site-header{border-bottom:1px solid #e2e5ea}
.site-footer{border-top:1px solid #e2e5ea;margin-top:2rem;font-size:.85rem;color:#5a6577}
.brand{font-weight:700;font-size:1.05rem;color:#1a2230}
.brand span{color:#005ea8}
.langs a{margin-left:.6rem;font-size:.85rem}
.langs a[aria-current]{font-weight:700;text-decoration:underline}
@media (prefers-color-scheme:dark){
body{color:#e6e8ec;background:#0f1318}
a{color:#69b4f0}
.muted,.crumbs,.site-footer,thead th,caption{color:#9aa4b2}
th,td{border-bottom-color:#252b34}
thead th{border-bottom-color:#3a424e}
.site-header,.site-footer{border-color:#252b34}
.brand{color:#e6e8ec}
.brand span{color:#69b4f0}
.cta{background:#1f6fb2}
.cta:hover{background:#2a7ec4}
}`;

/** Build a complete standalone HTML page. */
// CF-11: emit a per-region social-card SVG (area name + count + population) under
// dist/og/ and return the PNG sibling URL (rasterized in deploy by rasterize-cards.mjs).
const CARD_DIR = join(DIST, 'og');
const CARD_LABELS = {
  fi: { areas: 'Postinumeroalueet', pop: 'Asukkaat' },
  en: { areas: 'Postal areas', pop: 'Population' },
  sv: { areas: 'Postnummerområden', pop: 'Invånare' },
};
function emitRegionCard(region, regionName, lang) {
  const L = CARD_LABELS[lang] || CARD_LABELS.fi;
  const svg = buildSocialCardSvg({
    name: regionName,
    quality: null,
    stats: [
      { label: L.areas, value: fmtNum(region.count, lang) },
      { label: L.pop, value: fmtNum(region.totalPop, lang) },
    ],
  });
  mkdirSync(CARD_DIR, { recursive: true });
  const hash = createHash('sha256').update(svg).digest('hex').slice(0, 10);
  writeFileSync(join(CARD_DIR, `region-${region.id}-${lang}.${hash}.svg`), svg);
  return `${ORIGIN}/og/region-${region.id}-${lang}.${hash}.png`;
}

function htmlPage({ lang, title, description, canonical, alternates, jsonLd, body, ogImage, expectFaq }) {
  // CF-11: per-page social card (PNG) when provided, else the shared static image.
  const ogImg = ogImage || `${ORIGIN}/og-image.png`;
  const langLinks = LANGS.map((l) => {
    const label = { fi: 'FI', en: 'EN', sv: 'SV' }[l];
    const current = l === lang ? ' aria-current="true"' : '';
    return `<a href="${alternates[l]}" hreflang="${l}"${current}>${label}</a>`;
  }).join('');

  const altLinks = LANGS
    .map((l) => `    <link rel="alternate" hreflang="${l}" href="${alternates[l]}" />`)
    .join('\n');

  const footer = {
    fi: 'Tiedot: Tilastokeskus (Paavo), HSL, HSY, OpenStreetMap ja muut avoimet julkiset lähteet.',
    en: 'Data: Statistics Finland (Paavo), HSL, HSY, OpenStreetMap and other open public sources.',
    sv: 'Data: Statistikcentralen (Paavo), HSL, HSY, OpenStreetMap och andra öppna offentliga källor.',
  }[lang];

  // QW-6: discovery links — surface the data-sources page + the open-data
  // download corpus from the standalone hub/ranking/landing footers.
  const discovery = {
    fi: { sources: 'Tietolähteet', sourcesUrl: '/tietolahteet/', open: 'Avoin data' },
    en: { sources: 'Data sources', sourcesUrl: '/en/data-sources/', open: 'Open data' },
    sv: { sources: 'Datakällor', sourcesUrl: '/sv/datakallor/', open: 'Öppna data' },
  }[lang];

  // PO-9: localized og:locale (underscore format), its two alternates, and a
  // localized per-page og:image:alt (the page title reads well as alt text).
  const localeAlts = LANGS
    .filter((l) => l !== lang)
    .map((l) => `    <meta property="og:locale:alternate" content="${OG_LOCALE[l]}" />`)
    .join('\n');

  const html = `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" type="application/atom+xml" title="naapurustot.fi data updates" href="${ORIGIN}/data-updates.atom" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="DC.title" content="${escapeHtml(title)}" />
    <meta name="DC.creator" content="naapurustot.fi" />
    <meta name="DC.publisher" content="naapurustot.fi" />
    <meta name="DC.date" content="${CITE_YEAR}" />
    <meta name="DC.identifier" content="${canonical}" />
    <meta name="DC.language" content="${lang}" />
    <meta name="DC.rights" content="Data: Statistics Finland (CC BY 4.0), OpenStreetMap (ODbL) and other public sources" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="theme-color" content="#1e3a5f" />
${altLinks}
    <link rel="alternate" hreflang="x-default" href="${alternates.fi}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="naapurustot.fi" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${ogImg}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />
    <meta property="og:locale" content="${OG_LOCALE[lang]}" />
${localeAlts}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${ogImg}" />
    <style>${STYLE}</style>
${jsonLd}
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/">naapurustot<span>.fi</span></a>
      <nav class="langs" aria-label="Language">${langLinks}</nav>
    </header>
    <main>
${body}
    </main>
    <footer class="site-footer">
      <span>${footer}</span>
      <span><a href="${discovery.sourcesUrl}">${discovery.sources}</a> · <a href="/avoin-data/">${discovery.open}</a> · <a href="/">naapurustot.fi</a></span>
    </footer>
  </body>
</html>
`;
  // IN-2: hubs carry no FAQPage and no profile payload → default flags only
  // (singleton <title>/</head>/canonical, ≤1 og:url, a non-lonely hreflang
  // cluster, all JSON-LD parseable). Throws loudly on a template regression.
  // CF-7: comparison pages DO carry a FAQPage → expectFaq enforces exactly one.
  assertHeadIntegrity(html, { context: canonical, expectFaq });
  return html;
}

/** Uppercase the first letter (metric labels are lowercase for in-sentence use). */
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** "Best areas by metric" link row for a region OR municipality hub (only metrics
 *  with a page). `scope` carries `.rankings` plus the scope identity (kind+id/slug)
 *  that rankPath needs. */
function buildBestAreasNav(scope, lang, opts = {}) {
  let avail = scope.rankings || [];
  // CF-1: optional exclude (the current ranking's own metric) + cap, for the sibling-metric
  // row on ranking pages. Default (no opts) leaves hub-body calls byte-identical.
  if (opts.excludeSlug) avail = avail.filter((m) => m.slug !== opts.excludeSlug);
  if (opts.limit) avail = avail.slice(0, opts.limit);
  if (avail.length === 0) return '';
  const links = avail
    .map((m) => `<a href="${rankPath(m.slug, scope, lang)}">${escapeHtml(cap(m.label[lang]))}</a>`)
    .join(' · ');
  return `      <h2>${escapeHtml(RANK_TEXT[lang].bestHeading)}</h2>\n      <p>${links}</p>`;
}

/** National "best areas by metric" link row for the directory page. */
function buildDirectoryRankingNav(lang, opts = {}) {
  let metrics = RANKING_METRICS;
  if (opts.excludeSlug) metrics = metrics.filter((m) => m.slug !== opts.excludeSlug);
  if (opts.limit) metrics = metrics.slice(0, opts.limit);
  const links = metrics
    .map((m) => `<a href="${rankPath(m.slug, null, lang)}">${escapeHtml(cap(m.label[lang]))}</a>`)
    .join(' · ');
  return `      <h2>${escapeHtml(RANK_TEXT[lang].bestHeading)}</h2>\n      <p>${links}</p>`;
}

/** Region hub → "popular comparisons" nav. Links to the region's own /vertaa/ pages,
 *  reusing region.comparePairs (the same bounded set the pages are generated from) so
 *  every link resolves to a real page. De-orphans the otherwise-unlinked compare mesh. */
function buildCompareNav(region, lang) {
  const pairs = region.comparePairs || [];
  if (pairs.length === 0) return '';
  const links = pairs.map(([lo, hi]) => {
    const fa = compareFeatByPno.get(lo);
    const fb = compareFeatByPno.get(hi);
    if (!fa || !fb) return '';
    const slug = `${toSlug(fa.properties.pno, fa.properties.nimi)}-vs-${toSlug(fb.properties.pno, fb.properties.nimi)}`;
    const label = `${getDisplayName(fa.properties, lang)} vs ${getDisplayName(fb.properties, lang)}`;
    return `<a href="${comparePath(slug, lang)}">${escapeHtml(label)}</a>`;
  }).filter(Boolean).join(' · ');
  if (!links) return '';
  return `      <h2>${escapeHtml(TEXT[lang].compareHeading)}</h2>\n      <p>${links}</p>`;
}

// PO-4: a "Cite this page" section with a ready citation string and a BibTeX @misc
// entry (data vintage as the year), so researchers/journalists can cite a hub.
const CITE_TEXT = {
  fi: { heading: 'Viittaa tähän sivuun', intro: 'Suositeltu viittaus' },
  en: { heading: 'Cite this page', intro: 'Recommended citation' },
  sv: { heading: 'Citera denna sida', intro: 'Rekommenderad hänvisning' },
};
function buildCiteSection(lang, title, url) {
  const T = CITE_TEXT[lang] ?? CITE_TEXT.en;
  const cite = `naapurustot.fi (${CITE_YEAR}). ${title}. ${url}`;
  const key = `naapurustot_${CITE_YEAR}_${url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}`;
  const bib = `@misc{${key},\n  title        = {${title}},\n  author       = {{naapurustot.fi}},\n  year         = {${CITE_YEAR}},\n  howpublished = {\\url{${url}}},\n  note         = {Data: Statistics Finland (Paavo, CC BY 4.0) and other public sources}\n}`;
  return `      <h2>${escapeHtml(T.heading)}</h2>
      <p>${escapeHtml(T.intro)}: ${escapeHtml(cite)}</p>
      <details><summary>BibTeX</summary><pre style="white-space:pre-wrap;font-size:.82rem;overflow-x:auto">${escapeHtml(bib)}</pre></details>`;
}

// --- Localized prose ---
const TEXT = {
  fi: {
    dirTitle: 'Kaikki alueet — Suomen seutukunnat | naapurustot.fi',
    dirH1: 'Kaikki Suomen alueet',
    dirDesc: (regions) =>
      `naapurustot.fi kattaa kaikki ${regions} Suomen seutukuntaa. Selaa seutukuntia ja tutki asuinalueiden tilastoja kartalla.`,
    dirIntro: (areas, regions, pop) =>
      `naapurustot.fi kattaa ${areas} postinumeroaluetta kaikilla ${regions} Suomen seutukunnalla, ` +
      `joissa asuu yhteensä noin ${pop} ihmistä. Valitse seutukunta nähdäksesi sen postinumeroalueet ja tilastot.`,
    dirCrumb: 'Kaikki alueet',
    dirTableCaption: 'Suomen seutukunnat — alue- ja väestömäärät',
    colRegion: 'Seutukunta',
    colAreas: 'Alueita',
    colPopulation: 'Väkiluku',
    colArea: 'Alue',
    colPostal: 'Postinumero',
    colIncome: 'Mediaanitulo',
    cityTitle: (r) => `${r} — postinumeroalueet ja tilastot | naapurustot.fi`,
    cityDesc: (r, n) =>
      `${r} — ${n} postinumeroaluetta ja niiden tilastot naapurustot.fi-palvelussa: tulot, asuminen, palvelut, turvallisuus ja joukkoliikenne.`,
    cityIntro: (r, n, pop) =>
      `${r} on yksi Suomen 69 seutukunnasta. naapurustot.fi kattaa tällä alueella ${n} postinumeroaluetta, ` +
      `joiden yhteenlaskettu väkiluku on noin ${pop}. Vertaile asuinalueita yli 50 mittarilla — ` +
      `tulot, asuminen, palvelut, turvallisuus ja ympäristö.`,
    citySummary: (n, pop) => `${n} postinumeroaluetta · noin ${pop} asukasta`,
    cityAreasHeading: 'Postinumeroalueet',
    cityMapCta: (r) => `Avaa ${r} kartalla`,
    compareHeading: 'Suositut vertailut',
    cityTableCaption: (r) => `${r} — postinumeroalueet`,
    backToDir: '← Kaikki Suomen alueet',
    missing: '—',
  },
  en: {
    dirTitle: "All areas — Finland's sub-regions | naapurustot.fi",
    dirH1: 'All areas in Finland',
    dirDesc: (regions) =>
      `naapurustot.fi covers all ${regions} Finnish sub-regions. Browse the sub-regions and explore neighbourhood statistics on the map.`,
    dirIntro: (areas, regions, pop) =>
      `naapurustot.fi covers ${areas} postal code areas across all ${regions} Finnish sub-regions, ` +
      `with a combined population of about ${pop}. Choose a sub-region to see its postal code areas and statistics.`,
    dirCrumb: 'All areas',
    dirTableCaption: "Finland's sub-regions — area counts and population",
    colRegion: 'Sub-region',
    colAreas: 'Areas',
    colPopulation: 'Population',
    colArea: 'Area',
    colPostal: 'Postal code',
    colIncome: 'Median income',
    cityTitle: (r) => `${r} — postal code areas & statistics | naapurustot.fi`,
    cityDesc: (r, n) =>
      `${r} — ${n} postal code areas and their statistics on naapurustot.fi: income, housing, services, safety and public transport.`,
    cityIntro: (r, n, pop) =>
      `${r} is one of Finland's 69 sub-regions. naapurustot.fi covers ${n} postal code areas here, ` +
      `with a combined population of about ${pop}. Compare neighbourhoods across 50+ indicators — ` +
      `income, housing, services, safety and environment.`,
    citySummary: (n, pop) => `${n} postal code areas · about ${pop} residents`,
    cityAreasHeading: 'Postal code areas',
    cityMapCta: (r) => `Open ${r} on the map`,
    compareHeading: 'Popular comparisons',
    cityTableCaption: (r) => `${r} — postal code areas`,
    backToDir: '← All areas in Finland',
    missing: '—',
  },
  sv: {
    dirTitle: 'Alla områden — Finlands regioner | naapurustot.fi',
    dirH1: 'Alla områden i Finland',
    dirDesc: (regions) =>
      `naapurustot.fi täcker alla ${regions} finländska ekonomiska regioner. Bläddra bland regionerna och utforska områdesstatistik på kartan.`,
    dirIntro: (areas, regions, pop) =>
      `naapurustot.fi täcker ${areas} postnummerområden i alla ${regions} finländska regioner, ` +
      `med en sammanlagd befolkning på cirka ${pop}. Välj en region för att se dess postnummerområden och statistik.`,
    dirCrumb: 'Alla områden',
    dirTableCaption: 'Finlands regioner — antal områden och befolkning',
    colRegion: 'Region',
    colAreas: 'Områden',
    colPopulation: 'Folkmängd',
    colArea: 'Område',
    colPostal: 'Postnummer',
    colIncome: 'Medianinkomst',
    cityTitle: (r) => `${r} — postnummerområden & statistik | naapurustot.fi`,
    cityDesc: (r, n) =>
      `${r} — ${n} postnummerområden och deras statistik på naapurustot.fi: inkomst, boende, tjänster, säkerhet och kollektivtrafik.`,
    cityIntro: (r, n, pop) =>
      `${r} är en av Finlands 69 regioner. naapurustot.fi täcker ${n} postnummerområden i denna region, ` +
      `med en sammanlagd befolkning på cirka ${pop}. Jämför bostadsområden med över 50 mätare — ` +
      `inkomst, boende, tjänster, säkerhet och miljö.`,
    citySummary: (n, pop) => `${n} postnummerområden · cirka ${pop} invånare`,
    cityAreasHeading: 'Postnummerområden',
    cityMapCta: (r) => `Öppna ${r} på kartan`,
    compareHeading: 'Populära jämförelser',
    cityTableCaption: (r) => `${r} — postnummerområden`,
    backToDir: '← Alla områden i Finland',
    missing: '—',
  },
};

// --- Group features by region ---
const byRegion = new Map();
for (const f of geojson.features) {
  const p = f.properties;
  if (!p?.pno || !p?.nimi || !p?.city) continue;
  if (!byRegion.has(p.city)) byRegion.set(p.city, []);
  byRegion.get(p.city).push(f);
}

/** Per-region aggregates, sorted by number of areas (largest first). */
const regions = [...byRegion.entries()]
  .map(([id, features]) => {
    let totalPop = 0;
    let cx = 0, cy = 0;
    for (const f of features) {
      if (Number.isFinite(Number(f.properties.he_vakiy))) totalPop += Number(f.properties.he_vakiy);
      const [x, y] = featureCenter(f);
      cx += x;
      cy += y;
    }
    return {
      id,
      features,
      count: features.length,
      totalPop,
      center: [cx / features.length, cy / features.length],
    };
  })
  .sort((a, b) => b.count - a.count);

const TOTAL_AREAS = regions.reduce((s, r) => s + r.count, 0);
const TOTAL_POP = regions.reduce((s, r) => s + r.totalPop, 0);

// --- Group features by municipality (kunta) for municipality-level hub pages ---
// People search by city/municipality ("Espoo asuinalueet"), but a seutukunta hub
// bundles several municipalities, so cities like Espoo, Vantaa, Kuopio and Lahti had
// no landing page. Build one hub per municipality — EXCEPT where a seutukunta contains
// exactly one municipality (then the region hub already IS that municipality's page, so
// emitting both would be duplicate content). Municipality name is baked onto every
// feature by the pipeline; each municipality belongs to exactly one seutukunta.
const byMunicipality = new Map();
for (const f of geojson.features) {
  const p = f.properties;
  if (!p?.pno || !p?.nimi || !p?.municipality || !p?.city) continue;
  const name = String(p.municipality);
  if (!byMunicipality.has(name)) byMunicipality.set(name, { name, regionId: p.city, features: [] });
  byMunicipality.get(name).features.push(f);
}
// Municipalities per seutukunta → the 1:1 regions whose municipality hub we skip.
const muniCountByRegion = new Map();
for (const m of byMunicipality.values()) {
  muniCountByRegion.set(m.regionId, (muniCountByRegion.get(m.regionId) || 0) + 1);
}
// Detect the (rare) slugify collision so we can disambiguate deterministically with the
// numeric kunta code instead of silently overwriting one municipality's pages.
const muniSlugCounts = new Map();
for (const m of byMunicipality.values()) {
  const base = slugify(m.name);
  muniSlugCounts.set(base, (muniSlugCounts.get(base) || 0) + 1);
}
const municipalities = [...byMunicipality.values()]
  .filter((m) => (muniCountByRegion.get(m.regionId) || 0) > 1)
  .map((m) => {
    let totalPop = 0;
    for (const f of m.features) {
      if (Number.isFinite(Number(f.properties.he_vakiy))) totalPop += Number(f.properties.he_vakiy);
    }
    const base = slugify(m.name);
    const code = String(m.features[0].properties.kunta || '');
    const slug = muniSlugCounts.get(base) > 1 && code ? `${base}-${code}` : base;
    return { name: m.name, regionId: m.regionId, slug, features: m.features, count: m.features.length, totalPop };
  })
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fi'));
// Region id → its municipality hubs, for the "municipalities in this sub-region" nav.
const muniByRegion = new Map();
for (const m of municipalities) {
  if (!muniByRegion.has(m.regionId)) muniByRegion.set(m.regionId, []);
  muniByRegion.get(m.regionId).push(m);
}

const MUNI_PREFIX = { fi: '/kunta', en: '/en/municipality', sv: '/sv/kommun' };
function muniPath(slug, lang) { return `${MUNI_PREFIX[lang]}/${slug}/`; }
function muniUrl(slug, lang) { return `${ORIGIN}${muniPath(slug, lang)}`; }
function muniAlternates(slug) { return Object.fromEntries(LANGS.map((l) => [l, muniUrl(slug, l)])); }
const MUNI_OUT = {
  fi: (slug) => join(DIST, 'kunta', slug),
  en: (slug) => join(DIST, 'en', 'municipality', slug),
  sv: (slug) => join(DIST, 'sv', 'kommun', slug),
};

function cityUrl(id, lang) { return `${ORIGIN}${CITY_PREFIX[lang]}/${id}/`; }
function dirUrl(lang) { return `${ORIGIN}${DIRECTORY_PATH[lang]}`; }

// ---------------------------------------------------------------------------
// CF-12: prerendered "best areas by metric" ranking pages.
//
// /kaupunki/{region}/parhaat/{metric}/ (×3 languages) plus national top-50 lists
// for a handful of high-coverage, high-intent metrics. Each is a direction-aware
// ranked table of real values with source/vintage disclosure, ItemList +
// BreadcrumbList JSON-LD, and links into the /alue/ profiles. All page strings
// are inline (locale keys would consume the bundled fi.json budget); zero JS.
//
// The higherIsBetter direction is replicated inline — this .mjs cannot import
// colorScales.ts (its formatting → i18n chain reaches Vite-only `?url` assets).
// ---------------------------------------------------------------------------

function fmtDec(n, lang, d) {
  return Number(n).toLocaleString(LOCALE_TAG[lang], { minimumFractionDigits: d, maximumFractionDigits: d });
}

const RANK_SEGMENT = { fi: 'parhaat', en: 'best', sv: 'basta' };
const MIN_REGION_RANKED = 6; // a region needs this many covered areas for its own page
const MIN_MUNI_RANKED = 8;   // a municipality needs this many covered areas per metric
const NATIONAL_MIN_RANKED = 10; // a sparse metric needs this many to earn a national page
const REGION_TOP_N = 15;
const NATIONAL_TOP_N = 50;

// `layer` is the app LayerId (from src/utils/colorScales.ts LAYERS) that renders this
// metric's choropleth — used by the ranking page's into-app CTA (/?layer=<id>). Note 7
// of 10 layer ids differ from the geojson property (e.g. hr_mtu→median_income,
// crime_index→crime_rate); each is verified against colorScales.ts LAYERS.
const RANKING_METRICS = [
  { slug: 'quality-index', property: 'quality_index', higherIsBetter: true, layer: 'quality_index',
    label: { fi: 'elämänlaatu', en: 'quality of life', sv: 'livskvalitet' },
    col: { fi: 'Laatuindeksi', en: 'Quality index', sv: 'Kvalitetsindex' },
    fmt: (v, lang) => fmtNum(Math.round(v), lang) },
  { slug: 'income', property: 'hr_mtu', higherIsBetter: true, layer: 'median_income',
    label: { fi: 'mediaanitulot', en: 'median income', sv: 'medianinkomst' },
    col: { fi: 'Mediaanitulo', en: 'Median income', sv: 'Medianinkomst' },
    fmt: (v, lang) => `${fmtNum(Math.round(v), lang)} €` },
  { slug: 'safety', property: 'crime_index', higherIsBetter: false, layer: 'crime_rate',
    label: { fi: 'turvallisuus', en: 'safety', sv: 'säkerhet' },
    col: { fi: 'Rikollisuusindeksi', en: 'Crime index', sv: 'Brottsindex' },
    fmt: (v, lang) => fmtDec(v, lang, 1) },
  { slug: 'families', property: 'child_ratio', higherIsBetter: true, layer: 'child_ratio',
    label: { fi: 'lapsiperheet', en: 'families with children', sv: 'barnfamiljer' },
    col: { fi: 'Lasten osuus', en: 'Children (0–6) share', sv: 'Andel barn (0–6)' },
    fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { slug: 'transit', property: 'transit_stop_density', higherIsBetter: true, layer: 'transit_access',
    label: { fi: 'joukkoliikenne', en: 'public transport access', sv: 'kollektivtrafik' },
    col: { fi: 'Pysäkkitiheys', en: 'Stop density', sv: 'Hållplatstäthet' },
    fmt: (v, lang) => fmtNum(Math.round(v), lang) },
  { slug: 'air-quality', property: 'air_quality_index', higherIsBetter: false, layer: 'air_quality',
    label: { fi: 'ilmanlaatu', en: 'air quality', sv: 'luftkvalitet' },
    col: { fi: 'Ilmanlaatuindeksi', en: 'Air quality index', sv: 'Luftkvalitetsindex' },
    fmt: (v, lang) => fmtDec(v, lang, 1) },
  // CF-12 (expanded): four more high-coverage, objective-direction axes. All have
  // real registry entries and ≥97% national coverage; per-region/muni coverage gates
  // (MIN_REGION_RANKED / MIN_MUNI_RANKED) keep sparse scopes from emitting thin pages.
  { slug: 'walkability', property: 'walkability_index', higherIsBetter: true, layer: 'walkability',
    label: { fi: 'käveltävyys', en: 'walkability', sv: 'gångvänlighet' },
    col: { fi: 'Käveltävyysindeksi', en: 'Walkability index', sv: 'Gångvänlighetsindex' },
    fmt: (v, lang) => fmtNum(Math.round(v), lang) },
  { slug: 'education', property: 'higher_education_rate', higherIsBetter: true, layer: 'education',
    label: { fi: 'koulutustaso', en: 'higher education', sv: 'utbildningsnivå' },
    col: { fi: 'Korkeakoulutetut', en: 'Higher education', sv: 'Högutbildade' },
    fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { slug: 'students', property: 'student_share', higherIsBetter: true, layer: 'student_share',
    label: { fi: 'opiskelijat', en: 'students', sv: 'studerande' },
    col: { fi: 'Opiskelijaosuus', en: 'Student share', sv: 'Studerandeandel' },
    fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { slug: 'employment', property: 'unemployment_rate', higherIsBetter: false, layer: 'unemployment',
    label: { fi: 'matala työttömyys', en: 'low unemployment', sv: 'låg arbetslöshet' },
    col: { fi: 'Työttömyysaste', en: 'Unemployment rate', sv: 'Arbetslöshet' },
    fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
];

const RANK_TEXT = {
  fi: {
    title: (m, r) => `Parhaat alueet: ${m}${r ? ` – ${r}` : ' Suomessa'} | naapurustot.fi`,
    h1: (m, r) => `Parhaat alueet – ${m}${r ? `, ${r}` : ', koko Suomi'}`,
    desc: (m, r, n) => r
      ? `${r}: ${n} parasta postinumeroaluetta mittarilla ${m}. Todelliset arvot ja lähde, päivittyy avoimesta julkisesta datasta.`
      : `Suomen ${n} parasta postinumeroaluetta mittarilla ${m}. Todelliset arvot ja lähde.`,
    intro: (m, r, n) => r
      ? `${r} ${n} parasta postinumeroaluetta mittarilla ${m}, järjestettynä parhaasta. Klikkaa aluetta nähdäksesi sen kaikki tilastot.`
      : `Suomen ${n} parasta postinumeroaluetta mittarilla ${m}, järjestettynä parhaasta. Klikkaa aluetta nähdäksesi sen kaikki tilastot.`,
    colRank: 'Sija', colArea: 'Alue', colRegion: 'Seutukunta',
    source: (s, v) => `Lähde: ${s} (${v}). Kaikki arvot perustuvat avoimeen, todennettavaan julkiseen dataan.`,
    crumbBest: 'Parhaat alueet', crumbAll: 'Kaikki alueet',
    bestHeading: 'Parhaat alueet mittareittain',
    nationalLink: 'Koko Suomen lista',
    mapCta: (m, r) => `Katso ${m} kartalla${r ? ` – ${r}` : ''}`,
  },
  en: {
    title: (m, r) => `Best areas for ${m}${r ? ` in ${r}` : ' in Finland'} | naapurustot.fi`,
    h1: (m, r) => `Best areas for ${m}${r ? ` — ${r}` : ' — all of Finland'}`,
    desc: (m, r, n) => r
      ? `${r}: the ${n} best postal code areas for ${m}. Real values and source, updated from open public data.`
      : `The ${n} best postal code areas in Finland for ${m}. Real values and source.`,
    intro: (m, r, n) => r
      ? `The ${n} best postal code areas in ${r} for ${m}, ranked best first. Click an area to see all its statistics.`
      : `The ${n} best postal code areas in Finland for ${m}, ranked best first. Click an area to see all its statistics.`,
    colRank: 'Rank', colArea: 'Area', colRegion: 'Sub-region',
    source: (s, v) => `Source: ${s} (${v}). Every value is based on open, verifiable public data.`,
    crumbBest: 'Best areas', crumbAll: 'All areas',
    bestHeading: 'Best areas by metric',
    nationalLink: 'Nationwide list',
    mapCta: (m, r) => `See ${m} on the map${r ? ` – ${r}` : ''}`,
  },
  sv: {
    title: (m, r) => `Bästa områden för ${m}${r ? ` i ${r}` : ' i Finland'} | naapurustot.fi`,
    h1: (m, r) => `Bästa områden för ${m}${r ? ` — ${r}` : ' — hela Finland'}`,
    desc: (m, r, n) => r
      ? `${r}: de ${n} bästa postnummerområdena för ${m}. Verkliga värden och källa, uppdateras från öppna offentliga data.`
      : `De ${n} bästa postnummerområdena i Finland för ${m}. Verkliga värden och källa.`,
    intro: (m, r, n) => r
      ? `De ${n} bästa postnummerområdena i ${r} för ${m}, rankade bäst först. Klicka på ett område för all dess statistik.`
      : `De ${n} bästa postnummerområdena i Finland för ${m}, rankade bäst först. Klicka på ett område för all dess statistik.`,
    colRank: 'Plats', colArea: 'Område', colRegion: 'Region',
    source: (s, v) => `Källa: ${s} (${v}). Alla värden bygger på öppna, verifierbara offentliga data.`,
    crumbBest: 'Bästa områden', crumbAll: 'Alla områden',
    bestHeading: 'Bästa områden per mätare',
    nationalLink: 'Lista för hela Finland',
    mapCta: (m, r) => `Se ${m} på kartan${r ? ` – ${r}` : ''}`,
  },
};

/** Path (no origin) to a ranking page, per scope and language.
 *  scope: null = national | { kind:'region', id } | { kind:'muni', slug }. */
function rankPath(metricSlug, scope, lang) {
  if (!scope) return `/${[lang === 'fi' ? null : lang, RANK_SEGMENT[lang], metricSlug].filter(Boolean).join('/')}/`;
  if (scope.kind === 'muni') return `${MUNI_PREFIX[lang]}/${scope.slug}/${RANK_SEGMENT[lang]}/${metricSlug}/`;
  return `${CITY_PREFIX[lang]}/${scope.id}/${RANK_SEGMENT[lang]}/${metricSlug}/`;
}
function rankAlternates(metricSlug, scope) {
  return Object.fromEntries(LANGS.map((l) => [l, `${ORIGIN}${rankPath(metricSlug, scope, l)}`]));
}

/** Rank a feature list by a metric (direction-aware); returns the top-N covered. */
function rankFeatures(features, metric, topN) {
  const covered = features.filter((f) => Number.isFinite(Number(f.properties[metric.property])));
  covered.sort((a, b) => {
    const av = Number(a.properties[metric.property]);
    const bv = Number(b.properties[metric.property]);
    return metric.higherIsBetter ? bv - av : av - bv;
  });
  return covered.slice(0, topN);
}

/** Build one ranking page. `scope` is null (national) |
 *  { kind:'region', id } | { kind:'muni', slug, regionId, name }. */
function buildRankingPage(metric, lang, scope, ranked) {
  const T = RANK_TEXT[lang];
  const label = metric.label[lang];
  const national = !scope;
  const isMuni = !!scope && scope.kind === 'muni';
  const locationName = national ? '' : (isMuni ? scope.name : getRegionName(scope.id, lang));
  const alternates = rankAlternates(metric.slug, scope);
  const reg = REGISTRY.metrics?.[metric.property] ?? {};

  const rows = ranked.map((f, i) => {
    const p = f.properties;
    const name = escapeHtml(getDisplayName(p, lang));
    const href = `${AREA_PREFIX[lang]}/${escapeHtml(toSlug(p.pno, p.nimi))}/`;
    const value = escapeHtml(metric.fmt(Number(p[metric.property]), lang));
    // The sub-region column only makes sense nationally; region/muni scopes share one.
    const regionCell = national
      ? `<td>${escapeHtml(getRegionName(p.city, lang))}</td>`
      : '';
    return `        <tr><td class="num">${i + 1}</td><td><a href="${href}">${name}</a></td>` +
      `<td>${escapeHtml(p.pno)}</td>${regionCell}<td class="num">${value}</td></tr>`;
  }).join('\n');

  const regionColHead = national ? `<th scope="col">${escapeHtml(T.colRegion)}</th>` : '';

  // Breadcrumb trail + hub back-link deepen with the scope (national → region → muni).
  const hubPath = national ? DIRECTORY_PATH[lang]
    : isMuni ? muniPath(scope.slug, lang)
    : `${CITY_PREFIX[lang]}/${escapeHtml(scope.id)}/`;
  let crumbs;
  if (national) {
    crumbs = `<p class="crumbs"><a href="/">naapurustot.fi</a> / ${escapeHtml(T.crumbBest)}</p>`;
  } else if (isMuni) {
    const regionName = getRegionName(scope.regionId, lang);
    crumbs = `<p class="crumbs"><a href="/">naapurustot.fi</a> / <a href="${DIRECTORY_PATH[lang]}">${escapeHtml(T.crumbAll)}</a> / <a href="${CITY_PREFIX[lang]}/${escapeHtml(scope.regionId)}/">${escapeHtml(regionName)}</a> / <a href="${muniPath(scope.slug, lang)}">${escapeHtml(scope.name)}</a> / ${escapeHtml(T.crumbBest)}</p>`;
  } else {
    crumbs = `<p class="crumbs"><a href="/">naapurustot.fi</a> / <a href="${DIRECTORY_PATH[lang]}">${escapeHtml(T.crumbAll)}</a> / <a href="${CITY_PREFIX[lang]}/${escapeHtml(scope.id)}/">${escapeHtml(locationName)}</a> / ${escapeHtml(T.crumbBest)}</p>`;
  }

  const nationalCta = !national
    ? `\n      <p><a href="${rankPath(metric.slug, null, lang)}">${escapeHtml(T.nationalLink)} →</a></p>`
    : '';

  // Into-app CTA: open the interactive map already showing this metric's choropleth for
  // this scope, so a cold-search visitor lands on the ramp they searched for (not the
  // default view). National → the all-Finland default (?layer=); region/muni → ?city=
  // (a muni has no city filter of its own, so it falls back to its owning region).
  const mapCityId = national ? null : (isMuni ? scope.regionId : scope.id);
  const mapHref = mapCityId
    ? `/?city=${escapeHtml(mapCityId)}&amp;layer=${escapeHtml(metric.layer)}`
    : `/?layer=${escapeHtml(metric.layer)}`;
  const mapCta = `\n      <p><a class="cta" href="${mapHref}">${escapeHtml(T.mapCta(label, locationName))}</a></p>`;

  // CF-1: sibling-metric row so a ranking page is not a leaf — links this scope's other
  // rankings (national → the directory metrics), capped at 8, excluding the current metric.
  const siblingNav = national
    ? buildDirectoryRankingNav(lang, { limit: 8, excludeSlug: metric.slug })
    : buildBestAreasNav(scope, lang, { limit: 8, excludeSlug: metric.slug });

  const body = `      ${crumbs}
      <h1>${escapeHtml(T.h1(label, locationName))}</h1>
      <p class="lead">${escapeHtml(T.intro(label, locationName, ranked.length))}</p>
      <table>
        <caption>${escapeHtml(T.source(reg.source ?? 'naapurustot.fi', reg.vintage ?? ''))}</caption>
        <thead><tr><th scope="col" class="num">${escapeHtml(T.colRank)}</th><th scope="col">${escapeHtml(T.colArea)}</th><th scope="col">${escapeHtml(TEXT[lang].colPostal)}</th>${regionColHead}<th scope="col" class="num">${escapeHtml(metric.col[lang])}</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>${mapCta}${nationalCta}${siblingNav ? '\n' + siblingNav : ''}
      <p><a href="${hubPath}">← ${escapeHtml(national ? T.crumbAll : locationName)}</a></p>`;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: T.h1(label, locationName),
    numberOfItems: ranked.length,
    itemListElement: ranked.map((f, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: getDisplayName(f.properties, lang),
      url: `${ORIGIN}${AREA_PREFIX[lang]}/${toSlug(f.properties.pno, f.properties.nimi)}/`,
    })),
  };
  let crumbList;
  if (national) {
    crumbList = [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: T.crumbBest },
    ];
  } else if (isMuni) {
    crumbList = [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: T.crumbAll, item: dirUrl(lang) },
      { '@type': 'ListItem', position: 3, name: getRegionName(scope.regionId, lang), item: cityUrl(scope.regionId, lang) },
      { '@type': 'ListItem', position: 4, name: scope.name, item: muniUrl(scope.slug, lang) },
      { '@type': 'ListItem', position: 5, name: T.crumbBest },
    ];
  } else {
    crumbList = [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: T.crumbAll, item: dirUrl(lang) },
      { '@type': 'ListItem', position: 3, name: locationName, item: cityUrl(scope.id, lang) },
      { '@type': 'ListItem', position: 4, name: T.crumbBest },
    ];
  }
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbList };
  const jsonLd = [itemList, breadcrumb]
    .map((o) => `    <script type="application/ld+json">${safeJson(o)}</script>`)
    .join('\n');

  return htmlPage({
    lang,
    title: T.title(label, locationName),
    description: T.desc(label, locationName, ranked.length),
    canonical: alternates[lang],
    alternates,
    jsonLd,
    body,
  });
}

// --- Directory page ---
function buildDirectory(lang) {
  const T = TEXT[lang];
  const alternates = { fi: dirUrl('fi'), en: dirUrl('en'), sv: dirUrl('sv') };

  const rows = regions.map((r) => {
    const name = escapeHtml(getRegionName(r.id, lang));
    const href = `${CITY_PREFIX[lang]}/${escapeHtml(r.id)}/`;
    return `        <tr><td><a href="${href}">${name}</a></td>` +
      `<td class="num">${fmtNum(r.count, lang)}</td>` +
      `<td class="num">${fmtNum(r.totalPop, lang)}</td></tr>`;
  }).join('\n');

  const body = `      <p class="crumbs"><a href="/">naapurustot.fi</a> / ${escapeHtml(T.dirCrumb)}</p>
      <h1>${escapeHtml(T.dirH1)}</h1>
      <p class="lead">${escapeHtml(T.dirIntro(fmtNum(TOTAL_AREAS, lang), regions.length, fmtNum(TOTAL_POP, lang)))}</p>
      <table>
        <caption>${escapeHtml(T.dirTableCaption)}</caption>
        <thead><tr><th scope="col">${escapeHtml(T.colRegion)}</th><th scope="col" class="num">${escapeHtml(T.colAreas)}</th><th scope="col" class="num">${escapeHtml(T.colPopulation)}</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
${buildDirectoryRankingNav(lang)}
${buildCiteSection(lang, T.dirTitle, alternates[lang])}`;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: T.dirH1,
    numberOfItems: regions.length,
    itemListElement: regions.map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: getRegionName(r.id, lang),
      url: cityUrl(r.id, lang),
    })),
  };
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: T.dirH1,
    description: T.dirDesc(regions.length),
    url: alternates[lang],
    inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'naapurustot.fi', url: ORIGIN },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: T.dirCrumb },
    ],
  };
  const jsonLd = [collection, breadcrumb, itemList]
    .map((o) => `    <script type="application/ld+json">${safeJson(o)}</script>`)
    .join('\n');

  return htmlPage({
    lang,
    title: T.dirTitle,
    description: T.dirDesc(regions.length),
    canonical: alternates[lang],
    alternates,
    jsonLd,
    body,
  });
}

// --- Region hub page ---
function buildCityHub(region, lang) {
  const T = TEXT[lang];
  const regionName = getRegionName(region.id, lang);
  const alternates = {
    fi: cityUrl(region.id, 'fi'),
    en: cityUrl(region.id, 'en'),
    sv: cityUrl(region.id, 'sv'),
  };

  // Neighbourhoods sorted by population (largest first).
  const sorted = [...region.features].sort(
    (a, b) => (Number(b.properties.he_vakiy) || 0) - (Number(a.properties.he_vakiy) || 0),
  );

  const rows = sorted.map((f) => {
    const p = f.properties;
    const name = escapeHtml(getDisplayName(p, lang));
    const href = `${AREA_PREFIX[lang]}/${escapeHtml(toSlug(p.pno, p.nimi))}/`;
    const pop = Number.isFinite(Number(p.he_vakiy)) ? fmtNum(p.he_vakiy, lang) : T.missing;
    const income = Number.isFinite(Number(p.hr_mtu)) && Number(p.hr_mtu) > 0
      ? `${fmtNum(p.hr_mtu, lang)} €`
      : T.missing;
    return `        <tr><td><a href="${href}">${name}</a></td>` +
      `<td>${escapeHtml(p.pno)}</td>` +
      `<td class="num">${pop}</td>` +
      `<td class="num">${income}</td></tr>`;
  }).join('\n');

  const regionEsc = escapeHtml(regionName);
  const body = `      <p class="crumbs"><a href="/">naapurustot.fi</a> / <a href="${DIRECTORY_PATH[lang]}">${escapeHtml(T.dirCrumb)}</a> / ${regionEsc}</p>
      <h1>${regionEsc}</h1>
      <p class="lead">${escapeHtml(T.cityIntro(regionName, region.count, fmtNum(region.totalPop, lang)))}</p>
      <p class="summary"><span>${escapeHtml(T.citySummary(fmtNum(region.count, lang), fmtNum(region.totalPop, lang)))}</span></p>
      <p><a class="cta" href="/?city=${escapeHtml(region.id)}">${escapeHtml(T.cityMapCta(regionName))}</a></p>
      <h2>${escapeHtml(T.cityAreasHeading)}</h2>
      <table>
        <caption>${escapeHtml(T.cityTableCaption(regionName))}</caption>
        <thead><tr><th scope="col">${escapeHtml(T.colArea)}</th><th scope="col">${escapeHtml(T.colPostal)}</th><th scope="col" class="num">${escapeHtml(T.colPopulation)}</th><th scope="col" class="num">${escapeHtml(T.colIncome)}</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
${buildMunicipalitiesNav(region, lang)}
${buildBestAreasNav({ kind: 'region', id: region.id, rankings: region.rankings }, lang)}
${buildCompareNav(region, lang)}
${buildPlanningNav(region, lang)}
${buildCiteSection(lang, T.cityTitle(regionName), alternates[lang])}
      <p><a href="${DIRECTORY_PATH[lang]}">${escapeHtml(T.backToDir)}</a></p>`;

  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: regionName,
    description: T.cityDesc(regionName, region.count),
    url: alternates[lang],
    inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'naapurustot.fi', url: ORIGIN },
    about: {
      '@type': 'Place',
      name: regionName,
      address: { '@type': 'PostalAddress', addressCountry: 'FI' },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: Math.round(region.center[1] * 1e5) / 1e5,
        longitude: Math.round(region.center[0] * 1e5) / 1e5,
      },
    },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: T.dirCrumb, item: dirUrl(lang) },
      { '@type': 'ListItem', position: 3, name: regionName },
    ],
  };
  const dataset = buildHubDataset(lang, regionName, alternates[lang], region.center);
  const jsonLd = [collection, breadcrumb, dataset]
    .map((o) => `    <script type="application/ld+json">${safeJson(o)}</script>`)
    .join('\n');

  return htmlPage({
    lang,
    title: T.cityTitle(regionName),
    description: T.cityDesc(regionName, region.count),
    canonical: alternates[lang],
    alternates,
    jsonLd,
    body,
    ogImage: emitRegionCard(region, regionName, lang),
  });
}

// --- Municipality (kunta) hub page ----------------------------------------
// Inline localized prose (no bundled locale keys), mirroring the region hub.
const MUNI_TEXT = {
  fi: {
    title: (m) => `${m} — asuinalueet, postinumerot ja tilastot | naapurustot.fi`,
    desc: (m, n) => `${m}: ${n} postinumeroaluetta ja niiden tilastot naapurustot.fi-palvelussa — tulot, asuminen, palvelut, turvallisuus ja joukkoliikenne.`,
    intro: (m, n, pop) =>
      `${m} on suomalainen kunta. naapurustot.fi kattaa kunnassa ${n} postinumeroaluetta, ` +
      `joiden yhteenlaskettu väkiluku on noin ${pop}. Vertaile kunnan asuinalueita yli 50 mittarilla — ` +
      `tulot, asuminen, palvelut, turvallisuus ja ympäristö.`,
    tableCaption: (m) => `${m} — postinumeroalueet`,
    mapCta: (m) => `Avaa ${m} kartalla`,
    regionLabel: 'Seutukunta',
    regionMunisHeading: 'Kunnat tällä seutukunnalla',
  },
  en: {
    title: (m) => `${m} — neighbourhoods, postal codes & statistics | naapurustot.fi`,
    desc: (m, n) => `${m}: ${n} postal code areas and their statistics on naapurustot.fi — income, housing, services, safety and public transport.`,
    intro: (m, n, pop) =>
      `${m} is a Finnish municipality. naapurustot.fi covers ${n} postal code areas in ${m}, ` +
      `with a combined population of about ${pop}. Compare the municipality's neighbourhoods across 50+ ` +
      `indicators — income, housing, services, safety and environment.`,
    tableCaption: (m) => `${m} — postal code areas`,
    mapCta: (m) => `Open ${m} on the map`,
    regionLabel: 'Sub-region',
    regionMunisHeading: 'Municipalities in this sub-region',
  },
  sv: {
    title: (m) => `${m} — bostadsområden, postnummer & statistik | naapurustot.fi`,
    desc: (m, n) => `${m}: ${n} postnummerområden och deras statistik på naapurustot.fi — inkomst, boende, tjänster, säkerhet och kollektivtrafik.`,
    intro: (m, n, pop) =>
      `${m} är en finländsk kommun. naapurustot.fi täcker ${n} postnummerområden i ${m}, ` +
      `med en sammanlagd befolkning på cirka ${pop}. Jämför kommunens bostadsområden med över 50 mätare — ` +
      `inkomst, boende, tjänster, säkerhet och miljö.`,
    tableCaption: (m) => `${m} — postnummerområden`,
    mapCta: (m) => `Öppna ${m} på kartan`,
    regionLabel: 'Region',
    regionMunisHeading: 'Kommuner i denna region',
  },
};

function buildMunicipalityHub(muni, lang) {
  const T = TEXT[lang];
  const M = MUNI_TEXT[lang];
  const regionName = getRegionName(muni.regionId, lang);
  const alternates = muniAlternates(muni.slug);

  const sorted = [...muni.features].sort(
    (a, b) => (Number(b.properties.he_vakiy) || 0) - (Number(a.properties.he_vakiy) || 0),
  );
  const rows = sorted.map((f) => {
    const p = f.properties;
    const name = escapeHtml(getDisplayName(p, lang));
    const href = `${AREA_PREFIX[lang]}/${escapeHtml(toSlug(p.pno, p.nimi))}/`;
    const pop = Number.isFinite(Number(p.he_vakiy)) ? fmtNum(p.he_vakiy, lang) : T.missing;
    const income = Number.isFinite(Number(p.hr_mtu)) && Number(p.hr_mtu) > 0
      ? `${fmtNum(p.hr_mtu, lang)} €`
      : T.missing;
    return `        <tr><td><a href="${href}">${name}</a></td>` +
      `<td>${escapeHtml(p.pno)}</td>` +
      `<td class="num">${pop}</td>` +
      `<td class="num">${income}</td></tr>`;
  }).join('\n');

  const muniEsc = escapeHtml(muni.name);
  const regionEsc = escapeHtml(regionName);
  const regionHref = `${CITY_PREFIX[lang]}/${escapeHtml(muni.regionId)}/`;
  const body = `      <p class="crumbs"><a href="/">naapurustot.fi</a> / <a href="${DIRECTORY_PATH[lang]}">${escapeHtml(T.dirCrumb)}</a> / <a href="${regionHref}">${regionEsc}</a> / ${muniEsc}</p>
      <h1>${muniEsc}</h1>
      <p class="lead">${escapeHtml(M.intro(muni.name, muni.count, fmtNum(muni.totalPop, lang)))}</p>
      <p class="summary"><span>${escapeHtml(T.citySummary(fmtNum(muni.count, lang), fmtNum(muni.totalPop, lang)))}</span></p>
      <p><a class="cta" href="/?pno=${escapeHtml(String(sorted[0].properties.pno))}">${escapeHtml(M.mapCta(muni.name))}</a></p>
      <p>${escapeHtml(M.regionLabel)}: <a href="${regionHref}">${regionEsc}</a></p>
      <h2>${escapeHtml(T.cityAreasHeading)}</h2>
      <table>
        <caption>${escapeHtml(M.tableCaption(muni.name))}</caption>
        <thead><tr><th scope="col">${escapeHtml(T.colArea)}</th><th scope="col">${escapeHtml(T.colPostal)}</th><th scope="col" class="num">${escapeHtml(T.colPopulation)}</th><th scope="col" class="num">${escapeHtml(T.colIncome)}</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
${buildBestAreasNav({ kind: 'muni', slug: muni.slug, rankings: muni.rankings }, lang)}
${buildCompareNav(muni, lang)}
${buildMuniPlanningNav(muni, lang)}
${buildCiteSection(lang, M.title(muni.name), alternates[lang])}
      <p><a href="${DIRECTORY_PATH[lang]}">${escapeHtml(T.backToDir)}</a></p>`;

  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: muni.name,
    description: M.desc(muni.name, muni.count),
    url: alternates[lang],
    inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'naapurustot.fi', url: ORIGIN },
    about: {
      '@type': 'Place',
      name: muni.name,
      address: { '@type': 'PostalAddress', addressLocality: muni.name, addressCountry: 'FI' },
    },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: T.dirCrumb, item: dirUrl(lang) },
      { '@type': 'ListItem', position: 3, name: regionName, item: cityUrl(muni.regionId, lang) },
      { '@type': 'ListItem', position: 4, name: muni.name },
    ],
  };
  const jsonLd = [collection, breadcrumb]
    .map((o) => `    <script type="application/ld+json">${safeJson(o)}</script>`)
    .join('\n');

  return htmlPage({
    lang,
    title: M.title(muni.name),
    description: M.desc(muni.name, muni.count),
    canonical: alternates[lang],
    alternates,
    jsonLd,
    body,
  });
}

/** "Municipalities in this sub-region" link list for a multi-municipality region hub. */
function buildMunicipalitiesNav(region, lang) {
  const list = muniByRegion.get(region.id);
  if (!list || list.length === 0) return '';
  const M = MUNI_TEXT[lang];
  const items = [...list]
    .sort((a, b) => a.name.localeCompare(b.name, 'fi'))
    .map((m) => `<li><a href="${MUNI_PREFIX[lang]}/${escapeHtml(m.slug)}/">${escapeHtml(m.name)}</a></li>`)
    .join('');
  return `      <h2>${escapeHtml(M.regionMunisHeading)}</h2>
      <ul class="muni-nav">${items}</ul>`;
}

// --- CF-10: localized EN/SV landing pages ---------------------------------
// The SPA index.html (served at /) is the Finnish landing. EN/SV visitors had no
// language-matched entry page, so the home hreflang cluster pointed all three
// locales at the same Finnish URL. These standalone landings give /en/ and /sv/
// real, crawlable, translated entry points that link into the localized directory,
// the top regional hubs, and the interactive map. All strings inline (no bundle).
const LANDING_TEXT = {
  en: {
    title: 'naapurustot.fi — compare Finnish neighbourhoods, districts and suburbs on a map',
    description: "A free map tool for comparing and exploring Finland's neighbourhoods, districts and suburbs across 50+ indicators — income, housing, services, safety, public transport and environment.",
    h1: 'Compare Finnish neighbourhoods on a map',
    intro: (areas, regions, pop) =>
      `naapurustot.fi covers ${areas} postal code areas across all ${regions} Finnish sub-regions, with a combined population of about ${pop}. Explore each area's statistics — income, housing, services, safety and environment.`,
    mapCta: 'Open the interactive map',
    regionsHeading: 'Browse sub-regions',
    directoryLink: 'All areas in Finland',
    sourcesNote: 'Every figure comes from open, verifiable public data: Statistics Finland (Paavo), HSL, HSY, OpenStreetMap, the Finnish Police, Traficom and others.',
  },
  sv: {
    title: 'naapurustot.fi — jämför finländska bostadsområden och stadsdelar på en karta',
    description: 'Ett gratis kartverktyg för att jämföra och utforska Finlands bostadsområden, stadsdelar och förorter med över 50 mätare — inkomst, boende, tjänster, säkerhet, kollektivtrafik och miljö.',
    h1: 'Jämför finländska bostadsområden på en karta',
    intro: (areas, regions, pop) =>
      `naapurustot.fi täcker ${areas} postnummerområden i alla ${regions} finländska regioner, med en sammanlagd befolkning på cirka ${pop}. Utforska varje områdes statistik — inkomst, boende, tjänster, säkerhet och miljö.`,
    mapCta: 'Öppna den interaktiva kartan',
    regionsHeading: 'Bläddra bland regioner',
    directoryLink: 'Alla områden i Finland',
    sourcesNote: 'Alla uppgifter bygger på öppna, verifierbara offentliga data: Statistikcentralen (Paavo), HSL, HSY, OpenStreetMap, polisen, Traficom med flera.',
  },
};

function buildLanding(lang) {
  const L = LANDING_TEXT[lang];
  const alternates = { fi: `${ORIGIN}/`, en: `${ORIGIN}/en/`, sv: `${ORIGIN}/sv/` };
  const topRegions = regions.slice(0, 8);
  const hubLinks = topRegions
    .map((r) => `<li><a href="${CITY_PREFIX[lang]}/${escapeHtml(r.id)}/">${escapeHtml(getRegionName(r.id, lang))}</a></li>`)
    .join('\n        ');

  const body = `      <h1>${escapeHtml(L.h1)}</h1>
      <p class="lead">${escapeHtml(L.intro(fmtNum(TOTAL_AREAS, lang), regions.length, fmtNum(TOTAL_POP, lang)))}</p>
      <p><a class="cta" href="/?lang=${lang}">${escapeHtml(L.mapCta)}</a></p>
      <h2>${escapeHtml(L.regionsHeading)}</h2>
      <ul>
        ${hubLinks}
      </ul>
      <p><a href="${DIRECTORY_PATH[lang]}">${escapeHtml(L.directoryLink)} →</a></p>
      <p class="muted">${escapeHtml(L.sourcesNote)}</p>
${buildCiteSection(lang, L.title, alternates[lang])}`;

  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: L.h1,
    description: L.description,
    url: alternates[lang],
    inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'naapurustot.fi', url: ORIGIN },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: alternates[lang] }],
  };
  const jsonLd = [collection, breadcrumb]
    .map((o) => `    <script type="application/ld+json">${safeJson(o)}</script>`)
    .join('\n');

  return htmlPage({ lang, title: L.title, description: L.description, canonical: alternates[lang], alternates, jsonLd, body });
}

// --- CF-4: per-municipality planning hubs (/kaavoitus/{kunta}/) -------------
// A dedicated, indexable planning-hub page family. For every municipality that
// has any kaavat & hankkeet content (scripts/area_planning.json), emit a
// trilingual trio listing that municipality's in-progress plans + Väylä projects,
// linking OUT to the source URLs (rel="noopener nofollow") and IN to the affected
// /alue/ profiles, with CollectionPage + ItemList JSON-LD. Honest coverage:
// national Väylä projects everywhere + vireillä asemakaava for the participating
// cities only — NOT nationwide zoning data. All strings inline (zero bundle).
const AREA_PLANNING = JSON.parse(readFileSync(join(ROOT, 'scripts', 'area_planning.json'), 'utf-8'));
const PLANNING_MANIFEST = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'planning_manifest.json'), 'utf-8')); }
  catch { return {}; }
})();
const PLANNING_SNAPSHOT = PLANNING_MANIFEST.snapshot || CITE_YEAR;
const PLANNING_CITIES = (PLANNING_MANIFEST.plans?.cities || []).join(', ');

const PLANNING_PREFIX = { fi: '/kaavoitus', en: '/en/planning', sv: '/sv/planlaggning' };
function planningPath(slug, lang) { return `${PLANNING_PREFIX[lang]}/${slug}/`; }
function planningUrl(slug, lang) { return `${ORIGIN}${planningPath(slug, lang)}`; }
function planningAlternates(slug) {
  return Object.fromEntries(LANGS.map((l) => [l, planningUrl(slug, l)]));
}
const PLANNING_OUT = {
  fi: (slug) => join(DIST, 'kaavoitus', slug),
  en: (slug) => join(DIST, 'en', 'planning', slug),
  sv: (slug) => join(DIST, 'sv', 'planlaggning', slug),
};

// Localized prose + value labels for the planning hubs (inline; no locale keys).
const PLANNING_TEXT = {
  fi: {
    title: (m) => `Kaavoitus ja hankkeet — ${m} | naapurustot.fi`,
    h1: (m) => `Kaavoitus ja hankkeet — ${m}`,
    desc: (m, n) => `${m}: käynnissä olevat kaavat ja hankkeet — ${n} kohdetta. Lähdelinkit ja vaikutusalueet naapurustot.fi-palvelussa.`,
    intro: (m, n) => `${m}n alueen kaavat ja hankkeet, joita seurataan naapurustot.fi-palvelussa — yhteensä ${n} kohdetta lähdelinkeineen ja vaikutusalueineen.`,
    coverage: (cities, snap) => `Kansalliset Väylä-hankkeet sekä osallistuvien kaupunkien (${cities}) vireillä olevat asemakaavat tilanteessa ${snap}. Tämä ei ole valtakunnallinen kaavoitusaineisto.`,
    entriesHeading: 'Kaavat ja hankkeet',
    areasHeading: 'Vaikutusalueet',
    crumb: 'Kaavoitus ja hankkeet',
    crossHeading: 'Kaavoitus ja hankkeet',
    kindLabel: { project: 'Hanke', plan: 'Kaava' },
    statusLabel: { kaynnissa: 'käynnissä', vireilla: 'vireillä', hyvaksytty: 'hyväksytty' },
  },
  en: {
    title: (m) => `Planning and projects — ${m} | naapurustot.fi`,
    h1: (m) => `Planning and projects — ${m}`,
    desc: (m, n) => `${m}: in-progress plans and infrastructure projects — ${n} items. Source links and affected areas on naapurustot.fi.`,
    intro: (m, n) => `Plans and infrastructure projects in ${m} tracked on naapurustot.fi — ${n} items in total, with source links and the areas they affect.`,
    coverage: (cities, snap) => `National Väylä infrastructure projects plus in-progress local plans for participating cities (${cities}) as of ${snap}. This is not nationwide zoning data.`,
    entriesHeading: 'Plans and projects',
    areasHeading: 'Affected areas',
    crumb: 'Planning and projects',
    crossHeading: 'Planning and projects',
    kindLabel: { project: 'Project', plan: 'Plan' },
    statusLabel: { kaynnissa: 'ongoing', vireilla: 'in progress', hyvaksytty: 'approved' },
  },
  sv: {
    title: (m) => `Planläggning och projekt — ${m} | naapurustot.fi`,
    h1: (m) => `Planläggning och projekt — ${m}`,
    desc: (m, n) => `${m}: pågående planer och projekt — ${n} objekt. Källänkar och berörda områden på naapurustot.fi.`,
    intro: (m, n) => `Planer och infrastrukturprojekt i ${m} som följs på naapurustot.fi — totalt ${n} objekt med källänkar och berörda områden.`,
    coverage: (cities, snap) => `Nationella Väylä-infrastrukturprojekt samt pågående detaljplaner i deltagande städer (${cities}) per ${snap}. Detta är inte rikstäckande planläggningsdata.`,
    entriesHeading: 'Planer och projekt',
    areasHeading: 'Berörda områden',
    crumb: 'Planläggning och projekt',
    crossHeading: 'Planläggning och projekt',
    kindLabel: { project: 'Projekt', plan: 'Plan' },
    statusLabel: { kaynnissa: 'pågående', vireilla: 'under beredning', hyvaksytty: 'godkänd' },
  },
};

// Aggregate area_planning.json by municipality (the municipality of each pno comes
// from its geojson feature). Each entry of a Väylä project repeats across many pnos,
// so dedupe entries by name|url|date. Only municipalities with ≥1 entry get a hub.
const propsByPno = new Map();
for (const f of geojson.features) {
  const p = f.properties;
  if (p?.pno) propsByPno.set(String(p.pno), p);
}

const planningByMuni = new Map();
for (const [pno, list] of Object.entries(AREA_PLANNING)) {
  if (!Array.isArray(list) || list.length === 0) continue;
  const p = propsByPno.get(String(pno));
  if (!p || !p.municipality) continue;
  if (!planningByMuni.has(p.municipality)) {
    planningByMuni.set(p.municipality, {
      municipality: p.municipality,
      regionId: p.city || null,
      areas: [],
      entries: [],
      _seen: new Set(),
    });
  }
  const agg = planningByMuni.get(p.municipality);
  agg.areas.push(p);
  for (const e of list) {
    const key = `${e.name}|${e.url}|${e.date || ''}`;
    if (agg._seen.has(key)) continue;
    agg._seen.add(key);
    agg.entries.push(e);
  }
}

// region id → its planning municipalities (for the region-hub cross-link row).
const planningMunisByRegion = new Map();
for (const agg of planningByMuni.values()) {
  if (!agg.regionId) continue;
  if (!planningMunisByRegion.has(agg.regionId)) planningMunisByRegion.set(agg.regionId, []);
  planningMunisByRegion.get(agg.regionId).push(agg);
}
for (const list of planningMunisByRegion.values()) {
  list.sort((a, b) => b.areas.length - a.areas.length || a.municipality.localeCompare(b.municipality, 'fi'));
}

/** Region-hub cross-link row to its municipalities' kaavoitus hubs (CF-4). */
function buildPlanningNav(region, lang) {
  const munis = planningMunisByRegion.get(region.id);
  if (!munis || munis.length === 0) return '';
  const links = munis
    .map((a) => `<a href="${planningPath(slugify(a.municipality), lang)}">${escapeHtml(a.municipality)}</a>`)
    .join(' · ');
  return `      <h2>${escapeHtml(PLANNING_TEXT[lang].crossHeading)}</h2>\n      <p>${links}</p>`;
}

/** CF-1: municipality hub → its own /kaavoitus/ planning page, when that municipality
 *  publishes planning data (a real generated page, so no 404). */
function buildMuniPlanningNav(muni, lang) {
  if (!planningByMuni.has(muni.name)) return '';
  return `      <h2>${escapeHtml(PLANNING_TEXT[lang].crossHeading)}</h2>\n      <p><a href="${planningPath(slugify(muni.name), lang)}">${escapeHtml(muni.name)}</a></p>`;
}

/** Build one municipality planning hub page. */
function buildPlanningHub(agg, slug, lang) {
  const T = PLANNING_TEXT[lang];
  const muni = agg.municipality;
  const alternates = planningAlternates(slug);
  const regionName = agg.regionId ? getRegionName(agg.regionId, lang) : '';
  const n = agg.entries.length;

  const entryItems = agg.entries.map((e) => {
    const name = escapeHtml(e.name);
    const url = escapeHtml(e.url);
    const meta = [T.kindLabel[e.kind] ?? e.kind, T.statusLabel[e.status] ?? e.status, e.date, e.source]
      .filter(Boolean)
      .map(escapeHtml)
      .join(' · ');
    return `        <li><a href="${url}" rel="noopener nofollow" target="_blank">${name}</a> <span class="muted">— ${meta}</span></li>`;
  }).join('\n');

  const areaItems = agg.areas.map((p) => {
    const name = escapeHtml(getDisplayName(p, lang));
    const href = `${AREA_PREFIX[lang]}/${escapeHtml(toSlug(p.pno, p.nimi))}/`;
    return `        <li><a href="${href}">${name}</a> <span class="muted">${escapeHtml(p.pno)}</span></li>`;
  }).join('\n');

  const crumbs = regionName
    ? `<p class="crumbs"><a href="/">naapurustot.fi</a> / <a href="${CITY_PREFIX[lang]}/${escapeHtml(agg.regionId)}/">${escapeHtml(regionName)}</a> / ${escapeHtml(T.crumb)}</p>`
    : `<p class="crumbs"><a href="/">naapurustot.fi</a> / ${escapeHtml(T.crumb)}</p>`;
  const backLink = regionName
    ? `\n      <p><a href="${CITY_PREFIX[lang]}/${escapeHtml(agg.regionId)}/">← ${escapeHtml(regionName)}</a></p>`
    : '';

  const body = `      ${crumbs}
      <h1>${escapeHtml(T.h1(muni))}</h1>
      <p class="lead">${escapeHtml(T.intro(muni, n))}</p>
      <p class="muted">${escapeHtml(T.coverage(PLANNING_CITIES, PLANNING_SNAPSHOT))}</p>
      <h2>${escapeHtml(T.entriesHeading)} (${n})</h2>
      <ul>
${entryItems}
      </ul>
      <h2>${escapeHtml(T.areasHeading)} (${agg.areas.length})</h2>
      <ul>
${areaItems}
      </ul>${backLink}`;

  const itemList = {
    '@type': 'ItemList',
    numberOfItems: n,
    itemListElement: agg.entries.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: e.name,
      url: e.url,
    })),
  };
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: T.h1(muni),
    description: T.desc(muni, n),
    url: alternates[lang],
    inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'naapurustot.fi', url: ORIGIN },
    about: { '@type': 'Place', name: muni, address: { '@type': 'PostalAddress', addressCountry: 'FI' } },
    mainEntity: itemList,
  };
  const crumbList = regionName
    ? [
        { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: regionName, item: cityUrl(agg.regionId, lang) },
        { '@type': 'ListItem', position: 3, name: T.crumb },
      ]
    : [
        { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: T.crumb },
      ];
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbList };
  const jsonLd = [collection, breadcrumb]
    .map((o) => `    <script type="application/ld+json">${safeJson(o)}</script>`)
    .join('\n');

  return htmlPage({
    lang,
    title: T.title(muni),
    description: T.desc(muni, n),
    canonical: alternates[lang],
    alternates,
    jsonLd,
    body,
  });
}

// --- Main ---
console.log('Prerendering regional hub pages...');

const DIR_OUT = {
  fi: join(DIST, 'kaupungit'),
  en: join(DIST, 'en', 'cities'),
  sv: join(DIST, 'sv', 'stader'),
};
const CITY_OUT = {
  fi: (id) => join(DIST, 'kaupunki', id),
  en: (id) => join(DIST, 'en', 'city', id),
  sv: (id) => join(DIST, 'sv', 'stad', id),
};

// --- Comparison-pair infrastructure. Bounded, deterministic per-region pairs shared by
// BOTH the region hubs' "popular comparisons" nav (buildCompareNav) and the /vertaa/
// page generation below — one source of truth, so hubs never link to a missing page.
// Defined here (above the hub write loop) so buildCityHub can reach it at render time.
const COMPARE_PREFIX = { fi: '/vertaa', en: '/en/compare', sv: '/sv/jamfor' };
const COMPARE_TOP_N = 12; // per-region most-populated areas eligible for pairing
const compareFeatByPno = new Map();
for (const f of geojson.features) {
  const p = f.properties;
  if (p?.pno && p?.nimi && p?.city) compareFeatByPno.set(String(p.pno), f);
}
const ADJACENCY = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'adjacency.json'), 'utf-8')); }
  catch { return {}; }
})();
/** [lo,hi] pno pairs for one region: adjacency ∩ its top-N most-populated areas, same
 *  region only, deduped, stably sorted. Same-region means no pair spans two regions, so
 *  flattening these across regions reproduces the old global list exactly. */
function computeRegionComparePairs(region) {
  const top = [...region.features]
    .sort((x, y) => (Number(y.properties.he_vakiy) || 0) - (Number(x.properties.he_vakiy) || 0))
    .slice(0, COMPARE_TOP_N);
  const topPnos = new Set(top.map((f) => String(f.properties.pno)));
  const seen = new Set();
  const pairs = [];
  for (const f of top) {
    const pnoA = String(f.properties.pno);
    for (const nb of ADJACENCY[pnoA] || []) {
      const pnoB = String(nb);
      if (!topPnos.has(pnoB)) continue; // same-region pairs only, both in the top-N
      const [lo, hi] = pnoA < pnoB ? [pnoA, pnoB] : [pnoB, pnoA];
      const key = `${lo}-vs-${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([lo, hi]);
    }
  }
  pairs.sort((p, q) => (p[0] === q[0] ? p[1].localeCompare(q[1]) : p[0].localeCompare(q[0])));
  return pairs;
}

// CF-12: which metrics earn a per-region ranking page (enough covered areas to
// rank meaningfully) — attached to each region so its hub can cross-link them.
// Also precompute each region's compare pairs so the hub can link them.
for (const region of regions) {
  region.rankings = RANKING_METRICS.filter(
    (m) => region.features.filter((f) => Number.isFinite(Number(f.properties[m.property]))).length >= MIN_REGION_RANKED,
  );
  region.comparePairs = computeRegionComparePairs(region);
}
// CF-12 (muni scope): same coverage gate per municipality, so each /kunta/{slug}/parhaat/
// page is backed by ≥MIN_MUNI_RANKED real values and the muni hub can cross-link them.
// Must run before the municipality hubs are written (buildBestAreasNav reads muni.rankings).
for (const muni of municipalities) {
  muni.rankings = RANKING_METRICS.filter(
    (m) => muni.features.filter((f) => Number.isFinite(Number(f.properties[m.property]))).length >= MIN_MUNI_RANKED,
  );
  // CF-1: same bounded compare set as regions, so the muni hub can link its /vertaa/ pages
  // (a subset of the region's — every link resolves to a page that is actually generated).
  muni.comparePairs = computeRegionComparePairs(muni);
}

for (const lang of LANGS) {
  mkdirSync(DIR_OUT[lang], { recursive: true });
  writeFileSync(join(DIR_OUT[lang], 'index.html'), buildDirectory(lang));
}

// CF-10: localized EN/SV landing pages at /en/ and /sv/ (FI landing is the SPA at /).
for (const lang of ['en', 'sv']) {
  const dir = join(DIST, lang);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), buildLanding(lang));
}
console.log('Prerendered 2 localized landing pages (/en/, /sv/).');

let cityCount = 0;
for (const region of regions) {
  for (const lang of LANGS) {
    const dir = CITY_OUT[lang](region.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), buildCityHub(region, lang));
  }
  cityCount++;
}

console.log(`Prerendered ${cityCount} regional hubs + 3 directory pages (${cityCount * 3 + 3} HTML files).`);

// Municipality (kunta) hubs (×3 languages). People search by municipality, but a
// seutukunta hub bundles several — so each multi-municipality region's municipalities
// get their own landing page. Emits a {fi,en,sv} alternates manifest so the sitemap
// lists exactly the pages written.
let muniCount = 0;
const muniManifest = [];
for (const muni of municipalities) {
  for (const lang of LANGS) {
    const dir = MUNI_OUT[lang](muni.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), buildMunicipalityHub(muni, lang));
  }
  muniManifest.push(muniAlternates(muni.slug));
  muniCount++;
}
writeFileSync(join(DIST, 'kunnat-pages.json'), JSON.stringify(muniManifest));
console.log(`Prerendered ${muniCount} municipality hubs (${muniCount * 3} HTML files; manifest → dist/kunnat-pages.json).`);

// CF-12: ranking pages — national top-50 + per-region top-15 per metric (×3 langs).
// Emits a manifest of {fi,en,sv} alternates so generate-sitemap.mjs lists exactly
// the pages that were written (single source of truth — no gating drift).
const RANKABLE = geojson.features.filter((f) => f.properties?.pno && f.properties?.nimi);
const rankingManifest = [];

function writeRankingSet(metric, scope, ranked) {
  for (const lang of LANGS) {
    const dir = join(DIST, ...rankPath(metric.slug, scope, lang).split('/').filter(Boolean));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), buildRankingPage(metric, lang, scope, ranked));
  }
  rankingManifest.push(rankAlternates(metric.slug, scope));
}

for (const metric of RANKING_METRICS) {
  const ranked = rankFeatures(RANKABLE, metric, NATIONAL_TOP_N);
  if (ranked.length >= NATIONAL_MIN_RANKED) writeRankingSet(metric, null, ranked);
}
for (const region of regions) {
  for (const metric of region.rankings) {
    // CF-1: pass region.rankings so the ranking page can render a sibling-metric row.
    writeRankingSet(metric, { kind: 'region', id: region.id, rankings: region.rankings }, rankFeatures(region.features, metric, REGION_TOP_N));
  }
}
let muniRankingSets = 0;
for (const muni of municipalities) {
  for (const metric of muni.rankings) {
    writeRankingSet(
      metric,
      { kind: 'muni', slug: muni.slug, regionId: muni.regionId, name: muni.name, rankings: muni.rankings },
      rankFeatures(muni.features, metric, REGION_TOP_N),
    );
    muniRankingSets++;
  }
}

writeFileSync(join(DIST, 'ranking-pages.json'), JSON.stringify(rankingManifest));
console.log(`Prerendered ${rankingManifest.length} ranking page sets (${rankingManifest.length * 3} HTML files; ${muniRankingSets} municipality-scoped; manifest → dist/ranking-pages.json).`);

// ---------------------------------------------------------------------------
// CF-7: bounded "{A} vs {B}" comparison pages.
//
// High-intent "area X vs area Y" queries currently dead-end in the app's
// non-indexable ?compare= URLs. Emit a static, direction-aware comparison page
// for ADJACENT area pairs within each region's most-populated areas — reusing the
// in-app comparison stat set (replicated inline; the .tsx can't be imported here
// — its formatting→i18n chain reaches Vite-only `?url` assets). Bounded by
// adjacency ∩ each region's top-N by population so the page count stays sane.
// All strings are inline trilingual / panel.* locale lookups → zero JS bundle.
// ---------------------------------------------------------------------------

// COMPARE_PREFIX and COMPARE_TOP_N are defined earlier (above the hub write loop) so the
// region hubs can build compare links; COMPARE_OUT/paths stay here with the page writers.
const COMPARE_OUT = {
  fi: (slug) => join(DIST, 'vertaa', slug),
  en: (slug) => join(DIST, 'en', 'compare', slug),
  sv: (slug) => join(DIST, 'sv', 'jamfor', slug),
};
function comparePath(slug, lang) { return `${COMPARE_PREFIX[lang]}/${slug}/`; }
function compareUrl(slug, lang) { return `${ORIGIN}${comparePath(slug, lang)}`; }
function compareAlternates(slug) { return Object.fromEntries(LANGS.map((l) => [l, compareUrl(slug, l)])); }

// Comparison stats — inline mirror of src/utils/comparisonStats.ts ALL_STATS (keys +
// directions kept in sync). Labels reuse the panel.* locale strings (free in a build
// script). higherIsBetter: null = no objective winner (price/tenure/foreign-lang).
const COMPARE_STATS = [
  { key: 'quality_index', labelKey: 'panel.quality_index', higherIsBetter: true, fmt: (v, lang) => fmtNum(Math.round(v), lang) },
  { key: 'he_vakiy', labelKey: 'panel.population', higherIsBetter: true, fmt: (v, lang) => fmtNum(Math.round(v), lang) },
  { key: 'hr_mtu', labelKey: 'panel.median_income', higherIsBetter: true, fmt: (v, lang) => `${fmtNum(Math.round(v), lang)} €` },
  { key: 'unemployment_rate', labelKey: 'panel.unemployment', higherIsBetter: false, fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { key: 'foreign_language_pct', labelKey: 'panel.foreign_lang', higherIsBetter: null, fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { key: 'ownership_rate', labelKey: 'panel.ownership_rate', higherIsBetter: null, fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { key: 'rental_rate', labelKey: 'panel.rental_rate', higherIsBetter: null, fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { key: 'ra_as_kpa', labelKey: 'panel.avg_apt_size', higherIsBetter: true, fmt: (v, lang) => `${fmtDec(v, lang, 1)} m²` },
  { key: 'detached_house_share', labelKey: 'panel.detached_houses', higherIsBetter: true, fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { key: 'population_density', labelKey: 'panel.population_density', higherIsBetter: true, fmt: (v, lang) => `${fmtNum(Math.round(v), lang)} /km²` },
  { key: 'child_ratio', labelKey: 'panel.child_ratio', higherIsBetter: true, fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { key: 'student_share', labelKey: 'panel.student_share', higherIsBetter: true, fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { key: 'property_price_sqm', labelKey: 'panel.property_price', higherIsBetter: null, fmt: (v, lang) => `${fmtNum(Math.round(v), lang)} €/m²` },
  { key: 'crime_index', labelKey: 'panel.crime_rate', higherIsBetter: false, fmt: (v, lang) => fmtDec(v, lang, 1) },
  { key: 'walkability_index', labelKey: 'panel.walkability', higherIsBetter: true, fmt: (v, lang) => fmtNum(Math.round(v), lang) },
  { key: 'transit_stop_density', labelKey: 'panel.transit_access', higherIsBetter: true, fmt: (v, lang) => `${fmtDec(v, lang, 1)} /km²` },
  { key: 'air_quality_index', labelKey: 'panel.air_quality', higherIsBetter: false, fmt: (v, lang) => fmtDec(v, lang, 1) },
];

const COMPARE_TEXT = {
  fi: {
    title: (a, b) => `${a} vai ${b}? — alueiden vertailu | naapurustot.fi`,
    h1: (a, b) => `${a} vai ${b}?`,
    desc: (a, b) => `${a} ja ${b} vierekkäin: tulot, asuminen, turvallisuus, palvelut ja joukkoliikenne. Todelliset arvot avoimesta julkisesta datasta.`,
    intro: (a, b) => `${a} ja ${b} vertailtuna yli 15 mittarilla, todellisilla arvoilla. "Parempi"-sarake näyttää kumpi alue voittaa mittareilla, joilla on selkeä suunta.`,
    colMetric: 'Mittari', colBetter: 'Parempi', same: 'Tasan', neither: '—',
    crumbCompare: 'Alueiden vertailu',
    mapCta: (a, b) => `Vertaa ${a} ja ${b} kartalla`,
    faqQ: (a, b) => `Kumpi on parempi, ${a} vai ${b}?`,
    faqA: (a, b) => `Se riippuu siitä, mikä on sinulle tärkeää. Tällä sivulla ${a} ja ${b} on vertailtu yli 15 todellisella mittarilla (tulot, asuminen, turvallisuus, palvelut ja joukkoliikenne), joten voit painottaa juuri sinulle tärkeitä asioita.`,
  },
  en: {
    title: (a, b) => `${a} vs ${b} — neighbourhood comparison | naapurustot.fi`,
    h1: (a, b) => `${a} vs ${b}`,
    desc: (a, b) => `${a} and ${b} side by side: income, housing, safety, services and public transport. Real values from open public data.`,
    intro: (a, b) => `${a} and ${b} compared across 15+ indicators with real values. The "Better" column shows which area wins on metrics that have an objective direction.`,
    colMetric: 'Metric', colBetter: 'Better', same: 'Tie', neither: '—',
    crumbCompare: 'Compare areas',
    mapCta: (a, b) => `Compare ${a} and ${b} on the map`,
    faqQ: (a, b) => `Which is better, ${a} or ${b}?`,
    faqA: (a, b) => `It depends on what matters to you. This page compares ${a} and ${b} across 15+ real indicators (income, housing, safety, services and public transport) so you can weigh the things that matter to you.`,
  },
  sv: {
    title: (a, b) => `${a} eller ${b}? — jämförelse av områden | naapurustot.fi`,
    h1: (a, b) => `${a} eller ${b}?`,
    desc: (a, b) => `${a} och ${b} sida vid sida: inkomst, boende, säkerhet, tjänster och kollektivtrafik. Verkliga värden från öppna offentliga data.`,
    intro: (a, b) => `${a} och ${b} jämförda med över 15 mätare och verkliga värden. Kolumnen "Bättre" visar vilket område som vinner på mätare med en objektiv riktning.`,
    colMetric: 'Mätare', colBetter: 'Bättre', same: 'Lika', neither: '—',
    crumbCompare: 'Jämför områden',
    mapCta: (a, b) => `Jämför ${a} och ${b} på kartan`,
    faqQ: (a, b) => `Vilket är bättre, ${a} eller ${b}?`,
    faqA: (a, b) => `Det beror på vad som är viktigt för dig. Den här sidan jämför ${a} och ${b} med över 15 verkliga mätare (inkomst, boende, säkerhet, tjänster och kollektivtrafik) så att du kan väga det som är viktigt för dig.`,
  },
};

function buildComparePage(fa, fb, lang) {
  const T = COMPARE_TEXT[lang];
  const a = fa.properties, b = fb.properties;
  const nameA = getDisplayName(a, lang);
  const nameB = getDisplayName(b, lang);
  const hrefA = `${AREA_PREFIX[lang]}/${escapeHtml(toSlug(a.pno, a.nimi))}/`;
  const hrefB = `${AREA_PREFIX[lang]}/${escapeHtml(toSlug(b.pno, b.nimi))}/`;
  const slug = `${toSlug(a.pno, a.nimi)}-vs-${toSlug(b.pno, b.nimi)}`;
  const alternates = compareAlternates(slug);

  const rows = COMPARE_STATS.map((s) => {
    const va = Number(a[s.key]);
    const vb = Number(b[s.key]);
    const hasA = Number.isFinite(va);
    const hasB = Number.isFinite(vb);
    const cellA = hasA ? escapeHtml(s.fmt(va, lang)) : '—';
    const cellB = hasB ? escapeHtml(s.fmt(vb, lang)) : '—';
    let better = T.neither;
    if (s.higherIsBetter !== null && hasA && hasB) {
      if (va === vb) better = escapeHtml(T.same);
      else better = escapeHtml((s.higherIsBetter ? va > vb : va < vb) ? nameA : nameB);
    }
    const label = escapeHtml(LOCALES[lang]?.[s.labelKey] || LOCALES.fi[s.labelKey] || s.key);
    return `        <tr><td>${label}</td><td class="num">${cellA}</td><td class="num">${cellB}</td><td>${better}</td></tr>`;
  }).join('\n');

  const body = `      <p class="crumbs"><a href="/">naapurustot.fi</a> / <a href="${DIRECTORY_PATH[lang]}">${escapeHtml(TEXT[lang].dirCrumb)}</a> / <a href="${CITY_PREFIX[lang]}/${escapeHtml(a.city)}/">${escapeHtml(getRegionName(a.city, lang))}</a> / ${escapeHtml(T.crumbCompare)}</p>
      <h1>${escapeHtml(T.h1(nameA, nameB))}</h1>
      <p class="lead">${escapeHtml(T.intro(nameA, nameB))}</p>
      <table>
        <thead><tr><th scope="col">${escapeHtml(T.colMetric)}</th><th scope="col" class="num"><a href="${hrefA}">${escapeHtml(nameA)}</a></th><th scope="col" class="num"><a href="${hrefB}">${escapeHtml(nameB)}</a></th><th scope="col">${escapeHtml(T.colBetter)}</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
      <p><a class="cta" href="/?compare=${escapeHtml(a.pno)},${escapeHtml(b.pno)}&amp;city=${escapeHtml(a.city)}">${escapeHtml(T.mapCta(nameA, nameB))}</a></p>
      <p><a href="${hrefA}">${escapeHtml(nameA)} →</a> · <a href="${hrefB}">${escapeHtml(nameB)} →</a></p>`;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: T.h1(nameA, nameB),
    numberOfItems: 2,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: nameA, url: `${ORIGIN}${AREA_PREFIX[lang]}/${toSlug(a.pno, a.nimi)}/` },
      { '@type': 'ListItem', position: 2, name: nameB, url: `${ORIGIN}${AREA_PREFIX[lang]}/${toSlug(b.pno, b.nimi)}/` },
    ],
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: TEXT[lang].dirCrumb, item: `${ORIGIN}${DIRECTORY_PATH[lang]}` },
      { '@type': 'ListItem', position: 3, name: getRegionName(a.city, lang), item: `${ORIGIN}${CITY_PREFIX[lang]}/${a.city}/` },
      { '@type': 'ListItem', position: 4, name: T.h1(nameA, nameB) },
    ],
  };
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: T.faqQ(nameA, nameB), acceptedAnswer: { '@type': 'Answer', text: T.faqA(nameA, nameB) } },
    ],
  };
  const jsonLd = [itemList, breadcrumb, faq]
    .map((o) => `    <script type="application/ld+json">${safeJson(o)}</script>`)
    .join('\n');

  return htmlPage({
    lang,
    title: T.title(nameA, nameB),
    description: T.desc(nameA, nameB),
    canonical: alternates[lang],
    alternates,
    jsonLd,
    body,
    expectFaq: true,
  });
}

// Bounded pair list: flattened from each region's precomputed pairs (computed above with
// computeRegionComparePairs). Pairs are same-region, so flattening + a stable global sort
// reproduces the old single-pass list byte-for-byte — and it's the exact set the region
// hubs link to (buildCompareNav), so no hub link can point at a page that isn't generated.
const comparePairs = regions
  .flatMap((r) => r.comparePairs || [])
  .sort((p, q) => (p[0] === q[0] ? p[1].localeCompare(q[1]) : p[0].localeCompare(q[0])));

const compareManifest = [];
for (const [lo, hi] of comparePairs) {
  const fa = compareFeatByPno.get(lo);
  const fb = compareFeatByPno.get(hi);
  if (!fa || !fb) continue;
  const slug = `${toSlug(fa.properties.pno, fa.properties.nimi)}-vs-${toSlug(fb.properties.pno, fb.properties.nimi)}`;
  for (const lang of LANGS) {
    const dir = COMPARE_OUT[lang](slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), buildComparePage(fa, fb, lang));
  }
  compareManifest.push(compareAlternates(slug));
}
writeFileSync(join(DIST, 'vertaa-pages.json'), JSON.stringify(compareManifest));
console.log(`Prerendered ${compareManifest.length} comparison page sets (${compareManifest.length * 3} HTML files; manifest → dist/vertaa-pages.json).`);

// CF-4: per-municipality planning hubs (×3 languages). Sort entries (plans before
// projects, then by name) and affected areas (largest population first) for a
// stable, readable page. Emits a {fi,en,sv} alternates manifest so the sitemap
// lists exactly the pages written.
const planningManifest = [];
const planningMunis = [...planningByMuni.values()]
  .sort((a, b) => b.areas.length - a.areas.length || a.municipality.localeCompare(b.municipality, 'fi'));
for (const agg of planningMunis) {
  const slug = slugify(agg.municipality);
  agg.areas.sort((a, b) => (Number(b.he_vakiy) || 0) - (Number(a.he_vakiy) || 0));
  agg.entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'plan' ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'fi');
  });
  for (const lang of LANGS) {
    const dir = PLANNING_OUT[lang](slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), buildPlanningHub(agg, slug, lang));
  }
  planningManifest.push(planningAlternates(slug));
}

writeFileSync(join(DIST, 'kaavoitus-pages.json'), JSON.stringify(planningManifest));
console.log(`Prerendered ${planningManifest.length} planning hub sets (${planningManifest.length * 3} HTML files; manifest → dist/kaavoitus-pages.json).`);

// CF-1: per-pno reverse-nav manifest — the mechanism that de-orphans the ranking/compare/
// municipality/planning mesh from the profile pages (the main SEO entry points). Each entry
// is assembled from the EXACT structures that generated the hub pages (rankFeatures, the
// bounded comparePairs, planningByMuni, the muni feature sets), so every href points at a
// page that was actually written — zero 404 drift. Written to scripts/ (gitignored, read by
// prerender.mjs within the same build:pages run), NOT to dist/, so it never ships.
const NAV_CAP = 8;
const areaNav = {};
function navFor(pno, lang) {
  const key = String(pno);
  if (!areaNav[key]) areaNav[key] = {};
  if (!areaNav[key][lang]) areaNav[key][lang] = { rankings: [], compares: [] };
  return areaNav[key][lang];
}
// Municipality hub per pno.
for (const muni of municipalities) {
  for (const f of muni.features) {
    for (const lang of LANGS) navFor(f.properties.pno, lang).muni = { href: muniPath(muni.slug, lang), label: muni.name };
  }
}
// Planning hub per pno (its municipality publishes planning data).
for (const p of propsByPno.values()) {
  if (p.municipality && planningByMuni.has(p.municipality)) {
    for (const lang of LANGS) navFor(p.pno, lang).planning = { href: planningPath(slugify(p.municipality), lang), label: p.municipality };
  }
}
// Rankings per pno — national + region + muni, mirroring the exact pages written above.
function addRankingsToNav(scope, metrics, features, topN) {
  for (const metric of metrics) {
    const ranked = rankFeatures(features, metric, topN);
    for (const lang of LANGS) {
      const href = rankPath(metric.slug, scope, lang);
      const label = cap(metric.label[lang]);
      for (const f of ranked) {
        const nav = navFor(f.properties.pno, lang);
        if (nav.rankings.length < NAV_CAP) nav.rankings.push({ href, label });
      }
    }
  }
}
for (const metric of RANKING_METRICS) {
  const ranked = rankFeatures(RANKABLE, metric, NATIONAL_TOP_N);
  if (ranked.length < NATIONAL_MIN_RANKED) continue; // only metrics that earned a national page
  for (const lang of LANGS) {
    const href = rankPath(metric.slug, null, lang);
    const label = cap(metric.label[lang]);
    for (const f of ranked) {
      const nav = navFor(f.properties.pno, lang);
      if (nav.rankings.length < NAV_CAP) nav.rankings.push({ href, label });
    }
  }
}
for (const region of regions) addRankingsToNav({ kind: 'region', id: region.id }, region.rankings, region.features, REGION_TOP_N);
for (const muni of municipalities) addRankingsToNav({ kind: 'muni', slug: muni.slug, regionId: muni.regionId, name: muni.name }, muni.rankings, muni.features, REGION_TOP_N);
// Compares per pno — both members of each generated /vertaa/ pair.
for (const [lo, hi] of comparePairs) {
  const fa = compareFeatByPno.get(lo);
  const fb = compareFeatByPno.get(hi);
  if (!fa || !fb) continue;
  const slug = `${toSlug(fa.properties.pno, fa.properties.nimi)}-vs-${toSlug(fb.properties.pno, fb.properties.nimi)}`;
  for (const lang of LANGS) {
    const href = comparePath(slug, lang);
    const label = `${getDisplayName(fa.properties, lang)} vs ${getDisplayName(fb.properties, lang)}`;
    const na = navFor(lo, lang); if (na.compares.length < NAV_CAP) na.compares.push({ href, label });
    const nb = navFor(hi, lang); if (nb.compares.length < NAV_CAP) nb.compares.push({ href, label });
  }
}
writeFileSync(join(ROOT, 'scripts', 'area_nav.generated.json'), JSON.stringify(areaNav));
console.log(`Wrote per-pno reverse-nav manifest (${Object.keys(areaNav).length} pnos → scripts/area_nav.generated.json).`);
