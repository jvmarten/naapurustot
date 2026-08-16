/**
 * Terrain shadows for /live/ — the layer that answers "does that hill shade me".
 *
 * Buildings and canopy stop at DETAIL_MIN_ZOOM because below it a roof is not a
 * pixel. Relief does not: a 60 m ridge at a 3 degree sun throws over a kilometre,
 * which is legible from a viewport spanning a province. So terrain is what the
 * shadow map IS when zoomed out, and it keeps casting underneath the buildings
 * when zoomed in — a building standing in a hill's shadow is in shade whatever
 * its own roof does.
 *
 * THE HEIGHTFIELD IS OURS, MIRRORED AT BUILD TIME. No free DEM tile endpoint
 * sends `Access-Control-Allow-Origin`, so a browser cannot read a third party's
 * elevation pixels at all — the canvas taints and getImageData throws. See
 * scripts/fetch_terrain_dem.py. Tiles are same-origin here, which is the only
 * reason this module can exist.
 *
 * COST. The sweep below is O(1) per cell — one pass over the grid, no ray
 * marching per pixel — because the light is parallel, so a single traversal in
 * the sun's direction can carry the running shadow ceiling with it. That is what
 * makes it cheap enough to recompute on every frame of a time scrub, which is the
 * whole point: a terrain shadow that lagged the slider would be worse than none.
 */
import manifest from '../data/terrain_manifest.json';
import { frameAltitude, type SolarFrame } from '../utils/sun';

interface ZoomEntry {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  tiles: number;
  bytes: number;
}

interface Manifest {
  path: string;
  tileSize: number;
  quant: number;
  bbox: [number, number, number, number];
  zooms: Record<string, ZoomEntry>;
}

const M = manifest as unknown as Manifest;
const BASE = import.meta.env.BASE_URL ?? '/';

/** Zoom levels the pyramid actually has, ascending. */
const AVAILABLE = Object.keys(M.zooms ?? {})
  .map(Number)
  .sort((a, b) => a - b);

/** True when a terrain pyramid was built at all. */
export function hasTerrain(): boolean {
  return AVAILABLE.length > 0;
}

/**
 * Largest number of DEM tiles we will pull for one viewport.
 *
 * The pyramid exists so that this bound can be honoured at every camera: without
 * it, a country-wide view at the finest level would ask for the entire z8 set —
 * ~190 requests and 4 MB — to fill a screen where each tile is eight pixels
 * across. `terrainZoomFor` steps down until the count fits, which is the same
 * trade the basemap makes and for the same reason.
 */
const MAX_TILES = 12;

/**
 * DEM zoom for a map zoom, capped by what the pyramid holds and by MAX_TILES.
 *
 * Deliberately coarser than the camera. A terrain shadow's edge is soft — it is
 * cast by a slope, not by a wall — so sampling relief at roughly a third of the
 * screen's resolution is invisible once the mask is drawn back with smoothing,
 * and it cuts the sweep's cell count by an order of magnitude.
 */
export function terrainZoomFor(mapZoom: number): number {
  if (!AVAILABLE.length) return 0;
  const wanted = Math.round(mapZoom) - 2;
  const max = AVAILABLE[AVAILABLE.length - 1];
  const min = AVAILABLE[0];
  return Math.max(min, Math.min(max, wanted));
}

function tileUrl(z: number, x: number, y: number): string {
  return (
    BASE +
    M.path.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  );
}

/** Decoded tile elevations in metres, row-major, tileSize². */
const tileCache = new Map<string, Promise<Float32Array | null>>();

async function loadTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const res = await fetch(tileUrl(z, x, y));
    // A missing tile is normal at the edges of coverage — sea, or outside the
    // built bbox. It reads as elevation zero, which is what the sea is.
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const size = M.tileSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const { data } = ctx.getImageData(0, 0, size, size);
    const out = new Float32Array(size * size);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      // R is the high byte, G the low — see fetch_terrain_dem.py.
      out[i] = (data[p] * 256 + data[p + 1]) * M.quant;
    }
    return out;
  })().catch(() => {
    // Drop the rejected promise so a later pan can retry rather than being stuck
    // on it forever — the same rule the building shards follow.
    tileCache.delete(key);
    return null;
  });

  tileCache.set(key, pending);
  return pending;
}

