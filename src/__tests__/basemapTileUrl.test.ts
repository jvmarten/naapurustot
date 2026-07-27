import { describe, it, expect, afterEach } from 'vitest';
import { basemapTileUrl } from '../utils/basemap';

/**
 * The @2x basemap URLs come from `.env`, which is tracked and hardcodes them, so
 * Vite bakes `@2x` into the bundle and the `|| 'https://…@2x.png'` default in
 * each map component never executes. Any fix that edits those defaults is a
 * no-op — the rewrite must happen on the resolved value, which is what these
 * tests pin.
 */

const LIGHT = 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const LABELS = 'https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png';

const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');

function setDpr(value: unknown) {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(window, 'devicePixelRatio', original);
});

describe('basemapTileUrl', () => {
  it('drops @2x on a standard-density screen', () => {
    setDpr(1);
    expect(basemapTileUrl(LIGHT)).toBe('https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png');
    expect(basemapTileUrl(LABELS)).toBe('https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png');
  });

  it('keeps @2x on retina and other high-density screens', () => {
    for (const dpr of [1.5, 2, 3]) {
      setDpr(dpr);
      expect(basemapTileUrl(LIGHT), `dpr ${dpr}`).toBe(LIGHT);
    }
  });

  it('keeps @2x when the ratio is unreported or nonsensical', () => {
    // Never degrade quality on a guess — only on a screen we can identify.
    for (const dpr of [undefined, null, NaN, Infinity, 'two']) {
      setDpr(dpr);
      expect(basemapTileUrl(LIGHT), String(dpr)).toBe(LIGHT);
    }
  });

  it('leaves a URL that has no @2x marker untouched', () => {
    setDpr(1);
    const plain = 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
    expect(basemapTileUrl(plain)).toBe(plain);
  });

  it('only strips the marker before the extension, not an @2x elsewhere in the URL', () => {
    setDpr(1);
    const tricky = 'https://tiles.example.com/@2x-style/{z}/{x}/{y}@2x.png';
    expect(basemapTileUrl(tricky)).toBe('https://tiles.example.com/@2x-style/{z}/{x}/{y}.png');
  });

  it('handles a query string after the extension', () => {
    setDpr(1);
    const withQuery = 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png?key=abc';
    expect(basemapTileUrl(withQuery)).toBe('https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=abc');
  });
});
