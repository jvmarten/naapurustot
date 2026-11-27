import { describe, it, expect } from 'vitest';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { guardRepeatedContextLoss } from '../utils/contextLossGuard';

// A stand-in for MapLibre 5.21's own context handlers, registered the way it does
// (bubble phase, on the canvas), with the same save/restore logic that crashes.
function fakeMap() {
  const canvas = document.createElement('canvas');
  const style = { imageManager: { images: {} as Record<string, unknown> }, serialize: () => ({ version: 8 }) };
  const map = {
    style: style as typeof style | null,
    lost: { style: null as unknown, images: null as unknown },
    getCanvas: () => canvas,
  };
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    map.lost = map.style ? { style: map.style.serialize(), images: {} } : { style: null, images: {} };
    map.style = null;
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    if (map.lost.style) map.style = style;
    // MapLibre's line: `{}` is truthy, so a null style throws here.
    if (map.lost.images) map.style!.imageManager.images = map.lost.images as Record<string, unknown>;
  }, false);
  return { map, canvas };
}

const fire = (canvas: HTMLCanvasElement, type: string) => {
  const ev = new Event(type, { cancelable: true });
  canvas.dispatchEvent(ev);
  return ev;
};

describe('guardRepeatedContextLoss (NAAPURUSTOT-WEB-V)', () => {
  it('reproduces the crash without the guard', () => {
    const { canvas } = fakeMap();
    fire(canvas, 'webglcontextlost');
    fire(canvas, 'webglcontextlost');
    // jsdom reports listener exceptions instead of rethrowing; capture them.
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault(); };
    window.addEventListener('error', onError);
    fire(canvas, 'webglcontextrestored');
    window.removeEventListener('error', onError);
    expect(String(errors[0])).toMatch(/imageManager/);
  });

  it('keeps the first saved style across a second loss, so restore succeeds', () => {
    const { map, canvas } = fakeMap();
    guardRepeatedContextLoss(map as unknown as MaplibreMap);
    expect(fire(canvas, 'webglcontextlost').defaultPrevented).toBe(true);
    const second = fire(canvas, 'webglcontextlost');
    expect(second.defaultPrevented).toBe(true); // still asks the browser to restore
    expect(map.lost.style).not.toBeNull();
    fire(canvas, 'webglcontextrestored');
    expect(map.style).not.toBeNull();
  });
});
