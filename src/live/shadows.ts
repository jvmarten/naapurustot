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
 *
 * It doubles as the natural bound on how far outside the viewport a building can
 * still matter, which is what {@link padBbox} is asked for — see the renderer.
 */
export const MAX_SHADOW_METRES = 2_000;

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

// ---------------------------------------------------------------------------
// Web Mercator
// ---------------------------------------------------------------------------

/**
 * Project lon/lat into the Web Mercator unit square (0..1, y increasing south).
 *
 * The renderer keeps every footprint in this space rather than in lon/lat,
 * because at pitch 0 the map from Mercator to SCREEN is a plain affine one —
 * scale, rotate, translate. That turns re-projecting a screenful of buildings
 * into four multiply-adds per vertex instead of a `map.project()` call per
 * vertex, which is the difference between rendering a few hundred buildings at
 * street zoom and rendering ten thousand at city zoom (see `projectPrepared`).
 */
export function lonLatToMercator(lon: number, lat: number): Pt {
  // Clamped to the square Mercator domain; beyond ±85.05° the log diverges.
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.999_999), 0.999_999);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

/** Inverse of {@link lonLatToMercator}. */
export function mercatorToLonLat(x: number, y: number): Pt {
  return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI];
}

/**
 * The affine map from Mercator unit-square coordinates to screen pixels.
 *
 * Deliberately CALIBRATED from the live map rather than derived from MapLibre's
 * internals (world size, tile size, bearing sign): three `map.project()` calls
 * pin it exactly, for any zoom and any rotation, with no assumption that can
 * drift when the renderer changes. It is exact only while pitch is 0, which is
 * why /live/ pins `maxPitch: 0`.
 */
export interface Affine {
  /** Mercator coordinates the transform is expressed relative to. */
  ox: number;
  oy: number;
  /** Screen position of that origin. */
  px: number;
  py: number;
  /** d(screen)/d(mercator x). */
  ax: number;
  ay: number;
  /** d(screen)/d(mercator y). */
  bx: number;
  by: number;
}

/**
 * A footprint held in Mercator space with reusable screen-space scratch buffers.
 *
 * Two buffers rather than an array of points: the per-frame emitter walks them
 * with plain indexed reads, so a camera change refills existing memory instead
 * of allocating ~135,000 two-element arrays for a city-zoom viewport. The GC
 * churn from doing that per frame — not the rasteriser — is what used to pin a
 * time-slider scrub at single-digit fps.
 */
export interface PreparedBuilding {
  /** Vertex coordinates in the Mercator unit square. */
  mx: Float64Array;
  my: Float64Array;
  /** Metres. */
  height: number;
  /** Screen-space vertices for the current camera; only the first `sn` are valid. */
  sx: Float64Array;
  sy: Float64Array;
  sn: number;
  /** Screen-space bounds of the footprint, for viewport and sub-pixel culling. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Convert a fetched building into the render-path representation, once. */
export function prepareBuilding(b: Building): PreparedBuilding {
  const n = b.ring.length;
  const mx = new Float64Array(n);
  const my = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y] = lonLatToMercator(b.ring[i][0], b.ring[i][1]);
    mx[i] = x;
    my[i] = y;
  }
  return {
    mx,
    my,
    height: b.height,
    sx: new Float64Array(n),
    sy: new Float64Array(n),
    sn: 0,
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
  };
}

/**
 * Project a footprint to screen space, simplify it, and normalise its winding.
 *
 * All three in one pass, because they are all O(vertices) and this runs over
 * every building on a camera change. Vertices closer together than `minPx` are
 * dropped: a LOD2 footprint carries architectural detail far below a pixel at
 * city zooms, and the renderer's cost is dominated by the number of Path2D calls
 * (each kept vertex becomes one, times ~n+2 rings per building).
 *
 * Orientation is normalised LAST, after simplification, because dropping
 * vertices can in principle flip the sign of a near-degenerate ring's area — and
 * a single ring winding the wrong way SUBTRACTS itself from the nonzero-fill
 * union instead of joining it, which renders as a hole in the shadow.
 */