export interface HeightField {
  /** Elevations in metres, row-major, `width` × `height`. */
  data: Float32Array;
  width: number;
  height: number;
  /** Ground size of one cell in metres, at the field's centre latitude. */
  cellMetres: number;
  /** Geographic extent, [west, south, east, north]. */
  bbox: [number, number, number, number];
}

/** Web-Mercator tile coordinate (fractional) for a lon/lat. */
function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [x, y];
}

function tileToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * Latitude of a fractional grid ROW, for a field whose rows are Mercator.
 *
 * A HEIGHTFIELD ROW IS NOT A LATITUDE, AND THE DIFFERENCE IS NOT SMALL HERE. The
 * field is a slab of Web Mercator tiles, so row index is linear in Mercator y and
 * therefore NONLINEAR in latitude — and Mercator's mid-row sits well poleward of
 * the arithmetic mid-latitude (66.5°N against 60.1°N on a continental field).
 * Anything that walks the grid by row and needs to know where it is on the Earth
 * has to come through here; interpolating latitude linearly across the rows
 * instead puts a row up to 6.5° — some 720 km — from where it actually is.
 *
 * Returns a closure because both callers evaluate it many times over one field
 * and the two logarithms are what would otherwise be repeated.
 */
function rowToLat(field: HeightField): (row: number) => number {
  const [, south, , north] = field.bbox;
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const yNorth = merc(north);
  const ySouth = merc(south);
  const rows = Math.max(1, field.height - 1);
  return (row) => {
    const y = yNorth + ((ySouth - yNorth) * row) / rows;
    return (180 / Math.PI) * (2 * Math.atan(Math.exp(y)) - Math.PI / 2);
  };
}

/** Which pyramid level to read, and the tile rectangle to read from it. */
export interface TerrainLevel {
  z: number;
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
  /** False when even the coarsest level does not hold the whole viewport. */
  covered: boolean;
}

/**
 * Pick the pyramid level for a viewport: as fine as the budget allows, as coarse
 * as coverage demands.
 *
 * Exported for its own sake — it is pure, and it is where two separate classes of
 * bug have lived, while `loadHeightField` around it can only be exercised with a
 * network and a canvas.
 */
