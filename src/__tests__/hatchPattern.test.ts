import { describe, it, expect } from 'vitest';
import { makeHatchImage, noDataHatchId } from '../utils/hatchPattern';

describe('hatchPattern', () => {
  it('gives distinct, theme-suffixed image ids', () => {
    expect(noDataHatchId('light')).toBe('hatch-no-data-light');
    expect(noDataHatchId('dark')).toBe('hatch-no-data-dark');
    expect(noDataHatchId('light')).not.toBe(noDataHatchId('dark'));
  });

  it('returns null (not a throw) when a 2D canvas context is unavailable', () => {
    // jsdom without the `canvas` package returns null from getContext('2d').
    // The builder must degrade gracefully so map setup never crashes.
    const hasCtx =
      typeof document !== 'undefined' &&
      document.createElement('canvas').getContext('2d') != null;
    const img = makeHatchImage({ color: '#94a3b8' });
    if (hasCtx) {
      expect(img).not.toBeNull();
      // Default size is 8x8; ImageData stores RGBA (4 bytes per pixel).
      expect(img!.width).toBe(8);
      expect(img!.height).toBe(8);
      expect(img!.data.length).toBe(8 * 8 * 4);
    } else {
      expect(img).toBeNull();
    }
  });

  it('honors a custom size', () => {
    const ctxAvailable =
      typeof document !== 'undefined' &&
      document.createElement('canvas').getContext('2d') != null;
    if (!ctxAvailable) return; // nothing to assert without a real canvas
    const img = makeHatchImage({ color: '#000', size: 16 });
    expect(img!.width).toBe(16);
    expect(img!.height).toBe(16);
  });
});
