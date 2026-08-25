import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl';

const trackEvent = vi.fn();
vi.mock('../utils/analytics', () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a) }));

/** Minimal fake: `queryFeaturesSafe` only ever touches this one method. */
function fakeMap(impl: () => MapGeoJSONFeature[]) {
  const queryRenderedFeatures = vi.fn(impl);
  return { map: { queryRenderedFeatures } as unknown as MapLibreMap, queryRenderedFeatures };
}

// The module keeps a one-shot `reported` flag, so each case needs a fresh copy.
async function freshImport() {
  vi.resetModules();
  return (await import('../utils/mapQuery')).queryFeaturesSafe;
}

describe('queryFeaturesSafe', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    trackEvent.mockClear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('returns the features and forwards the layer list verbatim', async () => {
    const queryFeaturesSafe = await freshImport();
    const feats = [{ properties: { pno: '00100' } }] as unknown as MapGeoJSONFeature[];
    const { map, queryRenderedFeatures } = fakeMap(() => feats);

    const point = { x: 10, y: 20 } as unknown as Parameters<typeof queryFeaturesSafe>[1];
    expect(queryFeaturesSafe(map, point, ['neighborhoods-fill'])).toBe(feats);
    expect(queryRenderedFeatures).toHaveBeenCalledWith(point, { layers: ['neighborhoods-fill'] });
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('forwards a [x, y] tuple geometry unchanged (the coarse-pointer ring probe)', async () => {
    const queryFeaturesSafe = await freshImport();
    const { map, queryRenderedFeatures } = fakeMap(() => []);

    queryFeaturesSafe(map, [12, 34], ['neighborhoods-fill']);
    expect(queryRenderedFeatures).toHaveBeenCalledWith([12, 34], { layers: ['neighborhoods-fill'] });
  });

  it('degrades a corrupt-tile throw to "no features" instead of propagating it', async () => {
    const queryFeaturesSafe = await freshImport();
    const { map } = fakeMap(() => {
      throw new Error('feature index out of bounds');
    });

    // Must not throw: the callers' no-feature branch is the intended degradation.
    expect(queryFeaturesSafe(map, [1, 1], ['neighborhoods-fill'])).toEqual([]);
  });

  it('reports a failure exactly once, however many times it throws', async () => {
    const queryFeaturesSafe = await freshImport();
    const { map, queryRenderedFeatures } = fakeMap(() => {
      throw new Error('feature index out of bounds');
    });

    for (let i = 0; i < 3; i++) queryFeaturesSafe(map, [1, 1], ['neighborhoods-fill']);

    // The query itself is never suppressed — healthy neighbouring tiles must keep
    // answering — but a poisoned tile throws every frame, so reporting is one-shot.
    expect(queryRenderedFeatures).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('map-query-error', {
      message: 'feature index out of bounds',
    });
  });
});

describe('isStyleAlive', () => {
  async function freshIsStyleAlive() {
    vi.resetModules();
    return (await import('../utils/mapQuery')).isStyleAlive;
  }

  it('is true while the map has a style (live map)', async () => {
    const isStyleAlive = await freshIsStyleAlive();
    const map = { style: {} } as unknown as MapLibreMap;
    expect(isStyleAlive(map)).toBe(true);
  });

  it('is false once map.remove() has nulled the style (unmount teardown)', async () => {
    const isStyleAlive = await freshIsStyleAlive();
    // maplibre nulls `style` in remove(); this is what made getLayer throw
    // "Cannot read properties of null (reading 'getLayer')" in a route-swap teardown.
    const map = { style: null } as unknown as MapLibreMap;
    expect(isStyleAlive(map)).toBe(false);
  });

  it('is false while the style is transiently absent (WebGL context loss)', async () => {
    const isStyleAlive = await freshIsStyleAlive();
    const map = { style: undefined } as unknown as MapLibreMap;
    expect(isStyleAlive(map)).toBe(false);
  });
});

// Vite-native raw source read, matching src/__tests__/i18nUnusedKeys.test.ts —
// node:fs is not in this tsconfig's types.
const mapSources = import.meta.glob('../components/{Map,SplitMapView}.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('map hit-test call sites', () => {
  const read = (file: string) => {
    const src = mapSources[`../components/${file}`];
    if (!src) throw new Error(`could not read ../components/${file} (globbed: ${Object.keys(mapSources).join(', ')})`);
    return src;
  };

  // Regression guard for the Safari "feature index out of bounds" crash. MapLibre
  // implements a layer-scoped mouseenter/mouseleave by synthesizing an unthrottled
  // 'mousemove' delegate that calls queryRenderedFeatures *inside the library*, where
  // our guard cannot reach it. Discrete events (click) are fine.
  it.each(['Map.tsx', 'SplitMapView.tsx'])(
    '%s registers no layer-scoped mouseenter/mouseleave handler',
    (file) => {
      const src = read(file).replace(/^\s*\/\/.*$/gm, '');
      expect(src).not.toMatch(/\.(on|once)\(\s*['"]mouse(enter|leave|over|out)['"]\s*,[^)]*,/);
    },
  );

  it.each(['Map.tsx', 'SplitMapView.tsx'])(
    '%s routes every hit-test through queryFeaturesSafe',
    (file) => {
      expect(read(file)).not.toMatch(/\.queryRenderedFeatures\(/);
    },
  );

  // Regression guard for Sentry NAAPURUSTOT-WEB-W. A layer-scoped `on('click', LAYER, …)`
  // delegate makes MapLibre run `layers.filter(id => this.getLayer(id))` inside the library
  // before our handler; after a WebGL context loss that dereferences a null `this.style` and
  // throws, unguardably. Query the layers ourselves (map-level click + queryFeaturesSafe) so
  // the crash stays on the guarded path.
  it.each(['Map.tsx', 'SplitMapView.tsx'])(
    '%s registers no layer-scoped click delegate',
    (file) => {
      const src = read(file).replace(/^\s*\/\/.*$/gm, '');
      expect(src).not.toMatch(/\.(on|once)\(\s*['"]click['"]\s*,[^,)]+,/);
    },
  );
});