export function selectTerrainLevel(
  bbox: { west: number; south: number; east: number; north: number },
  mapZoom: number,
): TerrainLevel | null {
  if (!AVAILABLE.length) return null;

  let z = terrainZoomFor(mapZoom);
  let tx0 = 0;
  let ty0 = 0;
  let tx1 = 0;
  let ty1 = 0;

  /** Tile span of `bbox` at `level`, as [x0, y0, x1, y1, count]. */
  const span = (level: number): [number, number, number, number, number] => {
    const [ax, ay] = lonLatToTile(bbox.west, bbox.north, level);
    const [bx, by] = lonLatToTile(bbox.east, bbox.south, level);
    const x0 = Math.floor(ax);
    const y0 = Math.floor(ay);
    const x1 = Math.floor(bx);
    const y1 = Math.floor(by);
    return [x0, y0, x1, y1, (x1 - x0 + 1) * (y1 - y0 + 1)];
  };

  /**
   * Whether `level` actually holds every tile the viewport needs.
   *
   * A TIERED PYRAMID MAKES LEVEL CHOICE A COVERAGE QUESTION, NOT ONLY A COST ONE.
   * While every level shared one bbox, picking a level could never change what
   * ground was covered, so counting tiles was the whole decision. Now the levels
   * have deliberately different extents — and a camera over Norway at street zoom
   * asks for z8, which is Finland only. Nothing is in range, so the field comes
   * back null and the layer switches off over the most mountainous ground in the
   * dataset; a camera straddling the edge is worse, getting a half-populated
   * field whose missing half zero-fills into flat, lit ground.
   */
  const covers = (level: number, x0: number, y0: number, x1: number, y1: number): boolean => {
    const entry = M.zooms[String(level)];
    if (!entry) return false;
    return x0 >= entry.minX && x1 <= entry.maxX && y0 >= entry.minY && y1 <= entry.maxY;
  };

  // Step down a level at a time until the viewport both fits the tile budget and
  // is actually held at that level. A country-wide camera then draws from a
  // coarse level instead of issuing 190 requests, and a camera outside the fine
  // levels' extent falls back to one that reaches it rather than to nothing.
  for (;;) {
    const [x0, y0, x1, y1, count] = span(z);
    tx0 = x0;
    ty0 = y0;
    tx1 = x1;
    ty1 = y1;
    if ((count <= MAX_TILES && covers(z, x0, y0, x1, y1)) || z <= AVAILABLE[0]) break;
    z -= 1;
  }

  // AND THEN SPEND WHAT IS LEFT OF THE BUDGET.
  //
  // `terrainZoomFor` asks for a level about two below the camera, which is the
  // right trade for a shadow EDGE — it is cast by a slope, so it is soft, and
  // sampling it finely buys nothing. It is the wrong trade for the CASTER. At a
  // continental camera that rule picked ~4.6 km cells, and Finnish relief is
  // 50-200 m over a few kilometres, so the hills were averaged flat before the
  // sweep ever saw them: the zoomed-out map showed a sunlit half with no relief
  // on it at all, which is not what the country looks like at sunrise.
  //
  // The fix is free, which is why it is worth making. The sweep's cost is bounded
  // by MAX_TILES x tileSize² — by the TILE COUNT, not by the level — so a finer
  // level that still fits the budget costs nothing extra and doubles the linear
  // resolution. It cannot go finer than the pyramid's top, which is the level the
  // street zooms were tuned on.
  //
  // THE COVERAGE TEST IS NOT OPTIONAL HERE, IT IS THE WHOLE SAFETY OF THE CLIMB.
  // An earlier version of this loop asked only whether the finer level FIT, on
  // the reasoning that the descent above had already settled coverage. That was
  // true while all levels shared a bbox and false the moment they stopped: a
  // camera over Trondheim descends to z6, which covers it, and then climbs
  // 6 -> 7 -> 8 into a Finland-only level holding none of it, throwing away the
  // coverage the descent had found and blanking the layer entirely. Both loops
  // ask the same question because both loops can move the answer.
  while (z < AVAILABLE[AVAILABLE.length - 1]) {
    const [x0, y0, x1, y1, count] = span(z + 1);
    if (count > MAX_TILES || !covers(z + 1, x0, y0, x1, y1)) break;
    z += 1;
    tx0 = x0;
    ty0 = y0;
    tx1 = x1;
    ty1 = y1;
  }

  return { z, tx0, ty0, tx1, ty1, covered: covers(z, tx0, ty0, tx1, ty1) };
}

/**
 * Clip a chosen level's tile rectangle to the tiles that level actually holds.
 *
 * THE TILE BUDGET IS NOT ENFORCED AT THE PYRAMID'S FLOOR, which is what makes
 * this necessary rather than tidy. `selectTerrainLevel`'s descent stops
 * unconditionally once `z <= AVAILABLE[0]`, so the coarsest level is reached
 * without `count <= MAX_TILES` ever being applied to it — and /live/'s map sets
 * no `minZoom` and no `maxBounds`, so a pinch-out to a world view asks z3 for
 * its whole 8x8 grid against a budget of twelve tiles. That is a 16 MB field and
 * a sweep over four million cells, both of which the documented
 * `MAX_TILES x tileSize²` bound says cannot happen. z3's extent is 3..5 x 1..2,
 * so clipping turns sixty-four tiles into six.
 *
 * It is also the more accurate thing to do, not merely the cheaper one: tiles
 * outside the extent do not exist, so a rectangle including them is describing
 * ground the pyramid has nothing to say about. Clipped, the field covers what is
 * measured and the layer draws over that — the same silence it keeps when the
 * viewport misses the pyramid altogether.
 *
 * Returns null when the rectangle and the extent do not overlap at all. Exported
 * and pure for the reason `selectTerrainLevel` is: `loadHeightField` around it
 * needs a network and a canvas.
 */
export function clipLevelToExtent(level: TerrainLevel): TerrainLevel | null {
  const entry = M.zooms[String(level.z)];
  if (!entry) return null;
  const tx0 = Math.max(level.tx0, entry.minX);
  const ty0 = Math.max(level.ty0, entry.minY);
  const tx1 = Math.min(level.tx1, entry.maxX);
  const ty1 = Math.min(level.ty1, entry.maxY);
  if (tx1 < tx0 || ty1 < ty0) return null;
  return { ...level, tx0, ty0, tx1, ty1 };
}

