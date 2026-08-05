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
import { createHash } from 'crypto';
// PO-13: the single card-templating helper (shared with CF-11's runtime
// shortlist card). Pure SVG → no new client-bundle deps, no rasteriser.
import { buildSocialCardSvg } from './social-card.mjs';
// IN-8: slug-alias redirect-stub builder (pure; the module's main is guarded).
import { buildStubHtml, AREA_PREFIX as ALIAS_AREA_PREFIX } from './update_slug_aliases.mjs';
// IN-6: build-time head-integrity guard. The first-match head-token regexes used
// throughout this file silently corrupt EVERY page if a `<title>`/`</head>`/JSON-LD
// token ever appears twice (CLAUDE.md "Prerender head-token regexes"). Asserting on
// each assembled page turns that into a loud build failure instead of ~9,000 broken
// pages. Pure + side-effect-free, and unit-tested in prerenderOutput.test.ts.
import { assertHeadIntegrity, stripHomeOnlyPreloads } from './prerender-lib.mjs';
// The app's data-processing functions, reused at build time so each page can
// embed a render-ready payload. Both modules have type-only imports, so Node's
// TypeScript stripping (Node 22.18+/24) loads them without a build step.
import { computeQualityIndices } from '../src/utils/qualityIndex.ts';
import {
  computeMetroAverages,
  computeChangeMetrics,
  computeQuickWinMetrics,
  DATA_SOURCE_PUBLISHERS,
  DATA_SOURCE_METRICS,
} from '../src/utils/metrics.ts';
// CF-11: the single source of truth for percentile ranks, shared with the
// client-rendered <JsonLd /> so prerendered and hydrated structured data agree.
import { computeNeighbourhoodPercentiles } from '../src/utils/percentileRanks.ts';
// CF-2: plain-language strengths/weaknesses, templated from the same real
// direction-aware percentiles as the client panel, so the SEO meta/noscript copy
// matches the in-app summary exactly.
import { computeAreaSummary, composeSummarySentences, fillTemplate } from '../src/utils/areaSummary.ts';
import { decodeColumnar } from './lib/columnar.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const GEOJSON_PATH = join(ROOT, 'public', 'data', 'metro_neighborhoods.geojson');

// Read the built index.html as template. Strip the home-route-only App + maplibre
// preloads (vite.config.ts injectHomePreloads) up front: this template is cloned ONLY
// for non-home routes (profiles, data-sources, privacy, redirect stubs), none of which
// load the App shell or the full map, so they must not preload the ~263 KB maplibre
// chunk or render-block on its CSS. dist/index.html itself (the home route) keeps them.
const template = stripHomeOnlyPreloads(readFileSync(join(DIST, 'index.html'), 'utf-8'));

// Read GeoJSON.
const geojson = JSON.parse(readFileSync(GEOJSON_PATH, 'utf-8'));

// PO-15: the committed provenance manifest — `generated` timestamp and per-metric
// vintage/coverage. Read directly here (a build script, no client-bundle budget) to
// render the human, indexable "Data updated" changelog into the data-sources noscript.
const BUILD_METADATA = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'build_metadata.json'), 'utf-8'));
  } catch {
    return { generated: '', metrics: {} };
  }
})();

// CF-1: per-pno kaavat & hankkeet (zoning plans + infrastructure projects) list,
// a build input from build_planning_data.mjs (never shipped — like flood_risk.json).
// Read here to render the "Kaavoitus ja hankkeet lähistöllä" profile section +
// Place JSON-LD nodes at zero bundle cost. Snapshot + participating cities drive
// the honest partial-coverage caption.
const AREA_PLANNING = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'scripts', 'area_planning.json'), 'utf-8'));
  } catch {
    return {};
  }
})();
// CF-1: per-pno reverse-nav manifest (muni / rankings / compares / planning links), written
// by prerender-hubs.mjs earlier in this build:pages run. De-orphans the ranking/compare/
// municipality/planning mesh from the profile pages (both the <noscript> nav and the embedded
// __naapurustot_profile__ payload). Missing manifest → the profile pages keep their original
// three links (graceful degradation), so this is safe even if hubs are skipped.
const AREA_NAV = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'scripts', 'area_nav.generated.json'), 'utf-8'));
  } catch {
    return {};
  }
})();
const PLANNING_MANIFEST = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'planning_manifest.json'), 'utf-8'));
  } catch {
    return { snapshot: '', plans: { cities: [] } };
  }
})();
const PLANNING_SNAPSHOT = PLANNING_MANIFEST.snapshot || '';
const PLANNING_CITIES = (PLANNING_MANIFEST.plans?.cities ?? []).join(', ');

// QW-5: adjacency graph (pno → neighbour pnos) + a pno→props lookup, for the
// within-region "Naapurialueet / Nearby areas" link mesh appended to each profile
// noscript — turns the star topology (only upward links) into a connected mesh.
const ADJACENCY = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'adjacency.json'), 'utf-8'));
  } catch {
    return {};
  }
})();
const AREA_PREFIX = { fi: '/alue', en: '/en/area', sv: '/sv/omrade' };
const NEARBY_LABELS = { fi: 'Naapurialueet', en: 'Nearby areas', sv: 'Närliggande områden' };
const PNO_PROPS = new Map();
for (const f of geojson.features) {
  if (f.properties?.pno && f.properties?.nimi) PNO_PROPS.set(f.properties.pno, f.properties);
}

// #3: cross-region "Similar areas elsewhere in Finland" mesh. Precomputed here at
// BUILD time (zero client-bundle cost) from the committed, geometry-stripped
// region_properties.json, restricted to HIGH-COVERAGE Paavo demographic/economic axes
// (all 93–100% national coverage) so sparse layers like transit/prices/schools can't
// produce junk pairings. Each area gets its top-6 most-similar areas in OTHER
// seutukunnat, turning the ~9k profile pages from 69 within-region link-islands into
// one thematically connected graph (crawl depth / internal PageRank / AI relatedness).
// Deterministic — weighted-normalized Euclidean distance with a stable pno tie-break —
// so the rendered noscript is byte-stable across reruns.
const SIMILAR_METRICS = [
  'hr_mtu',                 // median income
  'unemployment_rate',
  'higher_education_rate',
  'ownership_rate',
  'population_density',
  'child_ratio',
  'he_kika',                // average age
  'foreign_language_pct',
];
const SIMILAR_ELSEWHERE = (() => {
  let areas;
  try {
    areas = decodeColumnar(JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'region_properties.json'), 'utf-8')));
  } catch {
    return {};
  }
  if (!Array.isArray(areas) || areas.length === 0) return {};

  // Min/max per metric across all areas, for [0,1] normalization (mirrors the in-app
  // findSimilarNeighborhoods so static and interactive notions of "similar" agree).
  const mins = {};
  const maxs = {};
  for (const m of SIMILAR_METRICS) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const a of areas) {
      const v = a[m];
      if (typeof v === 'number' && isFinite(v)) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    if (mn < mx) { mins[m] = mn; maxs[m] = mx; }
  }

  // Normalize each area once.
  const norm = new Map();
  for (const a of areas) {
    const o = {};
    for (const m of SIMILAR_METRICS) {
      const v = a[m];
      if (typeof v === 'number' && isFinite(v) && m in mins) {
        o[m] = (v - mins[m]) / (maxs[m] - mins[m]);
      }
    }
    norm.set(a.pno, o);
  }

  const out = {};
  for (const a of areas) {
    const an = norm.get(a.pno);
    // Bounded top-6 (sorted ascending by distance, then pno) — avoids allocating and
    // fully sorting a ~3k-candidate array per area.
    const top = [];
    for (const b of areas) {
      if (b.pno === a.pno || b.city === a.city) continue; // cross-region only
      const bn = norm.get(b.pno);
      let sum = 0;
      let used = 0;
      for (const m of SIMILAR_METRICS) {
        const x = an[m];
        const y = bn[m];
        if (typeof x === 'number' && typeof y === 'number') {
          const dq = x - y;
          sum += dq * dq;
          used++;
        }
      }
      // Require substantial overlap (≥5 of the 8 axes). Without this, a data-poor
      // rural area sharing only population_density with another gets a spurious
      // near-zero distance and pairs with unrelated data-empty areas.
      if (used < 5) continue;
      const dist = Math.sqrt(sum / used);
      if (top.length === 6 && (dist > top[5].dist || (dist === top[5].dist && b.pno >= top[5].pno))) continue;
      let i = top.length;
      while (i > 0 && (dist < top[i - 1].dist || (dist === top[i - 1].dist && b.pno < top[i - 1].pno))) i--;
      top.splice(i, 0, { pno: b.pno, dist });
      if (top.length > 6) top.pop();
    }
    if (top.length > 0) out[a.pno] = top.map((c) => c.pno);
  }
  return out;
})();
const SIMILAR_LABELS = {
  fi: 'Samankaltaiset alueet muualla Suomessa',
  en: 'Similar areas elsewhere in Finland',
  sv: 'Liknande områden på andra håll i Finland',
};

// Process every feature exactly as the client's dataLoader does (same order),
// so each page can embed a payload the React app renders from instantly —
// avoiding the ~1.7 MB region_properties.json fetch before first paint.
computeQualityIndices(geojson.features);
computeChangeMetrics(geojson.features);
computeQuickWinMetrics(geojson.features);
const metroAverages = computeMetroAverages(geojson.features);

// CF-11: percentile ranks for the quality index, median income and transit
// reachability, computed against real per-area values so each profile can state
// a verifiable "top X%" superlative both nationally and within its own region.
// All ranking logic lives in src/utils/percentileRanks.ts (the same module the
// client's <JsonLd /> uses), so the static and hydrated structured data match.
const NATIONAL_SOURCES = geojson.features;
// Region (seutukunta) cohorts, keyed by `city`, for within-region percentiles.
const REGION_SOURCES = new Map();
for (const f of geojson.features) {
  const city = f.properties?.city;
  if (!city) continue;
  if (!REGION_SOURCES.has(city)) REGION_SOURCES.set(city, []);
  REGION_SOURCES.get(city).push(f);
}

// Perf: percentilesFor and the area summary are pure functions of an area's props
// (the national/regional cohorts are fixed for the whole run), but each is invoked
// many times per area — across the FAQ, JSON-LD, meta description and social-card
// badge, in all three languages — and each call internally rebuilds and re-sorts
// the full national distribution. Without memoization that makes the prerender
// quadratic in the area count (the dominant cost by far). Caching the result per
// props object (one stable reference shared by a feature's three language renders)
// returns byte-identical output with the redundant recomputation removed.
const percentilesCache = new Map();
const areaSummaryCache = new Map();

/** Full {quality,income,transit}×{national,regional} percentile bundle for a feature's props. */
function percentilesFor(props) {
  const cached = percentilesCache.get(props);
  if (cached) return cached;
  const regional = (props.city && REGION_SOURCES.get(props.city)) || NATIONAL_SOURCES;
  const result = computeNeighbourhoodPercentiles(props, NATIONAL_SOURCES, regional);
  percentilesCache.set(props, result);
  return result;
}

