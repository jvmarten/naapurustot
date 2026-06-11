#!/usr/bin/env node
/**
 * PO-4 part 4: regenerate the data-derived sections of public/llms.txt and
 * public/llms-full.txt so the AI-assistant reference never drifts from the actual
 * layer catalogue, data sources, and build date. Runs in the `build:pages` chain.
 *
 * What is regenerated (everything else — the curated prose — is preserved in place):
 *   - llms-full.txt "## 4. Data layers": the grouped layer catalogue, derived from
 *     LAYER_GROUPS (LayerSelector.tsx) + the layer labels/explanations in the locale.
 *   - llms-full.txt "## 7. Data sources and licensing": one row per publisher with the
 *     layers it provides + its licence, derived from src/data/data_sources.json.
 *   - "Last reviewed: YYYY": the year from src/data/build_metadata.json.
 *   - llms.txt "Primary data sources:" sentence: the publisher list from the registry.
 *
 * The colorScales.ts → formatting.ts → i18n.ts chain reaches Vite-only `?url`
 * specifiers, so it can't be imported under plain Node; instead the LAYERS triples
 * (id / labelKey / property) are STATICALLY EXTRACTED from colorScales.ts by regex,
 * which is sufficient to map a registry metric (a property) to its display label.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const r = (...p) => resolve(ROOT, ...p);

const en = JSON.parse(readFileSync(r('src/locales/en.json'), 'utf-8'));
const registry = JSON.parse(readFileSync(r('src/data/data_sources.json'), 'utf-8'));
const buildMeta = JSON.parse(readFileSync(r('src/data/build_metadata.json'), 'utf-8'));
const colorScalesSrc = readFileSync(r('src/utils/colorScales.ts'), 'utf-8');
const layerSelectorSrc = readFileSync(r('src/components/LayerSelector.tsx'), 'utf-8');

// --- Static extraction: LAYERS triples (id, labelKey, property) ---
const layerById = new Map();
const idByProperty = new Map();
const re = /\bid:\s*'([^']+)',\s*labelKey:\s*'([^']+)',\s*property:\s*'([^']+)'/g;
for (let m; (m = re.exec(colorScalesSrc)); ) {
  const [, id, labelKey, property] = m;
  layerById.set(id, { id, labelKey, property, label: en[labelKey] ?? id });
  idByProperty.set(property, id);
}

// --- LAYER_GROUPS (group labelKey → ordered layer ids) ---
const groups = [];
const gre = /labelKey:\s*'(layers\.[^']+)',\s*ids:\s*\[([^\]]*)\]/g;
for (let m; (m = gre.exec(layerSelectorSrc)); ) {
  const labelKey = m[1];
  const ids = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  groups.push({ label: en[labelKey] ?? labelKey, ids });
}

// --- Section 4: grouped layer catalogue ---
function buildLayerCatalogue() {
  const lines = ['## 4. Data layers', '',
    'naapurustot.fi presents the following indicators, grouped as in the app. Each is',
    'an area-level statistic shown on the map and on every neighbourhood profile where',
    'data is available. This catalogue is generated from the live layer registry.', ''];
  for (const g of groups) {
    const items = g.ids.map((id) => layerById.get(id)).filter(Boolean);
    if (items.length === 0) continue;
    lines.push(`### ${g.label}`);
    for (const it of items) {
      const expl = en[`metric_explanation.${it.id}`];
      lines.push(`- **${it.label}**${expl ? ` — ${expl}` : ''}`);
    }
    lines.push('');
  }
  lines.push('Quality Index is a composite score (see section 5). Not every metric is',
    'available for every area; missing values are shown as blank, never estimated.', '');
  return lines.join('\n');
}

// --- Section 7: data sources & licensing (one row per publisher) ---
const LICENCE_LABEL = (l) => (l && l.toLowerCase() !== 'open' ? l : 'Open / public');
function buildSourcesTable() {
  // publisher id → set of layer labels it provides (via metric property → layer)
  const byPub = new Map();
  for (const [prop, meta] of Object.entries(registry.metrics ?? {})) {
    if (!meta || meta.stored === false) continue;
    const pub = meta.publisher;
    if (!pub) continue;
    const id = idByProperty.get(prop);
    const label = id ? layerById.get(id)?.label : null;
    if (!byPub.has(pub)) byPub.set(pub, new Set());
    if (label) byPub.get(pub).add(label);
  }
  const lines = ['## 7. Data sources and licensing', '',
    'Generated from the data-source registry; every metric traces to one of these',
    'publishers.', '', '| Source | Provides | Licence |', '|---|---|---|'];
  // Order publishers by how many layers they provide (richest first).
  const ordered = [...byPub.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [pubId, labels] of ordered) {
    const pub = registry.publishers?.[pubId] ?? { name: pubId, license: 'Open' };
    const provides = [...labels].sort().join(', ') || '—';
    lines.push(`| ${pub.name} | ${provides} | ${LICENCE_LABEL(pub.license)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// --- Splice a regenerated body between two "## N." headers ---
function replaceSection(text, header, nextHeader, body) {
  const start = text.indexOf(header);
  const end = text.indexOf(nextHeader, start + header.length);
  if (start === -1 || end === -1) {
    console.warn(`generate-llms: could not locate section ${header.trim()}`);
    return text;
  }
  return text.slice(0, start) + body.trimEnd() + '\n\n' + text.slice(end);
}

const year = String(buildMeta.generated ?? '').slice(0, 4) || '2026';

// --- llms-full.txt ---
let full = readFileSync(r('public/llms-full.txt'), 'utf-8');
full = full.replace(/Last reviewed: \d{4}/, `Last reviewed: ${year}`);
full = replaceSection(full, '## 4. Data layers', '## 5. ', buildLayerCatalogue());
full = replaceSection(full, '## 7. Data sources and licensing', '## 8. ', buildSourcesTable());
writeFileSync(r('public/llms-full.txt'), full);

// --- llms.txt: regenerate the "Primary data sources:" sentence ---
const pubNames = [...new Set(Object.values(registry.metrics ?? {})
  .filter((m) => m && m.stored !== false && m.publisher)
  .map((m) => registry.publishers?.[m.publisher]?.name)
  .filter(Boolean))];
const sourcesSentence = `Primary data sources: ${pubNames.join(', ')}. ` +
  'Statistics Finland data is licensed CC BY 4.0; OpenStreetMap data under the ODbL.';
let brief = readFileSync(r('public/llms.txt'), 'utf-8');
brief = brief.replace(/Primary data sources:[^\n]*\n/, sourcesSentence + '\n');
writeFileSync(r('public/llms.txt'), brief);

console.log(`generate-llms: regenerated ${layerById.size} layers across ${groups.length} groups, ` +
  `${new Set(Object.values(registry.metrics ?? {}).map((m) => m?.publisher).filter(Boolean)).size} publishers, year ${year}.`);
