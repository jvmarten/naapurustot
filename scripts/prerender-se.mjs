/**
 * Profile pages for Sweden's 6,160 DeSO areas, in all three languages (FI/EN/SV), at the
 * same /alue/, /en/area/ and /sv/omrade/ routes as Finland's. Called from prerender.mjs.
 *
 * Deliberately leaner than the Finnish page, because a Swedish area carries SCB's 15
 * metrics rather than Paavo's ~200, and because the page count matters: 18,480 pages.
 *   - Content: SCB's metrics in three sections, region and municipality, with SCB's
 *     definitions linked from the sources page. No quality index, percentiles, FAQ or
 *     "similar areas" — each is computed against Finland's national distribution.
 *   - No per-area social card: the cards are rasterized on every deploy (~3m50s for
 *     Finland's), and 18,480 more would multiply that and the published tree. Swedish
 *     pages keep the template's site-wide og:image.
 *   - No oEmbed endpoint, for the same file-count reason.
 * The client page (NeighborhoodProfilePage) renders the same sections from the payload.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SECTIONS_SE = [
  { title: { fi: 'Talous', en: 'Economy', sv: 'Ekonomi' }, metrics: [
    { prop: 'economic_standard_median', label: 'layer.economic_standard', fmt: 'sek', schema: 'Median economic standard (SEK/year)' },
    { prop: 'low_economic_standard_pct', label: 'layer.low_economic_standard', fmt: 'pct', schema: 'Low economic standard (%)' },
    { prop: 'unemployment_rate', label: 'layer.unemployment', fmt: 'pct', schema: 'Unemployment, 20–64 labour force (%)' },
    { prop: 'employment_rate', label: 'layer.employment_rate', fmt: 'pct', schema: 'Employment, 20–64 (%)' },
    { prop: 'higher_education_rate', label: 'layer.education', fmt: 'pct', schema: 'Post-secondary education, 25–65 (%)' },
  ] },
  { title: { fi: 'Väestö', en: 'Population', sv: 'Befolkning' }, metrics: [
    { prop: 'he_vakiy', label: { fi: 'Väkiluku', en: 'Population', sv: 'Folkmängd' }, fmt: 'int', schema: 'Population' },
    { prop: 'population_density', label: 'layer.population_density', fmt: 'density', schema: 'Population density (per km² of land)' },
    { prop: 'foreign_background_pct', label: 'layer.foreign_background', fmt: 'pct', schema: 'Foreign background (%)' },
    { prop: 'elderly_ratio_pct', label: 'layer.elderly_ratio', fmt: 'pct', schema: 'Aged 65+ (%)' },
    { prop: 'gender_ratio', label: 'layer.gender_ratio', fmt: 'dec2', schema: 'Women per man' },
  ] },
  { title: { fi: 'Asuminen', en: 'Housing', sv: 'Boende' }, metrics: [
    { prop: 'ownership_rate', label: 'layer.ownership', fmt: 'pct', schema: 'Residents in owned homes (%)' },
    { prop: 'rental_rate', label: 'layer.rental', fmt: 'pct', schema: 'Residents in rented homes (%)' },
    { prop: 'detached_house_share', label: 'layer.detached_houses', fmt: 'pct', schema: 'Residents in small houses (%)' },
    { prop: 'avg_household_size', label: 'layer.avg_household_size', fmt: 'dec2', schema: 'Average household size' },
    { prop: 'families_with_children_pct', label: 'layer.families_with_children', fmt: 'pct', schema: 'Households with children (%)' },
    { prop: 'single_parent_hh_pct', label: 'layer.single_parent_hh', fmt: 'pct', schema: 'Single-parent households (%)' },
  ] },
  { title: { fi: 'Palvelut', en: 'Services', sv: 'Service' }, metrics: [
    { prop: 'transit_stop_density', label: 'layer.transit_access', fmt: 'poi', schema: 'Public transport stops per km² (OpenStreetMap)' },
    { prop: 'school_density', label: 'layer.school_density', fmt: 'poi', schema: 'Schools per km² (Skolverket)' },
    { prop: 'healthcare_density', label: 'layer.healthcare_access', fmt: 'poi', schema: 'Healthcare facilities per km² (OpenStreetMap)' },
    { prop: 'grocery_density', label: 'layer.grocery_access', fmt: 'poi', schema: 'Grocery stores per km² (OpenStreetMap)' },
    { prop: 'restaurant_density', label: 'layer.restaurant_density', fmt: 'poi', schema: 'Restaurants and cafés per km² (OpenStreetMap)' },
    { prop: 'cycling_density', label: 'layer.cycling_infra', fmt: 'poi', schema: 'Cycleway segments per km² (OpenStreetMap)' },
  ] },
];

const TEXT_SE = {
  fi: {
    country: 'Ruotsi',
    titleCat: 'asuinalue ja tilastot',
    intro: (n, m, r) => `${n} on DeSO-tilastoalue ${m}n kunnassa (${r}), Ruotsissa. Tiedot: Tilastokeskus SCB, DeSO 2025.`,
    desc: (n, m) => `${n}, ${m}, Ruotsi: väkiluku, taloudellinen standardi, työllisyys, koulutus ja asuminen. Lähde: SCB.`,
    sources: 'Lähde: Statistiska centralbyrån (SCB), DeSO 2025 -aluejako, CC0. Palvelut: Skolverket (koulut) ja © OpenStreetMap-tekijät (ODbL). Määritelmät noudattavat SCB:tä, eikä niitä verrata Suomen lukuihin samalla asteikolla.',
    mapLink: 'Avaa kartalla',
    sourcesLink: 'Tietolähteet',
  },
  en: {
    country: 'Sweden',
    titleCat: 'neighbourhood & statistics',
    intro: (n, m, r) => `${n} is a DeSO statistical area in ${m} municipality (${r}), Sweden. Data: Statistics Sweden (SCB), DeSO 2025.`,
    desc: (n, m) => `${n}, ${m}, Sweden: population, economic standard, employment, education and housing. Source: SCB.`,
    sources: 'Source: Statistics Sweden (SCB), DeSO 2025 areas, CC0. Services: Skolverket (schools) and © OpenStreetMap contributors (ODbL). Definitions follow SCB and are never put on one scale with Finland\'s figures.',
    mapLink: 'Open on the map',
    sourcesLink: 'Data sources',
  },
  sv: {
    country: 'Sverige',
    titleCat: 'bostadsområde och statistik',
    intro: (n, m, r) => `${n} är ett DeSO-område i ${m} kommun (${r}), Sverige. Data: Statistiska centralbyrån (SCB), DeSO 2025.`,
    desc: (n, m) => `${n}, ${m}: folkmängd, ekonomisk standard, sysselsättning, utbildning och boende. Källa: SCB.`,
    sources: 'Källa: Statistiska centralbyrån (SCB), DeSO 2025, CC0. Service: Skolverket (skolor) och © OpenStreetMaps bidragsgivare (ODbL). Definitionerna följer SCB och ställs aldrig på samma skala som Finlands siffror.',
    mapLink: 'Öppna på kartan',
    sourcesLink: 'Datakällor',
  },
};

const SOURCES_PATH = { fi: '/tietolahteet/', en: '/en/data-sources/', sv: '/sv/datakallor/' };

/** Load Sweden's areas (the build input) and its region averages; empty when absent. */
export function loadSwedishAreas(root) {
  const path = join(root, 'public', 'data', 'se_deso.geojson');
  if (!existsSync(path)) return { features: [], regionAverages: {} };
  const features = JSON.parse(readFileSync(path, 'utf-8')).features;
  const aggregates = JSON.parse(readFileSync(join(root, 'src', 'data', 'region_aggregates.json'), 'utf-8'));
  return { features, regionAverages: aggregates.regions ?? {} };
}

