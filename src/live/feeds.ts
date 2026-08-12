/**
 * Registry of realtime feeds shown on /live/.
 *
 * The sidebar is generated ENTIRELY from this table — groups, colours, toggles,
 * ordering, the coverage badge — so adding a feed is a data change here plus the
 * three locale keys, never a change to the sidebar component. That is the whole
 * point of the shape: the realtime page is expected to accumulate feeds (weather
 * warnings, live trains, road incidents, transit disruptions, events), and each
 * one arriving should not mean touching UI code.
 *
 * `status` is deliberately part of the model rather than something the UI infers.
 * A feed that is listed but not yet wired renders as a visibly disabled row, so
 * the sidebar can honestly show where this is going without ever implying that
 * data exists. A feed must not be flipped to 'live' until it actually fetches.
 *
 * `coverage` carries the same obligation the map's layers do: 'national' means
 * every postal code, 'urban' means it exists only where the underlying source
 * has data, and the sidebar prints that on the row. The shadow feed is the
 * instructive case — the sun maths is exact everywhere in Finland, but the
 * BUILDINGS it casts against come from OSM height tags that thin out fast
 * outside city centres, so the feed is 'urban' and says so.
 */

export type FeedStatus = 'live' | 'planned';
export type FeedCoverage = 'national' | 'urban';

export interface Feed {
  id: string;
  /** i18n key for the row label. */
  labelKey: string;
  status: FeedStatus;
  coverage: FeedCoverage;
  /** Whether the feed starts switched on for a first-time visitor. */
  defaultOn: boolean;
}

export interface FeedGroup {
  id: string;
  labelKey: string;
  /**
   * Accent colour for the group's toggles, as a raw hex string.
   *
   * Not a Tailwind class name: these are interpolated into inline styles on the
   * toggle pills, and Tailwind's JIT compiler only emits classes it can see as
   * complete literals in source — a constructed `bg-${color}-500` silently
   * produces no CSS at all.
   */
  accent: string;
  feeds: Feed[];
}

export const FEED_GROUPS: FeedGroup[] = [
  {
    id: 'sun',
    labelKey: 'live.group.sun',
    accent: '#f59e0b',
    feeds: [
      { id: 'shadows', labelKey: 'live.feed.shadows', status: 'live', coverage: 'urban', defaultOn: true },
      { id: 'sun_position', labelKey: 'live.feed.sun_position', status: 'live', coverage: 'national', defaultOn: true },
    ],
  },
  {
    id: 'weather',
    labelKey: 'live.group.weather',
    accent: '#38bdf8',
    feeds: [
      { id: 'warnings', labelKey: 'live.feed.warnings', status: 'planned', coverage: 'national', defaultOn: false },
      // Air temperature at every reporting FMI station. National, and 5.3 kB
      // gzipped despite 170 kB of raw XML — see observations.ts before
      // "optimising" it to the coverage encoding, which is three times bigger
      // over the wire.
      { id: 'observations', labelKey: 'live.feed.observations', status: 'live', coverage: 'national', defaultOn: false },
      { id: 'air_quality', labelKey: 'live.feed.air_quality', status: 'planned', coverage: 'national', defaultOn: false },
    ],
  },
  {
    id: 'transport',
    labelKey: 'live.group.transport',
    accent: '#a78bfa',
    feeds: [
      // National by construction, which the shadow feed above cannot be: every
      // train running in the country, not just the cities a 3D model covers.
      { id: 'trains', labelKey: 'live.feed.trains', status: 'live', coverage: 'national', defaultOn: true },
      // National, and cheap enough to poll: the whole active set is 8 features
      // and 3.4 kB. Roadworks from the same endpoint are 585 features and
      // 1.28 MB, which is why this feed is announcements only — see incidents.ts.
      { id: 'road_incidents', labelKey: 'live.feed.road_incidents', status: 'live', coverage: 'national', defaultOn: true },
      { id: 'transit_alerts', labelKey: 'live.feed.transit_alerts', status: 'planned', coverage: 'urban', defaultOn: false },
    ],
  },
];

/** Every feed, flattened, in sidebar order. */
export const ALL_FEEDS: Feed[] = FEED_GROUPS.flatMap((g) => g.feeds);

/** Feed ids that are switched on for a visitor who has never used the page. */
export function defaultEnabledFeeds(): Set<string> {
  return new Set(ALL_FEEDS.filter((f) => f.status === 'live' && f.defaultOn).map((f) => f.id));
}

/**
 * Narrow an arbitrary set of ids to the ones that are real and currently live.
 *
 * The enabled set is persisted, so it outlives the registry: a feed that gets
 * renamed, removed, or reverted from 'live' to 'planned' would otherwise come
 * back from localStorage as a phantom toggle that no code responds to.
 */
export function sanitizeEnabled(ids: Iterable<string>): Set<string> {
  const live = new Set(ALL_FEEDS.filter((f) => f.status === 'live').map((f) => f.id));
  const out = new Set<string>();
  for (const id of ids) if (live.has(id)) out.add(id);
  return out;
}
