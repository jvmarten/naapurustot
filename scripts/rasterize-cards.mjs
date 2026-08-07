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
 * When the PNGs are in place the SVGs are DELETED: they are this script's input, not a
 * published asset, and leaving them in dist/og put ~9,000 needless files into every Pages
 * upload and into the cache deploy.yml saves from that directory.
 *
 * MEMORY: rendering ~9,000 cards in ONE long-lived process OOM-killed the deploy
 * ("The operation was canceled" ~6 min in) — each `new Resvg(...)` allocates a native
 * font DB + a 1200×630 RGBA pixmap, and those native allocations accumulate faster than
 * GC reclaims them. (An earlier fix removed a far worse cost — a per-card
 * `loadSystemFonts: true` that rescanned the runner's whole font tree every iteration —
 * but the residual per-card native growth still exhausted the runner.) So this script
 * runs as an ORCHESTRATOR that rasterizes the cards in fixed-size batches, each in a
 * fresh CHILD process that exits when its batch is done: the OS reclaims all native
 * memory between batches, bounding peak RSS regardless of any native leak. Each child
 * also runs under --expose-gc and forces a GC periodically as a second line of defense.
 * Batches run one per core, with the batch size scaled down so the total peak matches
 * what a single batch used to cost (see CONCURRENCY/BATCH below).
 * Set RASTERIZE_BATCH=<start>:<count> to invoke the worker path directly;
 * RASTERIZE_CONCURRENCY and RASTERIZE_BATCH_SIZE override the derived values.
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
import { spawn } from 'node:child_process';
import os from 'node:os';
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

// Batches run CONCURRENTLY, one child per core. The batching exists to bound memory (see
// MEMORY above); it used to also serialise the work — a `spawnSync` loop that left every
// core but one idle, so a cold rasterize of all 9,261 cards took ~15 min against the build
// job's timeout. Fanning it across the runner's 4 vCPUs cuts that to ~4 min.
//
// Concurrency must not buy speed with the OOM this script was written to avoid, so the
// batch size shrinks as concurrency grows to hold the TOTAL peak constant. Measured on a
// 4-core runner-equivalent box (peak RSS via /proc/<pid>/status VmHWM, cold batches):
//
//     50 cards → 318 MiB   100 → 433 MiB   200 → 797 MiB   400 → 1388 MiB
//
// i.e. ~200 MiB of fixed per-process cost (node + the DejaVu font buffers) plus ~3 MiB per
// card — one 1200×630 RGBA pixmap that the native allocator does not hand back. The fixed
// cost does NOT divide across workers, so P workers of B cards peak at P×(200 + 3B) MiB.
// Solving that against today's proven-safe 1388 MiB single-batch peak gives B below, and
// the arithmetic degenerates to exactly the old behaviour (1 worker × 400 cards) on a
// single-core machine. Holding the peak works out to ~1400 MiB at 1, 2 and 4 workers
// (the ubuntu-latest runner is 4 vCPU / 16 GB, so 4 is the case that matters). Past ~5
// workers the fixed per-process cost alone exceeds the budget and the BATCH floor takes
// over instead: 8 workers peak at ~2.2 GB, still a small fraction of any box with that
// many cores.
const PEAK_BUDGET_MIB = 1400; // today's measured peak — deliberately NOT raised
const WORKER_BASE_MIB = 200; // node + font buffers, per child
const PER_CARD_MIB = 3; // 1200×630 RGBA pixmap the native allocator retains
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const CONCURRENCY =
  Number(process.env.RASTERIZE_CONCURRENCY) ||
  clamp(os.availableParallelism?.() ?? os.cpus().length, 1, 8);

// Cards per child process. Overridable for tests.
const BATCH =
  Number(process.env.RASTERIZE_BATCH_SIZE) ||
  clamp(Math.floor((PEAK_BUDGET_MIB / CONCURRENCY - WORKER_BASE_MIB) / PER_CARD_MIB), 25, 400);

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
// Guard first: with no SVGs present every PNG looks like an orphan and the prune below
// would wipe the whole rasterized set. That only happens when this script is re-run after
// it has already dropped the SVGs (see dropSvgs), so treat it as a no-op.
if (allSvgs.length === 0) {
  console.log('rasterize-cards: no card SVGs in dist/og/ — nothing to do (already rasterized?).');
  process.exit(0);
}

