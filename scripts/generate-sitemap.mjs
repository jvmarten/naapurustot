/**
 * Generate sitemap.xml from the GeoJSON dataset.
 *
 * Outputs dist/sitemap.xml covering:
 *   - the home page
 *   - the all-areas directory (fi/en/sv)
 *   - every regional hub page (fi/en/sv)
 *   - every neighbourhood profile page (fi/en/sv)
 *
 * Each entry carries xhtml:link hreflang alternates so search engines map the
 * locales correctly. The slug logic is kept identical to scripts/prerender.mjs
 * so that every <loc> resolves to a file that prerendering actually wrote.
 *
 * Run after prerendering:  node scripts/generate-sitemap.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const GEOJSON_PATH = join(ROOT, 'public', 'data', 'metro_neighborhoods.geojson');
const ORIGIN = 'https://naapurustot.fi';

const geojson = JSON.parse(readFileSync(GEOJSON_PATH, 'utf-8'));
const today = new Date().toISOString().split('T')[0];

// Slug logic — must stay identical to scripts/prerender.mjs.
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

const urls = [];

// Home page.
urls.push({
  loc: `${ORIGIN}/`,
  priority: '1.0',
  changefreq: 'weekly',
  alternates: { fi: `${ORIGIN}/`, en: `${ORIGIN}/`, sv: `${ORIGIN}/` },
});

// All-areas directory.
const directory = {
  fi: `${ORIGIN}/kaupungit/`,
  en: `${ORIGIN}/en/cities/`,
  sv: `${ORIGIN}/sv/stader/`,
};
urls.push({ loc: directory.fi, priority: '0.9', changefreq: 'weekly', alternates: directory });
urls.push({ loc: directory.en, priority: '0.8', changefreq: 'weekly', alternates: directory });
urls.push({ loc: directory.sv, priority: '0.8', changefreq: 'weekly', alternates: directory });

// CF-9: data sources & methodology page.
const dataSources = {
  fi: `${ORIGIN}/tietolahteet`,
  en: `${ORIGIN}/en/data-sources`,
  sv: `${ORIGIN}/sv/datakallor`,
};
urls.push({ loc: dataSources.fi, priority: '0.5', changefreq: 'monthly', alternates: dataSources });
urls.push({ loc: dataSources.en, priority: '0.4', changefreq: 'monthly', alternates: dataSources });
urls.push({ loc: dataSources.sv, priority: '0.4', changefreq: 'monthly', alternates: dataSources });

const features = geojson.features.filter((f) => f.properties?.pno && f.properties?.nimi);

// Regional hub pages — one per region that has neighbourhood data.
const regionIds = [...new Set(features.map((f) => f.properties.city).filter(Boolean))].sort();
for (const id of regionIds) {
  const alt = {
    fi: `${ORIGIN}/kaupunki/${id}/`,
    en: `${ORIGIN}/en/city/${id}/`,
    sv: `${ORIGIN}/sv/stad/${id}/`,
  };
  urls.push({ loc: alt.fi, priority: '0.8', changefreq: 'monthly', alternates: alt });
  urls.push({ loc: alt.en, priority: '0.7', changefreq: 'monthly', alternates: alt });
  urls.push({ loc: alt.sv, priority: '0.7', changefreq: 'monthly', alternates: alt });
}

// Neighbourhood profile pages.
for (const feature of features) {
  const slug = toSlug(feature.properties.pno, feature.properties.nimi);
  const alt = {
    fi: `${ORIGIN}/alue/${slug}`,
    en: `${ORIGIN}/en/area/${slug}`,
    sv: `${ORIGIN}/sv/omrade/${slug}`,
  };
  urls.push({ loc: alt.fi, priority: '0.7', changefreq: 'monthly', alternates: alt });
  urls.push({ loc: alt.en, priority: '0.6', changefreq: 'monthly', alternates: alt });
  urls.push({ loc: alt.sv, priority: '0.6', changefreq: 'monthly', alternates: alt });
}

function renderAlternates(alternates) {
  if (!alternates) return '';
  return Object.entries(alternates)
    .map(([lang, href]) => `\n    <xhtml:link rel="alternate" hreflang="${lang}" href="${href}" />`)
    .join('');
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${renderAlternates(u.alternates)}
  </url>`).join('\n')}
</urlset>
`;

writeFileSync(join(DIST, 'sitemap.xml'), xml);
console.log(`Generated sitemap.xml with ${urls.length} URLs.`);