/** Memoized per-area strengths/weaknesses against the national cohort (language-independent). */
function areaSummaryFor(props) {
  const cached = areaSummaryCache.get(props);
  if (cached) return cached;
  const result = computeAreaSummary(props, NATIONAL_SOURCES);
  areaSummaryCache.set(props, result);
  return result;
}

/**
 * CF-2: localized plain-language strength/weakness sentences for one area, ranked
 * against the full national cohort so the "top {pct}% nationally" wording is true.
 * Returns finished strings (empty when nothing notable). Label and template lookups
 * go through LOCALES so the prerendered copy matches the client panel's `t()` output.
 */
function summarySentencesFor(props, lang) {
  const summary = areaSummaryFor(props);
  const L = LOCALES[lang];
  const tr = (k) => L?.[k] ?? LOCALES.fi[k] ?? k;
  const specs = composeSummarySentences(summary, {
    label: (k) => tr(k),
    and: tr('summary.and'),
  });
  return specs.map((s) => fillTemplate(tr(s.key), s.tokens));
}

// UI translations — used to resolve region names and metric labels so that
// every page uses the same wording as the app, in all three languages.
const LOCALES = {
  // IN-7: fi-extra.json holds the page-only fi strings split off fi.json (lazy
  // ?url asset at runtime); merge it back so the prerendered FI data-sources and
  // privacy pages still render their headings/bodies.
  fi: {
    ...JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'fi.json'), 'utf-8')),
    ...JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'fi-extra.json'), 'utf-8')),
  },
  en: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'en.json'), 'utf-8')),
  sv: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'sv.json'), 'utf-8')),
};

const LOCALE_TAG = { fi: 'fi-FI', en: 'en-US', sv: 'sv-SE' };
// og:locale uses underscore-format locale identifiers (not the BCP-47 hyphen
// tags in LOCALE_TAG used for number formatting). Mirrors index.html.
const OG_LOCALE = { fi: 'fi_FI', en: 'en_US', sv: 'sv_FI' };
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

/**
 * Rewrite the template's Open Graph locale tags to the page language: the single
 * `og:locale` becomes this page's underscore locale, and the two
 * `og:locale:alternate` tags become the other two languages. `og:image:alt` is
 * set to a localized per-page string (the localized page title works well).
 */
function localizeOgLocale(html, lang, imageAlt) {
  const alternates = ['fi', 'en', 'sv'].filter((l) => l !== lang);
  html = html.replace(
    /<meta property="og:image:alt" content="[^"]*" \/>/,
    `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />`,
  );
  html = html.replace(
    /<meta property="og:locale" content="[^"]*" \/>/,
    `<meta property="og:locale" content="${OG_LOCALE[lang]}" />`,
  );
  // The replacement below maps the Nth og:locale:alternate tag to alternates[N].
  // That positional assumption silently emits `undefined` if the template's tag
  // count ever drifts from the two alternates we have — fail loudly instead.
  const altCount = (html.match(/<meta property="og:locale:alternate" content="[^"]*" \/>/g) || []).length;
  if (altCount !== alternates.length) {
    throw new Error(`[prerender] expected ${alternates.length} og:locale:alternate tags in template, found ${altCount}`);
  }
  let i = 0;
  html = html.replace(
    /<meta property="og:locale:alternate" content="[^"]*" \/>/g,
    () => `<meta property="og:locale:alternate" content="${OG_LOCALE[alternates[i++]]}" />`,
  );
  return html;
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
    // Service densities span 0.0001-237/km². One decimal renders the whole
    // rural half of the country as "0,0" — the same rounding that used to be
    // baked into the data itself. Two significant figures below 1.
    case 'density': return n > 0 && n < 1 ? fmtNum(n, 4, lang).replace(/0+$/, '') : fmtNum(n, 1, lang);
    default: return fmtNum(n, 1, lang);
  }
}

