/**
 * Prerender neighbourhood profile pages as static HTML for SEO and GEO.
 *
 * Reads the GeoJSON and writes a static HTML file for every neighbourhood at:
 *   dist/alue/{slug}/index.html       (Finnish)
 *   dist/en/area/{slug}/index.html    (English)
 *   dist/sv/omrade/{slug}/index.html  (Swedish)
 *
 * Each file has a localized <title>, meta description, canonical + hreflang
 * links, schema.org JSON-LD (Place + BreadcrumbList) and a rich <noscript>
 * fallback containing the full neighbourhood statistics as semantic HTML
 * tables — so the content is fully available to search crawlers and language
 * models that do not execute JavaScript. The React app hydrates on top for
 * interactive visitors.
 *
 * Run after `npm run build`:  node scripts/prerender.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// The app's data-processing functions, reused at build time so each page can
// embed a render-ready payload. Both modules have type-only imports, so Node's
// TypeScript stripping (Node 22.18+/24) loads them without a build step.
import { computeQualityIndices } from '../src/utils/qualityIndex.ts';
import {
  computeMetroAverages,
  computeChangeMetrics,
  computeQuickWinMetrics,
} from '../src/utils/metrics.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const GEOJSON_PATH = join(ROOT, 'public', 'data', 'metro_neighborhoods.geojson');

// Read the built index.html as template.
const template = readFileSync(join(DIST, 'index.html'), 'utf-8');

// Read GeoJSON.
const geojson = JSON.parse(readFileSync(GEOJSON_PATH, 'utf-8'));

// Process every feature exactly as the client's dataLoader does (same order),
// so each page can embed a payload the React app renders from instantly —
// avoiding the ~1.7 MB region_properties.json fetch before first paint.
computeQualityIndices(geojson.features);
computeChangeMetrics(geojson.features);
computeQuickWinMetrics(geojson.features);
const metroAverages = computeMetroAverages(geojson.features);

// UI translations — used to resolve region names and metric labels so that
// every page uses the same wording as the app, in all three languages.
const LOCALES = {
  fi: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'fi.json'), 'utf-8')),
  en: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'en.json'), 'utf-8')),
  sv: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'sv.json'), 'utf-8')),
};

const LOCALE_TAG = { fi: 'fi-FI', en: 'en-US', sv: 'sv-SE' };
/** Path prefix for a regional hub page, per language. */
const CITY_PREFIX = { fi: '/kaupunki', en: '/en/city', sv: '/sv/stad' };
/** All-areas directory URL, per language. */
const DIRECTORY_URL = { fi: '/kaupungit/', en: '/en/cities/', sv: '/sv/stader/' };

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

/** Resolve the localized display name of a region (seutukunta). */
function getRegionName(city, lang) {
  if (!city) return '';
  const key = `city.${city}`;
  return LOCALES[lang]?.[key] || LOCALES.fi[key] || LOCALES.en[key] || '';
}

/** Display name varies by language: Swedish prefers `namn`, falls back to `nimi`. */
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

