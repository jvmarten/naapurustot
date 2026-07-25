import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs build script with no type declarations
import { ALLOWLIST, collectAdvisories, evaluateAudit } from '../../scripts/check-audit.mjs';

/**
 * Tests for the npm audit gate (scripts/check-audit.mjs).
 *
 * The gate replaces a bare `npm audit --audit-level=high` in ci.yml + auto-merge.yml,
 * so its allowlist is the only thing standing between "reviewed, expiring exemption"
 * and "high-severity advisories silently ignored". These pin that behaviour.
 */

/** A minimal `npm audit --json` report carrying the given advisories. */
function report(...advisories: { pkg: string; severity: string; ghsa: string; range?: string }[]) {
  const vulnerabilities: Record<string, unknown> = {};
  for (const a of advisories) {
    vulnerabilities[a.pkg] = {
      severity: a.severity,
      via: [
        {
          source: 1234567,
          name: a.pkg,
          dependency: a.pkg,
          title: `${a.pkg} advisory`,
          severity: a.severity,
          range: a.range ?? '<1.0.0',
          url: `https://github.com/advisories/${a.ghsa}`,
        },
      ],
    };
  }
  return { vulnerabilities };
}

const TODAY = '2026-07-25';

describe('collectAdvisories', () => {
  it('keys advisories by GHSA id and ignores anything below high', () => {
    const found = collectAdvisories(
      report(
        { pkg: 'left-pad', severity: 'high', ghsa: 'GHSA-aaaa-bbbb-cccc' },
        { pkg: 'lodash', severity: 'moderate', ghsa: 'GHSA-dddd-eeee-ffff' },
        { pkg: 'tar', severity: 'critical', ghsa: 'GHSA-gggg-hhhh-iiii' },
      ),
    );
    expect(found.map((f: { id: string }) => f.id).sort()).toEqual(['GHSA-aaaa-bbbb-cccc', 'GHSA-gggg-hhhh-iiii']);
  });

  it('deduplicates one advisory reported through several packages', () => {
    const r = report(
      { pkg: 'react-router', severity: 'high', ghsa: 'GHSA-qwww-vcr4-c8h2' },
      { pkg: 'react-router-dom', severity: 'high', ghsa: 'GHSA-qwww-vcr4-c8h2' },
    );
    expect(collectAdvisories(r)).toHaveLength(1);
  });

  it('tolerates an empty or malformed report', () => {
    expect(collectAdvisories({})).toEqual([]);
    expect(collectAdvisories({ vulnerabilities: { x: {} } })).toEqual([]);
  });
});

describe('evaluateAudit', () => {
  it('blocks any high advisory that is not allowlisted', () => {
    const result = evaluateAudit(report({ pkg: 'left-pad', severity: 'high', ghsa: 'GHSA-new-0000-0000' }), ALLOWLIST, TODAY);
    expect(result.ok).toBe(false);
    expect(result.blocking.map((b: { id: string }) => b.id)).toEqual(['GHSA-new-0000-0000']);
  });

  it('passes a clean report', () => {
    expect(evaluateAudit(report(), ALLOWLIST, TODAY).ok).toBe(true);
  });

  it('allows an in-date allowlisted advisory and surfaces its reason', () => {
    const list = [{ id: 'GHSA-qwww-vcr4-c8h2', package: 'react-router', scope: '.', until: '2026-10-31', reason: 'RSC mode unused' }];
    const result = evaluateAudit(report({ pkg: 'react-router', severity: 'high', ghsa: 'GHSA-qwww-vcr4-c8h2' }), list, TODAY);
    expect(result.ok).toBe(true);
    expect(result.allowed).toHaveLength(1);
    expect(result.allowed[0].reason).toBe('RSC mode unused');
  });

  it('fails once an exemption expires, so it cannot become permanent', () => {
    const list = [{ id: 'GHSA-qwww-vcr4-c8h2', package: 'react-router', scope: '.', until: '2026-07-24', reason: 'RSC mode unused' }];
    const result = evaluateAudit(report({ pkg: 'react-router', severity: 'high', ghsa: 'GHSA-qwww-vcr4-c8h2' }), list, TODAY);
    expect(result.ok).toBe(false);
    expect(result.expired.map((e: { id: string }) => e.id)).toEqual(['GHSA-qwww-vcr4-c8h2']);
  });

  it('reports an unmatched entry as stale without failing (upstream shipped a fix)', () => {
    const list = [{ id: 'GHSA-gone-0000-0000', package: 'left-pad', scope: '.', until: '2026-10-31', reason: 'fixed upstream?' }];
    const result = evaluateAudit(report(), list, TODAY);
    expect(result.ok).toBe(true);
    expect(result.stale.map((s: { id: string }) => s.id)).toEqual(['GHSA-gone-0000-0000']);
  });

  it('ignores entries scoped to another tree, and does not call them stale there', () => {
    const list = [{ id: 'GHSA-qwww-vcr4-c8h2', package: 'react-router', scope: '.', until: '2026-10-31', reason: 'frontend only' }];
    const inServer = evaluateAudit(report({ pkg: 'react-router', severity: 'high', ghsa: 'GHSA-qwww-vcr4-c8h2' }), list, TODAY, 'server/api');
    expect(inServer.ok).toBe(false); // not exempt outside its scope
    expect(inServer.stale).toEqual([]);
    expect(evaluateAudit(report(), list, TODAY, 'server/api').stale).toEqual([]);
  });
});

describe('the committed ALLOWLIST', () => {
  it('gives every entry an id, package, scope, reason and future-dated expiry', () => {
    for (const entry of ALLOWLIST) {
      expect(entry.id).toMatch(/^GHSA-/);
      expect(entry.package).toBeTruthy();
      expect(['.', 'server/api']).toContain(entry.scope ?? '.');
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(entry.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('stays small — every entry is a high advisory we chose to carry', () => {
    expect(ALLOWLIST.length).toBeLessThanOrEqual(3);
  });
});
