/**
 * Building shadow geometry for /live/.
 *
 * Casting a real shadow needs two things: where the sun is (exact everywhere —
 * see src/utils/sun.ts) and how tall the buildings are (the hard part). This
 * module owns the second, and is deliberately honest about how weak it is.
 *
 * WHY OSM AND NOT THE OFFICIAL REGISTER. Measured against the two candidate
 * sources for the Helsinki region:
 *
 *   HSY building register (pks_rakennukset_paivittyva), `kerrosten_lkm`
 *     → 472 of 3,000 sampled buildings carried a floor count (15.7 %); the rest
 *       held the 999999999 suppression sentinel.
 *   OpenStreetMap, `building:levels` or `height`, Helsinki centre
 *     → 1,413 of 2,283 buildings (61.9 %).
 *
 * So OSM wins by a factor of four where it matters, and it is the only one of
 * the two that covers the whole country at all. It is still nowhere near
 * complete, which is why `fetchBuildings` returns the DENOMINATOR alongside the
 * buildings: the page reports "n of m buildings in view have height data"
 * rather than drawing a partial shadow map that reads as authoritative. A
 * missing building is an unshaded hole, and the user has to be told.
 *
 * Heights derived from `building:levels` are estimates and are flagged
 * `estimated: true` so the UI can say so — a floor count is not a height.
 */

/** Metres per storey, for footprints that carry a floor count but no height. */
const METRES_PER_LEVEL = 3.2;

/** Metres per degree of latitude. */
const M_PER_DEG_LAT = 111_320;

/**
 * Longest shadow we will draw, in metres.
 *
 * The geometry stays correct as the sun approaches the horizon, but it stops
 * being useful: at 0.5° altitude a 20 m building casts 2.3 km, so a screenful of
 * downtown becomes one undifferentiated smear that also costs a fortune to
 * project. Clamping the LENGTH (rather than refusing to draw) keeps the
 * direction and the relative ordering honest while the sun is low.
 */
const MAX_SHADOW_METRES = 2_000;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** A closed ring of [lon, lat] pairs. */
export type Ring = [number, number][];

export interface Building {
  /** Outer ring only — courtyards are not modelled; they cost payload and barely alter a shadow. */
  ring: Ring;
  /** Metres. */
  height: number;
  /** True when the height was derived from a floor count rather than measured. */
  estimated: boolean;
}

export interface BuildingsResult {
  buildings: Building[];
  /** Every building in the bbox, including the ones with no usable height. */
  total: number;
}

export type Bbox = { south: number; west: number; north: number; east: number };

/**
 * Parse an OSM `height` tag into metres.
 *
 * The tag is free text in practice: "12", "12 m", "12m", and occasionally a
 * decimal comma. Anything that does not resolve to a positive finite number is
 * rejected rather than coerced — a building silently given height 0 casts no
 * shadow and looks identical to one that is genuinely missing, which would
 * corrupt the coverage figure this module exists to report accurately.
 */
export function parseHeightTag(raw: string | undefined): number | null {
  if (!raw) return null;
  const normalised = raw.replace(',', '.').replace(/\s*m(etres?|eters?)?\s*$/i, '').trim();
  const value = Number.parseFloat(normalised);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Parse an OSM `building:levels` tag into a height estimate in metres. */
export function parseLevelsTag(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return value * METRES_PER_LEVEL;
}

/** Resolve a building's height from its tags, preferring a measured height. */
export function heightFromTags(tags: Record<string, string> | undefined): { height: number; estimated: boolean } | null {
  const measured = parseHeightTag(tags?.height);
  if (measured !== null) return { height: measured, estimated: false };
  const fromLevels = parseLevelsTag(tags?.['building:levels']);
  if (fromLevels !== null) return { height: fromLevels, estimated: true };
  return null;
}

/**
 * Displace a [lon, lat] point by `metres` along a compass `bearing`.
 *
 * Flat-earth approximation, which is correct to well under a metre at the
 * distances involved (shadows are clamped to 2 km) and avoids the trigonometry
 * of a full geodesic solve for every vertex of every building on screen.
 */
export function offsetPoint(
  lon: number,
  lat: number,
  metres: number,
  bearingDeg: number,
): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  const dNorth = metres * Math.cos(rad);
  const dEast = metres * Math.sin(rad);
  const dLat = dNorth / M_PER_DEG_LAT;
  const dLon = dEast / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [lon + dLon, lat + dLat];
}

