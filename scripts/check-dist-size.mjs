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
 *                     card PNGs and excludes the card SVGs the rasterizer consumed.
 *                     This is the backstop on what actually ships.
 *
 * The rasterized PNG set is fixed by the area/region count (it does not grow with new data
 * layers or ranking families), so combinatorial runaway lives in the `pages` mesh — but the
 * `deploy` profile is not decorative: the one growth mode that bypasses `pages` entirely is
 * the dist/og cache accumulating across deploys, which is precisely what took the published
 * tree to 2.4 GB and broke production. Both profiles fail the job on breach.
 *
 * Mirrors scripts/check-bundle-size.mjs: one constant per budget, a GITHUB_STEP_SUMMARY
 * table when running in Actions, and a ::error:: annotation + exit 1 on breach.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MiB = 1024 * 1024;

// Measured 2026-08-07 in a clean tree (both profiles now deterministic):
//   pages  (ci/auto-merge lighthouse, post build:pages, no og cache) : 543 MB / 41,825 files
//   deploy (deploy.yml, post rasterize, the actual upload)           : ~970 MB / 41,825 files
//     — dist/og is 9,261 card PNGs; the card is a fixed 1200×630 template, so their size
//     barely varies (mean 49.6 KiB, σ 2.5 KiB, max 61.8 KiB over a 3,434-card sample ⇒ 449 MB
//     expected, 546 MB even if every card were the largest observed). The file COUNT is
//     identical across the two profiles: rasterize-cards.mjs deletes each card SVG once its
//     PNG exists, so the profiles differ only in card bytes (2.5 KB of SVG → ~50 KB of PNG).
//
// BOTH profiles are hard gates. `deploy` was previously warn-only because the upload size was
// cache-driven and therefore not something a build could legitimately fail on — dist/og was
// restored from a prefix-keyed cache that accumulated a new data-version of cards every deploy
// (32,538 files against ~9,000 real cards). That is fixed at the source: prerender-hubs.mjs
// clears the cache-restored SVGs before emitting the current set, so rasterize-cards.mjs's
// orphan prune can finally collect the superseded PNGs. The published tree is now a pure
// function of the committed data — so it can be gated like one.
//
// Re-arming this matters: the warn-only window is exactly when the tree ratcheted to 2.4 GB /
// ~65,000 files and the Pages sync crept past actions/deploy-pages' 10-minute default timeout,
// failing three consecutive production deploys while every `build` job stayed green.
//
//   - `pages`  gates the prerendered mesh pre-merge — the only part that grows combinatorially
//     (a new ranking metric ≈ +600 URLs/locale). Byte-identical across OSes.
//   - `deploy` gates the real upload. The budget is a RATCHET DETECTOR, not the Pages cap: the
//     documented 1 GB limit is demonstrably not hard-enforced here (deploys at 1382 MB
//     succeeded), and the binding constraint is sync TIME, which scales with file count. The
//     headroom below absorbs normal growth and trips long before anything approaches the size
//     that broke the deploy.
const PROFILES = {
  pages: {
    hard: true,
    budget: 640 * MiB,
    fileBudget: 50_000,
    label: 'Prerendered page mesh (pre-rasterize)',
  },
  deploy: {
    hard: true,
    budget: 1200 * MiB, // ~22% over today's 980 MB
    fileBudget: 50_000, // ~20% over today's 41,825 — sync time tracks this more than bytes
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
    // Both profiles are hard today: `pages` catches combinatorial page growth before merge,
    // `deploy` catches anything that reaches the upload without going through the mesh.
    console.error(`::error::${msg}`);
    process.exit(1);
  }
  // Soft profiles (none at present) report growth without blocking. Kept so a future profile
  // can be introduced in observe-only mode — but see the PROFILES comment: leaving the gate
  // that guards production in this mode is how the 2.4 GB tree shipped unnoticed.
  console.log(`::warning::${msg}`);
}
