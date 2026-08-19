/**
 * Live vessel positions for /live/ — the page's third realtime transport feed,
 * and the first one at sea.
 *
 * Source: Fintraffic's Digitraffic marine API, open data under CC BY 4.0, no API
 * key. Positions come off the vessels' own AIS transponders and are relayed by
 * Fintraffic's shore stations.
 *
 *   https://meri.digitraffic.fi/api/ais/v1/locations   — latest fix per vessel
 *   https://meri.digitraffic.fi/api/ais/v1/vessels      — name, type, destination
 *
 * WHY THIS FEED. The transport group already carries trains and road
 * announcements; the country's coast is the third face of the same live network,
 * and for a maritime nation it is not a minor one — nearly a thousand vessels are
 * on Finnish waters at any moment. AIS is measured position, published open, on
 * the same terms and with the same client-identification header the train feed
 * already uses, so it belongs here for the same reasons the trains do.
 *
 * THE WHOLE COUNTRY IS FETCHED, NOT THE VIEWPORT, exactly as the trains are. The
 * national set is ~1,000 features and ~40 kB; scoping to the camera would cost a
 * request per pan to save nothing worth saving, and vessels would arrive a beat
 * after the map settles instead of already being there. Filtering the national
 * set at draw time is free.
 *
 * NO INTERPOLATION BETWEEN FIXES. A hull could be dead-reckoned along its course
 * between polls and would look smoother, but the position it drew would be a
 * position nobody measured — the same category of thing as a fabricated data
 * value. A vessel moves when the feed says it moved, and a fix too old to trust
 * is drawn hollow rather than being quietly presented as current.
 *
 * THE POSITION FEED AND THE VESSEL REGISTER ARE SEPARATE, on purpose. `locations`
 * is ~40 kB and refreshes with every fix; `vessels` is the near-static register
 * of names, types and declared destinations. Polling the register at the position
 * cadence would re-download 44 kB of unchanging text every minute, so it is
 * fetched rarely and joined to a position by MMSI at draw time — which also keeps
 * a scrubbed snapshot's names current rather than freezing whatever was declared
 * when the snapshot was taken.
 */

/** One vessel's last reported AIS position. Register fields are joined separately. */
export interface Ship {
  /** Maritime Mobile Service Identity — the vessel's AIS identity. */
  mmsi: number;
  lon: number;
  lat: number;
  /** Speed over ground in knots, or null when the transponder reported none. */
  sog: number | null;
  /**
   * Course over ground in degrees, or null when unavailable.
   *
   * Course made good, not the way the bow points (the AIS `heading` field): it is
   * the direction the vessel is actually travelling, which is what the bow
   * triangle draws. `heading` is deliberately not carried — for a moving vessel
   * it barely differs from course, and for a moored one, which draws no triangle
   * at all, it would never be used.
   */
  cog: number | null;
  /** ITU navigational-status code (0–8 meaningful), or null when undefined. */
  navStat: number | null;
  /** When the position was measured, ms since the epoch, or null if unparseable. */
  at: number | null;
}

/** The near-static register entry for a vessel, keyed on MMSI. */
export interface VesselMeta {
  name: string | null;
  /** AIS ship-type code, 0–99, or null. See {@link shipCategoryKey}. */
  shipType: number | null;
  /** Declared destination, reproduced verbatim (an AIS free-text field). */
  destination: string | null;
  /** Maximum present static draught in metres, or null when not declared. */
  draughtM: number | null;
  callSign: string | null;
}

export type VesselMetaMap = Map<number, VesselMeta>;

/** Stable identity for a vessel across polls. */
export function shipKey(ship: Pick<Ship, 'mmsi'>): string {
  return String(ship.mmsi);
}

export const SHIPS_ENDPOINT = 'https://meri.digitraffic.fi/api/ais/v1/locations';
export const VESSELS_ENDPOINT = 'https://meri.digitraffic.fi/api/ais/v1/vessels';

/**
 * How often we ask for positions, in ms.
 *
 * The endpoint sends `cache-control: max-age=60`, so a faster poll only re-reads
 * a cached response — the natural cadence is one a minute, and it suits the data:
 * a vessel at 20 knots covers ~600 m a minute, a visible step but a step in the
 * right place. Polling stops while the tab is hidden (see useFeedPoll), so an
 * abandoned tab costs nothing.
 */
export const SHIP_POLL_MS = 60_000;

