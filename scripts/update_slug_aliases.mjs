#!/usr/bin/env node
/**
 * IN-8: slug-stability safety net.
 *
 * Profile URLs derive from the current GeoJSON `nimi` (`/alue/<pno>-<slug>/`), so a
 * quarterly refresh that renames an area silently 404s its already-indexed page —
 * GitHub Pages' 404 fallback returns status 404, burning accumulated link equity.
 *
 * This script maintains `src/data/slug_aliases.json`:
 *   { "aliases": { "<old-slug>": "<pno>" }, "slugs": { "<pno>": "<current-slug>" } }
 * On each run it computes current slugs from the GeoJSON, and for any pno whose slug
 * changed since the committed snapshot it records old-slug → pno. prerender.mjs then
 * writes a tiny canonical+refresh stub at every old URL pointing at the new one.
 *
 * Run in the data-refresh flow / build:data (NOT prerender alone — deploy builds
 * never commit back, so the snapshot must update where the result is committed).
 *
 * Usage: node scripts/update_slug_aliases.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Slug logic — MUST stay byte-identical to scripts/prerender.mjs / generate-sitemap.mjs.
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
export function toSlug(pno, nimi) {
  return `${pno}-${slugify(nimi)}`;
}

/** Path segment (no leading slash) per language for a profile URL. */
export const AREA_PREFIX = { fi: 'alue', en: 'en/area', sv: 'sv/omrade' };
const ORIGIN = 'https://naapurustot.fi';

/** Compute the current { pno: slug } map from GeoJSON features. */
export function computeCurrentSlugs(features) {
  const slugs = {};
  for (const f of features) {
    const p = f.properties;
    if (!p?.pno || !p?.nimi) continue;
    slugs[p.pno] = toSlug(p.pno, p.nimi);
  }
  return slugs;
}

/** Merge a new slug snapshot into the prior aliases, recording every rename. */
export function mergeAliases(prev, currentSlugs) {
  const aliases = { ...(prev?.aliases ?? {}) };
  const prevSlugs = prev?.slugs ?? {};
  for (const [pno, slug] of Object.entries(currentSlugs)) {
    const old = prevSlugs[pno];
    if (old && old !== slug && old !== aliasTargetSlug(currentSlugs, old)) {
      aliases[old] = pno; // the retired slug now resolves to this pno's current page
    }
  }
  const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return { aliases: sortObj(aliases), slugs: sortObj(currentSlugs) };
}
// An old slug that is *also* some area's current slug must not become an alias
// (it would shadow a live page). Returns the old slug iff it is a current slug.
function aliasTargetSlug(currentSlugs, oldSlug) {
  for (const s of Object.values(currentSlugs)) if (s === oldSlug) return oldSlug;
  return null;
}

/** Tiny stub page for a retired URL: canonical + instant refresh to the new URL. */
export function buildStubHtml(oldSlug, newSlug, lang) {
  const newUrl = `${ORIGIN}/${AREA_PREFIX[lang]}/${newSlug}/`;
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <title>naapurustot.fi</title>
    <link rel="canonical" href="${newUrl}" />
    <meta name="robots" content="noindex, follow" />
    <meta http-equiv="refresh" content="0; url=${newUrl}" />
  </head>
  <body><p>This area has moved to <a href="${newUrl}">${newUrl}</a>.</p></body>
</html>
`;
}

// --- main (guarded so the pure helpers above import cleanly in tests) ---
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const geojson = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'metro_neighborhoods.geojson'), 'utf-8'));
  const aliasPath = join(ROOT, 'src', 'data', 'slug_aliases.json');
  const prev = existsSync(aliasPath) ? JSON.parse(readFileSync(aliasPath, 'utf-8')) : { aliases: {}, slugs: {} };
  const next = mergeAliases(prev, computeCurrentSlugs(geojson.features));
  writeFileSync(aliasPath, JSON.stringify(next, null, 2) + '\n');
  const added = Object.keys(next.aliases).length - Object.keys(prev.aliases ?? {}).length;
  console.log(`slug_aliases.json: ${Object.keys(next.slugs).length} current slugs, ${Object.keys(next.aliases).length} aliases (${added >= 0 ? '+' : ''}${added} this run).`);
}
