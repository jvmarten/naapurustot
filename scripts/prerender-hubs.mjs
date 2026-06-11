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

function htmlPage({ lang, title, description, canonical, alternates, jsonLd, body, ogImage }) {
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

  // PO-9: localized og:locale (underscore format), its two alternates, and a
  // localized per-page og:image:alt (the page title reads well as alt text).
  const localeAlts = LANGS
    .filter((l) => l !== lang)
    .map((l) => `    <meta property="og:locale:alternate" content="${OG_LOCALE[l]}" />`)
    .join('\n');

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
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
      <a href="/">naapurustot.fi</a>
    </footer>
  </body>
</html>
`;
}

/** Uppercase the first letter (metric labels are lowercase for in-sentence use). */
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** "Best areas by metric" link row for a region hub (only metrics with a page). */
function buildBestAreasNav(region, lang) {
  const avail = region.rankings || [];
  if (avail.length === 0) return '';
  const links = avail
    .map((m) => `<a href="${rankPath(m.slug, region.id, lang)}">${escapeHtml(cap(m.label[lang]))}</a>`)
    .join(' · ');
  return `      <h2>${escapeHtml(RANK_TEXT[lang].bestHeading)}</h2>\n      <p>${links}</p>`;
}

/** National "best areas by metric" link row for the directory page. */
function buildDirectoryRankingNav(lang) {
  const links = RANKING_METRICS
    .map((m) => `<a href="${rankPath(m.slug, null, lang)}">${escapeHtml(cap(m.label[lang]))}</a>`)
    .join(' · ');
  return `      <h2>${escapeHtml(RANK_TEXT[lang].bestHeading)}</h2>\n      <p>${links}</p>`;
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
const REGION_TOP_N = 15;
const NATIONAL_TOP_N = 50;

const RANKING_METRICS = [
  { slug: 'quality-index', property: 'quality_index', higherIsBetter: true,
    label: { fi: 'elämänlaatu', en: 'quality of life', sv: 'livskvalitet' },
    col: { fi: 'Laatuindeksi', en: 'Quality index', sv: 'Kvalitetsindex' },
    fmt: (v, lang) => fmtNum(Math.round(v), lang) },
  { slug: 'income', property: 'hr_mtu', higherIsBetter: true,
    label: { fi: 'mediaanitulot', en: 'median income', sv: 'medianinkomst' },
    col: { fi: 'Mediaanitulo', en: 'Median income', sv: 'Medianinkomst' },
    fmt: (v, lang) => `${fmtNum(Math.round(v), lang)} €` },
  { slug: 'safety', property: 'crime_index', higherIsBetter: false,
    label: { fi: 'turvallisuus', en: 'safety', sv: 'säkerhet' },
    col: { fi: 'Rikollisuusindeksi', en: 'Crime index', sv: 'Brottsindex' },
    fmt: (v, lang) => fmtDec(v, lang, 1) },
  { slug: 'families', property: 'child_ratio', higherIsBetter: true,
    label: { fi: 'lapsiperheet', en: 'families with children', sv: 'barnfamiljer' },
    col: { fi: 'Lasten osuus', en: 'Children (0–6) share', sv: 'Andel barn (0–6)' },
    fmt: (v, lang) => `${fmtDec(v, lang, 1)} %` },
  { slug: 'transit', property: 'transit_stop_density', higherIsBetter: true,
    label: { fi: 'joukkoliikenne', en: 'public transport access', sv: 'kollektivtrafik' },
    col: { fi: 'Pysäkkitiheys', en: 'Stop density', sv: 'Hållplatstäthet' },
    fmt: (v, lang) => fmtNum(Math.round(v), lang) },
  { slug: 'air-quality', property: 'air_quality_index', higherIsBetter: false,
    label: { fi: 'ilmanlaatu', en: 'air quality', sv: 'luftkvalitet' },
    col: { fi: 'Ilmanlaatuindeksi', en: 'Air quality index', sv: 'Luftkvalitetsindex' },
    fmt: (v, lang) => fmtDec(v, lang, 1) },
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
  },
};

/** Path (no origin) to a ranking page, per scope and language. */
function rankPath(metricSlug, regionId, lang) {
  return regionId
    ? `${CITY_PREFIX[lang]}/${regionId}/${RANK_SEGMENT[lang]}/${metricSlug}/`
    : `/${[lang === 'fi' ? null : lang, RANK_SEGMENT[lang], metricSlug].filter(Boolean).join('/')}/`;
}
function rankAlternates(metricSlug, regionId) {
  return Object.fromEntries(LANGS.map((l) => [l, `${ORIGIN}${rankPath(metricSlug, regionId, l)}`]));
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

/** Build one ranking page. `region` is null for the national list. */
function buildRankingPage(metric, lang, region, ranked) {
  const T = RANK_TEXT[lang];
  const label = metric.label[lang];
  const regionName = region ? getRegionName(region.id, lang) : '';
  const alternates = rankAlternates(metric.slug, region ? region.id : null);
  const reg = REGISTRY.metrics?.[metric.property] ?? {};
  const national = !region;

  const rows = ranked.map((f, i) => {
    const p = f.properties;
    const name = escapeHtml(getDisplayName(p, lang));
    const href = `${AREA_PREFIX[lang]}/${escapeHtml(toSlug(p.pno, p.nimi))}/`;
    const value = escapeHtml(metric.fmt(Number(p[metric.property]), lang));
    const regionCell = national
      ? `<td>${escapeHtml(getRegionName(p.city, lang))}</td>`
      : '';
    return `        <tr><td class="num">${i + 1}</td><td><a href="${href}">${name}</a></td>` +
      `<td>${escapeHtml(p.pno)}</td>${regionCell}<td class="num">${value}</td></tr>`;
  }).join('\n');

  const regionColHead = national ? `<th scope="col">${escapeHtml(T.colRegion)}</th>` : '';
  const crumbs = national
    ? `<p class="crumbs"><a href="/">naapurustot.fi</a> / ${escapeHtml(T.crumbBest)}</p>`
    : `<p class="crumbs"><a href="/">naapurustot.fi</a> / <a href="${DIRECTORY_PATH[lang]}">${escapeHtml(T.crumbAll)}</a> / <a href="${CITY_PREFIX[lang]}/${escapeHtml(region.id)}/">${escapeHtml(regionName)}</a> / ${escapeHtml(T.crumbBest)}</p>`;

  const nationalCta = !national
    ? `\n      <p><a href="${rankPath(metric.slug, null, lang)}">${escapeHtml(T.nationalLink)} →</a></p>`
    : '';

  const body = `      ${crumbs}
      <h1>${escapeHtml(T.h1(label, regionName))}</h1>
      <p class="lead">${escapeHtml(T.intro(label, regionName, ranked.length))}</p>
      <table>
        <caption>${escapeHtml(T.source(reg.source ?? 'naapurustot.fi', reg.vintage ?? ''))}</caption>
        <thead><tr><th scope="col" class="num">${escapeHtml(T.colRank)}</th><th scope="col">${escapeHtml(T.colArea)}</th><th scope="col">${escapeHtml(TEXT[lang].colPostal)}</th>${regionColHead}<th scope="col" class="num">${escapeHtml(metric.col[lang])}</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>${nationalCta}
      <p><a href="${national ? DIRECTORY_PATH[lang] : `${CITY_PREFIX[lang]}/${escapeHtml(region.id)}/`}">← ${escapeHtml(national ? T.crumbAll : regionName)}</a></p>`;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: T.h1(label, regionName),
    numberOfItems: ranked.length,
    itemListElement: ranked.map((f, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: getDisplayName(f.properties, lang),
      url: `${ORIGIN}${AREA_PREFIX[lang]}/${toSlug(f.properties.pno, f.properties.nimi)}/`,
    })),
  };
  const crumbList = national
    ? [
        { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: T.crumbBest },
      ]
    : [
        { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: T.crumbAll, item: dirUrl(lang) },
        { '@type': 'ListItem', position: 3, name: regionName, item: cityUrl(region.id, lang) },
        { '@type': 'ListItem', position: 4, name: T.crumbBest },
      ];
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbList };
  const jsonLd = [itemList, breadcrumb]
    .map((o) => `    <script type="application/ld+json">${safeJson(o)}</script>`)
    .join('\n');

  return htmlPage({
    lang,
    title: T.title(label, regionName),
    description: T.desc(label, regionName, ranked.length),
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
${buildBestAreasNav(region, lang)}
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

// CF-12: which metrics earn a per-region ranking page (enough covered areas to
// rank meaningfully) — attached to each region so its hub can cross-link them.
for (const region of regions) {
  region.rankings = RANKING_METRICS.filter(
    (m) => region.features.filter((f) => Number.isFinite(Number(f.properties[m.property]))).length >= MIN_REGION_RANKED,
  );
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

// CF-12: ranking pages — national top-50 + per-region top-15 per metric (×3 langs).
// Emits a manifest of {fi,en,sv} alternates so generate-sitemap.mjs lists exactly
// the pages that were written (single source of truth — no gating drift).
const RANKABLE = geojson.features.filter((f) => f.properties?.pno && f.properties?.nimi);
const rankingManifest = [];

function writeRankingSet(metric, region, ranked) {
  for (const lang of LANGS) {
    const dir = join(DIST, ...rankPath(metric.slug, region ? region.id : null, lang).split('/').filter(Boolean));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), buildRankingPage(metric, lang, region, ranked));
  }
  rankingManifest.push(rankAlternates(metric.slug, region ? region.id : null));
}

for (const metric of RANKING_METRICS) {
  const ranked = rankFeatures(RANKABLE, metric, NATIONAL_TOP_N);
  if (ranked.length > 0) writeRankingSet(metric, null, ranked);
}
for (const region of regions) {
  for (const metric of region.rankings) {
    writeRankingSet(metric, region, rankFeatures(region.features, metric, REGION_TOP_N));
  }
}

writeFileSync(join(DIST, 'ranking-pages.json'), JSON.stringify(rankingManifest));
console.log(`Prerendered ${rankingManifest.length} ranking page sets (${rankingManifest.length * 3} HTML files; manifest → dist/ranking-pages.json).`);