/** Rounded numeric value for schema.org PropertyValue output. */
function roundForSchema(value, fmt) {
  const n = Number(value);
  if (fmt === 'rent_sqm') return Math.round(n * 100) / 100;
  if (fmt === 'pct' || fmt === 'dec1' || fmt === 'db' || fmt === 'sqm') return Math.round(n * 10) / 10;
  // Keep the precision the data carries — a schema.org PropertyValue of 0 for
  // an area with six grocery stores is a machine-readable false claim.
  if (fmt === 'density') return Math.round(n * 10000) / 10000;
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
  // Counts, not densities, for the five layers that carry one — same reasoning
  // as the profile page these pages mirror. Rendering the density at one decimal
  // put "0" on ~2,800 of the 3,018 /alue/ pages and emitted it as a schema.org
  // PropertyValue, which is a machine-readable false claim about a real place.
  // sports/transit have no count, so they keep the density and a label that
  // carries the /km² unit.
  { id: 'services', metrics: [
    { prop: 'grocery_count', label: 'layer.grocery_access', fmt: 'int', schema: 'Grocery stores' },
    { prop: 'restaurant_count', label: 'layer.restaurant_density', fmt: 'int', schema: 'Restaurants and cafes' },
    { prop: 'school_count', label: 'layer.school_density', fmt: 'int', schema: 'Schools' },
    { prop: 'daycare_count', label: 'layer.daycare_density', fmt: 'int', schema: 'Daycares' },
    { prop: 'healthcare_count', label: 'layer.healthcare_access', fmt: 'int', schema: 'Healthcare facilities' },
    { prop: 'sports_facility_density', label: 'panel.sports_facilities', fmt: 'density', schema: 'Sports facility density' },
    { prop: 'transit_stop_density', label: 'panel.transit_access', fmt: 'density', schema: 'Transit stop density' },
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

// ---------------------------------------------------------------------------
// CF-13: prerender-only profile enrichment from the latent Paavo fields.
//
// region_properties.json carries ~177 keys; only ~59 surface as layers. The
// remainder (full age pyramid, the 21 NACE employment sectors, household income
// and structure, living space) are real Statistics Finland figures that appear
// nowhere in the app. We render them into the <noscript> fallback and mirror the
// headline figures into the Place JSON-LD — the one route exempt from the bundle
// budget. All strings are inline here (locale keys would consume bundled fi.json).
//
// CRITICAL: latent Paavo fields carry raw `-1` confidentiality sentinels for
// small/suppressed areas — every read is guarded `>= 0`, and `tp_x_tunt`
// (unknown sector) is excluded, or pages would print "-1".
// ---------------------------------------------------------------------------

const ENRICH = {
  fi: {
    age: 'Ikäjakauma', ageCol: 'Ikäryhmä', count: 'Asukkaita',
    employment: 'Työpaikat toimialoittain', sectorCol: 'Toimiala', jobs: 'Työpaikkoja',
    households: 'Taloudet ja tulot',
    hhCount: 'Asuntokuntia', hhSize: 'Asuntokunnan keskikoko', spacePerPerson: 'Asumisväljyys',
    onepHouseholds: 'Yhden hengen taloudet',
    medianHhIncome: 'Asuntokuntien mediaanitulo', meanHhIncome: 'Asuntokuntien keskitulo',
    lowIncome: 'Alin tuloluokka', midIncome: 'Keskimmäinen tuloluokka', highIncome: 'Ylin tuloluokka',
    persons: 'henkilöä',
  },
  en: {
    age: 'Age distribution', ageCol: 'Age group', count: 'Residents',
    employment: 'Jobs by sector', sectorCol: 'Sector', jobs: 'Jobs',
    households: 'Households & income',
    hhCount: 'Households', hhSize: 'Average household size', spacePerPerson: 'Living space per person',
    onepHouseholds: 'One-person households',
    medianHhIncome: 'Median household income', meanHhIncome: 'Mean household income',
    lowIncome: 'Lowest income category', midIncome: 'Middle income category', highIncome: 'Highest income category',
    persons: 'persons',
  },
  sv: {
    age: 'Åldersfördelning', ageCol: 'Åldersgrupp', count: 'Invånare',
    employment: 'Arbetsplatser efter näringsgren', sectorCol: 'Näringsgren', jobs: 'Arbetsplatser',
    households: 'Hushåll & inkomst',
    hhCount: 'Hushåll', hhSize: 'Genomsnittlig hushållsstorlek', spacePerPerson: 'Boendetäthet',
    onepHouseholds: 'Enpersonshushåll',
    medianHhIncome: 'Hushållens medianinkomst', meanHhIncome: 'Hushållens medelinkomst',
    lowIncome: 'Lägsta inkomstklass', midIncome: 'Mellersta inkomstklass', highIncome: 'Högsta inkomstklass',
    persons: 'personer',
  },
};

/** Paavo `he_*` age bands in order, with display ranges (language-neutral). */
const AGE_BANDS = [
  ['he_0_2', '0–2'], ['he_3_6', '3–6'], ['he_7_12', '7–12'], ['he_13_15', '13–15'],
  ['he_16_17', '16–17'], ['he_18_19', '18–19'], ['he_20_24', '20–24'], ['he_25_29', '25–29'],
  ['he_30_34', '30–34'], ['he_35_39', '35–39'], ['he_40_44', '40–44'], ['he_45_49', '45–49'],
  ['he_50_54', '50–54'], ['he_55_59', '55–59'], ['he_60_64', '60–64'], ['he_65_69', '65–69'],
  ['he_70_74', '70–74'], ['he_75_79', '75–79'], ['he_80_84', '80–84'], ['he_85_', '85+'],
];

/** The 21 NACE sectors (Paavo `tp_*`), excluding `tp_x_tunt` (unknown). */
const SECTOR_NAMES = {
  tp_a_maat: { fi: 'A Maa-, metsä- ja kalatalous', en: 'A Agriculture, forestry & fishing', sv: 'A Jord-, skogsbruk & fiske' },
  tp_b_kaiv: { fi: 'B Kaivostoiminta', en: 'B Mining & quarrying', sv: 'B Utvinning av mineral' },
  tp_c_teol: { fi: 'C Teollisuus', en: 'C Manufacturing', sv: 'C Tillverkning' },
  tp_d_ener: { fi: 'D Energiahuolto', en: 'D Electricity & gas supply', sv: 'D Energiförsörjning' },
  tp_e_vesi: { fi: 'E Vesi- ja jätehuolto', en: 'E Water & waste management', sv: 'E Vatten- & avfallshantering' },
  tp_f_rake: { fi: 'F Rakentaminen', en: 'F Construction', sv: 'F Byggverksamhet' },
  tp_g_kaup: { fi: 'G Tukku- ja vähittäiskauppa', en: 'G Wholesale & retail trade', sv: 'G Handel' },
  tp_h_kulj: { fi: 'H Kuljetus ja varastointi', en: 'H Transportation & storage', sv: 'H Transport & magasinering' },
  tp_i_majo: { fi: 'I Majoitus- ja ravitsemistoiminta', en: 'I Accommodation & food service', sv: 'I Hotell- & restaurang' },
  tp_j_info: { fi: 'J Informaatio ja viestintä', en: 'J Information & communication', sv: 'J Information & kommunikation' },
  tp_k_raho: { fi: 'K Rahoitus- ja vakuutustoiminta', en: 'K Financial & insurance', sv: 'K Finans- & försäkring' },
  tp_l_kiin: { fi: 'L Kiinteistöala', en: 'L Real estate', sv: 'L Fastighetsverksamhet' },
  tp_m_erik: { fi: 'M Ammatillinen ja tieteellinen toiminta', en: 'M Professional & scientific', sv: 'M Juridik, ekonomi & vetenskap' },
  tp_n_hall: { fi: 'N Hallinto- ja tukipalvelut', en: 'N Administrative & support services', sv: 'N Uthyrning & stödtjänster' },
  tp_o_julk: { fi: 'O Julkinen hallinto', en: 'O Public administration & defence', sv: 'O Offentlig förvaltning' },
  tp_p_koul: { fi: 'P Koulutus', en: 'P Education', sv: 'P Utbildning' },
  tp_q_terv: { fi: 'Q Terveys- ja sosiaalipalvelut', en: 'Q Health & social work', sv: 'Q Vård & omsorg' },
  tp_r_taid: { fi: 'R Taiteet, viihde ja virkistys', en: 'R Arts, entertainment & recreation', sv: 'R Kultur, nöje & fritid' },
  tp_s_muup: { fi: 'S Muu palvelutoiminta', en: 'S Other service activities', sv: 'S Annan serviceverksamhet' },
  tp_t_koti: { fi: 'T Kotitalouksien toiminta työnantajina', en: 'T Households as employers', sv: 'T Förvärvsarbete i hushåll' },
  tp_u_kans: { fi: 'U Kansainväliset organisaatiot', en: 'U Extraterritorial organisations', sv: 'U Internationella organisationer' },
};

/** Sentinel-safe numeric read of a latent Paavo field (`-1` ⇒ null). Counts
 *  legitimately reach 0; pass `positive` for averages/levels (household size,
 *  living space, income) where Paavo also emits a bare 0 to mean "withheld". */
function paavoNum(props, key, positive = false) {
  const v = Number(props[key]);
  if (!Number.isFinite(v)) return null;
  return positive ? (v > 0 ? v : null) : (v >= 0 ? v : null);
}

/** Build the CF-13 enrichment tables (age pyramid, sectors, households). */
function buildEnrichmentSections(props, lang) {
  const E = ENRICH[lang];
  const lines = [];
  const pop = paavoNum(props, 'he_vakiy');

  // Age pyramid — counts + share of population, sentinels skipped.
  const ageRows = [];
  for (const [key, range] of AGE_BANDS) {
    const v = paavoNum(props, key);
    if (v == null) continue;
    const share = pop && pop > 0 ? ` (${fmtNum((v / pop) * 100, 1, lang)} %)` : '';
    ageRows.push(`        <tr><th scope="row">${range}</th><td>${fmtNum(v, 0, lang)}${share}</td></tr>`);
  }
  if (ageRows.length > 0) {
    lines.push(`      <h2>${escapeHtml(E.age)}</h2>`);
    lines.push(`      <table><thead><tr><th scope="col">${escapeHtml(E.ageCol)}</th><th scope="col">${escapeHtml(E.count)}</th></tr></thead><tbody>`);
    lines.push(...ageRows);
    lines.push('      </tbody></table>');
  }

  // Top-5 employment sectors by job count — share of total jobs.
  const totalJobs = paavoNum(props, 'tp_tyopy');
  if (totalJobs && totalJobs > 0) {
    const sectors = Object.keys(SECTOR_NAMES)
      .map((key) => ({ key, jobs: paavoNum(props, key) }))
      .filter((s) => s.jobs != null && s.jobs > 0)
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 5);
    if (sectors.length > 0) {
      lines.push(`      <h2>${escapeHtml(E.employment)}</h2>`);
      lines.push(`      <table><thead><tr><th scope="col">${escapeHtml(E.sectorCol)}</th><th scope="col">${escapeHtml(E.jobs)}</th></tr></thead><tbody>`);
      for (const s of sectors) {
        const name = escapeHtml(SECTOR_NAMES[s.key][lang]);
        const share = ` (${fmtNum((s.jobs / totalJobs) * 100, 1, lang)} %)`;
        lines.push(`        <tr><th scope="row">${name}</th><td>${fmtNum(s.jobs, 0, lang)}${share}</td></tr>`);
      }
      lines.push('      </tbody></table>');
    }
  }

  // Households & income — structure + income mix, sentinels skipped.
  const hh = paavoNum(props, 'tr_kuty');
  const hhRows = [];
  const addRow = (label, value) => hhRows.push(`        <tr><th scope="row">${escapeHtml(label)}</th><td>${value}</td></tr>`);
  const shareOf = (v, total) => (total && total > 0 ? ` (${fmtNum((v / total) * 100, 1, lang)} %)` : '');
  if (hh != null) addRow(E.hhCount, fmtNum(hh, 0, lang));
  const hhSize = paavoNum(props, 'te_takk', true);
  if (hhSize != null) addRow(E.hhSize, `${fmtNum(hhSize, 1, lang)} ${E.persons}`);
  const space = paavoNum(props, 'te_as_valj', true);
  if (space != null) addRow(E.spacePerPerson, `${fmtNum(space, 1, lang)} m²`);
  const onep = paavoNum(props, 'te_yks');
  if (onep != null) addRow(E.onepHouseholds, `${fmtNum(onep, 0, lang)}${shareOf(onep, hh)}`);
  const medInc = paavoNum(props, 'tr_mtu', true);
  if (medInc != null) addRow(E.medianHhIncome, `${fmtNum(medInc, 0, lang)} €`);
  const meanInc = paavoNum(props, 'tr_ktu', true);
  if (meanInc != null) addRow(E.meanHhIncome, `${fmtNum(meanInc, 0, lang)} €`);
  const low = paavoNum(props, 'tr_pi_tul');
  const mid = paavoNum(props, 'tr_ke_tul');
  const high = paavoNum(props, 'tr_hy_tul');
  if (low != null) addRow(E.lowIncome, `${fmtNum(low, 0, lang)}${shareOf(low, hh)}`);
  if (mid != null) addRow(E.midIncome, `${fmtNum(mid, 0, lang)}${shareOf(mid, hh)}`);
  if (high != null) addRow(E.highIncome, `${fmtNum(high, 0, lang)}${shareOf(high, hh)}`);
  if (hhRows.length > 0) {
    lines.push(`      <h2>${escapeHtml(E.households)}</h2>`);
    lines.push('      <table><tbody>');
    lines.push(...hhRows);
    lines.push('      </tbody></table>');
  }

  return lines;
}

/** CF-13: headline enrichment figures mirrored into the Place JSON-LD. */
function enrichmentSchemaProps(props) {
  const out = [];
  const med = paavoNum(props, 'tr_mtu', true);
  if (med != null) out.push(['Median household income (EUR)', Math.round(med)]);
  const mean = paavoNum(props, 'tr_ktu', true);
  if (mean != null) out.push(['Mean household income (EUR)', Math.round(mean)]);
  const size = paavoNum(props, 'te_takk', true);
  if (size != null) out.push(['Average household size (persons)', Math.round(size * 10) / 10]);
  const space = paavoNum(props, 'te_as_valj', true);
  if (space != null) out.push(['Living space per person (m²)', Math.round(space * 10) / 10]);
  const totalJobs = paavoNum(props, 'tp_tyopy');
  if (totalJobs && totalJobs > 0) {
    let top = null;
    for (const key of Object.keys(SECTOR_NAMES)) {
      const jobs = paavoNum(props, key);
      if (jobs != null && (top == null || jobs > top.jobs)) top = { key, jobs };
    }
    if (top) out.push(['Largest employment sector', SECTOR_NAMES[top.key].en]);
  }
  return out;
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
    titleCat: 'asuinalue ja tilastot',
    pop: 'Väkiluku',
    income: 'Mediaanitulo',
    descRank: (top) => `Laatuindeksissä koko maan parhaassa ${top} %:ssa.`,
    descIncRank: (top) => `Mediaanituloltaan koko maan parhaassa ${top} %:ssa.`,
    descTransitRank: (top) => `Joukkoliikenteen saavutettavuudessa koko maan parhaassa ${top} %:ssa.`,
    faqHeading: 'Usein kysytyt kysymykset',
    faqCrimeRankQ: (n) => `Kuinka turvallinen ${n} on?`,
    faqCrimeRankA: (n, top, regTop, region) =>
      `${n} kuuluu turvallisuudessa koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqAirRankQ: (n) => `Millainen ilmanlaatu alueella ${n} on?`,
    faqAirRankA: (n, top, regTop, region) =>
      `${n} kuuluu ilmanlaadultaan koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqTreeRankQ: (n) => `Kuinka vehreä ${n} on?`,
    faqTreeRankA: (n, top, regTop, region) =>
      `${n} kuuluu puuston latvuspeitossa koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqEduRankQ: (n) => `Kuinka korkeasti koulutettuja ${n} asukkaat ovat?`,
    faqEduRankA: (n, top, regTop, region) =>
      `${n} kuuluu korkeakoulutusasteessa koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqEmpRankQ: (n) => `Kuinka korkea työllisyysaste alueella ${n} on?`,
    faqEmpRankA: (n, top, regTop, region) =>
      `${n} kuuluu työllisyysasteessa koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqPopQ: (n) => `Mikä on ${n} väkiluku?`,
    faqPopA: (n, v) => `${n} väkiluku on noin ${v} asukasta.`,
    faqIncQ: (n) => `Mikä on mediaanitulo alueella ${n}?`,
    faqIncA: (n, v) => `Mediaanitulo alueella ${n} on noin ${v} € vuodessa.`,
    faqRankQ: (n) => `Miten ${n} sijoittuu laatuindeksissä?`,
    faqRankA: (n, top, regTop, region) =>
      `${n} kuuluu laatuindeksissä koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqIncRankQ: (n) => `Kuinka korkeat tulot alueella ${n} on?`,
    faqIncRankA: (n, top, regTop, region) =>
      `${n} kuuluu mediaanituloltaan koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqTransitRankQ: (n) => `Miten hyvin ${n} on joukkoliikenteen saavutettavissa?`,
    faqTransitRankA: (n, top, regTop, region) =>
      `${n} kuuluu joukkoliikenteen saavutettavuudessa koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
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
    titleCat: 'neighbourhood guide & statistics',
    pop: 'Population',
    income: 'Median income',
    descRank: (top) => `Ranks in the top ${top}% nationally for quality of life.`,
    descIncRank: (top) => `Ranks in the top ${top}% nationally for median income.`,
    descTransitRank: (top) => `Ranks in the top ${top}% nationally for public-transport access.`,
    faqHeading: 'Frequently asked questions',
    faqCrimeRankQ: (n) => `How safe is ${n}?`,
    faqCrimeRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for safety` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqAirRankQ: (n) => `What is the air quality in ${n}?`,
    faqAirRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for air quality` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqTreeRankQ: (n) => `How green is ${n}?`,
    faqTreeRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for tree canopy cover` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqEduRankQ: (n) => `How highly educated are residents of ${n}?`,
    faqEduRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for higher education` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqEmpRankQ: (n) => `How high is the employment rate in ${n}?`,
    faqEmpRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for employment rate` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqPopQ: (n) => `What is the population of ${n}?`,
    faqPopA: (n, v) => `${n} has a population of about ${v}.`,
    faqIncQ: (n) => `What is the median income in ${n}?`,
    faqIncA: (n, v) => `The median income in ${n} is about €${v} per year.`,
    faqRankQ: (n) => `How does ${n} rank for quality of life?`,
    faqRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for quality of life` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqIncRankQ: (n) => `How high are incomes in ${n}?`,
    faqIncRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for median income` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqTransitRankQ: (n) => `How well is ${n} served by public transport?`,
    faqTransitRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for public-transport access` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
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
    titleCat: 'bostadsområde och statistik',
    pop: 'Folkmängd',
    income: 'Medianinkomst',
    descRank: (top) => `Hör till de bästa ${top} % i landet i kvalitetsindexet.`,
    descIncRank: (top) => `Hör till de bästa ${top} % i landet i medianinkomst.`,
    descTransitRank: (top) => `Hör till de bästa ${top} % i landet i kollektivtrafikens tillgänglighet.`,
    faqHeading: 'Vanliga frågor',
    faqCrimeRankQ: (n) => `Hur säkert är ${n}?`,
    faqCrimeRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i säkerhet` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqAirRankQ: (n) => `Hur är luftkvaliteten i ${n}?`,
    faqAirRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i luftkvalitet` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqTreeRankQ: (n) => `Hur grönt är ${n}?`,
    faqTreeRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i krontäckning` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqEduRankQ: (n) => `Hur högutbildade är invånarna i ${n}?`,
    faqEduRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i högre utbildning` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqEmpRankQ: (n) => `Hur hög är sysselsättningsgraden i ${n}?`,
    faqEmpRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i sysselsättningsgrad` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqPopQ: (n) => `Vad är folkmängden i ${n}?`,
    faqPopA: (n, v) => `${n} har en folkmängd på cirka ${v}.`,
    faqIncQ: (n) => `Vad är medianinkomsten i ${n}?`,
    faqIncA: (n, v) => `Medianinkomsten i ${n} är cirka ${v} € per år.`,
    faqRankQ: (n) => `Hur placerar sig ${n} i kvalitetsindexet?`,
    faqRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i kvalitetsindexet` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqIncRankQ: (n) => `Hur höga är inkomsterna i ${n}?`,
    faqIncRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i medianinkomst` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqTransitRankQ: (n) => `Hur väl betjänas ${n} av kollektivtrafik?`,
    faqTransitRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i kollektivtrafikens tillgänglighet` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
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

// CF-1: kaavat & hankkeet ("planning & projects nearby"). Inline FI/EN/SV
// (no locale-file / bundle cost). Entries come from
// area_planning.json: {name, kind, ptype, subtype, status, date, url, source}.
// Coverage is honestly partial — national for state Väylä projects, participating
// cities only for municipal vireillä asemakaava — framed as a migration phase
// toward the statutory 2029 Ryhti rollout.
const PLANNING_LABELS = {
  fi: {
    heading: 'Kaavoitus ja hankkeet lähistöllä',
    status: { vireilla: 'vireillä', luonnos: 'luonnos', ehdotus: 'ehdotus', hyvaksytty: 'hyväksytty', voimassa: 'voimassa', kaynnissa: 'käynnissä' },
    ptype: { road: 'tiehanke', rail: 'ratahanke', waterway: 'vesiväylähanke', zoning: 'asemakaava' },
    coverage: (snap, cities) =>
      `Käynnissä olevat valtion väylähankkeet koko maassa; kuntien vireillä oleva asemakaavoitus osallistuvissa kaupungeissa${cities ? ` (${cities})` : ''}${snap ? ` tilanteessa ${snap}` : ''}. Ei valtakunnallista kaava-aineistoa — kattavuus täydentyy Ryhti-järjestelmän myötä vuoteen 2029 mennessä.`,
  },
  en: {
    heading: 'Planning & projects nearby',
    status: { vireilla: 'pending', luonnos: 'draft', ehdotus: 'proposal', hyvaksytty: 'approved', voimassa: 'in force', kaynnissa: 'ongoing' },
    ptype: { road: 'road project', rail: 'rail project', waterway: 'waterway project', zoning: 'detailed plan' },
    coverage: (snap, cities) =>
      `Ongoing state transport-infrastructure projects nationwide; in-progress municipal detailed planning in participating cities${cities ? ` (${cities})` : ''}${snap ? ` as of ${snap}` : ''}. Not nationwide zoning data — coverage expands toward the statutory 2029 Ryhti rollout.`,
  },
  sv: {
    heading: 'Planläggning och projekt i närheten',
    status: { vireilla: 'anhängig', luonnos: 'utkast', ehdotus: 'förslag', hyvaksytty: 'godkänd', voimassa: 'i kraft', kaynnissa: 'pågående' },
    ptype: { road: 'vägprojekt', rail: 'banprojekt', waterway: 'farledsprojekt', zoning: 'detaljplan' },
    coverage: (snap, cities) =>
      `Pågående statliga trafikledsprojekt i hela landet; kommunal detaljplanering under arbete i deltagande städer${cities ? ` (${cities})` : ''}${snap ? ` läget ${snap}` : ''}. Inget riksomfattande planmaterial — täckningen utvidgas mot den lagstadgade Ryhti-övergången 2029.`,
  },
};
function planningEntryHtml(e, L) {
  const tags = [];
  if (L.status[e.status]) tags.push(L.status[e.status]);
  if (L.ptype[e.ptype]) tags.push(L.ptype[e.ptype]);
  if (e.date) tags.push(e.date);
  const label = escapeHtml(e.name + (tags.length ? ` (${tags.join(', ')})` : ''));
  const inner = e.url ? `<a href="${escapeHtml(e.url)}" rel="noopener nofollow">${label}</a>` : label;
  return `        <li>${inner} — ${escapeHtml(e.source)}</li>`;
}
function buildPlanningHtml(props, lang) {
  const entries = AREA_PLANNING[props.pno];
  if (!entries || entries.length === 0) return null;
  const L = PLANNING_LABELS[lang] || PLANNING_LABELS.fi;
  const items = entries.map((e) => planningEntryHtml(e, L)).join('\n');
  return `      <h2>${escapeHtml(L.heading)}</h2>\n      <ul>\n${items}\n      </ul>\n` +
    `      <p>${escapeHtml(L.coverage(PLANNING_SNAPSHOT, PLANNING_CITIES))}</p>`;
}

// QW-5: within-region "Naapurialueet" link mesh. Resolves up to 8 adjacency
// neighbours that share this area's region to their localized profile URL+name;
// skips neighbours absent from the dataset or in another seutukunta.
function buildNearbyHtml(props, lang) {
  const neighbours = ADJACENCY[props.pno];
  if (!neighbours || neighbours.length === 0) return null;
  const links = [];
  for (const nPno of neighbours) {
    if (links.length >= 8) break;
    const np = PNO_PROPS.get(nPno);
    if (!np || np.city !== props.city) continue; // within-region only
    const name = escapeHtml(getDisplayName(np, lang));
    links.push(`<a href="${AREA_PREFIX[lang]}/${toSlug(nPno, np.nimi)}/">${name}</a>`);
  }
  if (links.length === 0) return null;
  return `      <h2>${escapeHtml(NEARBY_LABELS[lang])}</h2>\n      <p>${links.join(' · ')}</p>`;
}

// #3: cross-region "Similar areas elsewhere in Finland" link mesh. Resolves this
// area's precomputed top-6 nationwide lookalikes (SIMILAR_ELSEWHERE, all in OTHER
// seutukunnat) to their localized profile URL + name, annotating each with its region
// so the cross-region nature is explicit to readers and crawlers. Complements the
// within-region buildNearbyHtml: together they connect the page laterally AND across
// the whole corpus.
function buildSimilarElsewhereHtml(props, lang) {
  const sims = SIMILAR_ELSEWHERE[props.pno];
  if (!sims || sims.length === 0) return null;
  const links = [];
  for (const sPno of sims) {
    const sp = PNO_PROPS.get(sPno);
    if (!sp) continue;
    const name = escapeHtml(getDisplayName(sp, lang));
    const region = getRegionName(sp.city, lang);
    const label = region ? `${name} (${escapeHtml(region)})` : name;
    links.push(`<a href="${AREA_PREFIX[lang]}/${toSlug(sPno, sp.nimi)}/">${label}</a>`);
  }
  if (links.length === 0) return null;
  return `      <h2>${escapeHtml(SIMILAR_LABELS[lang])}</h2>\n      <p>${links.join(' · ')}</p>`;
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

  // CF-2: plain-language strengths/weaknesses, from this area's real percentiles.
  const summarySentences = summarySentencesFor(props, lang);
  if (summarySentences.length > 0) {
    lines.push(`      <p>${escapeHtml(summarySentences.join(' '))}</p>`);
  }

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

  // CF-13: deeper real-data tables from the latent Paavo fields (age pyramid,
  // employment by sector, household income & structure) — bundle-budget-free.
  lines.push(...buildEnrichmentSections(props, lang));

  // CF-11: FAQ — visible Q&A that mirrors the FAQPage JSON-LD (Google requires
  // the structured data to match on-page content).
  const faq = buildFaq(props, lang);
  if (faq.length > 0) {
    lines.push(`      <h2>${escapeHtml(T.faqHeading)}</h2>`);
    for (const { q, a } of faq) {
      lines.push(`      <h3>${escapeHtml(q)}</h3>`);
      lines.push(`      <p>${escapeHtml(a)}</p>`);
    }
  }

  // CF-1: kaavat & hankkeet lähistöllä (national Väylä projects + participating-
  // city vireillä asemakaava). Omitted for areas with no entry.
  const planningHtml = buildPlanningHtml(props, lang);
  if (planningHtml) lines.push(planningHtml);

  // QW-5: within-region nearby-areas link mesh (lateral crawl/internal-PageRank).
  const nearbyHtml = buildNearbyHtml(props, lang);
  if (nearbyHtml) lines.push(nearbyHtml);

  // #3: cross-region "similar areas elsewhere in Finland" mesh — thematic links that
  // connect the 69 within-region islands into one graph (crawl depth / PageRank).
  const similarHtml = buildSimilarElsewhereHtml(props, lang);
  if (similarHtml) lines.push(similarHtml);

  lines.push(`      <h2>${escapeHtml(T.sourcesHeading)}</h2>`);
  lines.push(`      <p>${escapeHtml(T.sources)}</p>`);

  const nav = [];
  if (props.city && region) {
    nav.push(`<a href="${CITY_PREFIX[lang]}/${escapeHtml(props.city)}/">${escapeHtml(T.regionLink)}</a>`);
  }
  nav.push(`<a href="/?pno=${pno}">${escapeHtml(T.mapLink)}</a>`);
  nav.push(`<a href="${DIRECTORY_URL[lang]}">${escapeHtml(T.directoryLink)}</a>`);
  // CF-1: reverse-nav links into the ranking/compare/municipality/planning mesh for this
  // area (from the build-time manifest; every href is a page that was actually generated).
  const an = AREA_NAV[String(pno)]?.[lang];
  if (an) {
    if (an.muni) nav.push(`<a href="${an.muni.href}">${escapeHtml(an.muni.label)}</a>`);
    for (const r of an.rankings ?? []) nav.push(`<a href="${r.href}">${escapeHtml(r.label)}</a>`);
    for (const c of an.compares ?? []) nav.push(`<a href="${c.href}">${escapeHtml(c.label)}</a>`);
    if (an.planning) nav.push(`<a href="${an.planning.href}">${escapeHtml(an.planning.label)}</a>`);
  }
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
  // CF-2: lead the meta with the auto-composed strength/weakness sentence (it can
  // name several metrics at once, e.g. "top 8% nationally for income and transit").
  // Falls back to the CF-11 single-superlative ranking when the summary is empty so
  // the description always carries a verifiable percentile.
  const summarySentences = summarySentencesFor(props, lang);
  if (summarySentences.length > 0) {
    parts.push(summarySentences[0]);
  } else {
    const pct = percentilesFor(props);
    if (pct.quality.nationalTop != null) parts.push(T.descRank(pct.quality.nationalTop));
    else if (pct.income.nationalTop != null) parts.push(T.descIncRank(pct.income.nationalTop));
    else if (pct.transit.nationalTop != null) parts.push(T.descTransitRank(pct.transit.nationalTop));
  }
  parts.push(T.descTail);
  return parts.join(' ');
}

/** CF-11: templated Q&A from this area's real values, shared by the noscript FAQ and
 *  the FAQPage JSON-LD so the structured data always matches visible page text. The
 *  ranking answers carry both national and within-region percentiles. */
function buildFaq(props, lang) {
  const T = TEXT[lang];
  const name = getDisplayName(props, lang);
  const region = getRegionName(props.city, lang);
  const pct = percentilesFor(props);
  const qa = [];
  const pop = Number(props.he_vakiy);
  if (Number.isFinite(pop)) qa.push({ q: T.faqPopQ(name), a: T.faqPopA(name, fmtNum(Math.round(pop), 0, lang)) });
  const inc = Number(props.hr_mtu);
  if (Number.isFinite(inc) && inc > 0) qa.push({ q: T.faqIncQ(name), a: T.faqIncA(name, fmtNum(Math.round(inc), 0, lang)) });
  if (pct.quality.nationalTop != null) {
    qa.push({ q: T.faqRankQ(name), a: T.faqRankA(name, pct.quality.nationalTop, pct.quality.regionalTop, region) });
  }
  if (pct.income.nationalTop != null) {
    qa.push({ q: T.faqIncRankQ(name), a: T.faqIncRankA(name, pct.income.nationalTop, pct.income.regionalTop, region) });
  }
  if (pct.transit.nationalTop != null) {
    qa.push({ q: T.faqTransitRankQ(name), a: T.faqTransitRankA(name, pct.transit.nationalTop, pct.transit.regionalTop, region) });
  }
  // CF-8: broaden the verifiable superlatives — crime/safety, air quality, tree
  // canopy, higher education and employment, each ranked from its own direction.
  if (pct.crime.nationalTop != null) {
    qa.push({ q: T.faqCrimeRankQ(name), a: T.faqCrimeRankA(name, pct.crime.nationalTop, pct.crime.regionalTop, region) });
  }
  if (pct.air.nationalTop != null) {
    qa.push({ q: T.faqAirRankQ(name), a: T.faqAirRankA(name, pct.air.nationalTop, pct.air.regionalTop, region) });
  }
  if (pct.treeCanopy.nationalTop != null) {
    qa.push({ q: T.faqTreeRankQ(name), a: T.faqTreeRankA(name, pct.treeCanopy.nationalTop, pct.treeCanopy.regionalTop, region) });
  }
  if (pct.education.nationalTop != null) {
    qa.push({ q: T.faqEduRankQ(name), a: T.faqEduRankA(name, pct.education.nationalTop, pct.education.regionalTop, region) });
  }
  if (pct.employment.nationalTop != null) {
    qa.push({ q: T.faqEmpRankQ(name), a: T.faqEmpRankA(name, pct.employment.nationalTop, pct.employment.regionalTop, region) });
  }
  return qa;
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
  // #3: machine-readable cross-region relatedness — the same top-6 nationwide
  // lookalikes rendered as crawlable links, exposed to structured-data consumers
  // (incl. AI answer engines) as Place references.
  const similarPnos = SIMILAR_ELSEWHERE[props.pno];
  if (similarPnos && similarPnos.length > 0) {
    const sim = [];
    for (const sPno of similarPnos) {
      const sp = PNO_PROPS.get(sPno);
      if (!sp) continue;
      sim.push({
        '@type': 'Place',
        name: getDisplayName(sp, lang),
        url: `https://naapurustot.fi${AREA_PREFIX[lang]}/${toSlug(sPno, sp.nimi)}/`,
      });
    }
    if (sim.length > 0) place.isSimilarTo = sim;
  }
  // CF-11: verifiable national + within-region superlatives as structured
  // properties — quality index, median income and transit reachability. Each
  // value is an integer "top X%" derived from real per-area distributions.
  const pct = percentilesFor(props);
  const pctProps = [
    ['qualityIndexTopPercentileNational', pct.quality.nationalTop],
    ['qualityIndexTopPercentileRegional', pct.quality.regionalTop],
    ['medianIncomeTopPercentileNational', pct.income.nationalTop],
    ['medianIncomeTopPercentileRegional', pct.income.regionalTop],
    ['transitReachabilityTopPercentileNational', pct.transit.nationalTop],
    ['transitReachabilityTopPercentileRegional', pct.transit.regionalTop],
    // CF-8: additional verifiable superlatives (crime/safety, air, tree canopy,
    // higher education, employment), national + within-region.
    ['safetyTopPercentileNational', pct.crime.nationalTop],
    ['safetyTopPercentileRegional', pct.crime.regionalTop],
    ['airQualityTopPercentileNational', pct.air.nationalTop],
    ['airQualityTopPercentileRegional', pct.air.regionalTop],
    ['treeCanopyTopPercentileNational', pct.treeCanopy.nationalTop],
    ['treeCanopyTopPercentileRegional', pct.treeCanopy.regionalTop],
    ['higherEducationTopPercentileNational', pct.education.nationalTop],
    ['higherEducationTopPercentileRegional', pct.education.regionalTop],
    ['employmentRateTopPercentileNational', pct.employment.nationalTop],
    ['employmentRateTopPercentileRegional', pct.employment.regionalTop],
  ];
  for (const [pname, value] of pctProps) {
    if (value != null) additionalProperty.push({ '@type': 'PropertyValue', name: pname, value });
  }
  // CF-13: mirror the latent-Paavo headline figures (household income, household
  // size, living space, largest employment sector) as structured properties.
  for (const [pname, value] of enrichmentSchemaProps(props)) {
    additionalProperty.push({ '@type': 'PropertyValue', name: pname, value });
  }
  // CF-1: nearby planning/projects as PropertyValue nodes (name + status + date).
  const planningEntries = AREA_PLANNING[props.pno];
  if (planningEntries) {
    const SL = PLANNING_LABELS.en.status;
    for (const e of planningEntries) {
      const tags = [SL[e.status] || e.status];
      if (e.date) tags.push(e.date);
      additionalProperty.push({
        '@type': 'PropertyValue',
        name: e.kind === 'project' ? 'infrastructureProjectNearby' : 'zoningPlanNearby',
        value: `${e.name} (${tags.filter(Boolean).join(', ')})`,
      });
    }
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
  // CF-11: FAQPage structured data (mirrors the visible noscript Q&A).
  const faq = buildFaq(props, lang);
  let faqScript = '';
  if (faq.length > 0) {
    const faqPage = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    };
    faqScript = `\n    <script type="application/ld+json">${safeJson(faqPage)}</script>`;
  }
  return `<script type="application/ld+json">${safeJson(place)}</script>\n    <script type="application/ld+json">${safeJson(breadcrumb)}</script>${faqScript}`;
}

// PO-13: emit one templated SVG social card per profile into the build output
// (dist/og/), as a content-hashed static asset — never committed to the repo.
const CARD_DIR = join(DIST, 'og');
const ORIGIN = 'https://naapurustot.fi';
let cardsWritten = 0;

/**
 * Localized best-percentile badge for the card: the single most favourable
 * "Top X% nationally" superlative this area can claim, picked across the same
 * percentile metrics the FAQ/JSON-LD use. Returns null when none qualify (e.g.
 * an area with no rankable metrics), in which case the card omits the pill.
 */
function bestNationalBadge(props, lang) {
  const pct = percentilesFor(props);
  // Prefer the strongest (lowest "top X%") of the headline metrics, in a stable
  // priority order so the badge is deterministic for ties.
  const candidates = [pct.quality, pct.income, pct.transit, pct.education, pct.crime, pct.air, pct.treeCanopy, pct.employment]
    .map((m) => m?.nationalTop)
    .filter((v) => v != null);
  if (candidates.length === 0) return null;
  const best = Math.min(...candidates);
  const tmpl = LOCALES[lang]?.['card.badge_national'] ?? LOCALES.fi['card.badge_national'];
  return fillTemplate(tmpl, { pct: String(best) });
}

/** The 2–3 key stats shown on the card, from this area's real values. */
function cardStats(props, lang) {
  const L = LOCALES[lang];
  const tr = (k) => L?.[k] ?? LOCALES.fi[k] ?? k;
  const stats = [];
  const pop = Number(props.he_vakiy);
  if (Number.isFinite(pop)) stats.push({ label: tr('panel.population'), value: fmtNum(Math.round(pop), 0, lang) });
  const inc = Number(props.hr_mtu);
  if (Number.isFinite(inc) && inc > 0) {
    stats.push({ label: tr('layer.median_income'), value: `${fmtNum(Math.round(inc), 0, lang)} €` });
  }
  return stats.slice(0, 3);
}

/**
 * Build, write (once, content-hashed) and return the absolute URL of this area's
 * social card for the given language. The same SVG bytes hash to the same file,
 * so re-runs are idempotent and the filename busts caches when the card changes.
 */
function emitCard(props, slug, lang) {
  const svg = buildSocialCardSvg({
    name: getDisplayName(props, lang),
    pno: props.pno,
    region: getRegionName(props.city, lang),
    quality: props.quality_index,
    qualityLabel: LOCALES[lang]?.['layer.quality_index'] ?? LOCALES.fi['layer.quality_index'],
    badge: bestNationalBadge(props, lang),
    stats: cardStats(props, lang),
  });
  const hash = createHash('sha256').update(svg).digest('hex').slice(0, 10);
  const fileName = `${slug}-${lang}.${hash}.svg`;
  mkdirSync(CARD_DIR, { recursive: true });
  writeFileSync(join(CARD_DIR, fileName), svg);
  cardsWritten++;
  return `${ORIGIN}/og/${fileName}`;
}

// CF-11: oEmbed discovery — lets WordPress / Discourse / newsroom CMSes auto-embed
// the live interactive map from a pasted profile link. type:"rich" with the same
// iframe `buildEmbedSnippet` produces in-app. One endpoint per (area, language).
function oembedHref(slug, lang) {
  return `${ORIGIN}/oembed/${slug}.${lang}.json`;
}
function buildOembedJson(props, lang, displayName) {
  const params = new URLSearchParams({ pno: String(props.pno), embed: '1' });
  if (lang !== 'fi') params.set('lang', lang);
  const url = `${ORIGIN}/?${params.toString()}`;
  const html = `<iframe src="${url}" width="640" height="480" style="border:0;border-radius:12px;max-width:100%;width:100%" loading="lazy" title="naapurustot.fi"></iframe>`;
  return JSON.stringify({
    version: '1.0', type: 'rich', provider_name: 'naapurustot.fi', provider_url: ORIGIN,
    title: `${displayName} (${props.pno})`, width: 640, height: 480, html,
  });
}

function generatePage(feature, lang) {
  const props = feature.properties;
  const slug = toSlug(props.pno, props.nimi);
  const center = featureCenter(feature);
  const region = getRegionName(props.city, lang);
  const displayName = getDisplayName(props, lang);

  // Keyword-rich <title>: front-load the area name + postal code (what users type),
  // then add the municipality (when it isn't already the name's prefix) and a localized
  // category descriptor, so the title carries "asuinalue / neighbourhood / bostadsområde"
  // and the town name for intent matching. SERPs may visually truncate the tail, but the
  // extra keywords still count toward ranking. (Previously: just "Name (pno) – …".)
  const muni = props.municipality ? String(props.municipality) : '';
  const muniPart = muni && !displayName.toLowerCase().startsWith(muni.toLowerCase()) ? `${muni} ` : '';
  const title = `${displayName} (${props.pno}) – ${muniPart}${TEXT[lang].titleCat} – naapurustot.fi`;
  const description = buildDescription(props, lang, displayName, region);

  const fiUrl = `https://naapurustot.fi/alue/${slug}/`;
  const enUrl = `https://naapurustot.fi/en/area/${slug}/`;
  const svUrl = `https://naapurustot.fi/sv/omrade/${slug}/`;
  const canonicalUrl = lang === 'fi' ? fiUrl : lang === 'sv' ? svUrl : enUrl;
  const jsonLd = buildJsonLd(props, center, canonicalUrl, lang);
  const noscriptContent = buildNoscriptContent(props, lang);

  let html = template;

  // Document language must match the page locale.
  html = html.replace('<html lang="fi">', `<html lang="${lang}">`);

  // PO-2: localize the hardcoded-Finnish skip link (the first focusable element)
  // so EN/SV no-JS / pre-hydration SR users don't hear the Finnish phrase. The
  // live SPA re-localizes it on mount too (App.tsx lang effect).
  html = html.replace(
    /<a class="skip-link" href="#main" lang="[^"]*">[^<]*<\/a>/,
    `<a class="skip-link" href="#main" lang="${lang}">${escapeHtml(LOCALES[lang]['aria.skip_to_content'])}</a>`,
  );

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

  // PO-13: per-area dynamic social card. Each profile gets its own templated SVG
  // card (area name, quality index, percentile badge, key stats), emitted as a
  // content-hashed asset under /og/, replacing the shared /og-image.png. The card
  // is 1200×630 (the template's og:image:width/height already match).
  // CF-11: Facebook/LinkedIn/WhatsApp/X do NOT render SVG og:images, so reference the
  // sibling PNG (rasterized from this SVG by scripts/rasterize-cards.mjs in deploy.yml).
  // The SVG is still emitted as the rasterizer's input.
  const ogImage = emitCard(props, slug, lang);
  const ogImagePng = ogImage.replace(/\.svg$/, '.png');
  html = html.replace(
    /<meta property="og:image" content="[^"]*" \/>/,
    `<meta property="og:image" content="${ogImagePng}" />\n    <meta property="og:image:type" content="image/png" />`,
  );
  html = html.replace(
    /<meta name="twitter:image" content="[^"]*" \/>/,
    `<meta name="twitter:image" content="${ogImagePng}" />`,
  );

  // PO-9: localize og:locale, its two alternates, and the per-area og:image:alt.
  html = localizeOgLocale(html, lang, title);

  // CF-10: strip ALL of the template's homepage-scoped JSON-LD (WebSite,
  // WebApplication, FAQPage, Organization, Dataset) — none of it describes this
  // neighbourhood, and leaving five homepage blocks on every profile dilutes the
  // page's structured data. The profile's own Place/BreadcrumbList/FAQPage are
  // injected immediately below, so the page still carries exactly the right graph.
  html = html.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  // …and the now-orphaned "Structured Data:" comments that introduced them.
  html = html.replace(/\s*<!-- Structured Data:[\s\S]*?-->/g, '');
  // CF-10: drop the homepage Finnish keywords meta — irrelevant on EN/SV profiles
  // and a deprecated, spammy signal on every profile.
  html = html.replace(/\s*<meta name="keywords"[^>]*>/, '');
  // PO-4: Dublin Core metadata so Zotero's Embedded Metadata translator produces a
  // correct one-click citation (title, creator, dated identifier, rights). DC.date
  // is the dataset build date — the citation reflects the data vintage, not the page
  // fetch time. Injected alongside the JSON-LD, ahead of </head>.
  const dcDate = String(BUILD_METADATA.generated || '').slice(0, 10);
  const dcMeta = [
    `<meta name="DC.title" content="${escapeHtml(title)}" />`,
    `<meta name="DC.creator" content="naapurustot.fi" />`,
    `<meta name="DC.publisher" content="naapurustot.fi" />`,
    dcDate && `<meta name="DC.date" content="${dcDate}" />`,
    `<meta name="DC.identifier" content="${canonicalUrl}" />`,
    `<meta name="DC.language" content="${lang}" />`,
    `<meta name="DC.type" content="Dataset" />`,
    `<meta name="DC.rights" content="Data: Statistics Finland (CC BY 4.0), OpenStreetMap (ODbL) and other public sources" />`,
  ].filter(Boolean).map((m) => `    ${m}`).join('\n');
  // CF-11: oEmbed discovery link.
  const oembedLink = `    <link rel="alternate" type="application/json+oembed" href="${oembedHref(slug, lang)}" title="${escapeHtml(getDisplayName(props, lang))}" />`;
  // Inject Dublin Core meta + oEmbed link + JSON-LD before closing </head>.
  html = html.replace('</head>', `${dcMeta}\n${oembedLink}\n    ${jsonLd}\n  </head>`);

  // Replace noscript content with the full neighbourhood statistics.
  html = html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>\n    <div style="max-width:820px;margin:2rem auto;padding:1rem;font-family:system-ui,sans-serif;line-height:1.55">\n${noscriptContent}\n    </div>\n  </noscript>`,
  );

  // Embed this neighbourhood's processed properties + the dataset-wide averages +
  // its precomputed percentile bundle so NeighborhoodProfilePage renders immediately
  // AND keeps its FAQPage / percentile structured data — all WITHOUT fetching the
  // ~2 MB national dataset on the prerendered fast path (the client only pulls it now
  // on genuine in-app profile→profile navigation). `pct` mirrors the same
  // computeNeighbourhoodPercentiles bundle <JsonLd /> would otherwise derive at
  // runtime from the national cohort. `<` is escaped so a literal `</script>` in any
  // string field cannot break out of the element.
  const payload = JSON.stringify({ p: props, avg: metroAverages, pct: percentilesFor(props), nav: AREA_NAV[String(props.pno)]?.[lang] ?? null }).replace(/</g, '\\u003c');
  html = html.replace(
    '</body>',
    `    <script id="__naapurustot_profile__" type="application/json">${payload}</script>\n  </body>`,
  );

  return html;
}

// CF-9: prerender the public Data Sources & Methodology page (FI/EN/SV), built
// from the same single source-of-truth registry the app uses, so it is indexable
// and citable. The <noscript> groups every dataset by publisher with its license,
// vintage and resolution; a Dataset JSON-LD node lists the publishers as creators.
const SOURCES_ROUTES = {
  // CF-10: trailing slash — the page is served as a directory index, and a request
  // without the slash 301-redirects to it; canonicalise to the redirect target.
  fi: { path: 'tietolahteet', url: 'https://naapurustot.fi/tietolahteet/' },
  en: { path: 'en/data-sources', url: 'https://naapurustot.fi/en/data-sources/' },
  sv: { path: 'sv/datakallor', url: 'https://naapurustot.fi/sv/datakallor/' },
};

/**
 * PO-15: localize the build_metadata `generated` ISO timestamp to a day-level date
 * (mirrors formatGeneratedDate in DataSourcesPage.tsx). Returns '' when absent/invalid.
 */
function formatGeneratedDate(iso, lang) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(LOCALE_TAG[lang], { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return String(iso).slice(0, 10);
  }
}

/**
 * PO-15: per-source refresh log from build_metadata — each source's newest vintage
 * year and how many metrics it backs, sorted newest-first. Mirrors the SPA grouping
 * in DataSourcesPage.tsx so the static and hydrated changelog agree.
 */
function buildRefreshLog() {
  const bySource = new Map();
  for (const m of Object.values(BUILD_METADATA.metrics ?? {})) {
    const source = m?.source;
    if (!source) continue;
    const cur = bySource.get(source) ?? { source, count: 0, newest: null };
    cur.count += 1;
    const years = String(m.vintage ?? '').match(/\d{4}/g);
    const y = years ? Math.max(...years.map(Number)) : null;
    if (y != null && (cur.newest == null || y > cur.newest)) cur.newest = y;
    bySource.set(source, cur);
  }
  return [...bySource.values()].sort((a, b) => {
    const ya = a.newest ?? -Infinity;
    const yb = b.newest ?? -Infinity;
    if (yb !== ya) return yb - ya;
    return a.source.localeCompare(b.source);
  });
}

function buildSourcesNoscript(lang) {
  const L = LOCALES[lang];
  const tr = (k) => L[k] ?? k;
  const fill = (k, tokens) => {
    let s = tr(k);
    for (const [token, value] of Object.entries(tokens)) s = s.replace(`{${token}}`, String(value));
    return s;
  };
  const granLabel = (g) =>
    g === '250m grid' ? tr('sources.gran_grid') : g === 'derived' ? tr('sources.gran_derived') : tr('sources.gran_postal');

  // PO-15: prominent generated date + per-source refresh log (indexable changelog).
  const generatedOn = formatGeneratedDate(BUILD_METADATA.generated, lang);
  let updatedBlock = '';
  if (generatedOn) {
    const logItems = buildRefreshLog()
      .map((r) => {
        const newest = r.newest != null ? `${escapeHtml(fill('sources.refresh_newest', { year: r.newest }))} · ` : '';
        return `<li>${escapeHtml(r.source)} — ${newest}${escapeHtml(fill('sources.refresh_layers', { n: r.count }))}</li>`;
      })
      .join('');
    updatedBlock =
      `<h2>${escapeHtml(tr('sources.updated_heading'))}</h2>` +
      `<p><strong>${escapeHtml(fill('sources.updated_on', { date: generatedOn }))}</strong></p>` +
      `<p>${escapeHtml(tr('sources.updated_intro'))}</p>` +
      `<h3>${escapeHtml(tr('sources.refresh_log_heading'))}</h3>` +
      `<ul>${logItems}</ul>`;
  }

  // Group registry metrics by publisher, collapsing to distinct datasets.
  const byPub = new Map();
  for (const entry of Object.values(DATA_SOURCE_METRICS)) {
    if (!byPub.has(entry.publisher)) byPub.set(entry.publisher, new Map());
    byPub.get(entry.publisher).set(`${entry.source}|${entry.vintage}|${entry.granularity}`, entry);
  }

  let rows = '';
  for (const [pubId, datasets] of byPub) {
    const pub = DATA_SOURCE_PUBLISHERS[pubId];
    if (!pub) continue;
    const items = [...datasets.values()]
      .map(
        (e) =>
          `<li>${escapeHtml(e.source)} (${escapeHtml(String(e.vintage))}, ${escapeHtml(granLabel(e.granularity))})` +
          `${e.is_proxy ? ` — ${escapeHtml(tr('data.estimate'))}` : ''}</li>`,
      )
      .join('');
    rows += `<li><a href="${escapeHtml(pub.url)}">${escapeHtml(pub.name)}</a> — ${escapeHtml(pub.license)}<ul>${items}</ul></li>`;
  }

  // PO-5: complete per-metric audit table from build_metadata — coverage, row
  // count, vintage, resolution and the proxy flag. The SPA ships most of this; the
  // prerendered noscript previously lacked it. Headers inline (build-only, no bundle).
  const CT = {
    fi: { heading: 'Mittareiden kattavuus', metric: 'Mittari', coverage: 'Kattavuus', rows: 'Alueita', vintage: 'Vuosi', gran: 'Tarkkuus', proxy: 'Arvio' },
    en: { heading: 'Per-metric coverage', metric: 'Metric', coverage: 'Coverage', rows: 'Areas', vintage: 'Year', gran: 'Resolution', proxy: 'Estimate' },
    sv: { heading: 'Mätarnas täckning', metric: 'Mätare', coverage: 'Täckning', rows: 'Områden', vintage: 'År', gran: 'Upplösning', proxy: 'Uppskattning' },
  }[lang] ?? { heading: 'Per-metric coverage', metric: 'Metric', coverage: 'Coverage', rows: 'Areas', vintage: 'Year', gran: 'Resolution', proxy: 'Estimate' };
  const metricRows = Object.keys(BUILD_METADATA.metrics ?? {}).sort().map((key) => {
    const m = BUILD_METADATA.metrics[key];
    return `<tr><th scope="row">${escapeHtml(key)}</th>` +
      `<td>${escapeHtml(String(m.coverage_pct ?? ''))} %</td>` +
      `<td>${escapeHtml(String(m.row_count ?? ''))}</td>` +
      `<td>${escapeHtml(String(m.vintage ?? ''))}</td>` +
      `<td>${escapeHtml(granLabel(m.granularity))}</td>` +
      `<td>${m.is_proxy ? escapeHtml(tr('data.estimate')) : '—'}</td></tr>`;
  }).join('');
  const coverageTable = metricRows
    ? `<h2>${escapeHtml(CT.heading)}</h2><table><thead><tr>` +
      `<th scope="col">${escapeHtml(CT.metric)}</th><th scope="col">${escapeHtml(CT.coverage)}</th>` +
      `<th scope="col">${escapeHtml(CT.rows)}</th><th scope="col">${escapeHtml(CT.vintage)}</th>` +
      `<th scope="col">${escapeHtml(CT.gran)}</th><th scope="col">${escapeHtml(CT.proxy)}</th></tr></thead><tbody>${metricRows}</tbody></table>`
    : '';

  return [
    `<h1>${escapeHtml(tr('sources.title'))}</h1>`,
    `<p>${escapeHtml(tr('sources.subtitle'))}</p>`,
    updatedBlock,
    `<h2>${escapeHtml(tr('sources.publishers_heading'))}</h2>`,
    `<ul>${rows}</ul>`,
    coverageTable,
    `<h2>${escapeHtml(tr('sources.methodology_heading'))}</h2>`,
    `<p>${escapeHtml(tr('sources.methodology_body'))}</p>`,
    `<p>${escapeHtml(tr('sources.quality_note'))}</p>`,
  ].filter(Boolean).join('\n');
}

function buildSourcesJsonLd(lang, canonicalUrl) {
  const tr = (k) => LOCALES[lang][k] ?? k;
  const ds = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: tr('sources.title'),
    description: tr('sources.subtitle'),
    url: canonicalUrl,
    inLanguage: lang,
    isAccessibleForFree: true,
    license: 'https://creativecommons.org/licenses/by/4.0/',
    // PO-15: real provenance — the build_metadata `generated` timestamp as the
    // dataset's machine-readable last-refresh date (matches the visible "Data updated" note).
    ...(BUILD_METADATA.generated ? { dateModified: BUILD_METADATA.generated } : {}),
    creator: Object.values(DATA_SOURCE_PUBLISHERS).map((p) => ({ '@type': 'Organization', name: p.name, url: p.url })),
  };
  // PO-10: a CollectionPage node describing the page itself (matching the hub
  // pages' depth: site root → this page) plus a BreadcrumbList. The brand name
  // "naapurustot.fi" is a literal, not a translatable string (mirrors the hubs).
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: tr('sources.title'),
    description: tr('sources.subtitle'),
    url: canonicalUrl,
    inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'naapurustot.fi', url: 'https://naapurustot.fi' },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: 'https://naapurustot.fi/' },
      { '@type': 'ListItem', position: 2, name: tr('sources.title') },
    ],
  };
  return [collection, breadcrumb, ds]
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
    .join('\n    ');
}

// PO-14: prerender the public Privacy & data-handling notice (FI/EN/SV). Built
// from the same locale dictionaries the app uses, so the static copy always
// matches the in-app PrivacyPage. The <noscript> mirrors every section as
// semantic HTML; a PrivacyPolicy JSON-LD node makes it machine-readable.
const PRIVACY_ROUTES = {
  // CF-10: trailing slash — served as a directory index (see SOURCES_ROUTES).
  fi: { path: 'tietosuoja', url: 'https://naapurustot.fi/tietosuoja/' },
  en: { path: 'en/privacy', url: 'https://naapurustot.fi/en/privacy/' },
  sv: { path: 'sv/integritet', url: 'https://naapurustot.fi/sv/integritet/' },
};

// Section keys must match src/pages/PrivacyPage.tsx (SECTION_KEYS), each with a
// `_h` heading and `_b` body in all three locale files.
const PRIVACY_SECTIONS = [
  'privacy.s_noaccount',
  'privacy.s_account',
  'privacy.s_basis',
  'privacy.s_thirdparties',
  'privacy.s_retention',
  'privacy.s_rights',
  'privacy.s_contact',
];

function buildPrivacyNoscript(lang) {
  const tr = (k) => LOCALES[lang][k] ?? LOCALES.fi[k] ?? k;
  const lines = [
    `<h1>${escapeHtml(tr('privacy.title'))}</h1>`,
    `<p>${escapeHtml(tr('privacy.subtitle'))}</p>`,
  ];
  for (const key of PRIVACY_SECTIONS) {
    lines.push(`<h2>${escapeHtml(tr(`${key}_h`))}</h2>`);
    // Bodies may contain newline-separated items (e.g. the third-party list);
    // split so each becomes its own paragraph in the fallback.
    for (const para of tr(`${key}_b`).split('\n')) {
      lines.push(`<p>${escapeHtml(para)}</p>`);
    }
    if (key === 'privacy.s_contact') {
      lines.push('<p><a href="mailto:info@naapurustot.fi">info@naapurustot.fi</a></p>');
    }
  }
  return lines.join('\n');
}

function buildPrivacyJsonLd(lang, canonicalUrl) {
  const tr = (k) => LOCALES[lang][k] ?? k;
  const policy = {
    '@context': 'https://schema.org',
    '@type': 'PrivacyPolicy',
    name: tr('privacy.title'),
    description: tr('privacy.subtitle'),
    url: canonicalUrl,
    inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'naapurustot.fi', url: 'https://naapurustot.fi' },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: 'https://naapurustot.fi/' },
      { '@type': 'ListItem', position: 2, name: tr('privacy.title') },
    ],
  };
  return [policy, breadcrumb]
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
    .join('\n    ');
}

function generatePrivacyPage(lang) {
  const title = `${LOCALES[lang]['privacy.title']} – naapurustot.fi`;
  const description = LOCALES[lang]['privacy.subtitle'];
  const { fi: fiR, en: enR, sv: svR } = PRIVACY_ROUTES;
  const canonicalUrl = PRIVACY_ROUTES[lang].url;
  const jsonLd = buildPrivacyJsonLd(lang, canonicalUrl);
  const noscriptContent = buildPrivacyNoscript(lang);

  let html = template;
  html = html.replace('<html lang="fi">', `<html lang="${lang}">`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`);
  html = html.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${canonicalUrl}" />`);
  html = html.replace(/<link rel="alternate" hreflang="fi" href="[^"]*" \/>/, `<link rel="alternate" hreflang="fi" href="${fiR.url}" />`);
  html = html.replace(/<link rel="alternate" hreflang="en" href="[^"]*" \/>/, `<link rel="alternate" hreflang="en" href="${enR.url}" />`);
  html = html.replace(/<link rel="alternate" hreflang="sv" href="[^"]*" \/>/, `<link rel="alternate" hreflang="sv" href="${svR.url}" />`);
  html = html.replace(/<link rel="alternate" hreflang="x-default" href="[^"]*" \/>/, `<link rel="alternate" hreflang="x-default" href="${fiR.url}" />`);
  html = html.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${canonicalUrl}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(title)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${escapeHtml(title)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${escapeHtml(description)}" />`);
  // PO-9: localize og:locale, its two alternates, and the per-page og:image:alt.
  html = localizeOgLocale(html, lang, title);
  html = html.replace('</head>', `    ${jsonLd}\n  </head>`);
  html = html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>\n    <div style="max-width:820px;margin:2rem auto;padding:1rem;font-family:system-ui,sans-serif;line-height:1.55">\n${noscriptContent}\n    </div>\n  </noscript>`,
  );
  return html;
}

function generateSourcesPage(lang) {
  const title = `${LOCALES[lang]['sources.title']} – naapurustot.fi`;
  const description = LOCALES[lang]['sources.subtitle'];
  const { fi: fiR, en: enR, sv: svR } = SOURCES_ROUTES;
  const canonicalUrl = SOURCES_ROUTES[lang].url;
  const jsonLd = buildSourcesJsonLd(lang, canonicalUrl);
  const noscriptContent = buildSourcesNoscript(lang);

  let html = template;
  html = html.replace('<html lang="fi">', `<html lang="${lang}">`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`);
  html = html.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${canonicalUrl}" />`);
  html = html.replace(/<link rel="alternate" hreflang="fi" href="[^"]*" \/>/, `<link rel="alternate" hreflang="fi" href="${fiR.url}" />`);
  html = html.replace(/<link rel="alternate" hreflang="en" href="[^"]*" \/>/, `<link rel="alternate" hreflang="en" href="${enR.url}" />`);
  html = html.replace(/<link rel="alternate" hreflang="sv" href="[^"]*" \/>/, `<link rel="alternate" hreflang="sv" href="${svR.url}" />`);
  html = html.replace(/<link rel="alternate" hreflang="x-default" href="[^"]*" \/>/, `<link rel="alternate" hreflang="x-default" href="${fiR.url}" />`);
  html = html.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${canonicalUrl}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(title)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${escapeHtml(title)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${escapeHtml(description)}" />`);
  // PO-9: localize og:locale, its two alternates, and the per-page og:image:alt.
  html = localizeOgLocale(html, lang, title);
  html = html.replace('</head>', `    ${jsonLd}\n  </head>`);
  html = html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>\n    <div style="max-width:820px;margin:2rem auto;padding:1rem;font-family:system-ui,sans-serif;line-height:1.55">\n${noscriptContent}\n    </div>\n  </noscript>`,
  );
  return html;
}

// --- Main ---
console.log('Prerendering neighbourhood profile pages...');

const features = geojson.features.filter((f) => f.properties?.pno && f.properties?.nimi);
const oembedDir = join(DIST, 'oembed'); // CF-11: per-area oEmbed endpoints
let count = 0;

for (const feature of features) {
  const slug = toSlug(feature.properties.pno, feature.properties.nimi);

  // IN-6: assert head integrity on every assembled profile before writing — every
  // area has population, so each page carries exactly one FAQPage and an embedded
  // profile payload; a duplicated head token or un-stripped homepage JSON-LD fails
  // the build here instead of silently corrupting the page.
  const fiHtml = generatePage(feature, 'fi');
  assertHeadIntegrity(fiHtml, { context: `alue/${slug}`, expectFaq: true, expectProfilePayload: true, expectThemeGuard: true });
  const fiDir = join(DIST, 'alue', slug);
  mkdirSync(fiDir, { recursive: true });
  writeFileSync(join(fiDir, 'index.html'), fiHtml);

  const enHtml = generatePage(feature, 'en');
  assertHeadIntegrity(enHtml, { context: `en/area/${slug}`, expectFaq: true, expectProfilePayload: true, expectThemeGuard: true });
  const enDir = join(DIST, 'en', 'area', slug);
  mkdirSync(enDir, { recursive: true });
  writeFileSync(join(enDir, 'index.html'), enHtml);

  const svHtml = generatePage(feature, 'sv');
  assertHeadIntegrity(svHtml, { context: `sv/omrade/${slug}`, expectFaq: true, expectProfilePayload: true, expectThemeGuard: true });
  const svDir = join(DIST, 'sv', 'omrade', slug);
  mkdirSync(svDir, { recursive: true });
  writeFileSync(join(svDir, 'index.html'), svHtml);

  // CF-11: oEmbed endpoint per language (referenced by the head link above).
  mkdirSync(oembedDir, { recursive: true });
  for (const lang of ['fi', 'en', 'sv']) {
    writeFileSync(join(oembedDir, `${slug}.${lang}.json`), buildOembedJson(feature.properties, lang, getDisplayName(feature.properties, lang)));
  }

  count++;
}

console.log(`Prerendered ${count} neighbourhoods (${count * 3} HTML files, ${cardsWritten} social cards in dist/og/).`);

// IN-8: write redirect stubs for retired slugs. When a Paavo refresh renames an
// area, slug_aliases.json records old-slug → pno; we write a tiny canonical+refresh
// stub at each old URL (all three languages) pointing at the area's current page,
// so an already-indexed link 301-equivalents to the new URL instead of 404-ing.
let stubCount = 0;
try {
  const aliases = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'slug_aliases.json'), 'utf-8'));
  const currentSlugs = new Set(Object.values(aliases.slugs ?? {}));
  for (const [oldSlug, pno] of Object.entries(aliases.aliases ?? {})) {
    const newSlug = aliases.slugs?.[pno];
    // Skip if the alias has no current target, or would shadow a live page.
    if (!newSlug || currentSlugs.has(oldSlug)) continue;
    for (const lang of ['fi', 'en', 'sv']) {
      const dir = join(DIST, ...ALIAS_AREA_PREFIX[lang].split('/'), oldSlug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.html'), buildStubHtml(oldSlug, newSlug, lang));
      stubCount++;
    }
  }
} catch {
  // No alias file yet — nothing to stub.
}
if (stubCount > 0) console.log(`Prerendered ${stubCount} slug-alias redirect stubs.`);

// CF-9: write the three localized data-sources pages.
for (const [lang, route] of Object.entries(SOURCES_ROUTES)) {
  const html = generateSourcesPage(lang);
  // IN-6: these pages keep the homepage JSON-LD (no profile payload, no own FAQ),
  // so assert the singleton head tokens and JSON-LD validity only — plus, like every
  // clone of the template, that its inline JavaScript survived intact.
  assertHeadIntegrity(html, { context: route.path, expectThemeGuard: true });
  const dir = join(DIST, ...route.path.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}
console.log('Prerendered 3 data-sources pages (/tietolahteet, /en/data-sources, /sv/datakallor).');

// PO-14: write the three localized privacy pages.
for (const [lang, route] of Object.entries(PRIVACY_ROUTES)) {
  const html = generatePrivacyPage(lang);
  assertHeadIntegrity(html, { context: route.path, expectThemeGuard: true }); // IN-6: singleton head tokens + JSON-LD validity + intact inline JS
  const dir = join(DIST, ...route.path.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}
console.log('Prerendered 3 privacy pages (/tietosuoja, /en/privacy, /sv/integritet).');

// The /live/ realtime surface, in all three languages.
//
// One WORD in every language (`/live/`, not nyt/now/nu) but three distinct URLs.
// Collapsing them into a single `/live/` that switches language from
// localStorage would leave nothing for hreflang to point at, and the page would
// index as Finnish-only — the locale prefix is what keeps one memorable path
// from costing the other two locales their crawlable URL.
//
// Prerendered for the same reason /uusi-salasana is: without a real directory,
// GitHub Pages answers the SPA fallback with HTTP 404, a canonical pointing at
// `/`, and the homepage's title. Unlike the reset page this one IS indexable —
// it is a public page people should be able to find.
const LIVE_ROUTES = {
  fi: { path: 'live', url: 'https://naapurustot.fi/live/' },
  en: { path: 'en/live', url: 'https://naapurustot.fi/en/live/' },
  sv: { path: 'sv/live', url: 'https://naapurustot.fi/sv/live/' },
};

function generateLivePage(lang) {
  const title = LOCALES[lang]['live.page.title'];
  const description = LOCALES[lang]['live.page.description'];
  const { fi: fiR, en: enR, sv: svR } = LIVE_ROUTES;
  const canonicalUrl = LIVE_ROUTES[lang].url;

  let html = template;
  html = html.replace('<html lang="fi">', `<html lang="${lang}">`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`);
  html = html.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${canonicalUrl}" />`);
  html = html.replace(/<link rel="alternate" hreflang="fi" href="[^"]*" \/>/, `<link rel="alternate" hreflang="fi" href="${fiR.url}" />`);
  html = html.replace(/<link rel="alternate" hreflang="en" href="[^"]*" \/>/, `<link rel="alternate" hreflang="en" href="${enR.url}" />`);
  html = html.replace(/<link rel="alternate" hreflang="sv" href="[^"]*" \/>/, `<link rel="alternate" hreflang="sv" href="${svR.url}" />`);
  html = html.replace(/<link rel="alternate" hreflang="x-default" href="[^"]*" \/>/, `<link rel="alternate" hreflang="x-default" href="${fiR.url}" />`);
  html = html.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${canonicalUrl}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(title)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${escapeHtml(title)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${escapeHtml(description)}" />`);
  html = localizeOgLocale(html, lang, title);
  // The live data is fetched client-side, so the <noscript> states what the page
  // is rather than mirroring content it cannot have.
  html = html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>\n    <div style="max-width:820px;margin:2rem auto;padding:1rem;font-family:system-ui,sans-serif;line-height:1.55">\n      <h1>${escapeHtml(title)}</h1>\n      <p>${escapeHtml(description)}</p>\n      <p>JavaScript is required for the live map.</p>\n    </div>\n  </noscript>`,
  );
  return html;
}

for (const [lang, route] of Object.entries(LIVE_ROUTES)) {
  const html = generateLivePage(lang);
  assertHeadIntegrity(html, { context: route.path, expectThemeGuard: true });
  const dir = join(DIST, ...route.path.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}
console.log('Prerendered 3 live pages (/live, /en/live, /sv/live).');

// Landing page for the link in a password-reset email.
//
// This exists so the path resolves as a FIRST-CLASS page on GitHub Pages.
//
// Without it the request still works — .github/workflows/deploy.yml copies
// dist/index.html over dist/404.html, so Pages serves the SPA shell for unknown
// paths and React Router matches /uusi-salasana client-side with the query intact.
// (public/404.html, a redirect stub that WOULD drop the path, only survives in
// local `npm run preview`; the deploy overwrites it.) But that fallback is served
// with HTTP 404, advertises `robots: index, follow`, points its canonical at `/`,
// and shows the homepage's marketing <title> — none of which is right for a page
// people reach from an email. Prerendering gives it a 200, a noindex, and a title.
//
// One file serves all three languages: the email link carries ?lang, which
// ResetPasswordPage applies on mount. There is deliberately no localized copy in
// the markup and no JSON-LD — the page is noindex (it is reachable only with a
// one-hour single-use token, and has nothing to offer a search engine), so the
// <noscript> just states that JavaScript is required.
const RESET_ROUTE = 'uusi-salasana';

function generateResetPage() {
  const title = 'Uusi salasana – naapurustot.fi';
  const description = 'Aseta uusi salasana naapurustot.fi-tunnuksellesi.';
  const canonicalUrl = `https://naapurustot.fi/${RESET_ROUTE}/`;

  let html = template;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`);
  html = html.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${canonicalUrl}" />`);
  html = html.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${canonicalUrl}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(title)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${escapeHtml(title)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${escapeHtml(description)}" />`);
  // Keep it out of the index and out of every sitemap. A reset URL in search
  // results is noise at best; it also stops the page accruing links that would
  // outlive the tokens they were minted for.
  //
  // REPLACE the template's existing robots tag rather than appending a second
  // one. Crawlers resolve conflicting robots metas by taking the most
  // restrictive, so a stray `index, follow` alongside this would still end up
  // noindex — but only by accident, and it reads as a bug to the next person.
  const robotsRe = /<meta name="robots" content="[^"]*" \/>/;
  if (!robotsRe.test(html)) {
    throw new Error('reset page: no robots meta found in the template to replace');
  }
  html = html.replace(robotsRe, '<meta name="robots" content="noindex, nofollow" />');
  html = html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>\n    <div style="max-width:820px;margin:2rem auto;padding:1rem;font-family:system-ui,sans-serif;line-height:1.55">\n      <h1>${escapeHtml(title)}</h1>\n      <p>${escapeHtml(description)}</p>\n      <p>JavaScript is required to set a new password.</p>\n    </div>\n  </noscript>`,
  );
  return html;
}

{
  const html = generateResetPage();
  assertHeadIntegrity(html, { context: RESET_ROUTE, expectThemeGuard: true });
  const robotsTags = html.match(/<meta name="robots"/g) ?? [];
  if (robotsTags.length !== 1 || !html.includes('content="noindex, nofollow"')) {
    throw new Error(`reset page: expected exactly one noindex robots meta, found ${robotsTags.length}`);
  }
  const dir = join(DIST, RESET_ROUTE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}
console.log(`Prerendered the password-reset page (/${RESET_ROUTE}).`);