/**
 * Assemble the heightfield covering `bbox`, or null when the pyramid has nothing
 * there (outside the mirrored extent, or no terrain built at all).
 */
export async function loadHeightField(
  bbox: { west: number; south: number; east: number; north: number },
  mapZoom: number,
): Promise<HeightField | null> {
  const selected = selectTerrainLevel(bbox, mapZoom);
  if (!selected) return null;
  const level = clipLevelToExtent(selected);
  if (!level) return null;
  const { z, tx0, ty0, tx1, ty1 } = level;

  const entry = M.zooms[String(z)];
  if (!entry) return null;

  const size = M.tileSize;
  const cols = tx1 - tx0 + 1;
  const rows = ty1 - ty0 + 1;
  if (cols <= 0 || rows <= 0) return null;

  const tiles = await Promise.all(
    Array.from({ length: cols * rows }, (_, i) => {
      const x = tx0 + (i % cols);
      const y = ty0 + Math.floor(i / cols);
      // Skip requests we know will 404 from the manifest rather than making the
      // browser find out — the edges of a viewport over the Gulf are mostly this.
      if (x < entry.minX || x > entry.maxX || y < entry.minY || y > entry.maxY) {
        return Promise.resolve(null);
      }
      return loadTile(z, x, y);
    }),
  );
  if (tiles.every((t) => t === null)) return null;

  const width = cols * size;
  const height = rows * size;
  const data = new Float32Array(width * height);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = tiles[r * cols + c];
      if (!tile) {
        /**
         * NOT ZERO. A MISSING TILE IS UNKNOWN GROUND, NOT SEA LEVEL.
         *
         * This block used to be `continue`, leaving the slab at its allocated 0
         * with the comment "stays 0 — sea level" — and nothing downstream could
         * tell that apart from a measured coastline. That conflation is what
         * CLAUDE.md's terrain invariant 16 is about: it rendered Norway as a
         * flat, fully-lit plain with a straight-edged seam where coverage
         * stopped. Widening the pyramid's coarse levels moved the seam out of
         * the common view; it did not fix the conflation, and `selectTerrainLevel`
         * has always been able to return a rectangle the level only partly holds
         * (its own `covered` flag says as much, and no production code read it).
         * The clip above removes the case where the whole tile is outside the
         * extent; this covers what is left — a tile inside the extent that 404s
         * or fails to decode, which the all-sea gaps in the mirrored pyramid
         * produce routinely.
         *
         * NaN rather than a sentinel elevation because it is the value that
         * cannot be mistaken for a measurement: every arithmetic path through it
         * yields NaN and every comparison against it is false, so code that
         * forgets to ask gets an obviously wrong answer instead of a plausible
         * one. The sweep asks (see `terrainShadowMask`).
         */
        for (let row = 0; row < size; row++) {
          const start = (r * size + row) * width + c * size;
          data.fill(NaN, start, start + size);
        }
        continue;
      }
      for (let row = 0; row < size; row++) {
        data.set(
          tile.subarray(row * size, row * size + size),
          (r * size + row) * width + c * size,
        );
      }
    }
  }

  const west = tileToLon(tx0, z);
  const east = tileToLon(tx1 + 1, z);
  const north = tileToLat(ty0, z);
  const south = tileToLat(ty1 + 1, z);
  const midLat = ((north + south) / 2) * (Math.PI / 180);
  // Mercator cell width in ground metres at the field's centre. The field spans
  // little enough latitude that one figure across it is well under a cell.
  const cellMetres = ((east - west) / width) * 111_320 * Math.cos(midLat);

  return { data, width, height, cellMetres, bbox: [west, south, east, north] };
}

/**
 * Nodes per axis in the local-altitude grid. See {@link altitudeGrid}.
 *
 * The sun's altitude over the ground is one of the smoothest fields there is —
 * a sinusoid with a 360° period in longitude — so a coarse lattice with bilinear
 * interpolation between the nodes is accurate to far better than the tenth of a
 * degree the mask is cached at. 33² nodes is a thousand `frameAltitude` calls
 * against up to a million cells swept, which is what keeps this free.
 */