export function projectPrepared(p: PreparedBuilding, t: Affine, minPx: number): void {
  const n = p.mx.length;
  const { mx, my, sx, sy } = p;
  const min2 = minPx * minPx;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let out = 0;

  for (let i = 0; i < n; i++) {
    const dx = mx[i] - t.ox;
    const dy = my[i] - t.oy;
    const x = t.px + t.ax * dx + t.bx * dy;
    const y = t.py + t.ay * dx + t.by * dy;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    // The first and last vertices are always kept, so the ring stays closed.
    if (out === 0 || i === n - 1) {
      sx[out] = x;
      sy[out] = y;
      out++;
      continue;
    }
    const ex = x - sx[out - 1];
    const ey = y - sy[out - 1];
    if (ex * ex + ey * ey >= min2) {
      sx[out] = x;
      sy[out] = y;
      out++;
    }
  }

  // The ring collapsed below a drawable polygon, so the whole footprint is about
  // a pixel across. Stand it in with its own bounding box rather than restoring
  // every vertex: at that size the two are indistinguishable on screen, and the
  // difference is five Path2D calls against however many a LOD2 outline carries
  // — which is what decides whether a zoomed-out city renders at all.
  if (out < 4) {
    if (n >= 5) {
      sx[0] = minX;
      sy[0] = minY;
      sx[1] = maxX;
      sy[1] = minY;
      sx[2] = maxX;
      sy[2] = maxY;
      sx[3] = minX;
      sy[3] = maxY;
      sx[4] = minX;
      sy[4] = minY;
      out = 5;
    } else {
      // Too few vertices to hold a box — a triangle, at most. Keep it whole.
      for (let i = 0; i < n; i++) {
        const dx = mx[i] - t.ox;
        const dy = my[i] - t.oy;
        sx[i] = t.px + t.ax * dx + t.bx * dy;
        sy[i] = t.py + t.ay * dx + t.by * dy;
      }
      out = n;
    }
  }

  if (signedArea2Flat(sx, sy, out) < 0) {
    for (let i = 0, j = out - 1; i < j; i++, j--) {
      const tx = sx[i];
      const ty = sy[i];
      sx[i] = sx[j];
      sy[i] = sy[j];
      sx[j] = tx;
      sy[j] = ty;
    }
  }

  p.sn = out;
  p.minX = minX;
  p.minY = minY;
  p.maxX = maxX;
  p.maxY = maxY;
}

// ---------------------------------------------------------------------------
// Bounding boxes
// ---------------------------------------------------------------------------

/** Grow a bbox by `metres` on every side. */
export function padBbox(bbox: Bbox, metres: number): Bbox {
  const dLat = metres / M_PER_DEG_LAT;
  const midLat = (bbox.south + bbox.north) / 2;
  const dLon = metres / (M_PER_DEG_LAT * Math.max(Math.cos((midLat * Math.PI) / 180), 0.01));
  return {
    south: bbox.south - dLat,
    north: bbox.north + dLat,
    west: bbox.west - dLon,
    east: bbox.east + dLon,
  };
}

/** Approximate area of a bbox in km², good enough to budget a request against. */
export function bboxAreaKm2(bbox: Bbox): number {
  const midLat = (bbox.south + bbox.north) / 2;
  const h = ((bbox.north - bbox.south) * M_PER_DEG_LAT) / 1000;
  const w = ((bbox.east - bbox.west) * M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180)) / 1000;
  return Math.max(0, h) * Math.max(0, w);
}

/** True when `outer` fully contains `inner`. */
export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    outer.south <= inner.south &&
    outer.north >= inner.north &&
    outer.west <= inner.west &&
    outer.east >= inner.east
  );
}

/** True when the two boxes share any area at all. */
export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;
}

/**
 * `area` minus `hole`, as up to four disjoint rectangles.
 *
 * Used to ask Overpass only for the part of the viewport a prebuilt city-model
 * shard does not already cover. Disjoint matters twice over: the strips cannot
 * double-count a building in the coverage denominator, and no footprint gets
 * drawn (and shaded) twice from two sources.
 *
 * Returns `[area]` unchanged when the two do not overlap, and `[]` when the hole
 * swallows the area completely.
 */
