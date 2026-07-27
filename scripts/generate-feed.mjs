#!/usr/bin/env node
/**
 * PO-5: render src/data/data_updates.json as an Atom feed at dist/data-updates.atom.
 *
 * The data-refresh changelog had no subscription surface; an Atom feed gives
 * journalists/researchers a standing "data updated" return hook — the cheapest
 * recurring-visit loop for a static site. Real build events only (the log is
 * appended by build_region_data.mjs); this script only renders.
 *
 * Run in the build:pages chain:  node scripts/generate-feed.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ORIGIN = 'https://naapurustot.fi';

const updates = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'data_updates.json'), 'utf-8')); }
  catch { return []; }
})();
const buildGenerated = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'build_metadata.json'), 'utf-8')).generated; }
  catch { return ''; }
})();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isoDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T00:00:00Z` : String(d);

const latest = updates[0]?.date ? isoDay(updates[0].date) : (buildGenerated || '1970-01-01T00:00:00Z');

const entries = updates.map((u) => {
  const summary = u.type === 'vintage'
    ? `${u.metric} updated from vintage ${u.from} to ${u.to}.`
    : u.type === 'vintage_correction'
      // Not new data: the recorded year was wrong and has been corrected. Saying
      // "updated to 2018" would read as a refresh to eight-year-old data.
      ? `${u.metric} vintage corrected from ${u.from} to ${u.to} (attribution fix, data unchanged).`
      : u.type === 'coverage'
        ? `${u.metric} coverage changed from ${u.from}% to ${u.to}%.`
        // IN-8: planning (and any future non-numeric) refresh — the title is self-describing.
        : u.title;
  return `  <entry>
    <title>${esc(u.title)}</title>
    <id>tag:naapurustot.fi,${esc(u.date)}:${esc(u.metric)}:${esc(u.type)}</id>
    <updated>${isoDay(u.date)}</updated>
    <link href="${ORIGIN}/tietolahteet/" />
    <summary>${esc(summary)}</summary>
  </entry>`;
}).join('\n');

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>naapurustot.fi — data updates</title>
  <subtitle>When a neighbourhood-statistics layer is refreshed or its coverage changes.</subtitle>
  <link href="${ORIGIN}/data-updates.atom" rel="self" />
  <link href="${ORIGIN}/tietolahteet/" />
  <id>${ORIGIN}/data-updates.atom</id>
  <updated>${latest}</updated>
  <author><name>naapurustot.fi</name></author>
${entries}
</feed>
`;

writeFileSync(join(DIST, 'data-updates.atom'), atom);
console.log(`Generated data-updates.atom (${updates.length} entries).`);