/**
 * How often we refresh the vessel register, in ms.
 *
 * Names and types change on the scale of a vessel being re-registered, not of it
 * moving. Half an hour keeps declared destinations reasonably fresh without
 * re-downloading 44 kB of largely-unchanging text at the position cadence.
 */
export const VESSELS_POLL_MS = 1_800_000;

/**
 * Past this age a fix is drawn hollow rather than solid.
 *
 * A moving vessel transmits every few seconds and a moored one every few minutes,
 * so ten minutes is well past a normal gap and well short of the point where a
 * position becomes fiction — a hull that lost coverage twenty minutes ago is no
 * longer certainly where the feed last saw it. The detail panel always prints the
 * exact fix age; this only governs the mark.
 */
export const SHIP_STALE_MS = 600_000;

/**
 * How far a scrub may sit from a retained snapshot and still be answered by it.
 *
 * The shared snapshot ring (positionBuffer.ts) defaults to 20 s, tuned for the
 * trains' 5 s poll. The ship feed polls once a minute, so its ordinary gap is
 * ~60 s: with the 20 s default, `snapshotAt` would refuse every instant more than
 * 20 s from a snapshot — blanking two thirds of a continuous recording on a
 * scrub — and `trackedRuns` would call every 60 s step a fresh stretch. 40 s is a
 * shade over half the poll interval, so consecutive snapshots overlap (each
 * covers ±40 s, spacing 60 s) and the recording reads as one run, while a real
 * gap (the tab was hidden) still exceeds it and correctly goes dark.
 */
export const SHIP_TRACK_TOLERANCE_MS = 40_000;

/**
 * Below this speed over ground, a vessel is treated as not making way, and its
 * course is not drawn as a direction.
 *
 * Course over ground is only defined for a vessel that is moving: a hull at
 * anchor or made fast still reports a `cog`, but it is the last course it had, a
 * default, or noise — not a bearing it is travelling on. Drawing a bow triangle
 * for a moored ferry points it somewhere it is not going, so at rest the mark is
 * a plain dot instead. 0.5 kn is the conventional "stopped" threshold, below AIS
 * manoeuvring speeds and above the jitter a berthed transponder reports.
 */
export const MAKING_WAY_KN = 0.5;

/** Whether a vessel is moving fast enough for its course to mean a direction. */
export function isMakingWay(sog: number | null): boolean {
  return sog !== null && sog >= MAKING_WAY_KN;
}

/** Client identification Fintraffic asks every caller to send — see trains.ts. */
const DIGITRAFFIC_USER = 'naapurustot.fi/live';

/** A finite number, or null. Rejects NaN, Infinity, strings and nullish. */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface RawFeature {
  mmsi?: unknown;
  geometry?: { coordinates?: unknown } | null;
  properties?: {
    sog?: unknown;
    cog?: unknown;
    navStat?: unknown;
    timestampExternal?: unknown;
  } | null;
}

/**
 * Turn the locations payload into ships, dropping anything malformed and
 * resolving the AIS "not available" sentinels to null.
 *
 * The sentinels are the whole reason this is not a straight field copy: AIS
 * encodes "no speed" as 1023 (→ 102.3 kn), "no course" as 3600 (→ 360°) and "no
 * and a client that took those at face value would draw a stationary moored
 * tanker doing 102 knots on a course of 360 degrees. Speed and course carry the
 * exact max-valid value one tick below the sentinel (102.2 kn, 359.9°), so the
 * cut is at the sentinel, not below it.
 */
export function parseShips(payload: unknown): Ship[] {
  const features = (payload as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) {
    throw new Error('ais locations: expected a feature collection');
  }

  const out: Ship[] = [];
  for (const raw of features as RawFeature[]) {
    const mmsi = finite(raw?.mmsi);
    if (mmsi === null) continue;

    const coords = raw?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = finite(coords[0]);
    const lat = finite(coords[1]);
    if (lon === null || lat === null) continue;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;

    const p = raw?.properties ?? {};
    const sogRaw = finite(p.sog);
    const cogRaw = finite(p.cog);
    const navStatRaw = finite(p.navStat);
    const at = finite(p.timestampExternal);

    out.push({
      mmsi,
      lon,
      lat,
      // >= rather than ===: the sentinel is the top of the range, and anything at
      // or above it is "no reading", never a real 102-knot vessel.
      sog: sogRaw !== null && sogRaw >= 0 && sogRaw < 102.3 ? sogRaw : null,
      cog: cogRaw !== null && cogRaw >= 0 && cogRaw < 360 ? cogRaw : null,
      navStat: navStatRaw !== null && navStatRaw >= 0 && navStatRaw <= 8 ? navStatRaw : null,
      at,
    });
  }
  return out;
}

