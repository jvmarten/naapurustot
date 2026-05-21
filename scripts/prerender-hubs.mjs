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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const GEOJSON_PATH = join(ROOT, 'public', 'data', 'metro_neighborhoods.geojson');

const geojson = JSON.parse(readFileSync(GEOJSON_PATH, 'utf-8'));

const LOCALES = {
  fi: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'fi.json'), 'utf-8')),
  en: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'en.json'), 'utf-8')),
  sv: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'sv.json'), 'utf-8')),
};

const LANGS = ['fi', 'en', 'sv'];
const LOCALE_TAG = { fi: 'fi-FI', en: 'en-US', sv: 'sv-SE' };
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
function htmlPage({ lang, title, description, canonical, alternates, jsonLd, body }) {
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

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="theme-color" content="#1e3a5f" />
${altLinks}
    <link rel="alternate" hreflang="x-default" href="${alternates.fi}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="naapurustot.fi" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${ORIGIN}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
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
      </table>`;

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
  const jsonLd = [collection, breadcrumb]
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

for (const lang of LANGS) {
  mkdirSync(DIR_OUT[lang], { recursive: true });
  writeFileSync(join(DIR_OUT[lang], 'index.html'), buildDirectory(lang));
}

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
