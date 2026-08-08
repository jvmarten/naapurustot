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

  // Step down a level at a time until the viewport fits the tile budget. A
  // country-wide camera then draws from z6 instead of issuing 190 requests.
  for (;;) {
    const [ax, ay] = lonLatToTile(bbox.west, bbox.north, z);
    const [bx, by] = lonLatToTile(bbox.east, bbox.south, z);
    tx0 = Math.floor(ax);
    ty0 = Math.floor(ay);
    tx1 = Math.floor(bx);
    ty1 = Math.floor(by);
    const count = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
    if (count <= MAX_TILES || z <= AVAILABLE[0]) break;
    z -= 1;
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
 * Returns null when the sun is at or below the horizon: "everything is shaded" is
 * the caller's business (it fills the viewport), not a mask.
 */
export function terrainShadowMask(
  field: HeightField,
  sunAltitudeDeg: number,
  shadowBearingDeg: number,
): Uint8ClampedArray | null {
  if (sunAltitudeDeg <= 0) return null;

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
  const drop = stepMetres * Math.tan((sunAltitudeDeg * Math.PI) / 180);

  /** Walk one line from (sx, sy) along the shadow direction to the far edge. */
  const sweep = (sx: number, sy: number): void => {
    let x = sx;
    let y = sy;
    let ceiling = -Infinity;
    while (x >= -0.5 && y >= -0.5 && x < width + 0.5 && y < height + 0.5) {
      const ix = Math.round(x);
      const iy = Math.round(y);
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
      x += dx;
      y += dy;
      ceiling -= drop;
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