export function bboxSubtract(area: Bbox, hole: Bbox): Bbox[] {
  if (!bboxIntersects(area, hole)) return [area];
  const out: Bbox[] = [];
  if (area.north > hole.north) {
    out.push({ ...area, south: Math.max(area.south, hole.north) });
  }
  if (area.south < hole.south) {
    out.push({ ...area, north: Math.min(area.north, hole.south) });
  }
  // The left/right strips are trimmed to the band the hole actually spans, so
  // they never overlap the top/bottom ones.
  const south = Math.max(area.south, hole.south);
  const north = Math.min(area.north, hole.north);
  if (north > south) {
    if (area.west < hole.west) {
      out.push({ south, north, west: area.west, east: Math.min(area.east, hole.west) });
    }
    if (area.east > hole.east) {
      out.push({ south, north, west: Math.max(area.west, hole.east), east: area.east });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sweep emitter
// ---------------------------------------------------------------------------

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
 * The vertices MUST already be in a consistent orientation (see
 * `projectPrepared`), which is why the footprint and its translation can be
 * emitted verbatim. Each sweep quad then picks its vertex order from the sign of
 * cross(edge, offset) — the quad's own signed area — so every ring agrees and the
 * nonzero fill unions them instead of cancelling.
 */
export function emitSweptFlat(
  sink: PathSink,
  xs: Float64Array,
  ys: Float64Array,
  n: number,
  dx: number,
  dy: number,
): void {
  if (n < 4) return;

  // Footprint.
  sink.moveTo(xs[0], ys[0]);
  for (let i = 1; i < n; i++) sink.lineTo(xs[i], ys[i]);
  sink.closePath();

  if (dx === 0 && dy === 0) return;

  // Translated copy — same winding, so no reordering needed.
  sink.moveTo(xs[0] + dx, ys[0] + dy);
  for (let i = 1; i < n; i++) sink.lineTo(xs[i] + dx, ys[i] + dy);
  sink.closePath();

  // One sweep quad per light-facing edge.
  for (let i = 0; i < n - 1; i++) {
    const ax = xs[i];
    const ay = ys[i];
    const bx = xs[i + 1];
    const by = ys[i + 1];
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
    sink.moveTo(ax, ay);
    sink.lineTo(bx, by);
    sink.lineTo(bx + dx, by + dy);
    sink.lineTo(ax + dx, ay + dy);
    sink.closePath();
  }
}

/**
 * Array form of {@link emitSweptFlat}, for tests and non-canvas callers.
 *
 * Shares the emitter so the winding guarantees the tests assert are the same
 * ones the renderer actually relies on.
 */
export function emitSweptPath(sink: PathSink, points: readonly Pt[], dx: number, dy: number): void {
  const n = points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = points[i][0];
    ys[i] = points[i][1];
  }
  emitSweptFlat(sink, xs, ys, n, dx, dy);
}

/** Normalise a projected footprint's orientation once, at projection time. */
export function orientProjected(points: Pt[]): Pt[] {
  return signedArea2(points) < 0 ? points.reverse() : points;
}

/**
 * Drop footprint vertices closer together than `minPx` on screen.
 *
 * The array twin of the simplification pass inside {@link projectPrepared},
 * kept for callers that hold points rather than the render path's flat buffers.
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
 * The emitter's output as explicit rings, for tests and non-canvas callers.
 *
 * Orients the input first, exactly as the render path does, so what the tests
 * assert about winding is what the renderer actually relies on.
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

/** Twice the signed area of a ring held in parallel coordinate buffers. */
export function signedArea2Flat(xs: Float64Array, ys: Float64Array, n: number): number {
  let sum = 0;
  for (let i = 0; i < n - 1; i++) {
    sum += xs[i] * ys[i + 1] - xs[i + 1] * ys[i];
  }
  return sum;
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
 * `emitSweptFlat` work at all. Orientation is normalised in the projected plane;
 * the canvas Y axis is flipped, so rings come out clockwise on screen, which is
 * equally fine — the nonzero rule only requires that they AGREE.
 */
export function orientRing<T extends readonly [number, number]>(ring: T[]): T[] {
  return signedArea2(ring) < 0 ? [...ring].reverse() : ring;
}

/**
 * Shadow length in metres for a building of `height`, clamped.
 *
 * Split out from the emitter so the renderer can compute the offset once in
 * screen space instead of re-deriving geodesic offsets per vertex per frame.
 */
export function shadowLengthMetres(height: number, sunAltitudeDeg: number): number {
  if (sunAltitudeDeg <= 0) return 0;
  const raw = height / Math.tan((sunAltitudeDeg * Math.PI) / 180);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, MAX_SHADOW_METRES);
}

/**
 * Fetch buildings in `bboxes` from Overpass, with the total building count.
 *
 * Takes a LIST of boxes so a viewport that is only partly covered by a prebuilt
 * city-model shard can ask for the remainder in one round trip (see
 * {@link bboxSubtract}). Overpass unions sets by element id, so a building
 * straddling two strips is fetched — and counted — once.
 *
 * The `out count` statement runs over ALL buildings while only the ones with a
 * usable height tag are returned with geometry, so the coverage ratio costs one
 * round trip and a few bytes instead of downloading footprints we cannot use.
 */
export async function fetchBuildings(bboxes: Bbox[], signal?: AbortSignal): Promise<BuildingsResult> {
  if (bboxes.length === 0) return { buildings: [], total: 0 };
  const areas = bboxes
    .map((b) => `way["building"](${b.south},${b.west},${b.north},${b.east});`)
    .join('');
  const query = `[out:json][timeout:90];(${areas})->.all;.all out count;(way.all["building:levels"];way.all["height"];);out geom;`;

  const res = await fetch(OVERPASS_URL, { method: 'POST', body: query, signal });
  if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
  const data = (await res.json()) as { elements?: OverpassElement[]; remark?: string };

  // Overpass reports a server-side timeout or a rate-limit rejection as HTTP 200
  // with a `remark` and no element list. Reading that as an empty result would
  // put "0 of 0 buildings have height data" on screen — a confident statement
  // about a place we never actually asked about.
  if (!Array.isArray(data.elements)) {
    throw new Error(`Overpass returned no result set${data.remark ? `: ${data.remark}` : ''}`);
  }

  const buildings: Building[] = [];
  let total = 0;
  for (const el of data.elements) {
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
