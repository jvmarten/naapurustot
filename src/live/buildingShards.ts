/**
 * Authoritative building heights for the /live/ shadow layer.
 *
 * Two tiers, and the page always says which one it drew:
 *
 *   'city_model' — a prebuilt shard from the City of Helsinki 3D city model.
 *                  `bldg:measuredHeight` is an actual measurement and every
 *                  building in the model carries one (400/400 on the sample used
 *                  to choose this source).
 *   'osm'        — the live Overpass fallback in ./shadows.ts, used wherever no
 *                  shard covers the viewport. Heights there are mostly
 *                  `building:levels` × an assumed storey height, and only ~62 %
 *                  of buildings in central Helsinki carry even that.
 *
 * The distinction is not cosmetic — an estimated height and a measured one differ
 * by metres, which at a low sun is tens of metres of shadow. So the source is part
 * of the result type rather than something the UI guesses, and it is reported in
 * the readout next to the count.
 *
 * THE TWO TIERS ARE COMBINED, NOT CHOSEN BETWEEN. A shard covers a rectangle a
 * few kilometres across; a viewport that reaches past its edge used to fall
 * entirely to whichever tier owned the CENTRE, so panning or zooming out over
 * Helsinki cut the buildings off along an invisible straight line and everything
 * beyond it silently stopped casting a shadow. `resolveBuildings` now takes the
 * measured footprints where the shard has them and asks Overpass only for the
 * rectangles it does not cover (see `bboxSubtract`), so the two meet without a
 * seam and without fetching anything twice.
 *
 * The manifest is statically imported because it is a handful of bytes per shard
 * (path, bbox, count) and choosing a tier must not itself cost a network round
 * trip. The shard payload is fetched lazily, once, only when a viewport actually
 * falls inside it.
 */
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { FeatureCollection, Polygon } from 'geojson';
import manifest from '../data/buildings_manifest.json';
import {
  fetchBuildings,
  bboxAreaKm2,
  bboxIntersects,
  bboxSubtract,
  type Bbox,
  type Building,
  type Ring,
} from './shadows';

export type HeightSource = 'city_model' | 'osm' | 'mixed';

export interface ShardEntry {
  path: string;
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
  count: number;
  bytes: number;
  /**
   * Tree canopy for the SAME extent, when it has been built.
   *
   * No bbox of its own: canopy is only ever loaded for a region whose building
   * shard already matched, so a second extent would be a second source of truth
   * that could silently disagree with the one actually tested.
   */
  canopy?: { path: string; count: number; bytes: number };
}

const SHARDS = manifest as unknown as Record<string, ShardEntry>;

const BASE = import.meta.env.BASE_URL ?? '/';

/**
 * Largest ground area we will ask Overpass for, in km².
 *
 * The gate this replaced was a zoom threshold, which asks the wrong question:
 * the cost of the query is set by the ground area it scans, and that depends on
 * the window size as much as on the zoom. Budgeting the AREA lets a laptop
 * window at zoom 13.7 fetch while a phone at the same zoom — a quarter of the
 * ground — is nowhere near the limit, and it keeps a very wide monitor from
 * quietly issuing a request four times the size anyone measured.
 *
 * The number is set by PAYLOAD, measured against the live endpoint over central
 * Helsinki — the densest building data in the country: 9 km² returned 2.7 MB of
 * JSON, 100 km² returned 8.8 MB. 45 km² is roughly 4 MB there, comparable to
 * what the old zoom-14.5 gate already fetched in the centre, while covering
 * about three times the ground. Everywhere outside the capital region is far
 * sparser, so this binds only where it has to.
 *
 * Do not read it as a size Overpass is guaranteed to serve. The public endpoint
 * is shared and its behaviour varies by the hour — a 29 km² query returned a
 * gateway timeout during this work while a 100 km² one succeeded minutes later.
 * That is why the page states a failure and lets the user retry rather than
 * spinning: the request being refused is a normal outcome, not a bug to hide.
 *
 * It is budgeted against the rectangles actually SENT, not the viewport: where a
 * city-model shard covers the middle, only the strips around it are queried, and
 * charging the query for ground it never scans would refuse requests that are
 * genuinely cheap.
 */
export const MAX_OSM_AREA_KM2 = 45;

