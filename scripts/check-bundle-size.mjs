#!/usr/bin/env node
/**
 * Single source of truth for the gzipped app-JS bundle budget (IN-1).
 *
 * Called by BOTH `.github/workflows/ci.yml` and `.github/workflows/auto-merge.yml`
 * so the budget constant and the measurement logic live in exactly one place —
 * before this, the two workflows carried independent copies of the 280,000-byte
 * check that could silently drift apart.
 *
 * It sums the gzipped size of every app JS chunk in dist/assets EXCEPT maplibre-*
 * (the irreducible third-party map renderer, the only excluded chunk). Lazy
 * chunks are included — lazy-loading does NOT exempt code from the budget.
 *
 * Side effects:
 *   - Writes `bundle-size.json` ({ js, css, total }) for baseline caching and
 *     cross-job forwarding (auto-merge saves it as the new main baseline).
 *   - If GITHUB_STEP_SUMMARY is set, appends a per-chunk table plus, when a
 *     `base-bundle-size.json` (restored from the main cache) is present, the
 *     exact gzip delta of this branch vs main.
 *   - Exits non-zero (with a ::error:: annotation) when the budget is exceeded.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

// Budget history: 160KB → 210KB (react-router-dom + @turf/union + auth/profile)
// → 235KB (first FEATURE_ROADMAP batch) → 256000 B (second) → 280000 B (third
// batch: 36-item roadmap completion + UX-review batch) → 282000 B (2026-06-11:
// the 2026-06-10 roadmap added three new map layers — radon, morbidity, flood —
// plus the transit-reachability grid and next-steps links, exhausting the 280 KB
// budget; raised to land the last roadmap items, mirroring 256→280) → 287000 B
// (2026-06-11: implemented all 44 remaining docs/UX_REVIEW.md findings — focus
// traps, ARIA names, a non-blocking region-switch progress bar, address-search
// region resolution, a signed-out favorites surface, a unified toast stack,
// language auto-detection, a touch peek bar, reduced-motion sheets, and more —
// adding ~4.4 KB of genuine UI logic + the bundled fi.json strings; data stays
// out of JS, so the heavy assets are unaffected) → 291000 B (2026-06-15: roadmap
// Batch 2 centerpiece — the kaavat & hankkeet map overlay (CF-2: usePlanningData
// + Map overlay/popup + PlanningControls + URL flag), the in-panel planning list
// (CF-3), and the expanded similarity picker (QW-3), ~3.2 KB of UI + bundled
// fi.json labels. Batch 1 first freed ~2 KB via the fi-extra split + orphan
// prune; this raise covers the remaining overflow. All planning DATA stays a
// lazy static shard — zero bundle bytes.
//
// Measurement basis: this sums Node `zlib.gzipSync` lengths — the honest gzip
// payload, with no embedded filename/mtime header. The previous inline shell
// gate used `find … -exec gzip -c`, whose per-file FNAME+MTIME headers inflated
// the total by ~2 KB across the ~108 chunks. So the number printed here reads
// ~2 KB BELOW the old gate at the same real bundle; the 280000 B budget is
// unchanged, which means ~2 KB more genuine headroom than the old method showed.
const BUDGET = 291_000;
const ASSETS_DIR = 'dist/assets';

const fmtKB = (b) => (b / 1024).toFixed(2);

const allFiles = readdirSync(ASSETS_DIR);
const jsFiles = allFiles.filter((f) => f.endsWith('.js') && !f.startsWith('maplibre-'));

let jsTotal = 0;
const rows = [];
for (const f of jsFiles) {
  const gz = gzipSync(readFileSync(join(ASSETS_DIR, f))).length;
  jsTotal += gz;
  rows.push({ name: f, gz });
}
rows.sort((a, b) => b.gz - a.gz);

let cssTotal = 0;
for (const f of allFiles.filter((f) => f.endsWith('.css'))) {
  cssTotal += gzipSync(readFileSync(join(ASSETS_DIR, f))).length;
}

const headroom = BUDGET - jsTotal;
console.log(
  `App JS bundle excluding maplibre (gzipped): ${jsTotal} bytes ` +
    `(budget ${BUDGET}, headroom ${headroom})`,
);

writeFileSync(
  'bundle-size.json',
  JSON.stringify({ js: jsTotal, css: cssTotal, total: jsTotal + cssTotal }) + '\n',
);

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  let base = null;
  if (existsSync('base-bundle-size.json')) {
    try {
      base = JSON.parse(readFileSync('base-bundle-size.json', 'utf8'));
    } catch {
      /* malformed cache — fall through to no-baseline path */
    }
  }
  const lines = ['### 📦 Bundle Size Report', ''];
  if (base && typeof base.js === 'number') {
    const diff = jsTotal - base.js;
    const sign = diff > 0 ? '+' : '';
    const pct = base.js > 0 ? ` (${sign}${((diff / base.js) * 100).toFixed(1)}%)` : '';
    lines.push('| App JS (excl. maplibre) | This branch | main | Delta |');
    lines.push('|---|---|---|---|');
    lines.push(
      `| Gzipped | ${fmtKB(jsTotal)} KB | ${fmtKB(base.js)} KB | ${sign}${fmtKB(diff)} KB${pct} |`,
    );
  } else {
    lines.push(`**App JS (excl. maplibre), gzipped:** ${fmtKB(jsTotal)} KB`);
    lines.push('');
    lines.push('> _No baseline from main yet — delta will appear once a main build is cached._');
  }
  lines.push('');
  lines.push(`**Budget:** ${fmtKB(BUDGET)} KB · **Headroom:** ${fmtKB(headroom)} KB`);
  lines.push('');
  lines.push('<details><summary>Per-chunk breakdown</summary>', '');
  lines.push('| Chunk | Gzipped |', '|---|---|');
  for (const r of rows) lines.push(`| ${r.name} | ${fmtKB(r.gz)} KB |`);
  lines.push('', '</details>');
  writeFileSync(summaryPath, lines.join('\n') + '\n', { flag: 'a' });
}

if (jsTotal > BUDGET) {
  console.error(
    `::error::JS bundle size exceeds ${fmtKB(BUDGET)} KB gzipped budget (${jsTotal} bytes)`,
  );
  process.exit(1);
}
