/**
 * Prerender neighborhood profile pages as static HTML for SEO.
 *
 * Reads the GeoJSON, generates an HTML file for each neighborhood at:
 *   dist/alue/{slug}/index.html      (Finnish)
 *   dist/en/area/{slug}/index.html   (English)
 *
 * Each file includes proper <title>, meta tags, JSON-LD, hreflang,
 * and a noscript fallback with key stats. The React app hydrates on top.
 *
 * Run after `npm run build`:
 *   node scripts/prerender.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const GEOJSON_PATH = join(ROOT, 'public', 'data', 'metro_neighborhoods.geojson');

// Read the built index.html as template
const template = readFileSync(join(DIST, 'index.html'), 'utf-8');

// Read GeoJSON
const geojson = JSON.parse(readFileSync(GEOJSON_PATH, 'utf-8'));

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toSlug(pno, nimi) {
  return `${pno}-${slugify(nimi)}`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCityName(city, lang) {
  const names = {
    helsinki_metro: { fi: 'Helsingin seutu', en: 'Helsinki Metro', sv: 'Helsingforsregionen' },
    turku: { fi: 'Turun seutu', en: 'Turku Metro', sv: 'Åboregionen' },
    tampere: { fi: 'Tampereen seutu', en: 'Tampere Metro', sv: 'Tammerforsregionen' },
  };
  return names[city]?.[lang] ?? '';
}

function getQualityLabel(qi, lang) {
  if (qi == null) return null;
  const cats = [
    { min: 0, max: 20, fi: 'Vältä', en: 'Avoid', sv: 'Undvik' },
    { min: 21, max: 40, fi: 'Huono', en: 'Bad', sv: 'Dåligt' },
    { min: 41, max: 60, fi: 'OK', en: 'Okay', sv: 'Okej' },
    { min: 61, max: 80, fi: 'Hyvä', en: 'Good', sv: 'Bra' },
    { min: 81, max: 100, fi: 'Erinomainen', en: 'Excellent', sv: 'Utmärkt' },
  ];
  const cat = cats.find(c => qi >= c.min && qi <= c.max);
  return cat?.[lang] ?? null;
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

function buildJsonLd(props, center, url) {
  const cityName = props.city === 'helsinki_metro' ? 'Helsinki'
    : props.city === 'turku' ? 'Turku'
    : props.city === 'tampere' ? 'Tampere'
    : 'Finland';

  const place = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: props.nimi,
    description: `${props.nimi} (${props.pno}) – ${cityName}`,
    url,
    address: {
      '@type': 'PostalAddress',
      postalCode: props.pno,
      addressLocality: cityName,
      addressCountry: 'FI',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: center[1],
      longitude: center[0],
    },
    isPartOf: { '@type': 'WebSite', url: 'https://naapurustot.fi' },
  };

  if (props.quality_index != null) {
    place.additionalProperty = [{
      '@type': 'PropertyValue',
      name: 'Quality Index',
      value: Math.round(props.quality_index),
      maxValue: 100,
    }];
  }

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: 'https://naapurustot.fi' },
      { '@type': 'ListItem', position: 2, name: cityName, item: `https://naapurustot.fi/?city=${props.city ?? 'helsinki_metro'}` },
      { '@type': 'ListItem', position: 3, name: props.nimi },
    ],
  };

  // Escape `<` to `\u003c` so a literal `</script>` in a neighborhood name
  // (or any other string field) cannot break out of the <script> element.
  // This matches the in-app <JsonLd /> component in src/components/profile/JsonLd.tsx.
  const safeJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${safeJson(place)}</script>\n    <script type="application/ld+json">${safeJson(breadcrumb)}</script>`;
}

function buildNoscriptContent(props, lang) {
  const cityName = getCityName(props.city, lang);
  const qi = props.quality_index != null ? Math.round(props.quality_index) : null;
  const qiLabel = getQualityLabel(qi, lang);
  const displayName = getDisplayName(props, lang);

  const labels = {
    fi: {
      qi: 'Laatuindeksi',
      median_income: 'Mediaanitulo',
      unemployment: 'Työttömyysaste',
      population: 'Väkiluku',
      property_price: 'Asuntohinnat',
      higher_education: 'Korkeakoulutus',
      back: 'Takaisin kartalle',
    },
    en: {
      qi: 'Quality Index',
      median_income: 'Median income',
      unemployment: 'Unemployment',
      population: 'Population',
      property_price: 'Property price',
      higher_education: 'Higher education',
      back: 'Back to the map',
    },
    sv: {
      qi: 'Kvalitetsindex',
      median_income: 'Medianinkomst',
      unemployment: 'Arbetslöshet',
      population: 'Folkmängd',
      property_price: 'Bostadspriser',
      higher_education: 'Högre utbildning',
      back: 'Tillbaka till kartan',
    },
  };
  const L = labels[lang] ?? labels.en;

  const lines = [`<h1>${escapeHtml(displayName)} (${props.pno})</h1>`];
  lines.push(`<p>${cityName}</p>`);

  if (qi != null && qiLabel) {
    lines.push(`<h2>${L.qi}: ${qi}/100 (${qiLabel})</h2>`);
  }

  const stats = [];
  if (props.hr_mtu != null) stats.push(`${L.median_income}: ${Math.round(props.hr_mtu).toLocaleString()} €`);
  if (props.unemployment_rate != null) stats.push(`${L.unemployment}: ${props.unemployment_rate.toFixed(1)} %`);
  if (props.he_vakiy != null) stats.push(`${L.population}: ${Math.round(props.he_vakiy).toLocaleString()}`);
  if (props.property_price_sqm != null) stats.push(`${L.property_price}: ${Math.round(props.property_price_sqm).toLocaleString()} €/m²`);
  if (props.higher_education_rate != null) stats.push(`${L.higher_education}: ${props.higher_education_rate.toFixed(1)} %`);

  if (stats.length > 0) {
    lines.push('<ul>');
    for (const s of stats) lines.push(`<li>${s}</li>`);
    lines.push('</ul>');
  }

  lines.push(`<p><a href="/">${L.back}</a></p>`);

  return lines.join('\n        ');
}

function generatePage(feature, lang) {
  const props = feature.properties;
  const slug = toSlug(props.pno, props.nimi);
  const center = featureCenter(feature);
  const cityName = getCityName(props.city, lang);
  const qi = props.quality_index != null ? Math.round(props.quality_index) : null;
  const qiLabel = getQualityLabel(qi, lang);
  const displayName = getDisplayName(props, lang);

  const title = `${displayName} (${props.pno}) – naapurustot.fi`;

  let description;
  if (qi != null) {
    if (lang === 'fi') {
      description = `${displayName} (${props.pno}), ${cityName}. Laatuindeksi: ${qi}/100 (${qiLabel}). Tutustu alueen tilastoihin.`;
    } else if (lang === 'sv') {
      description = `${displayName} (${props.pno}), ${cityName}. Kvalitetsindex: ${qi}/100 (${qiLabel}). Utforska områdets statistik.`;
    } else {
      description = `${displayName} (${props.pno}), ${cityName}. Quality index: ${qi}/100 (${qiLabel}). Explore neighborhood statistics.`;
    }
  } else {
    if (lang === 'fi') {
      description = `${displayName} (${props.pno}), ${cityName}. Tutustu alueen tilastoihin naapurustot.fi:ssä.`;
    } else if (lang === 'sv') {
      description = `${displayName} (${props.pno}), ${cityName}. Utforska områdets statistik på naapurustot.fi.`;
    } else {
      description = `${displayName} (${props.pno}), ${cityName}. Explore neighborhood statistics on naapurustot.fi.`;
    }
  }

  const fiUrl = `https://naapurustot.fi/alue/${slug}`;
  const enUrl = `https://naapurustot.fi/en/area/${slug}`;
  const svUrl = `https://naapurustot.fi/sv/omrade/${slug}`;
  const canonicalUrl = lang === 'fi' ? fiUrl : lang === 'sv' ? svUrl : enUrl;
  const jsonLd = buildJsonLd(props, center, canonicalUrl);
  const noscriptContent = buildNoscriptContent(props, lang);

  // Replace the <head> content in the template
  let html = template;

  // Replace title
  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(title)}</title>`
  );

  // Replace meta description
  html = html.replace(
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${escapeHtml(description)}" />`
  );

  // Replace canonical
  html = html.replace(
    /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${canonicalUrl}" />`
  );

  // Replace hreflang tags
  html = html.replace(
    /<link rel="alternate" hreflang="fi" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="fi" href="${fiUrl}" />`
  );
  html = html.replace(
    /<link rel="alternate" hreflang="en" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="en" href="${enUrl}" />`
  );
  html = html.replace(
    /<link rel="alternate" hreflang="sv" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="sv" href="${svUrl}" />`
  );
  html = html.replace(
    /<link rel="alternate" hreflang="x-default" href="[^"]*" \/>/,
    `<link rel="alternate" hreflang="x-default" href="${fiUrl}" />`
  );

  // Replace OG tags
  html = html.replace(
    /<meta property="og:url" content="[^"]*" \/>/,
    `<meta property="og:url" content="${canonicalUrl}" />`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${escapeHtml(title)}" />`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*" \/>/,
    `<meta property="og:description" content="${escapeHtml(description)}" />`
  );

  // Replace Twitter tags
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*" \/>/,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*" \/>/,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`
  );

  // Inject JSON-LD before closing </head>
  html = html.replace('</head>', `    ${jsonLd}\n  </head>`);

  // Replace noscript content
  html = html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>\n      <div style="max-width:800px;margin:2rem auto;padding:1rem;font-family:sans-serif">\n        ${noscriptContent}\n      </div>\n    </noscript>`
  );

  return html;
}

// --- Main ---
console.log('Prerendering neighborhood profile pages...');

const features = geojson.features.filter(f => f.properties?.pno && f.properties?.nimi);
let count = 0;

for (const feature of features) {
  const slug = toSlug(feature.properties.pno, feature.properties.nimi);

  // Finnish page
  const fiDir = join(DIST, 'alue', slug);
  mkdirSync(fiDir, { recursive: true });
  writeFileSync(join(fiDir, 'index.html'), generatePage(feature, 'fi'));

  // English page
  const enDir = join(DIST, 'en', 'area', slug);
  mkdirSync(enDir, { recursive: true });
  writeFileSync(join(enDir, 'index.html'), generatePage(feature, 'en'));

  // Swedish page
  const svDir = join(DIST, 'sv', 'omrade', slug);
  mkdirSync(svDir, { recursive: true });
  writeFileSync(join(svDir, 'index.html'), generatePage(feature, 'sv'));

  count++;
}

console.log(`Prerendered ${count} neighborhoods (${count * 3} HTML files).`);