interface RawVessel {
  mmsi?: unknown;
  name?: unknown;
  shipType?: unknown;
  destination?: unknown;
  draught?: unknown;
  callSign?: unknown;
}

/** A trimmed non-empty string, or null. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Turn the vessel register into a map keyed on MMSI.
 *
 * Draught arrives in decimetres and 0 means "not declared", not "zero draught",
 * so it becomes null rather than 0.0 m; the same is true of the sentinel ship
 * type 0 downstream (see {@link shipCategoryKey}).
 */
export function parseVessels(payload: unknown): VesselMetaMap {
  if (!Array.isArray(payload)) {
    throw new Error('ais vessels: expected an array');
  }
  const map: VesselMetaMap = new Map();
  for (const raw of payload as RawVessel[]) {
    const mmsi = finite(raw?.mmsi);
    if (mmsi === null) continue;
    const draughtDm = finite(raw?.draught);
    const shipType = finite(raw?.shipType);
    map.set(mmsi, {
      name: text(raw?.name),
      shipType: shipType !== null && shipType > 0 && shipType <= 99 ? shipType : null,
      destination: text(raw?.destination),
      draughtM: draughtDm !== null && draughtDm > 0 ? draughtDm / 10 : null,
      callSign: text(raw?.callSign),
    });
  }
  return map;
}

/**
 * Every vessel currently on Finnish waters.
 *
 * Throws rather than returning an empty list on a bad response: "no vessels" and
 * "we could not ask" are different facts, and only the first should be drawn as
 * an empty sea. As with the trains, the endpoint answers 406 without gzip, which
 * a browser always sends and cannot override.
 */
export async function fetchShips(signal?: AbortSignal): Promise<Ship[]> {
  const res = await fetch(SHIPS_ENDPOINT, {
    signal,
    headers: { 'Digitraffic-User': DIGITRAFFIC_USER },
  });
  if (!res.ok) throw new Error(`ais locations responded ${res.status}`);
  return parseShips(await res.json());
}

/** The vessel register — names, types, declared destinations. */
export async function fetchVessels(signal?: AbortSignal): Promise<VesselMetaMap> {
  const res = await fetch(VESSELS_ENDPOINT, {
    signal,
    headers: { 'Digitraffic-User': DIGITRAFFIC_USER },
  });
  if (!res.ok) throw new Error(`ais vessels responded ${res.status}`);
  return parseVessels(await res.json());
}

/**
 * The i18n key suffix for an AIS ship-type code's coarse category.
 *
 * AIS packs the type into two digits: the first is the class, the second a
 * subtype or hazard code. We keep only the class, and collapse the utility and
 * recreational classes together, because a reader wants "cargo / tanker /
 * passenger / working boat", not the sixty distinct codes the standard defines.
 * Unknown, "not available" (0) and the reserved 90–99 range all fall to `other`.
 */
export function shipCategoryKey(shipType: number | null): string {
  if (shipType === null) return 'other';
  if (shipType === 30) return 'fishing';
  if (shipType >= 31 && shipType <= 35) return 'service';
  if (shipType === 36 || shipType === 37) return 'recreational';
  if (shipType >= 40 && shipType <= 49) return 'high_speed';
  if (shipType >= 50 && shipType <= 59) return 'service';
  if (shipType >= 60 && shipType <= 69) return 'passenger';
  if (shipType >= 70 && shipType <= 79) return 'cargo';
  if (shipType >= 80 && shipType <= 89) return 'tanker';
  return 'other';
}

/**
 * The i18n key suffix for an AIS navigational-status code, or null when the code
 * carries no plain-language meaning worth a row (reserved values and "undefined",
 * which `parseShips` has already turned into a null navStat).
 */
export function navStatusKey(navStat: number | null): string | null {
  switch (navStat) {
    case 0: return 'underway';
    case 1: return 'anchored';
    case 2: return 'not_under_command';
    case 3: return 'restricted';
    case 4: return 'constrained';
    case 5: return 'moored';
    case 6: return 'aground';
    case 7: return 'fishing';
    case 8: return 'sailing';
    default: return null;
  }
}
