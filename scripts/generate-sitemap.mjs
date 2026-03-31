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

// Root page
urls.push({ loc: 'https://naapurustot.fi/', priority: '1.0', changefreq: 'weekly' });

// Neighborhood profile pages
const features = geojson.features.filter(f => f.properties?.pno && f.properties?.nimi);

for (const feature of features) {
  const slug = toSlug(feature.properties.pno, feature.properties.nimi);

  urls.push({
    loc: `https://naapurustot.fi/alue/${slug}`,
    priority: '0.8',
    changefreq: 'monthly',
  });
  urls.push({
    loc: `https://naapurustot.fi/en/area/${slug}`,
    priority: '0.7',
    changefreq: 'monthly',
  });
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

writeFileSync(join(DIST, 'sitemap.xml'), xml);
console.log(`Generated sitemap.xml with ${urls.length} URLs.`);
