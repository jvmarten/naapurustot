/**
 * PO-15: "Data updated" / refresh-log surface on the public Data Sources page.
 *
 * The page (src/pages/DataSourcesPage.tsx) and the prerendered version
 * (scripts/prerender.mjs) render the committed build_metadata provenance as a
 * human, indexable changelog: the prominent `generated` date plus a per-source
 * "newest vintage + layer count" log. These tests pin the two contracts the
 * feature depends on so neither can silently drift:
 *   1. build_metadata.json shape — a parseable `generated` ISO timestamp and
 *      per-metric vintage + coverage_pct.
 *   2. i18n keys exist with the exact {placeholder} tokens the renderers fill.
 * It also reproduces the per-source grouping to lock in its invariants
 * (deduped by source, newest-first, never fabricating a year).
 */
import { describe, it, expect } from 'vitest';
import buildMetadata from '../data/build_metadata.json';
import fi from '../locales/fi.json';
import en from '../locales/en.json';
import sv from '../locales/sv.json';

type Dict = Record<string, string>;
const LOCALES: Record<string, Dict> = { fi: fi as Dict, en: en as Dict, sv: sv as Dict };

interface MetricMeta {
  source: string;
  vintage: number | string;
  coverage_pct?: number;
}
const meta = buildMetadata as { generated: string; metrics: Record<string, MetricMeta> };

describe('PO-15 build_metadata provenance contract', () => {
  it('has a parseable `generated` ISO timestamp', () => {
    expect(typeof meta.generated).toBe('string');
    expect(meta.generated.length).toBeGreaterThan(0);
    expect(Number.isNaN(new Date(meta.generated).getTime())).toBe(false);
  });

  it('carries a vintage and source for every metric (coverage where measured)', () => {
    const entries = Object.entries(meta.metrics);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, m] of entries) {
      expect(m.source, 'metric source').toBeTruthy();
      expect(m.vintage, 'metric vintage').toBeDefined();
      if (m.coverage_pct != null) {
        expect(m.coverage_pct).toBeGreaterThanOrEqual(0);
        expect(m.coverage_pct).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('PO-15 i18n keys', () => {
  const KEYS_WITH_TOKENS: Record<string, string[]> = {
    'sources.updated_heading': [],
    'sources.updated_on': ['date'],
    'sources.updated_intro': [],
    'sources.refresh_log_heading': [],
    'sources.refresh_layers': ['n'],
    'sources.refresh_newest': ['year'],
  };

  const tokens = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

  it.each(Object.keys(LOCALES))('%s defines every PO-15 key with the right placeholders', (lang) => {
    const dict = LOCALES[lang];
    for (const [key, expected] of Object.entries(KEYS_WITH_TOKENS)) {
      const value = dict[key];
      expect(value, `${lang} missing ${key}`).toBeTruthy();
      expect([...tokens(value)].sort(), `${lang} ${key} placeholders`).toEqual([...expected].sort());
    }
  });
});

/** Per-source refresh log, mirroring the grouping in DataSourcesPage.tsx / prerender.mjs. */
function refreshLog(metrics: Record<string, MetricMeta>) {
  const bySource = new Map<string, { source: string; count: number; newest: number | null }>();
  for (const m of Object.values(metrics)) {
    if (!m.source) continue;
    const cur = bySource.get(m.source) ?? { source: m.source, count: 0, newest: null };
    cur.count += 1;
    const years = String(m.vintage ?? '').match(/\d{4}/g);
    const y = years ? Math.max(...years.map(Number)) : null;
    if (y != null && (cur.newest == null || y > cur.newest)) cur.newest = y;
    bySource.set(m.source, cur);
  }
  return [...bySource.values()].sort((a, b) => {
    const ya = a.newest ?? -Infinity;
    const yb = b.newest ?? -Infinity;
    if (yb !== ya) return yb - ya;
    return a.source.localeCompare(b.source);
  });
}

describe('PO-15 per-source refresh log', () => {
  const log = refreshLog(meta.metrics);

  it('produces one entry per distinct source', () => {
    const sources = new Set(Object.values(meta.metrics).map((m) => m.source).filter(Boolean));
    expect(log.length).toBe(sources.size);
    expect(new Set(log.map((r) => r.source)).size).toBe(log.length);
  });

  it('aggregates real layer counts that sum to the sourced metric total', () => {
    const sourced = Object.values(meta.metrics).filter((m) => m.source).length;
    expect(log.reduce((acc, r) => acc + r.count, 0)).toBe(sourced);
  });

  it('is sorted newest-vintage first', () => {
    for (let i = 1; i < log.length; i++) {
      const prev = log[i - 1].newest ?? -Infinity;
      const cur = log[i].newest ?? -Infinity;
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });
});