/**
 * Build one Swedish profile page from the cloned template.
 * `ctx` carries prerender.mjs's own helpers so the head rewrites stay identical to Finland's.
 */
export function generateSePage(feature, lang, ctx) {
  const { template, LOCALES, LOCALE_TAG, escapeHtml, toSlug, getRegionName, localizeOgLocale, BUILD_DATE, regionAverages } = ctx;
  const p = feature.properties;
  const T = TEXT_SE[lang];
  const name = p.nimi;
  const muni = p.municipality || '';
  const region = getRegionName(p.city, lang);
  const slug = toSlug(p.pno, p.nimi);
  const urls = { fi: `https://naapurustot.fi/alue/${slug}/`, en: `https://naapurustot.fi/en/area/${slug}/`, sv: `https://naapurustot.fi/sv/omrade/${slug}/` };
  const canonicalUrl = urls[lang];
  const title = `${name} (${p.pno}) – ${muni} ${T.titleCat} – naapurustot.fi`;
  const description = T.desc(name, muni);

  const label = (l) => (typeof l === 'string' ? LOCALES[lang]?.[l] || LOCALES.fi[l] || l : l[lang]);
  const num = (v, d) => Number(v).toLocaleString(LOCALE_TAG[lang], { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt = (v, f) => {
    if (v == null || !Number.isFinite(Number(v))) return null;
    switch (f) {
      case 'sek': return `${num(v, 0)} kr`;
      case 'pct': return `${num(v, 1)} %`;
      case 'int': return num(v, 0);
      case 'density': return `${num(v, v < 10 ? 2 : 0)} /km²`;
      // Service densities run from 0.0003 in a large rural DeSO to hundreds in a city
      // block, so the decimals follow the magnitude rather than rounding a real 0.004 to 0.
      case 'poi': return `${num(v, v === 0 || v >= 10 ? 0 : v >= 1 ? 1 : v >= 0.1 ? 2 : 3)} /km²`;
      case 'dec2': return num(v, 2);
      default: return String(v);
    }
  };

  // Noscript: the full statistics, readable without JavaScript.
  const sectionsHtml = SECTIONS_SE.map((s) => {
    const rows = s.metrics
      .map((m) => [label(m.label), fmt(p[m.prop], m.fmt)])
      .filter(([, v]) => v != null)
      .map(([l, v]) => `<tr><th scope="row" style="text-align:left;font-weight:500;padding:.25rem 1rem .25rem 0">${escapeHtml(l)}</th><td>${escapeHtml(v)}</td></tr>`)
      .join('');
    return rows ? `<h2>${escapeHtml(s.title[lang])}</h2><table>${rows}</table>` : '';
  }).join('\n');
  const noscript = [
    `<h1>${escapeHtml(name)} (${p.pno})</h1>`,
    `<p>${escapeHtml(T.intro(name, muni, region))}</p>`,
    sectionsHtml,
    `<p>${escapeHtml(T.sources)} <a href="${SOURCES_PATH[lang]}">${escapeHtml(T.sourcesLink)}</a></p>`,
    `<p><a href="/?pno=${p.pno}">${escapeHtml(T.mapLink)}</a></p>`,
  ].join('\n');

  // Structured data: the place, its values, and a breadcrumb — nothing derived from
  // Finland's national distribution.
  const additionalProperty = [];
  for (const s of SECTIONS_SE) for (const m of s.metrics) {
    const v = p[m.prop];
    if (v != null && Number.isFinite(Number(v))) additionalProperty.push({ '@type': 'PropertyValue', name: m.schema, value: v });
  }
  const place = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name,
    description: T.intro(name, muni, region),
    url: canonicalUrl,
    address: { '@type': 'PostalAddress', addressLocality: muni, addressRegion: region, addressCountry: 'SE' },
    geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lon },
    containedInPlace: { '@type': 'AdministrativeArea', name: muni },
    additionalProperty,
    isPartOf: { '@type': 'WebSite', name: 'naapurustot.fi', url: 'https://naapurustot.fi' },
  };
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: 'https://naapurustot.fi/' },
      { '@type': 'ListItem', position: 2, name: region || T.country, item: `https://naapurustot.fi/?city=${p.city}` },
      { '@type': 'ListItem', position: 3, name, item: canonicalUrl },
    ],
  };
  const jsonLd = [place, crumbs].map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n    ');

  let html = template;
  html = html.replace('<html lang="fi">', `<html lang="${lang}">`);
  html = html.replace(
    /<a class="skip-link" href="#main" lang="[^"]*">[^<]*<\/a>/,
    `<a class="skip-link" href="#main" lang="${lang}">${escapeHtml(LOCALES[lang]['aria.skip_to_content'])}</a>`,
  );
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`);
  html = html.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${canonicalUrl}" />`);
  for (const l of ['fi', 'en', 'sv']) {
    html = html.replace(new RegExp(`<link rel="alternate" hreflang="${l}" href="[^"]*" />`), `<link rel="alternate" hreflang="${l}" href="${urls[l]}" />`);
  }
  html = html.replace(/<link rel="alternate" hreflang="x-default" href="[^"]*" \/>/, `<link rel="alternate" hreflang="x-default" href="${urls.fi}" />`);
  html = html.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${canonicalUrl}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(title)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${escapeHtml(title)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${escapeHtml(description)}" />`);
  html = localizeOgLocale(html, lang, title);
  html = html.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  html = html.replace(/\s*<!-- Structured Data:[\s\S]*?-->/g, '');
  html = html.replace(/\s*<meta name="keywords"[^>]*>/, '');
  const dcMeta = [
    `<meta name="DC.title" content="${escapeHtml(title)}" />`,
    `<meta name="DC.creator" content="naapurustot.fi" />`,
    `<meta name="DC.publisher" content="naapurustot.fi" />`,
    BUILD_DATE && `<meta name="DC.date" content="${BUILD_DATE}" />`,
    `<meta name="DC.identifier" content="${canonicalUrl}" />`,
    `<meta name="DC.language" content="${lang}" />`,
    `<meta name="DC.type" content="Dataset" />`,
    `<meta name="DC.rights" content="Data: Statistics Sweden (SCB), CC0" />`,
  ].filter(Boolean).map((m) => `    ${m}`).join('\n');
  html = html.replace('</head>', `${dcMeta}\n    ${jsonLd}\n  </head>`);
  html = html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>\n    <div style="max-width:820px;margin:2rem auto;padding:1rem;font-family:system-ui,sans-serif;line-height:1.55">\n${noscript}\n    </div>\n  </noscript>`,
  );
  // The client page paints from this payload. `avg` is the area's own FA25 region —
  // Sweden has no national averages here, and Finland's would not describe it.
  const payload = JSON.stringify({ p, avg: regionAverages[p.city] ?? {}, pct: null, nav: null }).replace(/</g, '\\u003c');
  html = html.replace('</body>', `    <script id="__naapurustot_profile__" type="application/json">${payload}</script>\n  </body>`);
  return html;
}
