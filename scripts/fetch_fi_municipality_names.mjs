#!/usr/bin/env node
/**
 * Fetch the Swedish name of every Finnish municipality from Statistics Finland's
 * municipality classification (Kunnat 2025, CC BY 4.0) into
 * scripts/fi_municipality_names_sv.json — { "<kunta code>": "<Swedish name>" }.
 *
 * Bilingual municipalities have an official Swedish name (Helsinki → Helsingfors,
 * Espoo → Esbo); the classification also carries the established Swedish form of many
 * Finnish-speaking ones (Akaa → Ackas). Where Swedish has no name of its own the
 * classification repeats the Finnish one, and so does this file.
 *
 * Used by prerender-hubs.mjs for the Swedish-language pages. Reaches the network, so it is
 * NOT part of build:data; re-run it when the municipality classification changes.
 *
 *   node scripts/fetch_fi_municipality_names.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CLASSIFICATION = 'kunta_1_20250101';
const url = (lang) =>
  `https://data.stat.fi/api/classifications/v2/classifications/${CLASSIFICATION}/classificationItems?content=data&meta=max&lang=${lang}&format=json`;

async function names(lang) {
  const res = await fetch(url(lang));
  if (!res.ok) throw new Error(`${lang}: HTTP ${res.status}`);
  const items = await res.json();
  const out = {};
  for (const it of items) {
    const name = it.classificationItemNames?.find((n) => n.lang === lang)?.name;
    if (!/^\d{3}$/.test(it.code) || !name) throw new Error(`${lang}: malformed item ${JSON.stringify(it.code)}`);
    out[it.code] = name;
  }
  return out;
}

const sv = await names('sv');
const fi = await names('fi');
// A partial answer must never be written (the same rule as every other fetch here).
const missing = Object.keys(fi).filter((c) => !sv[c]);
if (missing.length || Object.keys(sv).length < 300) {
  throw new Error(`incomplete classification: ${Object.keys(sv).length} Swedish names, missing ${missing.join(', ')}`);
}
const sorted = Object.fromEntries(Object.keys(sv).sort().map((c) => [c, sv[c]]));
const outPath = resolve(import.meta.dirname, 'fi_municipality_names_sv.json');
writeFileSync(outPath, JSON.stringify({
  source: `Tilastokeskus, luokitus ${CLASSIFICATION} (Kunnat 2025), CC BY 4.0`,
  names: sorted,
}, null, 2) + '\n');
const differing = Object.keys(sv).filter((c) => sv[c] !== fi[c]).length;
console.log(`fi_municipality_names_sv.json: ${Object.keys(sv).length} municipalities, ${differing} with a Swedish name of their own.`);
