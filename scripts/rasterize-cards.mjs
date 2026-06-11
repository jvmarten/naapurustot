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
 * @resvg/resvg-js is a native module (devDependency). Fonts: the card uses
 * "system-ui, sans-serif". We load a SMALL FIXED font set (DejaVu Sans regular + bold,
 * covering Latin + ä/ö/å) ONCE into buffers and reuse them for every card. The earlier
 * per-card `loadSystemFonts: true` rebuilt the runner's entire font database (hundreds
 * of MB) on every one of ~9,000 cards, which OOM-killed the GitHub Pages deploy
 * ("The operation was canceled") — deploy.yml installs fonts-dejavu-core for the paths
 * below. A one-time system-font fallback covers local runs lacking those files.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const ogDir = resolve(import.meta.dirname, '..', 'dist', 'og');
if (!existsSync(ogDir)) {
  console.log('rasterize-cards: dist/og/ not found — nothing to do (run build:pages first).');
  process.exit(0);
}

// Load the two DejaVu faces once. Reusing buffers across cards keeps each Resvg's
// font DB to ~2 small files instead of re-scanning the whole system tree per card.
const FONT_PATHS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];
const fontBuffers = FONT_PATHS.filter(existsSync).map((p) => readFileSync(p));
// Only fall back to a (one-time) system scan when the bundled fonts are absent, e.g.
// a local dev run without fonts-dejavu-core — never per card on the deploy runner.
const fontOption = fontBuffers.length > 0
  ? { loadSystemFonts: false, fontBuffers, defaultFontFamily: 'DejaVu Sans' }
  : { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' };
console.log(
  fontBuffers.length > 0
    ? `rasterize-cards: using ${fontBuffers.length} bundled font face(s) (no system-font scan).`
    : 'rasterize-cards: bundled DejaVu fonts not found — falling back to a one-time system-font scan.',
);

const svgs = readdirSync(ogDir).filter((f) => f.endsWith('.svg'));
let rendered = 0;
let skipped = 0;
let failed = 0;

for (const svgFile of svgs) {
  const pngFile = svgFile.replace(/\.svg$/, '.png');
  const pngPath = join(ogDir, pngFile);
  if (existsSync(pngPath)) {
    skipped += 1; // content-hashed name → already up to date
    continue;
  }
  try {
    const svg = readFileSync(join(ogDir, svgFile), 'utf-8');
    const resvg = new Resvg(svg, {
      // The og:image dimensions are fixed at 1200×630 by the SVG itself.
      font: fontOption,
    });
    writeFileSync(pngPath, resvg.render().asPng());
    rendered += 1;
  } catch (err) {
    failed += 1;
    console.warn(`  failed to rasterize ${svgFile}: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`rasterize-cards: ${rendered} rendered, ${skipped} up-to-date, ${failed} failed (of ${svgs.length} SVGs).`);
if (failed > 0 && rendered === 0 && svgs.length > 0) process.exit(1);
