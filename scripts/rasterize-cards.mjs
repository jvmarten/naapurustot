#!/usr/bin/env node
/**
 * CF-11: rasterize the per-area/per-region social-card SVGs in dist/og/ to sibling
 * PNGs. Facebook, LinkedIn, WhatsApp and X do NOT render SVG og:images, so the
 * profile/hub pages reference a .png (see prerender.mjs); this step produces it.
 *
 * Build-only and DEPLOY-ONLY: it is wired into .github/workflows/deploy.yml, NOT the
 * ci/auto-merge `build:pages` runs, because ~9,000 PNGs add a few hundred MB to dist/
 * (within the GitHub Pages 1 GB cap). The card SVG filenames are content-hashed, so a
 * sibling .png that already exists is up to date and skipped — incremental across runs.
 *
 * MEMORY: rendering ~9,000 cards in ONE long-lived process OOM-killed the deploy
 * ("The operation was canceled" ~6 min in) — each `new Resvg(...)` allocates a native
 * font DB + a 1200×630 RGBA pixmap, and those native allocations accumulate faster than
 * GC reclaims them. (An earlier fix removed a far worse cost — a per-card
 * `loadSystemFonts: true` that rescanned the runner's whole font tree every iteration —
 * but the residual per-card native growth still exhausted the runner.) So this script
 * runs as an ORCHESTRATOR that rasterizes the cards in fixed-size batches, each in a
 * fresh CHILD process that exits when its batch is done: the OS reclaims all native
 * memory between batches, bounding peak RSS to one batch regardless of any native leak.
 * Each child also runs under --expose-gc and forces a GC periodically as a second line
 * of defense. Set RASTERIZE_BATCH=<start>:<count> to invoke the worker path directly.
 *
 * @resvg/resvg-js is a native module (devDependency). Fonts: the card uses
 * "system-ui, sans-serif". The worker loads a SMALL FIXED font set (DejaVu Sans regular
 * + bold, covering Latin + ä/ö/å) once into buffers; deploy.yml installs
 * fonts-dejavu-core for the paths below. A one-time system-font fallback covers local
 * runs lacking those files.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';

// dist/og by default; overridable for tests via RASTERIZE_OG_DIR.
const ogDir = process.env.RASTERIZE_OG_DIR
  ? resolve(process.env.RASTERIZE_OG_DIR)
  : resolve(import.meta.dirname, '..', 'dist', 'og');
if (!existsSync(ogDir)) {
  console.log('rasterize-cards: dist/og/ not found — nothing to do (run build:pages first).');
  process.exit(0);
}

// One stable, sorted list of all card SVGs. Batches index into THIS list (never the
// shrinking "missing PNG" set), so child slices stay aligned as earlier batches write PNGs.
const allSvgs = readdirSync(ogDir).filter((f) => f.endsWith('.svg')).sort();
const pngOf = (svgFile) => join(ogDir, svgFile.replace(/\.svg$/, '.png'));

const batchEnv = process.env.RASTERIZE_BATCH; // "<start>:<count>" → worker mode

// Cards per child process. Small enough that one batch's native footprint stays well
// under the runner's RAM even in the worst case (no GC between renders); large enough
// that process-spawn overhead is negligible across the ~9,000 cards. Overridable for tests.
const BATCH = Number(process.env.RASTERIZE_BATCH_SIZE) || 400;

if (batchEnv) {
  // ── WORKER: render one [start, start+count) slice, then exit (freeing native memory). ──
  const [start, count] = batchEnv.split(':').map(Number);
  const slice = allSvgs.slice(start, start + count);

  const FONT_PATHS = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  ];
  const fontBuffers = FONT_PATHS.filter(existsSync).map((p) => readFileSync(p));
  // Fall back to a one-time system scan only when the bundled fonts are absent (local
  // dev without fonts-dejavu-core) — never per card on the deploy runner.
  const fontOption = fontBuffers.length > 0
    ? { loadSystemFonts: false, fontBuffers, defaultFontFamily: 'DejaVu Sans' }
    : { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' };

  let rendered = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < slice.length; i++) {
    const svgFile = slice[i];
    const pngPath = pngOf(svgFile);
    if (existsSync(pngPath)) { skipped += 1; continue; } // content-hashed → already up to date
    try {
      const svg = readFileSync(join(ogDir, svgFile), 'utf-8');
      // The og:image dimensions are fixed at 1200×630 by the SVG itself.
      const resvg = new Resvg(svg, { font: fontOption });
      writeFileSync(pngPath, resvg.render().asPng());
      rendered += 1;
    } catch (err) {
      failed += 1;
      console.warn(`  failed to rasterize ${svgFile}: ${err instanceof Error ? err.message : err}`);
    }
    // Defense-in-depth: nudge GC every 64 renders so native wrappers are reclaimed
    // mid-batch too (the process exit below is the real guarantee).
    if (typeof global.gc === 'function' && (i & 63) === 63) global.gc();
  }
  console.log(`  batch ${start}–${start + slice.length}: ${rendered} rendered, ${skipped} up-to-date, ${failed} failed.`);
  // A batch fails only if every attempted render threw (a real, systemic problem);
  // isolated per-card failures are warned and tolerated.
  process.exit(failed > 0 && rendered === 0 && skipped === 0 ? 1 : 0);
}

// ── ORCHESTRATOR: spawn a child per batch. ──
// First drop orphan PNGs — a content-hashed PNG with no matching SVG is a stale card
// from an older data/layout version (the SVG name encodes the card's content). The
// deploy restores dist/og from a cache (see deploy.yml) so only changed cards re-render;
// pruning orphans keeps that cache from accumulating dead images across deploys.
const svgStems = new Set(allSvgs.map((f) => f.replace(/\.svg$/, '')));
let orphans = 0;
for (const f of readdirSync(ogDir)) {
  if (f.endsWith('.png') && !svgStems.has(f.replace(/\.png$/, ''))) {
    unlinkSync(join(ogDir, f));
    orphans += 1;
  }
}
if (orphans > 0) console.log(`rasterize-cards: pruned ${orphans} orphan PNG(s) (no matching SVG).`);

const missing = allSvgs.filter((f) => !existsSync(pngOf(f)));
if (missing.length === 0) {
  console.log(`rasterize-cards: all ${allSvgs.length} cards already rasterized — nothing to do.`);
  process.exit(0);
}

const batches = Math.ceil(allSvgs.length / BATCH);
console.log(
  `rasterize-cards: ${missing.length} of ${allSvgs.length} cards need rendering; ` +
  `processing in ${batches} process-isolated batch(es) of ${BATCH} to bound memory.`,
);

const selfPath = fileURLToPath(import.meta.url);
for (let start = 0; start < allSvgs.length; start += BATCH) {
  const result = spawnSync(process.execPath, ['--expose-gc', selfPath], {
    env: { ...process.env, RASTERIZE_BATCH: `${start}:${BATCH}` },
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`rasterize-cards: failed to spawn batch at ${start}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    // A non-zero child means either a systemic render failure or the child was killed
    // (e.g. OOM/signal) — fail loudly rather than ship a half-rasterized site.
    console.error(`rasterize-cards: batch starting at ${start} exited with ${result.status ?? result.signal}.`);
    process.exit(1);
  }
}

const stillMissing = allSvgs.filter((f) => !existsSync(pngOf(f))).length;
console.log(`rasterize-cards: done across ${batches} batch(es); ${stillMissing} card(s) still missing a PNG.`);
