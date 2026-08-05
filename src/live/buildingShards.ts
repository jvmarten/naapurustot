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
 * The manifest is statically imported because it is a handful of bytes per shard
 * (path, bbox, count) and choosing a tier must not itself cost a network round
 * trip. The shard payload is fetched lazily, once, only when a viewport actually
 * falls inside it.
 */
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { FeatureCollection, Polygon } from 'geojson';
import manifest from '../data/buildings_manifest.json';
import { fetchBuildings, type Bbox, type Building, type Ring } from './shadows';

export type HeightSource = 'city_model' | 'osm';

export interface ShardEntry {
  path: string;
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
  count: number;
  bytes: number;
}

const SHARDS = manifest as unknown as Record<string, ShardEntry>;

const BASE = import.meta.env.BASE_URL ?? '/';

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

async function loadShard(id: string, entry: ShardEntry): Promise<IndexedBuilding[]> {
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

function getShard(id: string, entry: ShardEntry): Promise<IndexedBuilding[]> {
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
  const centreLon = (bbox.west + bbox.east) / 2;
  const centreLat = (bbox.south + bbox.north) / 2;
  const shard = findShard(centreLon, centreLat);
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

/** True when any shard is configured at all — lets the UI skip city-model copy entirely. */
export function hasShards(): boolean {
  return Object.keys(SHARDS).length > 0;
}

export interface ResolvedBuildings {
  buildings: Building[];
  /** Buildings in view from the chosen source, INCLUDING ones with no usable height. */
  total: number;
  source: HeightSource;
}

/**
 * Buildings for `bbox` from the best source available there.
 *
 * Prefers the measured city model and falls back to the live OSM query, which is
 * also what happens when a shard fetch fails: a broken shard should degrade to
 * worse heights, not to no shadows at all.
 */
export async function resolveBuildings(
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<ResolvedBuildings> {
  try {
    const fromShard = await buildingsFromShard(bbox);
    if (fromShard) {
      // Every building in the city model carries a measured height, so the count
      // in view IS the total — there is no "missing height" subset to report.
      return { buildings: fromShard, total: fromShard.length, source: 'city_model' };
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    console.warn('LivePage: city-model shard unavailable, falling back to OSM', err);
  }
  const { buildings, total } = await fetchBuildings(bbox, signal);
  return { buildings, total, source: 'osm' };
}
