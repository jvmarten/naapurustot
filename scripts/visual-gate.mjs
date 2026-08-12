#!/usr/bin/env node
/**
 * Run the Playwright visual-regression project as a REAL gate.
 *
 * This exists because the previous inline workflow logic could not fail. It was:
 *
 *     if ls "$SNAP_DIR"/*-visual-linux.png; then npm run test:visual
 *     else npm run test:visual -- --update-snapshots || true; npm run test:visual; fi
 *
 * The only committed baselines are `*-visual-win32.png`, and CI runs on ubuntu — so the
 * `else` branch fired on every run: it generated fresh baselines from the build under
 * test, then "compared" that build against the images it had just taken of it. It passed
 * unconditionally, and reported as a green visual-regression check. The choropleth — the
 * core of the product — has therefore never once been compared to a known-good image,
 * which is why "all Finland shows no data" reached production twice and was caught by a
 * human rather than by CI.
 *
 * Two modes, and no third:
 *
 *   baselines present -> compare, and exit non-zero on any diff.
 *   baselines absent  -> generate them, tell the caller to commit them, exit non-zero.
 *
 * The absent case deliberately FAILS rather than passing quietly. A seeding run has
 * verified nothing, and the whole defect being fixed here is a check that reported
 * success without having looked at anything. The generated PNGs are uploaded by the
 * workflow as an artifact so the seed is one download-and-commit away.
 *
 * Baselines are platform-specific (Playwright suffixes the renderer platform) and must
 * be generated on the SAME platform + browser build as CI. Do not commit baselines
 * produced on a developer machine or in a container whose Chromium differs from the
 * runner's — antialiasing alone will exceed the diff threshold and the gate becomes
 * permanently red, which ends with someone disabling it again.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const SNAP_DIR = 'e2e/visual/visual-regression.spec.ts-snapshots';
// Playwright's platform token, matching how it names <snapshot>-<project>-<platform>.png.
const PLATFORM = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
const SUFFIX = `-visual-${PLATFORM}.png`;

function summary(md) {
  process.stdout.write(`${md}\n`);
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) { try { appendFileSync(f, `${md}\n`); } catch { /* summary is best-effort */ } }
}

const baselines = existsSync(SNAP_DIR)
  ? readdirSync(SNAP_DIR).filter((n) => n.endsWith(SUFFIX))
  : [];

function runPlaywright(extraArgs) {
  const args = ['playwright', 'test', '--project=visual', ...extraArgs];
  return spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
}

if (baselines.length === 0) {
  summary(`### Visual regression: SEEDED, NOT VERIFIED\n`);
  summary(
    `No \`*${SUFFIX}\` baselines are committed, so this run compared nothing. ` +
    `Generating them now and failing on purpose — a run that has not compared against a ` +
    `known-good image must not report success.`,
  );
  const gen = runPlaywright(['--update-snapshots']);
  if (gen.status !== 0) {
    summary(`\nBaseline generation itself failed (exit ${gen.status}). Fix that first.`);
    process.exit(gen.status ?? 1);
  }
  const made = existsSync(SNAP_DIR) ? readdirSync(SNAP_DIR).filter((n) => n.endsWith(SUFFIX)) : [];
  summary(`\nGenerated ${made.length} baseline(s) for \`${PLATFORM}\`:\n`);
  for (const n of made) summary(`- \`${join(SNAP_DIR, n)}\``);
  summary(
    `\n**To arm the gate:** download the \`visual-regression-diffs\` artifact from this run, ` +
    `commit these files, and push. The next run compares against them and fails on a real diff.`,
  );
  process.exit(1);
}

summary(`Visual regression: comparing against ${baselines.length} committed \`${PLATFORM}\` baseline(s).`);
const res = runPlaywright([]);
process.exit(res.status ?? 1);
