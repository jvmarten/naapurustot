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

/**
 * What a feed can honestly show for an instant that is not now.
 *
 * The page has one clock (see timeControl.ts) and every layer answers for it, so
 * each feed has to state how far its answer reaches. This is `coverage` in the
 * time dimension and it carries the same obligation: the sidebar prints it, and
 * a feed scrubbed past what it can speak for goes dark and says so rather than
 * leaving its "now" data on screen under someone else's timestamp.
 *
 *   computed  exact at any instant, backwards and forwards (astronomy).
 *   archive   the source serves measured history on request (FMI's WFS).
 *   forecast  archive backwards, and the PUBLISHER'S OWN forecast forwards.
 *   recorded  only what this session watched go by — the source publishes the
 *             latest state and keeps no history a browser can ask for.
 *   schedule  measured where we have a measurement, and the publisher's own
 *             timetable elsewhere — drawn as a plan, never as a fix.
 *   validity  each record carries its own from/to, so the publisher has already
 *             answered "is this in effect at T", including for future entries.
 *
 * The last two are the ones with a knife-edge in them, and it is worth being
 * exact about where the edge is. Neither of them invents a value: `forecast` is
 * ECMWF's published number for that station and hour, `schedule` is Fintraffic's
 * published route for that train. What they add over `archive` is that the page
 * is willing to SHOW a publisher's prediction — differently drawn, differently
 * labelled, and never where a measurement exists. What is still absent is a feed
 * that models something itself: no interpolation between two fixes of the same
 * measured quantity, no trend extrapolated past the last reading, and no
 * modelled value rendered in the same ink as an instrument's.
 */
export type FeedTimeModel =
  | 'computed'
  | 'archive'
  | 'forecast'
  | 'recorded'
  | 'schedule'
  | 'validity';

export interface Feed {
  id: string;
  /** i18n key for the row label. */
  labelKey: string;
  status: FeedStatus;
  coverage: FeedCoverage;
  /** How far from now this feed can be scrubbed. */
  time: FeedTimeModel;
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
      { id: 'shadows', labelKey: 'live.feed.shadows', status: 'live', coverage: 'urban', time: 'computed', defaultOn: true },
      { id: 'sun_position', labelKey: 'live.feed.sun_position', status: 'live', coverage: 'national', time: 'computed', defaultOn: true },
    ],
  },
  {
    id: 'weather',
    labelKey: 'live.group.weather',
    accent: '#38bdf8',
    feeds: [
      { id: 'warnings', labelKey: 'live.feed.warnings', status: 'planned', coverage: 'national', time: 'validity', defaultOn: false },
      // Air temperature at every reporting FMI station. National, and 5.3 kB
      // gzipped despite 170 kB of raw XML — see observations.ts before
      // "optimising" it to the coverage encoding, which is three times bigger
      // over the wire.
      //
      // 'forecast': the same stored query answers for any past window once it is
      // given an `endtime`, so scrubbing back shows what the stations actually
      // measured then rather than the present under a past clock — and past
      // "now" ECMWF publishes a forecast AT THOSE SAME STATIONS, 189 of them
      // matching coordinate for coordinate, so the layer carries on instead of
      // going dark. Forecast values are drawn in italic and stated as forecasts
      // everywhere they appear; see observations.ts.
      { id: 'observations', labelKey: 'live.feed.observations', status: 'live', coverage: 'national', time: 'forecast', defaultOn: false },
      // 'urban', not 'national', and deliberately: this is the municipal
      // monitoring network — 82 stations in towns. FMI's national background
      // network has seven, which is real but too sparse to read as a map.
      { id: 'air_quality', labelKey: 'live.feed.air_quality', status: 'live', coverage: 'urban', time: 'archive', defaultOn: false },
    ],
  },
  {
    id: 'transport',
    labelKey: 'live.group.transport',
    accent: '#a78bfa',
    feeds: [
      // National by construction, which the shadow feed above cannot be: every
      // train running in the country, not just the cities a 3D model covers.
      //
      // 'schedule': Digitraffic publishes the LATEST fix per train and offers
      // position history one train at a time, so there is no national past to
      // fetch. Inside the window this session watched, the layer replays the
      // snapshots it recorded (trainHistory.ts) — real positions at the times
      // they were reported. Outside it, the layer is placed from Fintraffic's
      // published timetable for the day (trainSchedule.ts): the publisher's own
      // times at the publisher's own control points, interpolated between them,
      // drawn as diamonds rather than dots and never where a fix exists.
      { id: 'trains', labelKey: 'live.feed.trains', status: 'live', coverage: 'national', time: 'schedule', defaultOn: true },
      // National, and cheap enough to poll: the whole active set is 8 features
      // and 3.4 kB. Roadworks from the same endpoint are 585 features and
      // 1.28 MB, which is why this feed is announcements only — see incidents.ts.
      //
      // 'validity': every announcement carries its own start and end, so "was
      // this in effect at 06:20" and "will this still be closed at 19:00" are
      // both answered by Fintraffic rather than by us.
      { id: 'road_incidents', labelKey: 'live.feed.road_incidents', status: 'live', coverage: 'national', time: 'validity', defaultOn: true },
      { id: 'transit_alerts', labelKey: 'live.feed.transit_alerts', status: 'planned', coverage: 'urban', time: 'validity', defaultOn: false },
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
