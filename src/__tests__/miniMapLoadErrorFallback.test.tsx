import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Feature, Polygon } from 'geojson';

vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  useI18nVersion: () => 0,
}));

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' as const }),
}));

// Simulate a MapLibre instance that initializes fine (constructor succeeds) but
// throws while the 'load' handler wires up sources/layers — mirroring a
// "RangeError: Maximum call stack size exceeded" hit on iOS WebKit while it
// synchronously processes the region geometry. This throw happens inside an
// async event callback, so without the component's own try/catch it would
// escape as an uncaught global error and crash the profile page.
const loadHandlers: Array<() => void> = [];
vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn(function () {
      return {
        on(event: string, cb: () => void) {
          if (event === 'load') loadHandlers.push(cb);
        },
        addSource() {
          throw new RangeError('Maximum call stack size exceeded');
        },
        addLayer() {
          throw new RangeError('Maximum call stack size exceeded');
        },
        remove() {},
      };
    }),
  },
}));

import { MiniMap } from '../components/profile/MiniMap';

const square: Feature<Polygon> = {
  type: 'Feature',
  properties: { nimi: 'Test Area', pno: '01280' },
  geometry: {
    type: 'Polygon',
    coordinates: [[[24.9, 60.16], [24.96, 60.16], [24.96, 60.18], [24.9, 60.18], [24.9, 60.16]]],
  },
};

describe('MiniMap load-handler error fallback', () => {
  beforeEach(() => {
    loadHandlers.length = 0;
  });

  it('degrades to the static fallback when MapLibre throws while adding layers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<MiniMap feature={square} allFeatures={[square]} />);

    // Fire the captured 'load' handler — addSource/addLayer throw a RangeError.
    // The component must swallow it rather than letting it escape.
    expect(loadHandlers).toHaveLength(1);
    expect(() => loadHandlers[0]()).not.toThrow();

    await waitFor(() => {
      expect(screen.getByText('error.webgl_unavailable')).toBeInTheDocument();
    });
    warn.mockRestore();
  });
});