function fmtNum(n, decimals, lang) {
  return Number(n).toLocaleString(LOCALE_TAG[lang], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const PER_MONTH = { fi: '/kk', en: '/mo', sv: '/mån' };

/** Human-readable formatting of a metric value for the visible fallback. */
function formatMetric(value, fmt, lang) {
  const n = Number(value);
  switch (fmt) {
    case 'euro': return `${fmtNum(Math.round(n), 0, lang)} €`;
    case 'price_sqm': return `${fmtNum(Math.round(n), 0, lang)} €/m²`;
    case 'rent_sqm': return `${fmtNum(n, 2, lang)} €/m²${PER_MONTH[lang]}`;
    case 'pct': return `${fmtNum(n, 1, lang)} %`;
    case 'sqm': return `${fmtNum(n, 1, lang)} m²`;
    case 'meters': return `${fmtNum(Math.round(n), 0, lang)} m`;
    case 'db': return `${fmtNum(n, 1, lang)} dB`;
    case 'year': return String(Math.round(n));
    case 'int': return fmtNum(Math.round(n), 0, lang);
    default: return fmtNum(n, 1, lang);
  }
}

/** Rounded numeric value for schema.org PropertyValue output. */
function roundForSchema(value, fmt) {
  const n = Number(value);
  if (fmt === 'rent_sqm') return Math.round(n * 100) / 100;
  if (fmt === 'pct' || fmt === 'dec1' || fmt === 'db' || fmt === 'sqm') return Math.round(n * 10) / 10;
  return Math.round(n);
}

const SECTION_LABELS = {
  demographics: { fi: 'Väestö', en: 'Population', sv: 'Befolkning' },
  income: { fi: 'Tulot ja työllisyys', en: 'Income & employment', sv: 'Inkomst & sysselsättning' },
  housing: { fi: 'Asuminen', en: 'Housing', sv: 'Boende' },
  services: { fi: 'Palvelut', en: 'Services', sv: 'Tjänster' },
  environment: { fi: 'Ympäristö ja turvallisuus', en: 'Environment & safety', sv: 'Miljö & säkerhet' },
};

const POPULATION_LABEL = { fi: 'Väkiluku', en: 'Population', sv: 'Folkmängd' };

/**
 * Metric catalogue grouped into sections. `label` is either a layer i18n key
 * (resolved from LOCALES) or a {fi,en,sv} object. `schema` is the stable
 * English name used in schema.org PropertyValue output.
 */
const SECTIONS = [
  { id: 'demographics', metrics: [
    { prop: 'he_vakiy', label: POPULATION_LABEL, fmt: 'int', schema: 'Population' },
    { prop: 'population_density', label: 'layer.population_density', fmt: 'int', schema: 'Population density (per km²)' },
    { prop: 'he_kika', label: 'layer.avg_age', fmt: 'dec1', schema: 'Average age (years)' },
    { prop: 'child_ratio', label: 'layer.child_ratio', fmt: 'pct', schema: 'Young children 0–6 (%)' },
    { prop: 'foreign_language_pct', label: 'layer.foreign_lang', fmt: 'pct', schema: 'Foreign-language speakers (%)' },
    { prop: 'pensioner_share', label: 'layer.pensioners', fmt: 'pct', schema: 'Pensioners (%)' },
    { prop: 'student_share', label: 'layer.student_share', fmt: 'pct', schema: 'Students (%)' },
  ] },
  { id: 'income', metrics: [
    { prop: 'hr_mtu', label: 'layer.median_income', fmt: 'euro', schema: 'Median income (EUR)' },
    { prop: 'unemployment_rate', label: 'layer.unemployment', fmt: 'pct', schema: 'Unemployment rate (%)' },
    { prop: 'employment_rate', label: 'layer.employment_rate', fmt: 'pct', schema: 'Employment rate (%)' },
    { prop: 'higher_education_rate', label: 'layer.education', fmt: 'pct', schema: 'Higher education (%)' },
  ] },
  { id: 'housing', metrics: [
    { prop: 'property_price_sqm', label: 'layer.property_price', fmt: 'price_sqm', schema: 'Property price (EUR/m²)' },
    { prop: 'rental_price_sqm', label: 'layer.rental_price', fmt: 'rent_sqm', schema: 'Rent level (EUR/m²/month)' },
    { prop: 'ownership_rate', label: 'layer.ownership', fmt: 'pct', schema: 'Home ownership (%)' },
    { prop: 'rental_rate', label: 'layer.rental', fmt: 'pct', schema: 'Rental dwellings (%)' },
    { prop: 'ra_as_kpa', label: 'layer.apt_size', fmt: 'sqm', schema: 'Average dwelling size (m²)' },
    { prop: 'detached_house_share', label: 'layer.detached_houses', fmt: 'pct', schema: 'Detached houses (%)' },
    { prop: 'avg_construction_year', label: 'layer.building_age', fmt: 'year', schema: 'Average construction year' },
  ] },
  { id: 'services', metrics: [
    { prop: 'grocery_density', label: 'layer.grocery_access', fmt: 'dec1', schema: 'Grocery store density' },
    { prop: 'restaurant_density', label: 'layer.restaurant_density', fmt: 'dec1', schema: 'Restaurant density' },
    { prop: 'school_density', label: 'layer.school_density', fmt: 'dec1', schema: 'School density' },
    { prop: 'daycare_density', label: 'layer.daycare_density', fmt: 'dec1', schema: 'Daycare density' },
    { prop: 'healthcare_density', label: 'layer.healthcare_access', fmt: 'dec1', schema: 'Healthcare density' },
    { prop: 'sports_facility_density', label: 'layer.sports_facilities', fmt: 'dec1', schema: 'Sports facility density' },
    { prop: 'transit_stop_density', label: 'layer.transit_access', fmt: 'dec1', schema: 'Transit stop density' },
  ] },
  { id: 'environment', metrics: [
    { prop: 'air_quality_index', label: 'layer.air_quality', fmt: 'dec1', schema: 'Air quality index' },
    { prop: 'tree_canopy_pct', label: 'layer.tree_canopy', fmt: 'pct', schema: 'Tree canopy cover (%)' },
    { prop: 'water_proximity_m', label: 'layer.water_proximity', fmt: 'meters', schema: 'Distance to water (m)' },
    { prop: 'noise_pollution', label: 'layer.noise_pollution', fmt: 'db', schema: 'Noise level (dB)' },
    { prop: 'walkability_index', label: 'layer.walkability', fmt: 'dec1', schema: 'Walkability index' },
    { prop: 'crime_index', label: 'layer.crime_rate', fmt: 'dec1', schema: 'Crime index' },
  ] },
];

function resolveLabel(label, lang) {
  if (typeof label === 'string') {
    return LOCALES[lang]?.[label] || LOCALES.fi[label] || LOCALES.en[label] || label;
  }
  return label[lang] || label.fi;
}

/** Localized prose used in the <noscript> fallback and meta description. */
const TEXT = {
  fi: {
    intro: (name, pno, region, count) =>
      `${name} (${pno}) on suomalainen postinumeroalue${region ? `, ${region}` : ''}. ` +
      `naapurustot.fi näyttää alueen tilastot ${count} mittarista — väestö, tulot, asuminen, palvelut ja ympäristö. ` +
      `Kaikki tiedot perustuvat avoimeen julkiseen dataan.`,
    sourcesHeading: 'Tietolähteet',
    sources: 'Tietolähteet: Tilastokeskus (Paavo-avoindata), HSL, Helsingin seudun ympäristöpalvelut HSY, ' +
      'OpenStreetMap, poliisi, Traficom ja Väylävirasto. Kaikki arvot perustuvat avoimeen, todennettavaan julkiseen dataan.',
    regionLink: 'Seutukunnan kaikki alueet',
    mapLink: 'Avaa kartalla',
    directoryLink: 'Kaikki Suomen alueet',
    schemaDesc: (name, pno, region) =>
      `${name} (${pno}), ${region} — postinumeroalueen tilastot ja vertailu naapurustot.fi-palvelussa.`,
    descTail: 'Tutustu alueen tilastoihin: asuminen, tulot, palvelut ja ympäristö.',
    pop: 'Väkiluku',
    income: 'Mediaanitulo',
  },
  en: {
    intro: (name, pno, region, count) =>
      `${name} (${pno}) is a postal code area in Finland${region ? `, in the ${region} sub-region` : ''}. ` +
      `naapurustot.fi shows statistics for this neighbourhood across ${count} indicators — ` +
      `population, income, housing, services and environment. All figures come from open public data.`,
    sourcesHeading: 'Data sources',
    sources: 'Data sources: Statistics Finland (Paavo open data), HSL, Helsinki Region Environmental Services HSY, ' +
      'OpenStreetMap, the Finnish Police, Traficom and Väylävirasto. Every value is based on open, verifiable public data.',
    regionLink: 'All areas in this region',
    mapLink: 'Open on the map',
    directoryLink: 'All areas in Finland',
    schemaDesc: (name, pno, region) =>
      `${name} (${pno}), ${region} — postal code area statistics and comparison on naapurustot.fi.`,
    descTail: 'Explore the area statistics: housing, income, services and environment.',
    pop: 'Population',
    income: 'Median income',
  },
  sv: {
    intro: (name, pno, region, count) =>
      `${name} (${pno}) är ett postnummerområde i Finland${region ? `, i regionen ${region}` : ''}. ` +
      `naapurustot.fi visar statistik för området inom ${count} mätare — ` +
      `befolkning, inkomst, boende, tjänster och miljö. Alla uppgifter bygger på öppna offentliga data.`,
    sourcesHeading: 'Datakällor',
    sources: 'Datakällor: Statistikcentralen (Paavo öppna data), HSL, Helsingforsregionens miljötjänster HSY, ' +
      'OpenStreetMap, polisen, Traficom och Trafikledsverket. Alla värden bygger på öppna, verifierbara offentliga data.',
    regionLink: 'Alla områden i regionen',
    mapLink: 'Öppna på kartan',
    directoryLink: 'Alla områden i Finland',
    schemaDesc: (name, pno, region) =>
      `${name} (${pno}), ${region} — statistik och jämförelse för postnummerområdet på naapurustot.fi.`,
    descTail: 'Utforska områdets statistik: boende, inkomst, tjänster och miljö.',
    pop: 'Folkmängd',
    income: 'Medianinkomst',
  },
};

/** Collect every present metric of a feature, grouped into sections. */
function collectSections(props) {
  const out = [];
  let count = 0;
  for (const section of SECTIONS) {
    const rows = [];
    for (const m of section.metrics) {
      const v = props[m.prop];
      if (v == null || !Number.isFinite(Number(v))) continue;
      rows.push(m);
      count++;
    }
    if (rows.length > 0) out.push({ id: section.id, rows });
  }
  return { sections: out, count };
}

function buildNoscriptContent(props, lang) {
  const T = TEXT[lang];
  const displayName = getDisplayName(props, lang);
  const regionName = getRegionName(props.city, lang);
  const name = escapeHtml(displayName);
  const pno = escapeHtml(props.pno);
  const region = escapeHtml(regionName);
  const { sections, count } = collectSections(props);

  const lines = [];
  lines.push(`      <h1>${name} (${pno})</h1>`);
  lines.push(`      <p>${escapeHtml(T.intro(displayName, props.pno, regionName, count))}</p>`);

  for (const section of sections) {
    lines.push(`      <h2>${escapeHtml(SECTION_LABELS[section.id][lang])}</h2>`);
    lines.push('      <table><tbody>');
    for (const m of section.rows) {
      const label = escapeHtml(resolveLabel(m.label, lang));
      const value = escapeHtml(formatMetric(props[m.prop], m.fmt, lang));
      lines.push(`        <tr><th scope="row">${label}</th><td>${value}</td></tr>`);
    }
    lines.push('      </tbody></table>');
  }

  lines.push(`      <h2>${escapeHtml(T.sourcesHeading)}</h2>`);
  lines.push(`      <p>${escapeHtml(T.sources)}</p>`);

  const nav = [];
  if (props.city && region) {
    nav.push(`<a href="${CITY_PREFIX[lang]}/${escapeHtml(props.city)}/">${escapeHtml(T.regionLink)}</a>`);
  }
  nav.push(`<a href="/?pno=${pno}">${escapeHtml(T.mapLink)}</a>`);
  nav.push(`<a href="${DIRECTORY_URL[lang]}">${escapeHtml(T.directoryLink)}</a>`);
  lines.push(`      <p>${nav.join(' · ')}</p>`);

  return lines.join('\n');
}

function buildDescription(props, lang, displayName, region) {
  const T = TEXT[lang];
  const parts = [`${displayName} (${props.pno})${region ? `, ${region}` : ''}.`];
  if (props.he_vakiy != null && Number.isFinite(Number(props.he_vakiy))) {
    parts.push(`${T.pop} ${fmtNum(Math.round(Number(props.he_vakiy)), 0, lang)}.`);
  }
  if (props.hr_mtu != null && Number.isFinite(Number(props.hr_mtu))) {
    parts.push(`${T.income} ${fmtNum(Math.round(Number(props.hr_mtu)), 0, lang)} €.`);
  }
  parts.push(T.descTail);
  return parts.join(' ');
}

function buildJsonLd(props, center, url, lang) {
  const name = getDisplayName(props, lang);
  const region = getRegionName(props.city, lang) || 'Finland';

  const additionalProperty = [];
  for (const section of SECTIONS) {
    for (const m of section.metrics) {
      const v = props[m.prop];
      if (v == null || !Number.isFinite(Number(v))) continue;
      additionalProperty.push({
        '@type': 'PropertyValue',
        name: m.schema,
        value: roundForSchema(v, m.fmt),
      });
    }
  }

  const place = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name,
    description: TEXT[lang].schemaDesc(name, props.pno, region),
    url,
    address: {
      '@type': 'PostalAddress',
      postalCode: props.pno,
      addressRegion: region,
      addressCountry: 'FI',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: center[1],
      longitude: center[0],
    },
    isPartOf: { '@type': 'WebSite', name: 'naapurustot.fi', url: 'https://naapurustot.fi' },
  };
  if (props.city) {
    place.containedInPlace = {
      '@type': 'Place',
      name: region,
      url: `https://naapurustot.fi${CITY_PREFIX[lang]}/${props.city}/`,
    };
  }
  if (additionalProperty.length > 0) place.additionalProperty = additionalProperty;

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: 'https://naapurustot.fi/' },
      {
        '@type': 'ListItem', position: 2, name: region,
        item: `https://naapurustot.fi${CITY_PREFIX[lang]}/${props.city ?? 'helsinki_metro'}/`,
      },
      { '@type': 'ListItem', position: 3, name },
    ],
  };

  // Escape every `<` as the JSON escape < so a literal `</script>` in any
  // string field cannot break out of the <script> element. Mirrors the
  // in-app <JsonLd /> component in src/components/profile/JsonLd.tsx.
  const safeJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${safeJson(place)}</script>\n    <script type="application/ld+json">${safeJson(breadcrumb)}</script>`;
}

function generatePage(feature, lang) {
  const props = feature.properties;
  const slug = toSlug(props.pno, props.nimi);
  const center = featureCenter(feature);
  const region = getRegionName(props.city, lang);
  const displayName = getDisplayName(props, lang);

  const title = `${displayName} (${props.pno}) – naapurustot.fi`;
  const description = buildDescription(props, lang, displayName, region);

  const fiUrl = `https://naapurustot.fi/alue/${slug}`;
  const enUrl = `https://naapurustot.fi/en/area/${slug}`;
  const svUrl = `https://naapurustot.fi/sv/omrade/${slug}`;
  const canonicalUrl = lang === 'fi' ? fiUrl : lang === 'sv' ? svUrl : enUrl;
  const jsonLd = buildJsonLd(props, center, canonicalUrl, lang);
  const noscriptContent = buildNoscriptContent(props, lang);

  let html = template;

  // Document language must match the page locale.
  html = html.replace('<html lang="fi">', `<html lang="${lang}">`);

  // Title.
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);

  // Meta description.
  html = html.replace(
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${escapeHtml(description)}" />`,
  );

  // Canonical.
  html = html.replace(
    /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${canonicalUrl}" />`,
  );

  // Hreflang tags.
  html = html.replace(
    /<link rel="alternate" hreflang="fi" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="fi" href="${fiUrl}" />`,
  );
  html = html.replace(
    /<link rel="alternate" hreflang="en" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="en" href="${enUrl}" />`,
  );
  html = html.replace(
    /<link rel="alternate" hreflang="sv" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="sv" href="${svUrl}" />`,
  );
  html = html.replace(
    /<link rel="alternate" hreflang="x-default" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="x-default" href="${fiUrl}" />`,
  );

  // Open Graph tags.
  html = html.replace(
    /<meta property="og:url" content="[^"]*" \/>/,
    `<meta property="og:url" content="${canonicalUrl}" />`,
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*" \/>/,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
  );

  // Twitter tags.
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*" \/>/,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*" \/>/,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  );

  // Inject JSON-LD before closing </head>.
  html = html.replace('</head>', `    ${jsonLd}\n  </head>`);

  // Replace noscript content with the full neighbourhood statistics.
  html = html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>\n    <div style="max-width:820px;margin:2rem auto;padding:1rem;font-family:system-ui,sans-serif;line-height:1.55">\n${noscriptContent}\n    </div>\n  </noscript>`,
  );

  // Embed this neighbourhood's processed properties + the dataset-wide
  // averages so NeighborhoodProfilePage renders immediately, without first
  // fetching the national dataset. `<` is escaped so a literal `</script>` in
  // any string field cannot break out of the element.
  const payload = JSON.stringify({ p: props, avg: metroAverages }).replace(/</g, '\\u003c');
  html = html.replace(
    '</body>',
    `    <script id="__naapurustot_profile__" type="application/json">${payload}</script>\n  </body>`,
  );

  return html;
}

// --- Main ---
console.log('Prerendering neighbourhood profile pages...');

const features = geojson.features.filter((f) => f.properties?.pno && f.properties?.nimi);
let count = 0;

for (const feature of features) {
  const slug = toSlug(feature.properties.pno, feature.properties.nimi);

  const fiDir = join(DIST, 'alue', slug);
  mkdirSync(fiDir, { recursive: true });
  writeFileSync(join(fiDir, 'index.html'), generatePage(feature, 'fi'));

  const enDir = join(DIST, 'en', 'area', slug);
  mkdirSync(enDir, { recursive: true });
  writeFileSync(join(enDir, 'index.html'), generatePage(feature, 'en'));

  const svDir = join(DIST, 'sv', 'omrade', slug);
  mkdirSync(svDir, { recursive: true });
  writeFileSync(join(svDir, 'index.html'), generatePage(feature, 'sv'));

  count++;
}

console.log(`Prerendered ${count} neighbourhoods (${count * 3} HTML files).`);
