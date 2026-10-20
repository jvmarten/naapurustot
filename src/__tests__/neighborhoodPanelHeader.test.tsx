/**
 * The panel header: the region name follows the live language, and the copy-link /
 * shortlist / reference / export actions sit behind the "more" menu instead of a
 * row of buttons under every section.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NeighborhoodPanel } from '../components/NeighborhoodPanel';
import { setLang, t } from '../utils/i18n';
import type { NeighborhoodProperties } from '../utils/metrics';

// A region aggregate whose snapshot was built before the English dictionary arrived:
// its `nimi` is the Finnish fallback.
const region = {
  pno: 'helsinki_metro',
  nimi: 'Helsingin seutu',
  namn: 'Helsingin seutu',
  kunta: null,
  city: 'helsinki_metro',
  _isMetroArea: true,
  he_vakiy: 1_635_656,
} as unknown as NeighborhoodProperties;

function renderPanel(props: Partial<React.ComponentProps<typeof NeighborhoodPanel>> = {}) {
  return render(
    <MemoryRouter>
      <NeighborhoodPanel data={region} metroAverages={{}} onClose={() => {}} {...props} />
    </MemoryRouter>,
  );
}

/** The desktop side panel (the mobile sheet renders the same header twice). */
const desktop = () => within(screen.getByRole('complementary'));

afterEach(async () => {
  cleanup();
  await setLang('fi');
});

describe('NeighborhoodPanel header', () => {
  it('shows a region in the active language, not the name frozen into its snapshot', async () => {
    await setLang('en');
    renderPanel();
    expect(desktop().getByRole('heading', { level: 2 })).toHaveTextContent('Helsinki Metro');
  });

  it('keeps the exports behind the more menu until it is opened', async () => {
    await setLang('en');
    const onToggleShortlist = vi.fn();
    renderPanel({ onToggleShortlist, onExploreCity: () => {} });

    expect(screen.queryByText(t('export.csv'))).toBeNull();
    // The explore button lives in the header, beside the name, not in a section.
    expect(desktop().getByText(t('panel.explore_postal_codes'))).toBeInTheDocument();

    fireEvent.click(desktop().getByTitle(t('panel.more_actions')));
    expect(desktop().getByText(t('export.csv'))).toBeInTheDocument();

    // A row acts and closes the menu.
    fireEvent.click(desktop().getByText(t('shortlist.add')));
    expect(onToggleShortlist).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t('export.csv'))).toBeNull();
  });

  it('closes the menu on Escape without letting the key close the panel', async () => {
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);
    renderPanel();
    fireEvent.click(desktop().getByTitle(t('panel.more_actions')));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText(t('export.csv'))).toBeNull();
    expect(onKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onKey);
  });

  it('pins to the comparison from the ⊕ beside the name', () => {
    const onPin = vi.fn();
    renderPanel({ onPin });
    fireEvent.click(desktop().getByTitle(t('compare.pin')));
    expect(onPin).toHaveBeenCalledWith(region);
  });
});