const SUN_GRID = 33;

/** Solar altitude sampled on a lattice over the field, for interpolation. */
interface AltitudeGrid {
  /**
   * tan(altitude), floored at 0 where the sun is at or below the horizon.
   *
   * ZERO RATHER THAN A SENTINEL, and that is load-bearing. Both arrays are
   * interpolated between nodes, so a magic value would be averaged against real
   * tangents in every cell the terminator crosses — and the alternative, treating
   * any cell with one foot in the dark as wholly dark, blanks the relief across a
   * whole lattice cell, which at a continental field is ~100 km of SUNLIT ground
   * beside the line. Zero is not a sentinel here but the correct limit: a shadow
   * is cot(altitude) long, so it grows without bound as the sun reaches the
   * horizon, and a descent rate going to zero is exactly that.
   */
  tan: Float32Array;
  /** Altitude in degrees, which is what decides night — see the note above. */
  deg: Float32Array;
  /** Highest altitude anywhere on the lattice, degrees. */
  maxDeg: number;
}

/**
 * Sample the sun's altitude across a heightfield.
 *
 * WHY THIS IS NOT ONE NUMBER. A heightfield at a continental camera spans
 * thousands of kilometres, and the sun does not have one altitude over that: at
 * the instant this was written the frame ran from -12.9° over Denmark to +8.5°
 * over the White Sea. Shadow length is cot(altitude), so using the map centre's
 * value everywhere stretched every shadow in the sunlit north-east by a factor of
 * eighty-five and painted the continent in streaks — the failure that made the
 * zoomed-out view unreadable.
 *
 * THE LATTICE IS INDEXED THE WAY THE SWEEP READS IT. `locate` finds a node from a
 * field row by a plain linear scale, so a node's stated position has to be the
 * latitude of the row that scale maps to it — which is a MERCATOR interpolation,
 * not a linear one in degrees. Getting that wrong is not a rounding error: on a
 * continental field it handed row 279 the sun computed for 58.3°N when the row is
 * really at 64.8°N, turning a genuine +1.1° sun into a −2.6° one and declaring a
 * whole band of sunlit ground to be night. It is also one-signed, so it does not
 * average out. See {@link rowToLat}.
 */
function altitudeGrid(field: HeightField, frame: SolarFrame): AltitudeGrid {
  const [west, , east] = field.bbox;
  const tan = new Float32Array(SUN_GRID * SUN_GRID);
  const deg = new Float32Array(SUN_GRID * SUN_GRID);
  const toLat = rowToLat(field);
  const rowSpan = Math.max(1, field.height - 1);
  let maxDeg = -90;
  for (let r = 0; r < SUN_GRID; r++) {
    // The field row this node stands for, then that row's true latitude. The
    // sweep's `locate` maps row -> node with exactly this scale, so the two
    // agree by construction rather than by coincidence.
    const lat = toLat((r * rowSpan) / (SUN_GRID - 1));
    for (let c = 0; c < SUN_GRID; c++) {
      const lon = west + ((east - west) * c) / (SUN_GRID - 1);
      const a = frameAltitude(frame, lat, lon);
      if (a > maxDeg) maxDeg = a;
      const i = r * SUN_GRID + c;
      deg[i] = a;
      tan[i] = a > 0 ? Math.tan((a * Math.PI) / 180) : 0;
    }
  }
  return { tan, deg, maxDeg };
}