/** A loaded building plus its own bbox, so viewport filtering is a cheap compare. */
interface IndexedBuilding extends Building {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * In-flight and completed shard loads, keyed by shard id.
 *
 * Cached as the PROMISE, not the result, so two viewport changes in quick
 * succession share one fetch instead of racing two multi-megabyte downloads. A
 * failed load deletes its entry so a later pan can retry rather than being stuck
 * on a rejected promise forever — the same rule metroAreas.ts follows for the
 * region outlines.
 */
const shardCache = new Map<string, Promise<IndexedBuilding[]>>();

/** A shard entry's extent as a Bbox. */
export function shardBbox(entry: ShardEntry): Bbox {
  const [minLon, minLat, maxLon, maxLat] = entry.bbox;
  return { west: minLon, south: minLat, east: maxLon, north: maxLat };
}

/** The shard covering this point, or null when there is none. */
export function findShard(lon: number, lat: number): { id: string; entry: ShardEntry } | null {
  for (const [id, entry] of Object.entries(SHARDS)) {
    const [minLon, minLat, maxLon, maxLat] = entry.bbox;
    if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) {
      return { id, entry };
    }
  }
  return null;
}

/**
 * The shard with the largest overlap with `bbox`, or null when none touches it.
 *
 * Overlap rather than containment of the centre: a viewport that only clips the
 * corner of a shard should still get the measured heights for that corner, with
 * OSM filling the rest.
 */
export function findShardOverlapping(bbox: Bbox): { id: string; entry: ShardEntry } | null {
  let best: { id: string; entry: ShardEntry } | null = null;
  let bestArea = 0;
  for (const [id, entry] of Object.entries(SHARDS)) {
    const sb = shardBbox(entry);
    if (!bboxIntersects(bbox, sb)) continue;
    const area = bboxAreaKm2({
      south: Math.max(bbox.south, sb.south),
      north: Math.min(bbox.north, sb.north),
      west: Math.max(bbox.west, sb.west),
      east: Math.min(bbox.east, sb.east),
    });
    if (area > bestArea) {
      bestArea = area;
      best = { id, entry };
    }
  }
  return best;
}

function index(building: Building): IndexedBuilding {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of building.ring) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return { ...building, minLon, minLat, maxLon, maxLat };
}

async function loadShard(id: string, entry: { path: string }): Promise<IndexedBuilding[]> {
  const res = await fetch(`${BASE}${entry.path}`);
  if (!res.ok) throw new Error(`shard ${id} responded ${res.status}`);
  const topology = (await res.json()) as Topology;
  const objectName = Object.keys(topology.objects)[0];
  const collection = feature(topology, topology.objects[objectName]) as unknown as FeatureCollection<
    Polygon,
    { h?: number }
  >;

  const out: IndexedBuilding[] = [];
  for (const f of collection.features) {
    const height = f.properties?.h;
    if (typeof height !== 'number' || height <= 0) continue;
    const ring = f.geometry?.coordinates?.[0] as Ring | undefined;
    if (!ring || ring.length < 4) continue;
    // Heights here are measured, so `estimated` is false — that flag is what
    // lets the UI distinguish these from the OSM storey-count derivations.
    out.push(index({ ring, height, estimated: false }));
  }
  return out;
}

function getShard(id: string, entry: { path: string }): Promise<IndexedBuilding[]> {
  const cached = shardCache.get(id);
  if (cached) return cached;
  const pending = loadShard(id, entry).catch((err: unknown) => {
    shardCache.delete(id);
    throw err;
  });
  shardCache.set(id, pending);
  return pending;
}

/**
 * Buildings from the city-model shard covering `bbox`, or null when none does.
 *
 * Returning null rather than an empty array is deliberate: "no shard here" and
 * "a shard that happens to contain no buildings" are different facts, and only
 * the first one should send the caller to the OSM fallback.
 */
export async function buildingsFromShard(bbox: Bbox): Promise<Building[] | null> {
  const shard = findShardOverlapping(bbox);
  if (!shard) return null;

  const all = await getShard(shard.id, shard.entry);
  // Bbox-overlap, not containment: a building whose centre is off-screen can
  // still cast its shadow across the visible area, so anything intersecting the
  // viewport has to be kept.
  return all.filter(
    (b) =>
      b.maxLon >= bbox.west &&
      b.minLon <= bbox.east &&
      b.maxLat >= bbox.south &&
      b.minLat <= bbox.north,
  );
}

/**
 * Tree canopy from the shard covering `bbox`, or [] when there is none.
 *
 * Returns [] rather than null on a miss, unlike `buildingsFromShard`: absent
 * trees never send the caller anywhere else. There is no OSM fallback for canopy
 * — OpenStreetMap has essentially no tree heights — so "no canopy here" and "no
 * canopy data at all" lead to the same drawing, which is nothing.
 *
 * A failed canopy load is swallowed. Trees are an enhancement to the shadow
 * layer; losing them should cost their shade, not the building shadows that
 * shipped before them.
 */
export async function canopyFromShard(bbox: Bbox): Promise<Building[]> {
  const shard = findShardOverlapping(bbox);
  const canopy = shard?.entry.canopy;
  if (!shard || !canopy) return [];
  try {
    const all = await getShard(`${shard.id}:canopy`, canopy);
    return all.filter(
      (b) =>
        b.maxLon >= bbox.west &&
        b.minLon <= bbox.east &&
        b.maxLat >= bbox.south &&
        b.minLat <= bbox.north,
    );
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    console.warn('LivePage: canopy shard unavailable, drawing buildings only', err);
    return [];
  }
}

