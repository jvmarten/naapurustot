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

/** A point in any planar space — lon/lat for geometry, pixels for rendering. */
export type Pt = [number, number];

/**
 * Shadow length in metres for a building of `height`, clamped.
 *
 * Split out from `shadowRings` so the renderer can compute the offset once in
 * screen space instead of re-deriving geodesic offsets per vertex per frame.
 */
export function shadowLengthMetres(height: number, sunAltitudeDeg: number): number {
  if (sunAltitudeDeg <= 0) return 0;
  const raw = height / Math.tan((sunAltitudeDeg * Math.PI) / 180);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, MAX_SHADOW_METRES);
}

/**
 * Swept shadow rings for an already-projected footprint, displaced by (dx, dy).
 *
 * The planar twin of `shadowRings`, for the render path: the caller projects each
 * footprint ONCE per camera position and then only has to move it by a pixel
 * vector as the sun changes, instead of re-projecting every vertex of every ring
 * on every frame. Same orientation normalisation, for the same load-bearing
 * reason — see `shadowRings`.
 */
/** The subset of Path2D the sweep emitter needs. Lets tests record the calls. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

/**
 * Emit one building's swept shadow straight into `sink`, allocating nothing.
 *
 * The allocation-free form matters more than it looks. Building the same rings
 * as arrays first cost ~3,600 throwaway arrays per frame across a screenful of
 * buildings, and the resulting GC churn — not the rasteriser — was what made
 * scrubbing the time slider run at 74 ms a step against 16 ms with the layer off.
 * `fill()` itself measured 0.05 ms.
 *
 * `points` MUST already be in a consistent orientation (see `orientProjected`),
 * which is why the footprint and its translation can be emitted verbatim. Each
 * sweep quad then picks its vertex order from the sign of cross(edge, offset) —
 * the quad's own signed area — so every ring agrees and the nonzero fill unions
 * them instead of cancelling. See `shadowRings` for what cancelling looks like.
 */
export function emitSweptPath(sink: PathSink, points: readonly Pt[], dx: number, dy: number): void {
  const n = points.length;
  if (n < 4) return;

  // Footprint.
  sink.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < n; i++) sink.lineTo(points[i][0], points[i][1]);
  sink.closePath();

  if (dx === 0 && dy === 0) return;

  // Translated copy — same winding, so no reordering needed.
  sink.moveTo(points[0][0] + dx, points[0][1] + dy);
  for (let i = 1; i < n; i++) sink.lineTo(points[i][0] + dx, points[i][1] + dy);
  sink.closePath();

  // One sweep quad per edge, wound to match.
  for (let i = 0; i < n - 1; i++) {
    const ax = points[i][0];
    const ay = points[i][1];
    const bx = points[i + 1][0];
    const by = points[i + 1][1];
    // Twice the quad's signed area, without building it.
    const cross = (bx - ax) * dy - (by - ay) * dx;
    // Only the light-facing edges are swept. cross === 0 is an edge parallel to
    // the offset (zero area, paints nothing); cross < 0 is a back-facing edge,
    // whose quad lies inside the union already formed by the footprint, the
    // translated copy and the front-facing quads. Skipping them halves the ring
    // count, which is what the renderer's cost is made of.
    //
    // This is an optimisation on a union, so it was checked by rendering rather
    // than by argument — the previous "obvious" reasoning about winding is what
    // made shadows invisible in the first place. Measured against the all-quads
    // build over the same viewport: 444,990 -> 444,977 painted pixels at 08:00,
    // 460,230 -> 460,225 at 13:30, 636,905 -> 636,901 at 18:00. That is a
    // 0.003 % difference, i.e. a few anti-aliased boundary pixels. Scrub cost
    // went from 55.7 to 27.2 ms a step.
    if (cross <= 0) continue;
    if (cross > 0) {
      sink.moveTo(ax, ay);
      sink.lineTo(bx, by);
      sink.lineTo(bx + dx, by + dy);
      sink.lineTo(ax + dx, ay + dy);
    } else {
      sink.moveTo(ax, ay);
      sink.lineTo(ax + dx, ay + dy);
      sink.lineTo(bx + dx, by + dy);
      sink.lineTo(bx, by);
    }
    sink.closePath();
  }
}

/** Normalise a projected footprint's orientation once, at projection time. */
export function orientProjected(points: Pt[]): Pt[] {
  return signedArea2(points) < 0 ? points.reverse() : points;
}

/**
 * Drop footprint vertices closer together than `minPx` on screen.
 *
 * Runs once per camera position, not per frame, so it is free at draw time — and
 * it pays off every frame, because the renderer's cost is dominated by the number
 * of Path2D calls (each vertex becomes one, times ~n+2 rings per building). A
 * LOD2 footprint carries architectural detail far below a pixel at city zooms;
 * removing it changes no visible silhouette.
 *
 * The first and last points are always kept so the ring stays closed, and a ring
 * that would collapse below a triangle is returned untouched rather than
 * degenerating into something that paints nothing.
 */
export function simplifyProjected(points: Pt[], minPx = 1.5): Pt[] {
  const n = points.length;
  if (n < 5) return points;
  const min2 = minPx * minPx;
  const out: Pt[] = [points[0]];
  for (let i = 1; i < n - 1; i++) {
    const last = out[out.length - 1];
    const ddx = points[i][0] - last[0];
    const ddy = points[i][1] - last[1];
    if (ddx * ddx + ddy * ddy >= min2) out.push(points[i]);
  }
  out.push(points[n - 1]);
  return out.length >= 4 ? out : points;
}

/**
 * Array form of {@link emitSweptPath}, for tests and non-canvas callers.
 *
 * Shares the emitter so the winding guarantees the tests assert are the same
 * ones the renderer actually relies on.
 */
export function sweptRings(points: readonly Pt[], dx: number, dy: number): Pt[][] {
  const rings: Pt[][] = [];
  let current: Pt[] | null = null;
  emitSweptPath(
    {
      moveTo(x, y) {
        current = [[x, y]];
      },
      lineTo(x, y) {
        current?.push([x, y]);
      },
      closePath() {
        if (current) {
          current.push([current[0][0], current[0][1]]);
          rings.push(current);
          current = null;
        }
      },
    },
    orientProjected(points.map(([x, y]) => [x, y] as Pt)),
    dx,
    dy,
  );
  return rings;
}

/** Twice the signed area of a ring. Positive = counter-clockwise in screen axes. */
export function signedArea2(ring: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum;
}

/**
 * Force a ring counter-clockwise (positive signed area).
 *
 * Not cosmetic — consistent orientation is what makes the single-path union in
 * `emitSweptPath` work at all. Orientation is normalised in the projected plane;
 * the canvas Y axis is flipped, so rings come out clockwise on screen, which is
 * equally fine — the nonzero rule only requires that they AGREE.
 */
export function orientRing<T extends readonly [number, number]>(ring: T[]): T[] {
  return signedArea2(ring) < 0 ? [...ring].reverse() : ring;
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
