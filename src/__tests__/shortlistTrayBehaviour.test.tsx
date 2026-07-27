import type React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, within, act } from '@testing-library/react';
import { ShortlistTray } from '../components/ShortlistTray';
import { defaultWizardAnswers } from '../hooks/useWizardProfile';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { LayerConfig } from '../utils/colorScales';

/**
 * The shortlist tray is where the product's funnel converges — the surface a
 * returning user comes back to and the only real argument for having an account —
 * and it had no behavioural tests at all. These cover the chip row, the decision
 * table (sorting, no-data cells, the active-layer column) and the action row,
 * including the failure paths that only appear when the clipboard is blocked or
 * an export chunk fails to load.
 */

vi.mock('../hooks/useNotes', () => ({
  // 00100 has a saved note, nothing else does.
  readNote: (pno: string) => (pno === '00100' ? 'a note' : ''),
}));
vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../utils/export', () => ({
  exportGeoJson: vi.fn(),
  exportShortlistCsv: vi.fn(),
  exportShortlistPdf: vi.fn(),
}));

const props = (pno: string, over: Record<string, unknown> = {}) => ({
  pno,
  nimi: `Area ${pno}`,
  quality_index: pno === '00100' ? 80 : 40,
  he_vakiy: 5000,
  grocery_density: pno === '00100' ? 3 : 9,
  ...over,
}) as unknown as NeighborhoodProperties;

const LAYER = {
  id: 'grocery_density',
  labelKey: 'layer.grocery_density',
  property: 'grocery_density',
  format: (v: number) => `${v} kpl`,
} as unknown as LayerConfig;

const ENTRIES = [
  { pno: '00100', name: 'Alpha' },
  { pno: '00200', name: 'Beta' },
];

type TrayProps = React.ComponentProps<typeof ShortlistTray>;

function renderTray(over: Record<string, unknown> = {}) {
  const base = {
    entries: ENTRIES,
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onCompare: vi.fn(),
    onClear: vi.fn(),
    propsFor: (pno: string) => props(pno),
    layerConfig: LAYER,
    wizardProfile: null,
    ...over,
  };
  const view = render(<ShortlistTray {...(base as unknown as TrayProps)} />);
  return { ...view, handlers: base };
}

function openTable(container: HTMLElement) {
  fireEvent.click(container.querySelector('button[aria-pressed]')!);
  return container.querySelector('table')!;
}

/** Area-name cell text for each body row, in render order. */
function rowNames(table: HTMLTableElement): string[] {
  return within(table).getAllByRole('row').slice(1)
    .map((r) => r.querySelectorAll('td')[0].textContent?.trim() ?? '');
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('ShortlistTray — chip view', () => {
  it('renders nothing when the shortlist is empty', () => {
    const { container } = renderTray({ entries: [] });
    expect(container.firstChild).toBeNull();
  });

  it('shows the entry count and one chip per entry', () => {
    const { container } = renderTray();
    expect(container.textContent).toContain('(2)');
    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).toContain('Beta');
  });

  it('selects and removes through the chip controls', () => {
    const { container, handlers } = renderTray();
    fireEvent.click(within(container).getByText('Alpha'));
    expect(handlers.onSelect).toHaveBeenCalledWith('00100');
    const removes = within(container).getAllByTitle(/poista|remove/i);
    fireEvent.click(removes[0]);
    expect(handlers.onRemove).toHaveBeenCalledWith('00100');
  });

  it('marks only the entries that have a saved note', () => {
    const { container } = renderTray();
    // readNote is mocked to return a note for 00100 only.
    expect(within(container).getAllByTitle(/muistiinpano|note/i).length).toBe(1);
  });

  it('collapses when a collapse handler is supplied', () => {
    const onCollapse = vi.fn();
    const { container } = renderTray({ onCollapse });
    fireEvent.click(within(container).getByText(/\(2\)/));
    expect(onCollapse).toHaveBeenCalled();
  });
});

