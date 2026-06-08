import { describe, it, expect } from 'vitest';
import { neighborsFromGraph } from '../utils/adjacency';
import type { Feature } from 'geojson';

function feat(pno: string): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    properties: { pno, nimi: pno },
  };
}

// CF-12: the runtime adjacency lookup — reads the precomputed pno -> [neighbours]
// graph and filters to areas actually loaded, so every chip is clickable.
describe('CF-12 neighborsFromGraph (adjacency lookup)', () => {
  const graph = {
    '00100': ['00120', '00130', '00200'],
    '00120': ['00100'],
    '00130': ['00100'],
    '00200': ['00100'],
  };

  it('returns the graph neighbours that exist in the loaded features', () => {
    const features = ['00100', '00120', '00130', '00200'].map(feat);
    expect(neighborsFromGraph(graph, '00100', features)).toEqual(['00120', '00130', '00200']);
  });

  it('drops neighbours absent from the loaded features (e.g. another region)', () => {
    // 00130 is not loaded — it must not surface as a clickable chip.
    const features = ['00100', '00120', '00200'].map(feat);
    expect(neighborsFromGraph(graph, '00100', features)).toEqual(['00120', '00200']);
  });

  it('returns null for a pno missing from the graph (signals geometry fallback)', () => {
    const features = ['00100', '09999'].map(feat);
    expect(neighborsFromGraph(graph, '09999', features)).toBeNull();
  });

  it('returns an empty array for an island whose graph entry is empty', () => {
    expect(neighborsFromGraph({ '00100': [] }, '00100', [feat('00100')])).toEqual([]);
  });
});
