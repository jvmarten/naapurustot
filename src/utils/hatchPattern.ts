/**
 * Runtime-generated diagonal-stripe hatch images for MapLibre `fill-pattern`
 * layers. Used by the no-data treatment (PO-1) and reused by later overlays
 * (PO-2 selection hatch, IN-1) — so the builder is intentionally generic.
 *
 * MapLibre images are stored on the map's style. A full style reload (e.g. a
 * `setStyle` swap) drops registered images, so callers should also wire up the
 * map's `styleimagemissing` event via `ensureHatchImage` — MapLibre fires it
 * whenever a layer references an image id that is not currently registered,
 * which transparently re-adds the pattern after any reload.
 */

import type maplibregl from 'maplibre-gl';

export interface HatchOptions {
  /** Stripe + background CSS color (e.g. '#94a3b8'). */
  color: string;
  /** Image edge length in device-independent px. Power-of-two keeps GL happy. */
  size?: number;
  /** Stroke width of each diagonal line in px. */
  lineWidth?: number;
  /** Spacing between stripe centers in px. */
  spacing?: number;
  /** Overall image opacity (0–1). Keeps the hatch subtle over the basemap. */
  opacity?: number;
}

/**
 * Render a tileable 45° diagonal-stripe pattern as an ImageData-compatible
 * object that `map.addImage` accepts ({ width, height, data }). Returns null
 * when a 2D canvas context is unavailable (e.g. SSR / headless without canvas).
 */
export function makeHatchImage(opts: HatchOptions): ImageData | null {
  const size = opts.size ?? 8;
  const lineWidth = opts.lineWidth ?? 1;
  const spacing = opts.spacing ?? 4;
  const opacity = opts.opacity ?? 0.5;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'square';

  // Draw 45° lines (top-left to bottom-right). Drawing offset copies above and
  // below the tile makes the stripes wrap seamlessly across tile edges.
  for (let offset = -size; offset < size * 2; offset += spacing) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + size, size);
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, size, size);
}

/** Image id for the no-data hatch in a given theme. Theme-suffixed so light
 *  and dark variants can coexist on the same style. */
export function noDataHatchId(theme: 'dark' | 'light'): string {
  return `hatch-no-data-${theme}`;
}

/** Subtle, theme-aware stripe color for the no-data hatch. */
function noDataHatchColor(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? '#64748b' : '#94a3b8';
}

/**
 * Idempotently register the no-data hatch image for `theme` on `map`, and wire
 * a one-time `styleimagemissing` handler so the image is re-added automatically
 * after any style reload. Safe to call repeatedly (per data/theme effect run).
 *
 * Returns the image id to reference from a `fill-pattern` paint property.
 */
export function ensureHatchImage(map: maplibregl.Map, theme: 'dark' | 'light'): string {
  const id = noDataHatchId(theme);
  addHatchIfMissing(map, id, theme);

  // Wire the missing-image fallback exactly once per map. MapLibre re-fires
  // styleimagemissing on reload for every still-referenced pattern id, so this
  // covers theme variants added later too. The flag lives on the map instance.
  const m = map as maplibregl.Map & { __hatchMissingWired?: boolean };
  if (!m.__hatchMissingWired) {
    m.__hatchMissingWired = true;
    map.on('styleimagemissing', (e) => {
      const requested = e.id;
      if (requested === noDataHatchId('dark')) addHatchIfMissing(map, requested, 'dark');
      else if (requested === noDataHatchId('light')) addHatchIfMissing(map, requested, 'light');
    });
  }
  return id;
}

function addHatchIfMissing(map: maplibregl.Map, id: string, theme: 'dark' | 'light'): void {
  if (map.hasImage(id)) return;
  const img = makeHatchImage({ color: noDataHatchColor(theme), size: 8, lineWidth: 1, spacing: 4, opacity: 0.5 });
  if (img) map.addImage(id, img, { pixelRatio: 2 });
}