// Then drop orphan PNGs — a content-hashed PNG with no matching SVG is a stale card from
// an older data/layout version (the SVG name encodes the card's content). The deploy
// restores dist/og from a cache (see deploy.yml) so only changed cards re-render; pruning
// orphans keeps that cache from accumulating dead images across deploys. This only
// collects because prerender-hubs.mjs clears the cache-restored SVGs before emitting the
// current set — otherwise a stale SVG shields its stale PNG from this loop forever.
const svgStems = new Set(allSvgs.map((f) => f.replace(/\.svg$/, '')));
let orphans = 0;
for (const f of readdirSync(ogDir)) {
  if (f.endsWith('.png') && !svgStems.has(f.replace(/\.png$/, ''))) {
    unlinkSync(join(ogDir, f));
    orphans += 1;
  }
}
if (orphans > 0) console.log(`rasterize-cards: pruned ${orphans} orphan PNG(s) (no matching SVG).`);

// The SVGs are this script's INPUT, never a published asset — prerender.mjs and
// prerender-hubs.mjs both point og:image/twitter:image at the .png sibling, and nothing
// in src/ fetches /og/*.svg. Dropping them once the PNGs exist keeps ~9,000 files out of
// BOTH the Pages upload and the dist/og cache that deploy.yml saves from this very
// directory — so the cache carries PNGs only and each deploy's SVG set is exactly what
// that build emitted. Pages sync cost scales with file count, which is what pushed the
// deployment past deploy-pages' timeout.
function dropSvgs() {
  let dropped = 0;
  for (const f of allSvgs) {
    try {
      unlinkSync(join(ogDir, f));
      dropped += 1;
    } catch {
      // Already gone — nothing to do.
    }
  }
  if (dropped > 0) console.log(`rasterize-cards: dropped ${dropped} card SVG(s) (build inputs, not published).`);
}

const missing = allSvgs.filter((f) => !existsSync(pngOf(f)));
if (missing.length === 0) {
  console.log(`rasterize-cards: all ${allSvgs.length} cards already rasterized — nothing to do.`);
  dropSvgs();
  process.exit(0);
}

const starts = [];
for (let start = 0; start < allSvgs.length; start += BATCH) starts.push(start);
const batches = starts.length;
console.log(
  `rasterize-cards: ${missing.length} of ${allSvgs.length} cards need rendering; ` +
  `processing in ${batches} process-isolated batch(es) of ${BATCH} across ${CONCURRENCY} worker(s) ` +
  `(peak ≈ ${CONCURRENCY * (WORKER_BASE_MIB + PER_CARD_MIB * BATCH)} MiB).`,
);

const selfPath = fileURLToPath(import.meta.url);

/** Run one batch in a child that exits when done, freeing its native memory. */
function runBatch(start) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--expose-gc', selfPath], {
      env: { ...process.env, RASTERIZE_BATCH: `${start}:${BATCH}` },
      stdio: 'inherit',
    });
    // Each child prints a single line when its batch finishes, so 'inherit' across
    // concurrent workers interleaves whole lines rather than fragments.
    child.on('error', (error) => resolve({ start, error }));
    child.on('close', (code, signal) => resolve({ start, code, signal }));
  });
}

// Pull batches off a shared queue: uneven batch durations can't leave a worker idle the
// way a fixed per-worker partition would.
let nextBatch = 0;
let failure = null;
async function worker() {
  while (nextBatch < starts.length && failure === null) {
    const start = starts[nextBatch++];
    const result = await runBatch(start);
    if (result.error) {
      failure = `failed to spawn batch at ${result.start}: ${result.error.message}`;
    } else if (result.code !== 0) {
      // A non-zero child means either a systemic render failure or the child was killed
      // (e.g. OOM/signal) — fail loudly rather than ship a half-rasterized site. Workers
      // stop pulling new batches, but those already in flight are awaited below.
      failure = `batch starting at ${result.start} exited with ${result.code ?? result.signal}`;
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, starts.length) }, worker));
if (failure !== null) {
  console.error(`rasterize-cards: ${failure}.`);
  process.exit(1);
}

const stillMissing = allSvgs.filter((f) => !existsSync(pngOf(f))).length;
console.log(`rasterize-cards: done across ${batches} batch(es); ${stillMissing} card(s) still missing a PNG.`);
dropSvgs();
