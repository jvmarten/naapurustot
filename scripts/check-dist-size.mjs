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

// Measured 2026-07-24 (this build):
//   pages  (post build:pages, pre-rasterize) : 557 MB / 41,882 files
//   deploy (post rasterize, the real upload)  : ~1016 MB / ~50,936 files
//     = 557 MB mesh  +  ~459 MB of 9,054 card PNGs (~52 KB each; the SVGs stay too).
// The GitHub Pages published-site cap is 1 GiB (1073.7 MB): the current deploy already
// sits at ~95% of it. The card-PNG payload is FIXED by the area/region count, so the only
// thing that grows is the `pages` mesh — a new combinatorial page family (a ranking metric
// ≈ +600 URLs/locale of prerendered HTML) can push the deploy over the cap. Hence a tight
// `pages` budget (the meaningful pre-merge early-warning) and a `deploy` backstop just under
// the hard cap. If either fires, PRUNE (e.g. drop the now-unused dist/og SVGs from the
// upload, ~22 MB; trim a page family) rather than raising the budget toward 1 GiB.
const PROFILES = {
  // Pre-rasterize prerendered page mesh — what the ci.yml / auto-merge.yml lighthouse jobs
  // produce (no card PNGs, no og cache). ~83 MB headroom over today's 557 MB: normal PRs
  // move the mesh by <1 MB, but a whole new ranking/compare family (100s of MB) trips it.
  pages: {
    budget: 640 * MiB,
    fileBudget: 50_000,
    label: 'Prerendered page mesh (pre-rasterize)',
  },
  // Full published tree (post-rasterize), the real 1 GiB Pages cap guard. Set just under the
  // hard cap (~1073.7 MB) so it fails LOUDLY before an upload silently truncates/rejects,
  // with ~52 MB over today's ~1016 MB so it never false-fails a deploy Pages would accept.
  deploy: {
    budget: 1068 * MiB,
    fileBudget: 58_000,
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
  console.error(`::error::dist/ ${profile.label} ${why} — prune the page mesh or cards before it hits the 1 GB Pages cap.`);
  process.exit(1);
}
