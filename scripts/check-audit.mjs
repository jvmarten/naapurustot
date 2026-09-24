#!/usr/bin/env node
/**
 * `npm audit` gate with an explicit, expiring allowlist.
 *
 * Replaces a bare `npm audit --audit-level=high` in CI. The bare command has no way
 * to say "this high advisory does not apply to us", so a single unfixable-in-major
 * advisory blocks every merge until someone takes a major-version bump they would
 * not otherwise take — which is exactly what CLAUDE.md warns against ("Don't jump a
 * major (it can break the parent)"). The escape hatch is deliberately narrow:
 *
 *   - Only the advisories listed in ALLOWLIST below are tolerated, by GHSA id.
 *   - Each entry carries the reason it does not apply to this codebase and an
 *     `until` date. Past that date the gate FAILS even though the entry exists, so
 *     an exemption cannot quietly become permanent.
 *   - Anything else at high/critical fails the gate, exactly as before.
 *   - An entry that no longer matches any advisory warns (upstream shipped a fix →
 *     delete the entry); it never fails, so a fix landing upstream cannot break CI.
 *
 * Usage: node scripts/check-audit.mjs [directory]   (default: repo root)
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FAIL_LEVELS = new Set(['high', 'critical']);

/**
 * Advisories we have reviewed and accepted, keyed by GHSA id.
 *
 * `until` is an ISO date: the exemption expires and the gate starts failing, forcing
 * a re-review (by then the upstream fix is usually reachable without a major bump).
 * `scope` is the directory the entry applies to ('.' for the frontend, 'server/api'
 * for the API), so an entry is never reported stale in a tree it was never about.
 */
export const ALLOWLIST = [
  {
    id: 'GHSA-qwww-vcr4-c8h2',
    package: 'react-router',
    scope: '.',
    until: '2026-10-31',
    reason:
      'RSC Mode CSRF Bypass. Only reachable through React Router\'s RSC mode: it lets an ' +
      'action run before the framework returns 400 on a cross-origin request. This app is a ' +
      'static SPA — main.tsx mounts a plain <BrowserRouter> with declarative <Route> elements, ' +
      'there is no server request handler, no RSC, no actions, and no framework mode. The fix ' +
      'ships only in react-router 8.3.0, and react-router-dom has no 8.x release at all (latest ' +
      '7.18.1), so clearing it means migrating every import off react-router-dom onto ' +
      'react-router@8 — a routing major bump for a vulnerability we cannot reach. The two ' +
      'react-router advisories that DO touch a declarative SPA (route-matching DoS ' +
      'GHSA-chx6-hx7r-mcp5, open redirect / deserializeErrors) are fixed in 7.18.0 and taken.',
  },
  {
    id: 'GHSA-jrc7-96c5-q579',
    package: 'maplibre-gl',
    scope: '.',
    until: '2026-11-30',
    reason:
      'XSS sanitizer bypass in MapLibre\'s internal DOM.sanitize(). In maplibre-gl 5.x its only ' +
      'caller is AttributionControl, which sanitizes the map sources\' attribution HTML before ' +
      'setting innerHTML. What reaches it here: our constant BASEMAP_ATTRIBUTION (utils/basemap.ts) ' +
      'and the attribution field of the OpenFreeMap TileJSON for the basemap vector source. Every ' +
      'app-added source (postal areas, grids, planning, /live/ rasters) sets no attribution, and no ' +
      'user- or URL-controlled string is ever passed to a source or the control. Exploiting it would ' +
      'therefore need a compromise of tiles.openfreemap.org (or of the build-time basemap style URL) — ' +
      'a residual supply-chain risk, not a reachable input. The fix exists only in maplibre-gl ' +
      '6.4.1+, a major bump of the map library behind every view (and the /live/ app) that also ' +
      'retires the 5.18–5.24 query regression worked around in utils/mapQuery.ts. The short `until` ' +
      'is deliberate: it forces that migration rather than letting this exemption drift.',
  },
];

