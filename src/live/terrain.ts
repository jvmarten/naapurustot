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
 * Assemble the heightfield covering `bbox`, or null when the pyramid has nothing
 * there (outside Finland, or no terrain built at all).
 */
export async function loadHeightField(
  bbox: { west: number; south: number; east: number; north: number },
  mapZoom: number,
): Promise<HeightField | null> {
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

  // Step down a level at a time until the viewport fits the tile budget. A
  // country-wide camera then draws from a coarse level instead of issuing 190
  // requests.
  for (;;) {
    const [x0, y0, x1, y1, count] = span(z);
    tx0 = x0;
    ty0 = y0;
    tx1 = x1;
    ty1 = y1;
    if (count <= MAX_TILES || z <= AVAILABLE[0]) break;
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
  // resolution. The step-down loop above guarantees coverage; this only ever
  // moves up while coverage still fits, and it cannot go finer than the pyramid's
  // top, which is the level the street zooms were tuned on.
  while (z < AVAILABLE[AVAILABLE.length - 1]) {
    const [x0, y0, x1, y1, count] = span(z + 1);
    if (count > MAX_TILES || !M.zooms[String(z + 1)]) break;
    z += 1;
    tx0 = x0;
    ty0 = y0;
    tx1 = x1;
    ty1 = y1;
  }

  const size = M.tileSize;
  const cols = tx1 - tx0 + 1;
  const rows = ty1 - ty0 + 1;
  if (cols <= 0 || rows <= 0) return null;

  const entry = M.zooms[String(z)];
  if (!entry) return null;

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
      if (!tile) continue; // stays 0 — sea level
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
 * zoomed-out view unreadable. Nodes carry -1 rather than a tangent where the sun
 * is down, because there is no such thing as a shadow length there and the
 * twilight wash is what shades that ground.
 */
function altitudeGrid(field: HeightField, frame: SolarFrame): AltitudeGrid {
  const [west, south, east, north] = field.bbox;
  const tan = new Float32Array(SUN_GRID * SUN_GRID);
  const deg = new Float32Array(SUN_GRID * SUN_GRID);
  let maxDeg = -90;
  for (let r = 0; r < SUN_GRID; r++) {
    // Latitude is interpolated linearly in DEGREES rather than in the field's
    // Mercator rows. The lattice is a sampling of a smooth function, not a
    // registration of the raster, so the only thing that matters is that the
    // node's stated position is where its value was computed — and the sweep
    // interpolates in the same linear parameter it is indexed by.
    const lat = north + ((south - north) * r) / (SUN_GRID - 1);
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

  const stepMetres = Math.hypot(dx, dy) * cellMetres;
  const uniformTan = Math.tan((sunAltitudeDeg * Math.PI) / 180);

  // Grid-cell -> lattice-node scale, hoisted: the sweep runs per step and these
  // are the only two divisions in it.
  const gx = (SUN_GRID - 1) / Math.max(1, width - 1);
  const gy = (SUN_GRID - 1) / Math.max(1, height - 1);
  const tanGrid = grid?.tan;
  const degGrid = grid?.deg;

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
          if (h >= ceiling) {
            ceiling = h; // lit, and now the thing casting further down the line
            out[idx] = 0;
          } else {
            out[idx] = 255;
          }
        }
        ceiling -= stepMetres * tan;
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
