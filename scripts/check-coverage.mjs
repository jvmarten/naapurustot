#!/usr/bin/env node
// IN-5: test-coverage ratchet gate.
//
// Reads the v8 coverage summary produced by `vitest run --coverage`
// (coverage/coverage-summary.json) and compares the four headline totals against
// the committed coverage-baseline.json. Fails (exit 1) if any metric falls more
// than TOLERANCE percentage points below its baseline, so hard-won coverage can
// never silently regress — but unrelated work is not blocked by sub-noise jitter.
//
// The gate only ratchets DOWNWARD protection: it never demands an increase. When
// coverage genuinely improves, bump coverage-baseline.json to lock the gain in.
//
// Writes a Markdown table to $GITHUB_STEP_SUMMARY when present (mirrors the
// existing bundle-size report), and always prints a plain summary to stdout.

import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Allow a slightly larger drift than pure noise, since v8 line/branch attribution
// can shift by a fraction when unrelated files change. Anything beyond this is a
// real regression worth a human look.
const TOLERANCE = 0.5;

const METRICS = ['statements', 'branches', 'functions', 'lines'];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

let summary;
try {
  summary = readJson(resolve(repoRoot, 'coverage', 'coverage-summary.json'));
} catch {
  console.error('::error::coverage/coverage-summary.json not found — run `vitest run --coverage` first.');
  process.exit(1);
}

const baseline = readJson(resolve(repoRoot, 'coverage-baseline.json'));
const total = summary.total;

const rows = [];
let failed = false;
for (const m of METRICS) {
  const current = total[m].pct;
  const base = baseline[m];
  const floor = base - TOLERANCE;
  const ok = current >= floor;
  if (!ok) failed = true;
  rows.push({ metric: m, current, base, floor, ok });
}

// Plain stdout report
console.log('Coverage ratchet (tolerance ' + TOLERANCE + ' pp):');
for (const r of rows) {
  const status = r.ok ? 'OK' : 'FAIL';
  console.log(
    `  ${r.metric.padEnd(11)} current ${r.current.toFixed(2)}%  baseline ${r.base.toFixed(2)}%  floor ${r.floor.toFixed(2)}%  [${status}]`,
  );
}

// GitHub step summary
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### 🧪 Coverage Ratchet',
    '',
    `Tolerance: ${TOLERANCE} pp below baseline. Raise \`coverage-baseline.json\` to lock in gains.`,
    '',
    '| Metric | Current | Baseline | Floor | Status |',
    '|--------|---------|----------|-------|--------|',
    ...rows.map(
      (r) =>
        `| ${r.metric} | ${r.current.toFixed(2)}% | ${r.base.toFixed(2)}% | ${r.floor.toFixed(2)}% | ${r.ok ? '✅' : '❌'} |`,
    ),
    '',
  ];
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  } catch {
    /* non-fatal */
  }
}

if (failed) {
  for (const r of rows.filter((x) => !x.ok)) {
    console.error(
      `::error::Coverage for ${r.metric} dropped to ${r.current.toFixed(2)}% (baseline ${r.base.toFixed(2)}%, floor ${r.floor.toFixed(2)}%). Add tests or, if intentional, update coverage-baseline.json.`,
    );
  }
  process.exit(1);
}

console.log('\nCoverage ratchet passed — no metric regressed beyond tolerance.');
