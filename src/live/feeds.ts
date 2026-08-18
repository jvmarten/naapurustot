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
 *   modelled  the publisher's MODEL over the whole window, with no measured half
 *             in either direction — CAMS's UV index, whose "past" is an earlier
 *             run of the same model rather than an instrument. Distinct from
 *             `forecast` on purpose: there, a measurement exists behind now and
 *             beats the model outright, and the page draws the join. Here there
 *             is no join to draw and nothing to prefer, so the feed says model
 *             everywhere rather than implying a measured half it does not have.
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
  | 'modelled'
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
  /**
   * The same accent, dark enough to be READ on a light background.
   *
   * Not a duplicate: `accent` is an ink for a coloured surface — a toggle's
   * fill, a mark on a dark map — and it is chosen to be bright enough to survive
   * the night wash. Used as TEXT on the sidebar's `#f8fafc`, those same three
   * colours measure 2.05, 2.05 and 2.60 against WCAG's 4.5 for 12 px bold, so
   * the group headings were effectively unreadable for anyone in light mode.
   * (In dark mode they are 9.39, 9.42 and 7.41, which is why this never showed
   * up: the theme it fails in is the one nobody develops in.) These are the
   * -700 rung of the same Tailwind hues — 4.80, 5.67, 6.79 — so the families
   * still read as families.
   */
  accentText: string;
  feeds: Feed[];
}

export const FEED_GROUPS: FeedGroup[] = [
  {
    id: 'sun',
    labelKey: 'live.group.sun',
    accent: '#f59e0b',
    accentText: '#b45309',
    feeds: [
      { id: 'shadows', labelKey: 'live.feed.shadows', status: 'live', coverage: 'urban', time: 'computed', defaultOn: true },
      { id: 'sun_position', labelKey: 'live.feed.sun_position', status: 'live', coverage: 'national', time: 'computed', defaultOn: true },
      // The one row in this group that is not astronomy, which is exactly why it
      // is a row: the toggle is what lets a reader keep the exact numbers and
      // decline a model — and it is also the switch on the page's only
      // third-party request outside FMI, Fintraffic and MET Norway.
      { id: 'uv_index', labelKey: 'live.feed.uv_index', status: 'live', coverage: 'national', time: 'modelled', defaultOn: true },
    ],
  },
  {
    id: 'weather',
    labelKey: 'live.group.weather',
    accent: '#38bdf8',
    accentText: '#0369a1',
    feeds: [
      // STILL PLANNED, AND THE OBVIOUS ROUTES ARE CLOSED — recorded here so the
      // next attempt does not repeat the search. Measured 2026-08-17:
      // opendata.fmi.fi lists 150-odd stored queries and not one of them is a
      // warning product (the closest, `fmi::forecast::*`, are model fields, not
      // the meteorologist's warning). FMI publishes warnings as CAP at
      // alerts.fmi.fi, which answers 200 and sends NO `Access-Control-Allow-
      // Origin` at all, with or without an `Origin` header — so no browser can
      // read it, whoever issues the request. What remains is the undocumented
      // API behind ilmatieteenlaitos.fi's own warning page; it does send
      // `access-control-allow-origin: *`, but it is an internal endpoint with no
      // published contract and no licence attached, which is not a source this
      // project builds a stated fact on.
      { id: 'warnings', labelKey: 'live.feed.warnings', status: 'planned', coverage: 'national', time: 'validity', defaultOn: false },
      // The page's first RASTER feed — FMI's national radar composite, from the
      // open WMS rather than the WFS every other FMI feed here uses. See
      // radar.ts: it is the one measured layer that cannot load its day up
      // front, because a day of it is 288 images and ~25 MB against the ~20 kB
      // a day of stations costs.
      //
      // 'national' with a caveat the sidebar cannot hold, so the readout carries
      // it instead: the ten radars cover the country, and FMI's own style paints
      // the ground outside their range as a faint grey rather than as nothing —
      // which is the distinction this project makes everywhere else between "no
      // rain" and "we cannot see", already made for us.
      //
      // OFF BY DEFAULT, for the same reason lightning is: a national frame is
      // ~100 kB and there is one every five minutes, which is real money to
      // spend on a visitor who came for the shadows.
      //
      // 'forecast' rather than 'archive', and the forecast half is somebody
      // ELSE's — the one feed here where the two halves have different
      // publishers. FMI's open WMS holds no product that reaches past the
      // present minute, so past "now" this layer is MET Norway's Nordic radar
      // nowcast, whose mosaic includes all eleven FMI radars (nowcast.ts). Same
      // rule as the temperature layer either way: a measurement beats a forecast
      // outright, the seam is the wall clock, and the forecast half names its
      // publisher and its analysis time everywhere it is drawn.
      { id: 'radar', labelKey: 'live.feed.radar', status: 'live', coverage: 'national', time: 'forecast', defaultOn: false },
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
      // The first feed here whose data is EVENTS rather than the state of a
      // station, which changes what the clock asks it for: not "what was the
      // value at T" but "what struck between T-30min and T". lightning.ts
      // explains the window and why it is part of the feed rather than a
      // rendering choice.
      //
      // 'national' without a caveat — the detection network locates flashes by
      // triangulation from far outside the country, so coverage does not thin at
      // the edges the way a station map does. 'archive': FMI serves the history
      // on request, and nothing is drawn forward of now because a flash that has
      // not happened has no publisher.
      //
      // OFF BY DEFAULT, and that is a cost decision rather than a confidence
      // one. A day of a national storm is 477 kB where every other feed here is
      // 2-20 kB (the measurements are in lightning.ts), so it is bought by
      // people who asked for lightning and by nobody else.
      { id: 'lightning', labelKey: 'live.feed.lightning', status: 'live', coverage: 'national', time: 'archive', defaultOn: false },
    ],
  },
  {
    id: 'transport',
    labelKey: 'live.group.transport',
    accent: '#a78bfa',
    accentText: '#6d28d9',
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
      // STILL PLANNED, and the obvious first move is a dead end — recorded for
      // the same reason the `warnings` note above it is. Probed 2026-08-17:
      // HSL's keyless GTFS-RT service alerts at
      // realtime.hsl.fi/realtime/service-alerts/v2/hsl answer 200 with 28.9 kB
      // of protobuf and no API key, which from curl looks perfect; the response
      // carries no `Access-Control-Allow-Origin`, and a preflight with
      // `Origin: https://naapurustot.fi` is rejected outright — "400 The origin
      // 'https://naapurustot.fi' is not allowed" — so no browser can read it.
      // The old api.digitransit.fi/realtime/service-alerts path now answers 404
      // "deprecated and removed". That leaves Digitransit's OTP2 GraphQL, which
      // does allow browser origins but wants the subscription key, so this feed
      // is a key-handling decision rather than a data-availability one.
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
