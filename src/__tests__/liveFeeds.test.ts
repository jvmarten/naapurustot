import { describe, it, expect } from 'vitest';
import {
  ALL_FEEDS,
  FEED_GROUPS,
  allLiveFeeds,
  defaultEnabledFeeds,
  sanitizeEnabled,
} from '../live/feeds';

describe('feed registry', () => {
  it('has a unique id for every feed', () => {
    const ids = ALL_FEEDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every feed a label, coverage, time model and status', () => {
    for (const f of ALL_FEEDS) {
      expect(f.labelKey).toMatch(/^live\.feed\./);
      expect(['national', 'urban', 'coastal']).toContain(f.coverage);
      expect(['computed', 'archive', 'forecast', 'modelled', 'recorded', 'schedule', 'validity']).toContain(f.time);
      expect(['live', 'planned']).toContain(f.status);
    }
  });

  it('carries the sea-level feed as a live, coastal, archive feed', () => {
    const sea = ALL_FEEDS.find((f) => f.id === 'sea_level');
    expect(sea).toBeDefined();
    expect(sea!.status).toBe('live');
    expect(sea!.coverage).toBe('coastal');
    expect(sea!.time).toBe('archive');
    expect(sea!.defaultOn).toBe(false);
  });
});

describe('allLiveFeeds', () => {
  it('contains every live feed id and no planned one', () => {
    const all = allLiveFeeds();
    for (const f of ALL_FEEDS) {
      expect(all.has(f.id)).toBe(f.status === 'live');
    }
  });

  it('is a superset of the default-on set — "All" turns on strictly more', () => {
    const all = allLiveFeeds();
    for (const id of defaultEnabledFeeds()) expect(all.has(id)).toBe(true);
    // At least one live feed is off by default, so "All" is a real expansion of
    // "restore defaults", which is the whole reason the button needed fixing.
    expect(all.size).toBeGreaterThan(defaultEnabledFeeds().size);
  });

  it('returns a fresh set each call (the caller mutates it)', () => {
    const a = allLiveFeeds();
    a.delete([...a][0]);
    expect(allLiveFeeds().size).toBe(a.size + 1);
  });
});

describe('defaultEnabledFeeds', () => {
  it('is only live, default-on feeds', () => {
    for (const id of defaultEnabledFeeds()) {
      const f = ALL_FEEDS.find((x) => x.id === id)!;
      expect(f.status).toBe('live');
      expect(f.defaultOn).toBe(true);
    }
  });
});

describe('sanitizeEnabled', () => {
  it('keeps only ids that are real and currently live', () => {
    const cleaned = sanitizeEnabled(['sea_level', 'warnings', 'not_a_feed', 'shadows']);
    expect(cleaned.has('sea_level')).toBe(true); // live
    expect(cleaned.has('shadows')).toBe(true); // live
    expect(cleaned.has('warnings')).toBe(false); // planned
    expect(cleaned.has('not_a_feed')).toBe(false); // gone
  });
});

describe('feed groups', () => {
  it('flattens to exactly the feeds in the groups', () => {
    expect(ALL_FEEDS.length).toBe(FEED_GROUPS.reduce((n, g) => n + g.feeds.length, 0));
  });

  it('gives each group two readable accent inks', () => {
    for (const g of FEED_GROUPS) {
      expect(g.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(g.accentText).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
