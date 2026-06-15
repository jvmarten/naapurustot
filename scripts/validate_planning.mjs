#!/usr/bin/env node
/**
 * IN-8: planning-data integrity & freshness guard.
 *
 * The kaavat & hankkeet pipeline (IN-1) deliberately keeps planning OUT of the
 * metrics registry, so the data-quality coverage-regression guard never sees it.
 * The city WFS feeds are the product's flakiest inputs — layer names drift and
 * servers go down — and a silent fetch failure would drop a city's plans behind
 * the gray fallback while the "tilanne <snapshot>" caption keeps claiming
 * freshness. This script is the planning analog of check_coverage_regression:
 *
 *  1. PRESENCE GUARD — fail the refresh when a city that had plans in the
 *     committed baseline now resolves to zero, or when the national Väylä feed
 *     collapses to zero. `--write-baseline` records the current state as the new
 *     baseline (the escape hatch for an intentional coverage change).
 *  2. FRESHNESS — on a real refresh (new snapshot), append a "Kaavat ja hankkeet
 *     päivitetty" entry to data_updates.json so the PO-5 Atom feed surfaces it as
 *     a re-engagement signal. Deduped by the feed entry id.
 *
 * Run in the data-refresh workflow after build:data. Zero client bundle bytes.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = resolve(ROOT, 'src', 'data', 'planning_manifest.json');
const BASELINE = resolve(ROOT, 'src', 'data', 'planning_baseline.json');
const UPDATES = resolve(ROOT, 'src', 'data', 'data_updates.json');
const writeBaseline = process.argv.includes('--write-baseline');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
const current = {
  snapshot: manifest.snapshot ?? '',
  cities: manifest.plans?.cities ?? [],
  plansTotal: manifest.plans?.total ?? 0,
  projectsTotal: manifest.projects?.total ?? 0,
};

if (writeBaseline) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      { cities: current.cities, plansTotal: current.plansTotal, projectsTotal: current.projectsTotal },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `planning baseline written: ${current.cities.length} cities, ` +
      `${current.plansTotal} plans, ${current.projectsTotal} projects.`,
  );
  process.exit(0);
}

// 1 — presence guard
const errors = [];
if (existsSync(BASELINE)) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf-8'));
  const missing = (base.cities ?? []).filter((c) => !current.cities.includes(c));
  if (missing.length) {
    errors.push(`cities that had plans now return nothing: ${missing.join(', ')} (feed drift/outage?)`);
  }
  if ((base.projectsTotal ?? 0) > 0 && current.projectsTotal === 0) {
    errors.push('national Väylä projects collapsed to zero (the OGC feed is likely down)');
  }
  if ((base.plansTotal ?? 0) > 0 && current.plansTotal === 0) {
    errors.push('all municipal plans collapsed to zero');
  }
} else {
  console.warn('no planning_baseline.json — run with --write-baseline to create it; skipping regression checks.');
}
if (errors.length) {
  console.error('::error::Planning data regression:\n  ' + errors.join('\n  '));
  process.exit(1);
}

// 2 — freshness feed entry (deduped by id: date:metric:type)
const updates = existsSync(UPDATES) ? JSON.parse(readFileSync(UPDATES, 'utf-8')) : [];
const idOf = (u) => `${u.date}:${u.metric}:${u.type}`;
const entry = {
  date: current.snapshot,
  metric: 'kaavat_hankkeet',
  type: 'planning',
  title: `Kaavat ja hankkeet päivitetty (${current.cities.length} kuntaa, tilanne ${current.snapshot})`,
};
if (current.snapshot && !updates.some((u) => idOf(u) === idOf(entry))) {
  updates.unshift(entry);
  writeFileSync(UPDATES, JSON.stringify(updates, null, 2) + '\n');
  console.log(`appended planning refresh entry to data_updates.json (${current.snapshot}).`);
}

console.log(
  `planning OK: ${current.cities.length} cities, ${current.plansTotal} plans, ` +
    `${current.projectsTotal} projects, snapshot ${current.snapshot}.`,
);
