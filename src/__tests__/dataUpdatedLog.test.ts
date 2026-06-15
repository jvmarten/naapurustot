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
import fiExtra from '../locales/fi-extra.json';
import en from '../locales/en.json';
import sv from '../locales/sv.json';
// @ts-expect-error — plain .mjs build helper with no type declarations
import { computeDataUpdateEvents, mergeDataUpdates } from '../../scripts/lib/data-updates.mjs';

type Dict = Record<string, string>;
// IN-7: the PO-15 sources.* keys moved to fi-extra.json; merge it into the fi
// dict so the parity check below sees them (prerender does the same merge).
const LOCALES: Record<string, Dict> = {
  fi: { ...(fi as Dict), ...(fiExtra as Dict) },
  en: en as Dict,
  sv: sv as Dict,
};

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

describe('PO-5 data-updates changelog (Atom feed source)', () => {
  it('emits a vintage event when a metric is refreshed', () => {
    const events = computeDataUpdateEvents(
      { crime_index: { vintage: 2023, coverage_pct: 80 } },
      { crime_index: { vintage: 2024, coverage_pct: 80 } },
      '2026-06-10',
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ metric: 'crime_index', type: 'vintage', from: 2023, to: 2024, date: '2026-06-10' });
    expect(events[0].title).toContain('2024');
  });

  it('emits a coverage event only when coverage shifts >= 0.5pp', () => {
    const big = computeDataUpdateEvents(
      { hr_mtu: { vintage: 2024, coverage_pct: 90.0 } },
      { hr_mtu: { vintage: 2024, coverage_pct: 91.2 } },
      '2026-06-10',
    );
    expect(big).toHaveLength(1);
    expect(big[0].type).toBe('coverage');
    const small = computeDataUpdateEvents(
      { hr_mtu: { vintage: 2024, coverage_pct: 90.0 } },
      { hr_mtu: { vintage: 2024, coverage_pct: 90.3 } },
      '2026-06-10',
    );
    expect(small).toHaveLength(0);
  });

  it('does not emit for a brand-new metric (addition, not a refresh)', () => {
    expect(computeDataUpdateEvents({}, { fresh: { vintage: 2024, coverage_pct: 60 } }, '2026-06-10')).toHaveLength(0);
  });

  it('mergeDataUpdates prepends newest events and bounds the log', () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({ metric: `old${i}` }));
    const merged = mergeDataUpdates(existing, [{ metric: 'new1' }, { metric: 'new2' }], 4);
    expect(merged).toHaveLength(4);
    expect(merged[0].metric).toBe('new1');
    expect(mergeDataUpdates(existing, [])).toBe(existing);
  });
});