/**
 * Which cells the terrain puts in shade, as one byte per cell (255 = shadowed).
 *
 * A SINGLE SWEEP, NOT A RAY PER CELL. The sun is effectively at infinity, so
 * every shadow ray through the field is parallel. Walking the grid along that
 * shared direction lets one traversal carry a running "shadow ceiling": step by
 * step the ceiling descends by `tan(altitude)` times the ground covered, and any
 * cell whose terrain reaches above it is lit and becomes the new ceiling. Every
 * cell is then touched once, independent of how far its shadow reaches — where
 * marching a ray per cell would cost O(n) each and make a low sun, whose rays are
 * longest, the slowest case. Here a low sun costs exactly what a high one does.
 *
 * WHAT VARIES ACROSS THE FIELD AND WHAT DOES NOT. Given a `frame`, the descent
 * rate is resampled at every step from {@link altitudeGrid}, so a shadow shortens
 * as it runs into ground where the sun is higher. The DIRECTION stays a single
 * bearing, taken at the map centre: the running-ceiling formulation is what makes
 * this O(1) per cell, and it exists only because every ray is parallel — bending
 * them per cell would curve the traversal and start missing and double-visiting
 * cells. The residual error is real and bounded: across a continental frame the
 * solar azimuth spans about 30°, so a shadow drawn at the centre's bearing lands
 * off-true by a fraction of its own length near the edges. That is a soft error
 * in a soft-edged layer, and it is the price of being able to recompute the whole
 * field on every tick of the time scrubber.
 *
 * Returns null when the sun is at or below the horizon EVERYWHERE in the field:
 * "everything is shaded" is the caller's business (it washes the viewport), not a
 * mask. With a frame that test is per-field rather than per-centre, so a viewport
 * straddling the terminator still gets relief on its sunlit half.
 */
