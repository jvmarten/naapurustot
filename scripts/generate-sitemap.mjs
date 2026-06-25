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
const BUILD_METADATA_PATH = join(ROOT, 'src', 'data', 'build_metadata.json');
const ORIGIN = 'https://naapurustot.fi';

const geojson = JSON.parse(readFileSync(GEOJSON_PATH, 'utf-8'));
const today = new Date().toISOString().split('T')[0];

// Stable per-area lastmod driven by the data-refresh date (PO-12).
// Stamping a fresh build timestamp on every URL each deploy trains crawlers to
// ignore lastmod, so profile/hub/directory URLs use the dataset's `generated`
// date instead. It only changes when the underlying data is actually rebuilt.
// The home page may keep the build date since it changes every deploy.
function readDataLastmod() {
  try {
    const meta = JSON.parse(readFileSync(BUILD_METADATA_PATH, 'utf-8'));
    const date = new Date(meta.generated).toISOString().split('T')[0];
    // Guard against a malformed `generated` value yielding "Invalid Date".
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  } catch {
    // Fall through to the build date if metadata is missing/unparseable.
  }
  return today;
}

const dataLastmod = readDataLastmod();

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

// Home pages — one per language (CF-10: the EN/SV landings at /en/ and /sv/ are
// now real prerendered pages, so each gets its own sitemap entry and the hreflang
// cluster maps the three locales to distinct URLs). Keeps the build date since the
// landing content changes every deploy.
const homeAlts = { fi: `${ORIGIN}/`, en: `${ORIGIN}/en/`, sv: `${ORIGIN}/sv/` };
urls.push({ loc: homeAlts.fi, priority: '1.0', changefreq: 'weekly', lastmod: today, alternates: homeAlts });
urls.push({ loc: homeAlts.en, priority: '0.9', changefreq: 'weekly', lastmod: today, alternates: homeAlts });
urls.push({ loc: homeAlts.sv, priority: '0.9', changefreq: 'weekly', lastmod: today, alternates: homeAlts });

// All-areas directory.
const directory = {
  fi: `${ORIGIN}/kaupungit/`,
  en: `${ORIGIN}/en/cities/`,
  sv: `${ORIGIN}/sv/stader/`,
};
urls.push({ loc: directory.fi, priority: '0.9', changefreq: 'weekly', alternates: directory });
urls.push({ loc: directory.en, priority: '0.8', changefreq: 'weekly', alternates: directory });
urls.push({ loc: directory.sv, priority: '0.8', changefreq: 'weekly', alternates: directory });

// CF-9: data sources & methodology page. CF-10: trailing slash to match the
// prerendered canonical (served as a directory index).
const dataSources = {
  fi: `${ORIGIN}/tietolahteet/`,
  en: `${ORIGIN}/en/data-sources/`,
  sv: `${ORIGIN}/sv/datakallor/`,
};
urls.push({ loc: dataSources.fi, priority: '0.5', changefreq: 'monthly', alternates: dataSources });
urls.push({ loc: dataSources.en, priority: '0.4', changefreq: 'monthly', alternates: dataSources });
urls.push({ loc: dataSources.sv, priority: '0.4', changefreq: 'monthly', alternates: dataSources });

// CF-14: open-data download/API landing page (single language, crawlable).
urls.push({ loc: `${ORIGIN}/avoin-data/`, priority: '0.6', changefreq: 'monthly' });

// PO-14: privacy & data-handling notice page. CF-10: trailing slash (directory index).
const privacy = {
  fi: `${ORIGIN}/tietosuoja/`,
  en: `${ORIGIN}/en/privacy/`,
  sv: `${ORIGIN}/sv/integritet/`,
};
urls.push({ loc: privacy.fi, priority: '0.4', changefreq: 'yearly', alternates: privacy });
urls.push({ loc: privacy.en, priority: '0.3', changefreq: 'yearly', alternates: privacy });
urls.push({ loc: privacy.sv, priority: '0.3', changefreq: 'yearly', alternates: privacy });

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
    fi: `${ORIGIN}/alue/${slug}/`,
    en: `${ORIGIN}/en/area/${slug}/`,
    sv: `${ORIGIN}/sv/omrade/${slug}/`,
  };
  urls.push({ loc: alt.fi, priority: '0.7', changefreq: 'monthly', alternates: alt });
  urls.push({ loc: alt.en, priority: '0.6', changefreq: 'monthly', alternates: alt });
  urls.push({ loc: alt.sv, priority: '0.6', changefreq: 'monthly', alternates: alt });
}

// CF-12: "best areas by metric" ranking pages. prerender-hubs.mjs writes a
// manifest of {fi,en,sv} alternates for exactly the pages it generated (coverage
// gating lives there) — read it so every <loc> resolves to a real file.
try {
  const manifest = JSON.parse(readFileSync(join(DIST, 'ranking-pages.json'), 'utf-8'));
  for (const alt of manifest) {
    urls.push({ loc: alt.fi, priority: '0.6', changefreq: 'monthly', alternates: alt });
    urls.push({ loc: alt.en, priority: '0.5', changefreq: 'monthly', alternates: alt });
    urls.push({ loc: alt.sv, priority: '0.5', changefreq: 'monthly', alternates: alt });
  }
} catch {
  // Manifest absent (hubs not yet prerendered) — sitemap simply omits ranking pages.
}

// CF-4: per-municipality planning hubs (/kaavoitus/{kunta}/). prerender-hubs.mjs
// writes a manifest of {fi,en,sv} alternates for exactly the municipalities that
// have planning content — read it so every <loc> resolves to a real file.
try {
  const manifest = JSON.parse(readFileSync(join(DIST, 'kaavoitus-pages.json'), 'utf-8'));
  for (const alt of manifest) {
    urls.push({ loc: alt.fi, priority: '0.6', changefreq: 'monthly', alternates: alt });
    urls.push({ loc: alt.en, priority: '0.5', changefreq: 'monthly', alternates: alt });
    urls.push({ loc: alt.sv, priority: '0.5', changefreq: 'monthly', alternates: alt });
  }
} catch {
  // Manifest absent (hubs not yet prerendered) — sitemap simply omits planning pages.
}

// Municipality (kunta) hubs (/kunta/{slug}/). prerender-hubs.mjs writes a manifest of
// {fi,en,sv} alternates for exactly the municipalities that earned a hub (multi-
// municipality regions only) — read it so every <loc> resolves to a real file.
try {
  const manifest = JSON.parse(readFileSync(join(DIST, 'kunnat-pages.json'), 'utf-8'));
  for (const alt of manifest) {
    urls.push({ loc: alt.fi, priority: '0.7', changefreq: 'monthly', alternates: alt });
    urls.push({ loc: alt.en, priority: '0.6', changefreq: 'monthly', alternates: alt });
    urls.push({ loc: alt.sv, priority: '0.6', changefreq: 'monthly', alternates: alt });
  }
} catch {
  // Manifest absent (hubs not yet prerendered) — sitemap simply omits municipality pages.
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
    <lastmod>${u.lastmod ?? dataLastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${renderAlternates(u.alternates)}
  </url>`).join('\n')}
</urlset>
`;

writeFileSync(join(DIST, 'sitemap.xml'), xml);
console.log(`Generated sitemap.xml with ${urls.length} URLs.`);
