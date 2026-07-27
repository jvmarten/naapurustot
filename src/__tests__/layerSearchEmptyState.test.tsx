import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayerSelector } from '../components/LayerSelector';
import { t } from '../utils/i18n';

/**
 * UX EM-1: the layer panel's search had two first-timer failures — a query that
 * matched nothing rendered the panel body as pure empty space (no "no matches",
 * no count, no explanation), and the filter used a plain lowercase `includes`,
 * so typing Finnish labels without diacritics ("vaesto", "aanestys") matched none
 * of the ä/ö labels that SearchBar and CitySelector already fold.
 */
function renderSelector() {
  const utils = render(
    <LayerSelector activeLayer="quality_index" onLayerChange={vi.fn()} />
  );
  // The desktop panel starts expanded; grab its search box.
  const input = screen.getAllByPlaceholderText(t('layers.search_placeholder'))[0];
  return { ...utils, input };
}

describe('LayerSelector search (EM-1)', () => {
  it('matches accent-free typing against ä/ö labels', () => {
    const { input } = renderSelector();
    fireEvent.change(input, { target: { value: 'vaesto' } });
    // "Väestötiheys" / "Väestö" only match once both sides are folded.
    expect(screen.getAllByText(/Väestö/).length).toBeGreaterThan(0);
    expect(screen.queryByText(t('layers.no_matches').replace('{query}', 'vaesto'))).toBeNull();
  });

  it('explains a zero-result query instead of rendering blank space', () => {
    const { input } = renderSelector();
    fireEvent.change(input, { target: { value: 'zzzqqq' } });
    expect(
      screen.getByText(t('layers.no_matches').replace('{query}', 'zzzqqq'))
    ).toBeInTheDocument();
  });

  it('offers a clear-search action from the zero-result block', () => {
    const { input } = renderSelector();
    fireEvent.change(input, { target: { value: 'zzzqqq' } });
    fireEvent.click(screen.getByText(t('layers.clear_search')));
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(t('layers.clear_search'))).toBeNull();
  });

  it('keeps the panel populated for an empty query', () => {
    renderSelector();
    expect(screen.queryByText(t('layers.no_matches').replace('{query}', ''))).toBeNull();
  });
});