export function terrainShadowMask(
  field: HeightField,
  sunAltitudeDeg: number,
  shadowBearingDeg: number,
  frame?: SolarFrame,
): Uint8ClampedArray | null {
  const grid = frame ? altitudeGrid(field, frame) : null;
  // Without a frame the caller is asking the old question — one altitude for the
  // whole field — and gets the old answer.
  if ((grid ? grid.maxDeg : sunAltitudeDeg) <= 0) return null;

  const { data, width, height, cellMetres } = field;
  const out = new Uint8ClampedArray(width * height);

  // Screen/grid direction the shadows run: bearing is clockwise from north, and
  // grid rows increase southward.
  const rad = (shadowBearingDeg * Math.PI) / 180;
  let dx = Math.sin(rad);
  let dy = -Math.cos(rad);
  const scale = Math.max(Math.abs(dx), Math.abs(dy));
  if (scale < 1e-9) return null;
  // Normalise so the dominant axis advances exactly one cell per step; the sweep
  // then visits every cell on its line without gaps or double-counting.
  dx /= scale;
  dy /= scale;

  /** Cells covered per step. Multiplied by the row's own cell size, below. */
  const stepCells = Math.hypot(dx, dy);
  const uniformTan = Math.tan((sunAltitudeDeg * Math.PI) / 180);

  // Grid-cell -> lattice-node scale, hoisted: the sweep runs per step and these
  // are the only two divisions in it.
  const gx = (SUN_GRID - 1) / Math.max(1, width - 1);
  const gy = (SUN_GRID - 1) / Math.max(1, height - 1);
  const tanGrid = grid?.tan;
  const degGrid = grid?.deg;

  /**
   * Ground size of a cell on each row, relative to the field's nominal figure.
   *
   * A MERCATOR CELL IS NOT A FIXED NUMBER OF METRES. It shrinks as cos(latitude),
   * and `cellMetres` is one sample of that taken at the field's centre — a fair
   * approximation for a city viewport, which is what it was written for, and a
   * large error for a field spanning a continent. Over 52°N..72°N the true cell
   * runs 1490 m at the south edge to 740 m at the north while the nominal figure
   * says 1132 m throughout, so the descent rate — and therefore every shadow
   * LENGTH, since the two are proportional — comes out 32 % long in the Baltic
   * and 35 % short in Lapland. At a grazing sun a 300 m fell throws over 100
   * cells, so that is tens of kilometres of error in the visible picture.
   *
   * O(height) to build against an O(width x height) sweep, and it is a pure
   * multiplier, so nothing about the traversal changes.
   */
  const rowMetres = new Float32Array(height);
  {
    const toLat = rowToLat(field);
    // Referenced to the same latitude `loadHeightField` used for `cellMetres`,
    // so the scale is exactly 1 there and small fields are untouched.
    const [, south, , north] = field.bbox;
    const refCos = Math.cos((((north + south) / 2) * Math.PI) / 180) || 1;
    for (let r = 0; r < height; r++) {
      rowMetres[r] = (cellMetres * Math.cos((toLat(r) * Math.PI) / 180)) / refCos;
    }
  }

  // Bilinear weights for a fractional cell, resolved once and read by both
  // lattices. Clamped at the edges so the sweep's out-of-bounds lead-in keeps
  // descending at the rate of the ground it is about to reach.
  let wi = 0;
  let wtx = 0;
  let wty = 0;
  const locate = (x: number, y: number): void => {
    const fx = Math.min(SUN_GRID - 1, Math.max(0, x * gx));
    const fy = Math.min(SUN_GRID - 1, Math.max(0, y * gy));
    const c0 = Math.min(SUN_GRID - 2, Math.floor(fx));
    const r0 = Math.min(SUN_GRID - 2, Math.floor(fy));
    wtx = fx - c0;
    wty = fy - r0;
    wi = r0 * SUN_GRID + c0;
  };
  const sample = (g: Float32Array): number => {
    const a = g[wi];
    const b = g[wi + 1];
    const c = g[wi + SUN_GRID];
    const d = g[wi + SUN_GRID + 1];
    return a + (b - a) * wtx + (c - a) * wty + (a - b - c + d) * wtx * wty;
  };

  /** Walk one line from (sx, sy) along the shadow direction to the far edge. */
  const sweep = (sx: number, sy: number): void => {
    let x = sx;
    let y = sy;
    let ceiling = -Infinity;
    while (x >= -0.5 && y >= -0.5 && x < width + 0.5 && y < height + 0.5) {
      const ix = Math.round(x);
      const iy = Math.round(y);
      let tan = uniformTan;
      let night = false;
      if (tanGrid && degGrid) {
        locate(x, y);
        // The terminator is decided from the interpolated ALTITUDE, per step, so
        // it lands where it actually falls rather than being rounded out to the
        // lattice cell that happens to contain it.
        night = sample(degGrid) <= 0;
        tan = sample(tanGrid);
      }
      if (night) {
        // Past the terminator. There is no shadow here to compute — the ground is
        // in night, which the twilight wash paints — and carrying a ceiling across
        // the line would let the dark side cast back into the lit one.
        if (ix >= 0 && iy >= 0 && ix < width && iy < height) out[iy * width + ix] = 0;
        ceiling = -Infinity;
      } else {
        if (ix >= 0 && iy >= 0 && ix < width && iy < height) {
          const idx = iy * width + ix;
          const h = data[idx];
          if (h !== h) {
            // UNKNOWN GROUND (NaN — see loadHeightField). We do not know whether
            // it stands in the light, so the layer says nothing about it: alpha
            // 0, which draws no shade and no relief, the same silence the layer
            // keeps outside the field altogether. What it must not do is answer
            // the question anyway — `NaN >= ceiling` is false, so without this
            // branch every unmeasured cell would have been declared shadowed.
            //
            // The ceiling is CARRIED rather than reset. A shadow's height above
            // sea level at a given distance is set by its caster and the sun, not
            // by the ground it passes over, so a real ridge whose shadow crosses
            // an unmapped gap and reaches mapped ground beyond still shades it
            // correctly. Resetting would draw a lit stripe just past every gap —
            // an artefact, and no better informed.
            out[idx] = 0;
          } else if (h >= ceiling) {
            ceiling = h; // lit, and now the thing casting further down the line
            out[idx] = 0;
          } else {
            out[idx] = 255;
          }
        }
        // The step's ground length at THIS row's latitude — see `rowMetres`.
        // Clamped rather than skipped off the ends so the out-of-bounds lead-in
        // still descends, at the rate of the ground it is about to reach.
        ceiling -=
          stepCells * tan * rowMetres[iy < 0 ? 0 : iy >= height ? height - 1 : iy];
      }
      x += dx;
      y += dy;
    }
  };

  // Seed from the two edges the light enters through. Both are needed: a line
  // entering through the left edge only covers cells the drift keeps in frame, so
  // the top or bottom edge has to seed the rest.
  if (dx > 0) for (let y = 0; y < height; y++) sweep(0, y);
  else if (dx < 0) for (let y = 0; y < height; y++) sweep(width - 1, y);
  if (dy > 0) for (let x = 0; x < width; x++) sweep(x, 0);
  else if (dy < 0) for (let x = 0; x < width; x++) sweep(x, height - 1);

  return out;
}