describe('ShortlistTray — action row', () => {
  it('hides Compare where there is nothing loaded to pin', () => {
    const { container } = renderTray({ canCompare: false });
    const withCompare = renderTray({ canCompare: true }).container.textContent ?? '';
    expect((container.textContent ?? '').length).toBeLessThan(withCompare.length);
  });

  it('fires compare and clear', () => {
    const { container, handlers } = renderTray();
    const buttons = within(container).getAllByRole('button');
    const compare = buttons.find((b) => /vertail|compare/i.test(b.textContent ?? ''));
    fireEvent.click(compare!);
    expect(handlers.onCompare).toHaveBeenCalled();
    const clear = buttons.find((b) => /tyhjenn|clear/i.test(b.textContent ?? ''));
    fireEvent.click(clear!);
    expect(handlers.onClear).toHaveBeenCalled();
  });

  it('hides the export actions when no feature resolver is supplied', () => {
    const { container } = renderTray();
    expect(container.textContent).not.toMatch(/CSV|PDF|GeoJSON/i);
  });

  it('shows the export actions once features can be resolved', () => {
    const featureFor = (pno: string) => ({
      type: 'Feature', geometry: null, properties: props(pno),
    }) as unknown as GeoJSON.Feature;
    const { container } = renderTray({ featureFor });
    expect(container.textContent).toMatch(/CSV/i);
    expect(container.textContent).toMatch(/GeoJSON/i);
  });

  it('reveals the link for manual copying when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    const { container } = renderTray({ shareUrl: 'https://naapurustot.fi/?sl=00100' });
    const share = within(container).getAllByRole('button')
      .find((b) => /jaa|share/i.test(b.textContent ?? ''));
    await act(async () => { fireEvent.click(share!); });
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe('https://naapurustot.fi/?sl=00100');
  });

  it('falls back to the manual copy box when writeText rejects', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const { container } = renderTray({ shareUrl: 'https://naapurustot.fi/?sl=00100' });
    const share = within(container).getAllByRole('button')
      .find((b) => /jaa|share/i.test(b.textContent ?? ''));
    await act(async () => { fireEvent.click(share!); });
    expect(container.querySelector('textarea')).not.toBeNull();
  });
});

describe('ShortlistTray — decision table', () => {
  it('renders a row per entry with the quality index and the active-layer value', () => {
    const { container } = renderTray();
    const table = openTable(container);
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2
    expect(table.textContent).toContain('80');
    expect(table.textContent).toContain('3 kpl');
  });

  it('notifies the host the first time the table opens, so it can load properties', () => {
    const onExpand = vi.fn();
    const { container } = renderTray({ onExpand });
    const toggle = container.querySelector('button[aria-pressed]')!;
    fireEvent.click(toggle);
    fireEvent.click(toggle); // back to chips
    fireEvent.click(toggle); // and out again
    expect(onExpand).toHaveBeenCalledTimes(2);
  });

  it('sorts by quality index, descending first, and reverses on a second click', () => {
    const { container } = renderTray();
    const table = openTable(container);
    expect(rowNames(table)).toEqual(['Alpha', 'Beta']); // 80 before 40
    const qiHeader = within(table).getAllByRole('columnheader')[1];
    fireEvent.click(within(qiHeader).getByRole('button'));
    expect(rowNames(table)).toEqual(['Beta', 'Alpha']);
  });

  it('sorts by the active-layer column', () => {
    const { container } = renderTray();
    const table = openTable(container);
    const layerHeader = within(table).getAllByRole('columnheader')[3];
    fireEvent.click(within(layerHeader).getByRole('button'));
    expect(rowNames(table)).toEqual(['Beta', 'Alpha']); // 9 kpl before 3 kpl
  });

  it('sorts by name', () => {
    const { container } = renderTray();
    const table = openTable(container);
    const nameHeader = within(table).getAllByRole('columnheader')[0];
    fireEvent.click(within(nameHeader).getByRole('button'));
    expect(rowNames(table)).toEqual(['Alpha', 'Beta']);
  });

  it('shows an explicit no-data cell rather than omitting a row whose properties are unresolved', () => {
    const { container } = renderTray({ propsFor: () => null });
    const table = openTable(container);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(table.textContent).not.toContain('80');
  });

  it('sorts areas with missing values last in both directions', () => {
    const propsFor = (pno: string) => (pno === '00200' ? null : props(pno));
    const { container } = renderTray({ propsFor });
    const table = openTable(container);
    expect(rowNames(table)).toEqual(['Alpha', 'Beta']);
    const qiHeader = within(table).getAllByRole('columnheader')[1];
    fireEvent.click(within(qiHeader).getByRole('button'));
    expect(rowNames(table)).toEqual(['Alpha', 'Beta']);
  });

  it('falls back to a dash header when no layer is active', () => {
    const { container } = renderTray({ layerConfig: undefined });
    const table = openTable(container);
    expect(within(table).getAllByRole('columnheader')[3].textContent).toContain('—');
  });

  it('scores the fit column against a profile the user actually configured', () => {
    const customised = { ...defaultWizardAnswers, transitImportance: defaultWizardAnswers.transitImportance === 5 ? 1 : 5 };
    const { container } = renderTray({ wizardProfile: customised });
    const table = openTable(container);
    expect(table.textContent).toMatch(/\d+\s*%/);
  });

  it('removes an entry from the table view', () => {
    const { container, handlers } = renderTray();
    const table = openTable(container);
    const row = within(table).getAllByRole('row')[1];
    fireEvent.click(within(row).getAllByRole('button').at(-1)!);
    expect(handlers.onRemove).toHaveBeenCalled();
  });

  it('selects an area from the table view', () => {
    const { container, handlers } = renderTray();
    const table = openTable(container);
    fireEvent.click(within(table).getByText('Alpha'));
    expect(handlers.onSelect).toHaveBeenCalledWith('00100');
  });
});
