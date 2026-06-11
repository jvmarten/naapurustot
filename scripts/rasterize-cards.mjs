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
 * "system-ui, sans-serif"; loadSystemFonts pulls the runner's DejaVu/Liberation
 * (covering ä/ö/å) — deploy.yml installs fonts-dejavu-core to guarantee availability.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const ogDir = resolve(import.meta.dirname, '..', 'dist', 'og');
if (!existsSync(ogDir)) {
  console.log('rasterize-cards: dist/og/ not found — nothing to do (run build:pages first).');
  process.exit(0);
}

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
      font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
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