/** Run `npm audit --json` in `cwd`. Exits non-zero when vulnerabilities exist, so the
 *  error path still carries the JSON report on stdout. */
export function runAudit(cwd) {
  try {
    return JSON.parse(execFileSync('npm', ['audit', '--json'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

/** Every distinct high/critical advisory in an `npm audit --json` report. */
export function collectAdvisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || !FAIL_LEVELS.has(via.severity)) continue;
      // `url` is the canonical GitHub advisory link; its last path segment is the GHSA id.
      const id = String(via.url ?? '').split('/').filter(Boolean).pop() ?? `npm-${via.source}`;
      if (!found.has(id)) {
        found.set(id, { id, package: via.dependency ?? via.name, title: via.title, range: via.range, severity: via.severity });
      }
    }
  }
  return [...found.values()];
}

/**
 * Split the advisories found into what fails the gate and what is allowed, and report
 * allowlist entries that are stale (no longer matched) or expired.
 *
 * @param {object} report      parsed `npm audit --json`
 * @param {Array}  allowlist   ALLOWLIST entries
 * @param {string} today       ISO date (YYYY-MM-DD) to evaluate `until` against
 * @param {string} [scope]     directory being audited; entries scoped elsewhere are ignored
 */
export function evaluateAudit(report, allowlist, today, scope = '.') {
  const inScope = allowlist.filter((e) => (e.scope ?? '.') === scope);
  const entries = new Map(inScope.map((e) => [e.id, e]));
  const blocking = [];
  const allowed = [];
  const expired = [];
  for (const adv of collectAdvisories(report)) {
    const entry = entries.get(adv.id);
    if (!entry) { blocking.push(adv); continue; }
    if (entry.until && entry.until < today) { expired.push({ ...adv, until: entry.until }); blocking.push(adv); continue; }
    allowed.push({ ...adv, until: entry.until, reason: entry.reason });
  }
  const matched = new Set([...allowed, ...expired].map((a) => a.id));
  const stale = inScope.filter((e) => !matched.has(e.id));
  return { blocking, allowed, expired, stale, ok: blocking.length === 0 };
}

// ── CLI ──
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const where = process.argv[2] ?? '.';
  const cwd = where === '.' ? root : join(root, where);
  // Derived from the clock, not from committed data: an expiry is about wall-clock
  // review time, and this gate writes no artifact (nothing to keep reproducible).
  const today = new Date().toISOString().slice(0, 10);
  const result = evaluateAudit(runAudit(cwd), ALLOWLIST, today, where);

  for (const a of result.allowed) {
    console.log(`::warning::[${where}] allowlisted until ${a.until}: ${a.id} (${a.package}) — ${a.title}`);
  }
  for (const e of result.stale) {
    console.log(`::warning::[${where}] allowlist entry ${e.id} (${e.package}) matches no current advisory — upstream fixed it? Remove the entry.`);
  }
  for (const e of result.expired) {
    console.log(`::error::[${where}] allowlist entry ${e.id} EXPIRED on ${e.until} — re-review it or take the fix.`);
  }
  for (const a of result.blocking) {
    console.log(`::error::[${where}] ${a.severity} advisory not allowlisted: ${a.id} (${a.package} ${a.range}) — ${a.title}`);
  }

  if (!result.ok) {
    console.error(`\nnpm audit gate FAILED for ${where}: ${result.blocking.length} high/critical advisor${result.blocking.length === 1 ? 'y' : 'ies'} to address.`);
    console.error('Fix by pinning the offending package in the root package.json "overrides" to the first patched');
    console.error('version its parents can load, or — if it genuinely cannot apply here — add a reviewed entry to');
    console.error('ALLOWLIST in scripts/check-audit.mjs with a reason and an `until` date.');
    process.exit(1);
  }
  console.log(`npm audit gate passed for ${where} (${result.allowed.length} reviewed exemption${result.allowed.length === 1 ? '' : 's'}, 0 blocking).`);
}
