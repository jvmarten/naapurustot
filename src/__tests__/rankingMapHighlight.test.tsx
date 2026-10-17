import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { FeatureCollection } from 'geojson';
import { RankingTable } from '../components/RankingTable';
import { getLayerById } from '../utils/colorScales';
import { setMapHighlight, subscribeMapHighlight } from '../utils/mapHighlight';

/**
 * Hovering a ranking row lights that area on the map. The table reports the row's
 * pno through `onHoverArea`; App wires that to utils/mapHighlight.ts, which the map
 * subscribes to and turns into its hover feature-state.
 */

const property = getLayerById('foreign_lang').property;

const data: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { pno: '01300', nimi: 'Veromiehenkylä', v: 62.6 },
    { pno: '01200', nimi: 'Hakunila', v: 54.1 },
  ].map(({ pno, nimi, v }) => ({
    type: 'Feature',
    geometry: null as unknown as GeoJSON.Geometry,
    properties: { pno, nimi, he_vakiy: 1000, [property]: v },
  })),
};

function renderTable(onHoverArea: (pno: string | null) => void) {
  return render(
    <RankingTable data={data} activeLayer="foreign_lang" onSelect={vi.fn()} onClose={vi.fn()} onHoverArea={onHoverArea} />,
  );
}

const row = (name: string) => screen.getByText(name).closest('button')!;

describe('RankingTable row hover', () => {
  afterEach(cleanup);

  it('reports the hovered row and clears on leave', () => {
    const onHoverArea = vi.fn();
    renderTable(onHoverArea);

    fireEvent.pointerEnter(row('Veromiehenkylä'), { pointerType: 'mouse' });
    fireEvent.pointerLeave(row('Veromiehenkylä'), { pointerType: 'mouse' });
    fireEvent.pointerEnter(row('Hakunila'), { pointerType: 'mouse' });

    expect(onHoverArea.mock.calls).toEqual([['01300'], [null], ['01200']]);
  });

  it('ignores touch, which has no hover', () => {
    const onHoverArea = vi.fn();
    renderTable(onHoverArea);

    fireEvent.pointerEnter(row('Hakunila'), { pointerType: 'touch' });

    expect(onHoverArea).not.toHaveBeenCalled();
  });

  it('clears the highlight when the table unmounts under the cursor', () => {
    const onHoverArea = vi.fn();
    const { unmount } = renderTable(onHoverArea);

    fireEvent.pointerEnter(row('Hakunila'), { pointerType: 'mouse' });
    unmount();

    expect(onHoverArea.mock.calls).toEqual([['01200'], [null]]);
  });
});

describe('mapHighlight store', () => {
  afterEach(() => setMapHighlight(null));

  it('notifies subscribers once per change, and not after unsubscribing', () => {
    const listener = vi.fn();
    const unsub = subscribeMapHighlight(listener);

    setMapHighlight('00100');
    setMapHighlight('00100');
    setMapHighlight(null);
    unsub();
    setMapHighlight('00200');

    expect(listener.mock.calls).toEqual([['00100'], [null]]);
  });
});
