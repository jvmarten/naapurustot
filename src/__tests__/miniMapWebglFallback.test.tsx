import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Feature, Polygon } from 'geojson';

// Mock i18n so assertions can match on translation keys directly.
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  useI18nVersion: () => 0,
}));

// MiniMap reads the theme; no provider is mounted in this unit test.
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' as const }),
}));

// Simulate a browser/device without a usable WebGL context: MapLibre throws
// from its constructor (mirrors the production "Failed to initialize WebGL"
// error on Firefox/Linux that this fallback was added for).
vi.mock('maplibre-gl', () => ({
  default: {
    // Must be a real function (not an arrow) so `new maplibregl.Map(...)`
    // reaches the body and throws the simulated WebGL error — an arrow
    // function isn't a constructor and would throw a TypeError first,
    // exercising the wrong code path.
    Map: vi.fn(function () {
      throw new Error('Failed to initialize WebGL');
    }),
  },
}));

import { MiniMap } from '../components/profile/MiniMap';

const square: Feature<Polygon> = {
  type: 'Feature',
  properties: { nimi: 'Test Area', pno: '00160' },
  geometry: {
    type: 'Polygon',
    coordinates: [[[24.9, 60.16], [24.96, 60.16], [24.96, 60.18], [24.9, 60.18], [24.9, 60.16]]],
  },
};

describe('MiniMap WebGL fallback', () => {
  it('renders a static fallback instead of crashing when WebGL is unavailable', () => {
    // Should not throw — the component swallows the MapLibre error.
    expect(() => render(<MiniMap feature={square} />)).not.toThrow();

    // The accessible fallback message is shown in place of the map canvas.
    expect(screen.getByText('error.webgl_unavailable')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'aria.minimap: Test Area');
  });

  it('renders nothing for a feature with null geometry', () => {
    const noGeom = { ...square, geometry: null } as unknown as Feature<Polygon>;
    const { container } = render(<MiniMap feature={noGeom} />);
    expect(container.firstChild).toBeNull();
  });
});