/** True when any shard is configured at all — lets the UI skip city-model copy entirely. */
export function hasShards(): boolean {
  return Object.keys(SHARDS).length > 0;
}

/**
 * What the shadow layer can draw for a viewport, decided without fetching.
 *
 *   'shard'     — measured heights only; either the shard covers the whole box,
 *                 or the rest of it is too large to ask Overpass for.
 *   'shard+osm' — measured heights plus an Overpass query for the remainder.
 *   'osm'       — no shard here, and the box is small enough to query.
 *   'none'      — nothing can be drawn; the UI must say "zoom in" rather than
 *                 render an empty map that reads as "no buildings here".
 *
 * Separated from {@link resolveBuildings} so the page can put the honest message
 * up IMMEDIATELY on a camera change, instead of after a debounce and a round
 * trip. Both are pure functions of the bbox, so they cannot disagree.
 */
export type CoveragePlan = 'shard' | 'shard+osm' | 'osm' | 'none';

/** Total ground area of a set of boxes, in km². */
function totalAreaKm2(boxes: Bbox[]): number {
  return boxes.reduce((sum, b) => sum + bboxAreaKm2(b), 0);
}

export function planCoverage(bbox: Bbox): CoveragePlan {
  const shard = findShardOverlapping(bbox);
  if (!shard) return bboxAreaKm2(bbox) <= MAX_OSM_AREA_KM2 ? 'osm' : 'none';
  const uncovered = bboxSubtract(bbox, shardBbox(shard.entry));
  if (uncovered.length === 0) return 'shard';
  return totalAreaKm2(uncovered) <= MAX_OSM_AREA_KM2 ? 'shard+osm' : 'shard';
}

export interface ResolvedBuildings {
  buildings: Building[];
  /**
   * Tree canopy, kept OUT of `buildings` on purpose.
   *
   * A crown is not a wall: it dapples rather than blocks, so it is drawn in its
   * own pass at a lower alpha. Merging the two lists would force one opacity on
   * both and overstate how much light a tree stops.
   */
  canopy: Building[];
  /** Buildings in view from the chosen sources, INCLUDING ones with no usable height. */
  total: number;
  source: HeightSource;
  /** How many came from a measured city model. */
  measured: number;
  /** OSM buildings with a usable height, and the OSM denominator they came from. */
  osmWithHeight: number;
  osmTotal: number;
  /**
   * True when part of the viewport was deliberately left unqueried.
   *
   * Only happens with a city model behind it: the shard answers for its own
   * rectangle and the surrounding strips were too large to be a fair request.
   * The result is buildings that stop along a straight line, so the UI has to be
   * able to SAY that rather than letting it read as "nothing is built there".
   */
  partial: boolean;
}

/**
 * Buildings for `bbox` from every source that has them there.
 *
 * A shard failure degrades to OSM over the whole box rather than to no shadows
 * at all: worse heights beat an empty map, which the user would read as "there
 * are no buildings here".
 */
export async function resolveBuildings(
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<ResolvedBuildings> {
  const shard = findShardOverlapping(bbox);
  let measured: Building[] = [];
  /** The part of the viewport the city model does not answer for. */
  let uncovered: Bbox[] = [bbox];

  if (shard) {
    try {
      measured = (await buildingsFromShard(bbox)) ?? [];
      uncovered = bboxSubtract(bbox, shardBbox(shard.entry));
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      console.warn('LivePage: city-model shard unavailable, falling back to OSM', err);
      measured = [];
      uncovered = [bbox];
    }
  }

  // Budgeted against the strips actually sent — Overpass scans the boxes it is
  // given, not the hole between them — so a wide view over a covered city centre
  // still gets its surroundings filled in.
  const askOsm = uncovered.length > 0 && totalAreaKm2(uncovered) <= MAX_OSM_AREA_KM2;
  // In parallel: the Overpass strips and the region's canopy are independent, and
  // trees should not wait behind a query that may be queued for a minute.
  const [osm, canopy] = await Promise.all([
    askOsm ? fetchBuildings(uncovered, signal) : Promise.resolve({ buildings: [], total: 0 }),
    canopyFromShard(bbox),
  ]);

  const source: HeightSource = measured.length
    ? osm.buildings.length
      ? 'mixed'
      : 'city_model'
    : 'osm';

  return {
    buildings: measured.length ? [...measured, ...osm.buildings] : osm.buildings,
    canopy,
    total: measured.length + osm.total,
    source,
    measured: measured.length,
    osmWithHeight: osm.buildings.length,
    osmTotal: osm.total,
    partial: uncovered.length > 0 && !askOsm,
  };
}
