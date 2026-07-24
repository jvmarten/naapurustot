/**
 * Generate a sitemap INDEX from the GeoJSON dataset (IN-3).
 *
 * Outputs:
 *   - dist/sitemap.xml            — a <sitemapindex> referencing the children below
 *   - dist/sitemap-<family>.xml.gz — one gzipped <urlset> per URL family
 *
 * Families:
 *   - pages    : home + directory + data-sources + open-data + privacy (fi/en/sv)
 *   - alue     : every neighbourhood profile page (fi/en/sv)
 *   - kaupunki : every regional hub page (fi/en/sv)
 *   - parhaat  : every "best areas by metric" ranking page (national/region/muni)
 *   - kaavoitus: every per-municipality planning hub
 *   - kunta    : every municipality hub
 *   - vertaa   : every "{A} vs {B}" comparison page
 *
 * Why an index of gzipped children (was: one flat urlset of ~19,927 URLs / ~10 MB):
 * the sitemaps.org protocol caps a single sitemap at 50,000 URLs / 50 MB uncompressed.
 * A single flat file was ~40% of the way there and had no guard, so a combinatorial
 * page family (a new ranking metric ≈ +600 URLs/locale) could silently push it over
 * the limit and get the whole sitemap rejected. The index + per-family split keeps every
 * child far under the cap, and a hard ceiling guard (throws past 45,000 URLs / 45 MB per
 * child — headroom under the 50k/50MB limits) fails the build loudly if a family ever
 * approaches it. Gzipped children (sitemaps.org supports .gz) also cut the served/on-disk
 * bytes; the index itself stays uncompressed at /sitemap.xml (what robots.txt advertises
 * and health-check.yml pings).
 *
 * Each <url> carries xhtml:link hreflang alternates so search engines map the locales
 * correctly — the xhtml namespace is declared on every child <urlset> (NOT the index).
 * The slug logic is kept identical to scripts/prerender.mjs so every <loc> resolves to a
 * file that prerendering actually wrote.
 *
 * Run after prerendering:  node scripts/generate-sitemap.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const GEOJSON_PATH = join(ROOT, 'public', 'data', 'metro_neighborhoods.geojson');
const BUILD_METADATA_PATH = join(ROOT, 'src', 'data', 'build_metadata.json');
const ORIGIN = 'https://naapurustot.fi';

// Ceiling guard — headroom under the sitemaps.org 50,000-URL / 50 MB-per-file limits.
const MAX_URLS_TOTAL = 45000;
const MAX_CHILD_BYTES = 45 * 1024 * 1024;

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

// --- Family: static pages -------------------------------------------------
const pagesUrls = [];

// Home pages — one per language (CF-10: the EN/SV landings at /en/ and /sv/ are
// now real prerendered pages, so each gets its own sitemap entry and the hreflang
// cluster maps the three locales to distinct URLs). Keeps the build date since the
// landing content changes every deploy.
const homeAlts = { fi: `${ORIGIN}/`, en: `${ORIGIN}/en/`, sv: `${ORIGIN}/sv/` };
pagesUrls.push({ loc: homeAlts.fi, priority: '1.0', changefreq: 'weekly', lastmod: today, alternates: homeAlts });
pagesUrls.push({ loc: homeAlts.en, priority: '0.9', changefreq: 'weekly', lastmod: today, alternates: homeAlts });
pagesUrls.push({ loc: homeAlts.sv, priority: '0.9', changefreq: 'weekly', lastmod: today, alternates: homeAlts });

// All-areas directory.
const directory = {
  fi: `${ORIGIN}/kaupungit/`,
  en: `${ORIGIN}/en/cities/`,
  sv: `${ORIGIN}/sv/stader/`,
};
pagesUrls.push({ loc: directory.fi, priority: '0.9', changefreq: 'weekly', alternates: directory });
pagesUrls.push({ loc: directory.en, priority: '0.8', changefreq: 'weekly', alternates: directory });
pagesUrls.push({ loc: directory.sv, priority: '0.8', changefreq: 'weekly', alternates: directory });

// CF-9: data sources & methodology page. CF-10: trailing slash to match the
// prerendered canonical (served as a directory index).
const dataSources = {
  fi: `${ORIGIN}/tietolahteet/`,
  en: `${ORIGIN}/en/data-sources/`,
  sv: `${ORIGIN}/sv/datakallor/`,
};
pagesUrls.push({ loc: dataSources.fi, priority: '0.5', changefreq: 'monthly', alternates: dataSources });
pagesUrls.push({ loc: dataSources.en, priority: '0.4', changefreq: 'monthly', alternates: dataSources });
pagesUrls.push({ loc: dataSources.sv, priority: '0.4', changefreq: 'monthly', alternates: dataSources });

// CF-14: open-data download/API landing page (single language, crawlable).
pagesUrls.push({ loc: `${ORIGIN}/avoin-data/`, priority: '0.6', changefreq: 'monthly' });

// PO-14: privacy & data-handling notice page. CF-10: trailing slash (directory index).
const privacy = {
  fi: `${ORIGIN}/tietosuoja/`,
  en: `${ORIGIN}/en/privacy/`,
  sv: `${ORIGIN}/sv/integritet/`,
};
pagesUrls.push({ loc: privacy.fi, priority: '0.4', changefreq: 'yearly', alternates: privacy });
pagesUrls.push({ loc: privacy.en, priority: '0.3', changefreq: 'yearly', alternates: privacy });
pagesUrls.push({ loc: privacy.sv, priority: '0.3', changefreq: 'yearly', alternates: privacy });

const features = geojson.features.filter((f) => f.properties?.pno && f.properties?.nimi);

// --- Family: regional hub pages -------------------------------------------
const kaupunkiUrls = [];
const regionIds = [...new Set(features.map((f) => f.properties.city).filter(Boolean))].sort();
for (const id of regionIds) {
  const alt = {
    fi: `${ORIGIN}/kaupunki/${id}/`,
    en: `${ORIGIN}/en/city/${id}/`,
    sv: `${ORIGIN}/sv/stad/${id}/`,
  };
  kaupunkiUrls.push({ loc: alt.fi, priority: '0.8', changefreq: 'monthly', alternates: alt });
  kaupunkiUrls.push({ loc: alt.en, priority: '0.7', changefreq: 'monthly', alternates: alt });
  kaupunkiUrls.push({ loc: alt.sv, priority: '0.7', changefreq: 'monthly', alternates: alt });
}

// --- Family: neighbourhood profile pages ----------------------------------
const alueUrls = [];
for (const feature of features) {
  const slug = toSlug(feature.properties.pno, feature.properties.nimi);
  const alt = {
    fi: `${ORIGIN}/alue/${slug}/`,
    en: `${ORIGIN}/en/area/${slug}/`,
    sv: `${ORIGIN}/sv/omrade/${slug}/`,
  };
  alueUrls.push({ loc: alt.fi, priority: '0.7', changefreq: 'monthly', alternates: alt });
  alueUrls.push({ loc: alt.en, priority: '0.6', changefreq: 'monthly', alternates: alt });
  alueUrls.push({ loc: alt.sv, priority: '0.6', changefreq: 'monthly', alternates: alt });
}

// --- Manifest-driven families ---------------------------------------------
// prerender-hubs.mjs writes a manifest of {fi,en,sv} alternates for exactly the pages
// it generated (coverage gating lives there) — read it so every <loc> resolves to a real
// file. A missing manifest (hubs not yet prerendered) yields an empty family, which is
// simply omitted from the index rather than crashing the build.
function loadManifestFamily(file, priorities) {
  const urls = [];
  try {
    const manifest = JSON.parse(readFileSync(join(DIST, file), 'utf-8'));
    for (const alt of manifest) {
      urls.push({ loc: alt.fi, priority: priorities.fi, changefreq: 'monthly', alternates: alt });
      urls.push({ loc: alt.en, priority: priorities.en, changefreq: 'monthly', alternates: alt });
      urls.push({ loc: alt.sv, priority: priorities.sv, changefreq: 'monthly', alternates: alt });
    }
  } catch {
    // Manifest absent — this family is omitted from the sitemap.
  }
  return urls;
}

// CF-12: "best areas by metric" ranking pages (national + region + municipality).
const parhaatUrls = loadManifestFamily('ranking-pages.json', { fi: '0.6', en: '0.5', sv: '0.5' });
// CF-4: per-municipality planning hubs (/kaavoitus/{kunta}/).
const kaavoitusUrls = loadManifestFamily('kaavoitus-pages.json', { fi: '0.6', en: '0.5', sv: '0.5' });
// Municipality (kunta) hubs (/kunta/{slug}/).
const kuntaUrls = loadManifestFamily('kunnat-pages.json', { fi: '0.7', en: '0.6', sv: '0.6' });
// CF-7: "{A} vs {B}" comparison pages (/vertaa/{a}-vs-{b}/).
const vertaaUrls = loadManifestFamily('vertaa-pages.json', { fi: '0.5', en: '0.4', sv: '0.4' });

const families = [
  { name: 'pages', urls: pagesUrls },
  { name: 'alue', urls: alueUrls },
  { name: 'kaupunki', urls: kaupunkiUrls },
  { name: 'parhaat', urls: parhaatUrls },
  { name: 'kaavoitus', urls: kaavoitusUrls },
  { name: 'kunta', urls: kuntaUrls },
  { name: 'vertaa', urls: vertaaUrls },
];

// --- Ceiling guard --------------------------------------------------------
const totalUrls = families.reduce((n, f) => n + f.urls.length, 0);
if (totalUrls > MAX_URLS_TOTAL) {
  throw new Error(
    `Sitemap exceeds ${MAX_URLS_TOTAL} URLs (${totalUrls}). Split a family into more children ` +
      `or the sitemap risks the sitemaps.org 50k-URL limit.`,
  );
}

// --- XML rendering --------------------------------------------------------
function renderAlternates(alternates) {
  if (!alternates) return '';
  return Object.entries(alternates)
    .map(([lang, href]) => `\n    <xhtml:link rel="alternate" hreflang="${lang}" href="${href}" />`)
    .join('');
}

function renderUrlset(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod ?? dataLastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${renderAlternates(u.alternates)}
  </url>`,
  )
  .join('\n')}
</urlset>
`;
}

// --- Emit children + index ------------------------------------------------
const indexEntries = [];
for (const family of families) {
  if (family.urls.length === 0) continue; // omit empty families (e.g. a manifest absent)
  const xml = renderUrlset(family.urls);
  const bytes = Buffer.byteLength(xml, 'utf-8');
  if (bytes > MAX_CHILD_BYTES) {
    throw new Error(
      `Sitemap child sitemap-${family.name}.xml is ${(bytes / 1048576).toFixed(1)} MB uncompressed ` +
        `(> ${MAX_CHILD_BYTES / 1048576} MB). Split this family so each child stays under the ` +
        `sitemaps.org 50 MB limit.`,
    );
  }
  const childFile = `sitemap-${family.name}.xml.gz`;
  writeFileSync(join(DIST, childFile), gzipSync(Buffer.from(xml, 'utf-8')));
  // Child lastmod = the newest lastmod among its URLs (today for the home in `pages`,
  // dataLastmod for everything else) so the index reflects when the child last changed.
  const childLastmod = family.urls.reduce(
    (max, u) => {
      const d = u.lastmod ?? dataLastmod;
      return d > max ? d : max;
    },
    dataLastmod,
  );
  indexEntries.push({ file: childFile, lastmod: childLastmod, count: family.urls.length });
}

const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexEntries
  .map(
    (e) => `  <sitemap>
    <loc>${ORIGIN}/${e.file}</loc>
    <lastmod>${e.lastmod}</lastmod>
  </sitemap>`,
  )
  .join('\n')}
</sitemapindex>
`;

writeFileSync(join(DIST, 'sitemap.xml'), indexXml);

console.log(
  `Generated sitemap index (${indexEntries.length} children, ${totalUrls} URLs total):`,
);
for (const e of indexEntries) {
  console.log(`  ${e.file} — ${e.count} URLs`);
}