/**
 * The rings that together cover one building's cast shadow.
 *
 * Returns the footprint, the footprint translated to where its roof outline
 * lands, and one quad per edge sweeping between the two. Their UNION is the
 * shadow; this function deliberately does not compute that union.
 *
 * Why not: a real polygon union would pull a boolean-geometry dependency into
 * the bundle (`@turf/union` is already noted in CLAUDE.md as vestigial and kept
 * out of the runtime for exactly this reason) and cost a lot of CPU per frame.
 * Instead the renderer accumulates every ring into a SINGLE canvas path and
 * fills it once — the nonzero winding rule then merges the overlaps for free,
 * and one fill means one uniform alpha instead of overlapping shapes stacking
 * into a darker blotch where buildings are dense. The union is done by the
 * rasteriser, which was going to rasterise them anyway.
 */
export function shadowRings(building: Building, sunAltitudeDeg: number, shadowBearingDeg: number): Ring[] {
  if (sunAltitudeDeg <= 0) return [];
  const raw = building.height / Math.tan((sunAltitudeDeg * Math.PI) / 180);
  const length = Math.min(raw, MAX_SHADOW_METRES);
  if (!Number.isFinite(length) || length <= 0) return [];

  const ring = building.ring;
  const translated: Ring = ring.map(([lon, lat]) => offsetPoint(lon, lat, length, shadowBearingDeg));

  const rings: Ring[] = [ring, translated];
  for (let i = 0; i < ring.length - 1; i++) {
    rings.push([ring[i], ring[i + 1], translated[i + 1], translated[i], ring[i]]);
  }
  return rings;
}

/**
 * Fetch buildings in `bbox` from Overpass, with the total building count.
 *
 * The `out count` statement runs over ALL buildings while only the ones with a
 * usable height tag are returned with geometry, so the coverage ratio costs one
 * round trip and a few bytes instead of downloading footprints we cannot use.
 */
export async function fetchBuildings(bbox: Bbox, signal?: AbortSignal): Promise<BuildingsResult> {
  const area = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query = `[out:json][timeout:60];way["building"](${area})->.all;.all out count;(way.all["building:levels"];way.all["height"];);out geom;`;

  const res = await fetch(OVERPASS_URL, { method: 'POST', body: query, signal });
  if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
  const data = (await res.json()) as { elements?: OverpassElement[] };

  const buildings: Building[] = [];
  let total = 0;
  for (const el of data.elements ?? []) {
    if (el.type === 'count') {
      total = Number.parseInt(el.tags?.ways ?? el.tags?.total ?? '0', 10) || 0;
      continue;
    }
    if (!el.geometry || el.geometry.length < 3) continue;
    const resolved = heightFromTags(el.tags);
    if (!resolved) continue;
    const ring: Ring = el.geometry.map((p) => [p.lon, p.lat]);
    // Overpass returns a closed way with a repeated last node, but not always —
    // close it explicitly so the edge sweep below never skips the final side.
    const [firstLon, firstLat] = ring[0];
    const [lastLon, lastLat] = ring[ring.length - 1];
    if (firstLon !== lastLon || firstLat !== lastLat) ring.push([firstLon, firstLat]);
    buildings.push({ ring, height: resolved.height, estimated: resolved.estimated });
  }

  // A bbox with no `count` element (older Overpass instances) must not report
  // 100 % coverage by accident — fall back to what we actually saw.
  if (total < buildings.length) total = buildings.length;

  return { buildings, total };
}

interface OverpassElement {
  type: string;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}
