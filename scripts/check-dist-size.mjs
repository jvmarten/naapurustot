#!/usr/bin/env node
/**
 * Single source of truth for the published-site size ceiling (IN-3).
 *
 * GitHub Pages rejects a published site larger than 1 GB, and nothing verified the
 * deploy against that cap — the ~9,000-page prerendered mesh plus the deploy-time
 * social-card PNGs push dist/ into the hundreds of MB, and a combinatorial page family
 * (a new ranking metric ≈ +600 URLs/locale of prerendered HTML) could silently grow it
 * toward the cap until an upload truncates or fails. This walks dist/, sums the RAW
 * on-disk bytes + file count (NOT gzipped — the Pages cap is on the uncompressed site),
 * prints a per-top-level-directory breakdown, and exits non-zero past a budget.
 *
 * Two profiles, because dist/ has two meaningfully different states:
 *   --profile pages   The prerendered page mesh after `npm run build:pages`, BEFORE the
 *                     deploy-only social-card rasterization. This is what the ci.yml /
 *                     auto-merge.yml lighthouse jobs produce, and it is where the
 *                     combinatorial growth actually lives — so this is the pre-merge gate.
 *   --profile deploy  The full published tree after `node scripts/rasterize-cards.mjs`,
 *                     right before upload-pages-artifact. Includes the ~9,261 stable
 *                     card PNGs. This is the backstop guard on the actual 1 GB cap.
 *
 * The rasterized PNG set is fixed by the area/region count (it does not grow with new
 * data layers or ranking families), so the runaway risk is entirely in the `pages` mesh;
 * the `deploy` profile is the absolute-cap backstop.
 *
 * Mirrors scripts/check-bundle-size.mjs: one constant per budget, a GITHUB_STEP_SUMMARY
 * table when running in Actions, and a ::error:: annotation + exit 1 on breach.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MiB = 1024 * 1024;

// Measured 2026-07-24 in the real jobs:
//   pages  (ci/auto-merge lighthouse, post build:pages, no og cache) : 557 MB / 41,882 files
//   deploy (deploy.yml, post rasterize, the actual upload)           : 1382 MB / 65,167 files
//     — of which dist/og alone is 846 MB / 32,538 files: the deploy restores dist/og from a
//     prefix-keyed cache (deploy.yml) that has accumulated many data-versions' worth of card
//     PNGs, far more than the ~9,054 current cards. GitHub Pages accepts this upload today
//     (prior deploys at ~1382 MB succeed), so the documented "1 GB" limit is NOT hard-enforced
//     for artifact-based Pages at the uncompressed-tree level — a HARD deploy gate below the
//     working size would just false-fail production. So:
//   - `pages` is the HARD pre-merge gate: it measures the DETERMINISTIC prerendered mesh (no
//     cache, no PNGs), which is the only thing that grows with new page families. Byte-identical
//     across OSes, so 640 MiB over today's 557 MB never false-fails yet trips on a new family.
//   - `deploy` is a WARN-ONLY visibility report: it always prints the per-dir breakdown (so the
//     og-cache bloat is visible every deploy) and emits a ::warning:: past a generous soft
//     threshold set above today's real size, but NEVER fails the deploy. Follow-ups to reclaim
//     room: fix the dist/og cache accumulation (32k files ≫ 9k cards) and drop the now-unused
//     card SVGs from the upload (prerender references the .png).
const PROFILES = {
  pages: {
    hard: true,
    budget: 640 * MiB,
    fileBudget: 50_000,
    label: 'Prerendered page mesh (pre-rasterize)',
  },
  deploy: {
    hard: false, // visibility + growth warning only — never blocks the deploy (see above)
    budget: 1600 * MiB,
    fileBudget: 90_000,
    label: 'Full published site (post-rasterize)',
  },
};

const profileArg = (() => {
  const i = process.argv.indexOf('--profile');
  return i !== -1 ? process.argv[i + 1] : 'pages';
})();
const profile = PROFILES[profileArg];
if (!profile) {
  console.error(`::error::Unknown --profile "${profileArg}" (expected: ${Object.keys(PROFILES).join(', ')})`);
  process.exit(2);
}

const DIST_DIR = 'dist';
if (!existsSync(DIST_DIR)) {
  console.error(`::error::${DIST_DIR}/ not found — run \`npm run build\` (and \`npm run build:pages\`) first.`);
  process.exit(2);
}

const fmtMB = (b) => (b / MiB).toFixed(1);

// Recursive walk, bucketing bytes + file count by the first path segment under dist/.
// Loose files at the dist root are bucketed under '(root)'.
const perDir = new Map(); // topLevel -> { bytes, files }
let totalBytes = 0;
let totalFiles = 0;

function bump(topLevel, bytes) {
  const cur = perDir.get(topLevel) ?? { bytes: 0, files: 0 };
  cur.bytes += bytes;
  cur.files += 1;
  perDir.set(topLevel, cur);
}

function walk(absDir, topLevel) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, topLevel ?? entry.name);
    } else if (entry.isFile()) {
      const { size } = statSync(abs);
      totalBytes += size;
      totalFiles += 1;
      bump(topLevel ?? '(root)', size);
    }
    // Symlinks/others: skip (none are expected in dist).
  }
}

walk(DIST_DIR, null);

const rows = [...perDir.entries()]
  .map(([name, v]) => ({ name, ...v }))
  .sort((a, b) => b.bytes - a.bytes);

const headroom = profile.budget - totalBytes;
console.log(
  `dist/ ${profile.label}: ${fmtMB(totalBytes)} MB across ${totalFiles} files ` +
    `(budget ${fmtMB(profile.budget)} MB, headroom ${fmtMB(headroom)} MB; ` +
    `files ${totalFiles}/${profile.fileBudget}).`,
);
for (const r of rows) {
  console.log(`  ${r.name.padEnd(16)} ${fmtMB(r.bytes).padStart(8)} MB  ${String(r.files).padStart(6)} files`);
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const lines = [
    `### 📦 dist size — ${profile.label}`,
    '',
    `**Total:** ${fmtMB(totalBytes)} MB / ${totalFiles} files · ` +
      `**Budget:** ${fmtMB(profile.budget)} MB / ${profile.fileBudget} files · ` +
      `**Headroom:** ${fmtMB(headroom)} MB`,
    '',
    '| Directory | Size | Files |',
    '|---|--:|--:|',
    ...rows.map((r) => `| ${r.name} | ${fmtMB(r.bytes)} MB | ${r.files} |`),
    '',
  ];
  writeFileSync(summaryPath, lines.join('\n') + '\n', { flag: 'a' });
}

if (totalBytes > profile.budget || totalFiles > profile.fileBudget) {
  const why =
    totalBytes > profile.budget
      ? `size ${fmtMB(totalBytes)} MB exceeds ${fmtMB(profile.budget)} MB budget`
      : `file count ${totalFiles} exceeds ${profile.fileBudget} budget`;
  const msg = `dist/ ${profile.label} ${why} — prune the page mesh or the dist/og card cache.`;
  if (profile.hard) {
    // Hard gate (pages): fail the job so growth is caught before merge.
    console.error(`::error::${msg}`);
    process.exit(1);
  }
  // Warn-only (deploy): the real upload size is cache-driven and known-accepted by Pages,
  // so surface growth loudly but never block the deploy.
  console.log(`::warning::${msg}`);
}
