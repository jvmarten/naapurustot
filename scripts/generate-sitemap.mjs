/**
 * Generate sitemap.xml from the GeoJSON dataset.
 *
 * Outputs to dist/sitemap.xml with all neighborhood profile page URLs
 * plus the root page.
 *
 * Run after prerender:
 *   node scripts/generate-sitemap.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const GEOJSON_PATH = join(ROOT, 'public', 'data', 'metro_neighborhoods.geojson');

const geojson = JSON.parse(readFileSync(GEOJSON_PATH, 'utf-8'));
const today = new Date().toISOString().split('T')[0];

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

const urls = [];

// Root page — provide hreflang alternates so search engines understand each locale
urls.push({
  loc: 'https://naapurustot.fi/',
  priority: '1.0',
  changefreq: 'weekly',
  alternates: {
    fi: 'https://naapurustot.fi/',
    en: 'https://naapurustot.fi/',
    sv: 'https://naapurustot.fi/',
  },
});

// Neighborhood profile pages
const features = geojson.features.filter(f => f.properties?.pno && f.properties?.nimi);

for (const feature of features) {
  const slug = toSlug(feature.properties.pno, feature.properties.nimi);
  const fi = `https://naapurustot.fi/alue/${slug}`;
  const en = `https://naapurustot.fi/en/area/${slug}`;
  const sv = `https://naapurustot.fi/sv/omrade/${slug}`;
  const alternates = { fi, en, sv };

  urls.push({ loc: fi, priority: '0.8', changefreq: 'monthly', alternates });
  urls.push({ loc: en, priority: '0.7', changefreq: 'monthly', alternates });
  urls.push({ loc: sv, priority: '0.7', changefreq: 'monthly', alternates });
}

function renderAlternates(alternates) {
  if (!alternates) return '';
  return Object.entries(alternates)
    .map(([lang, href]) => `\n    <xhtml:link rel="alternate" hreflang="${lang}" href="${href}" />`)
    .join('');
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${renderAlternates(u.alternates)}
  </url>`).join('\n')}
</urlset>
`;

writeFileSync(join(DIST, 'sitemap.xml'), xml);
console.log(`Generated sitemap.xml with ${urls.length} URLs.`);
