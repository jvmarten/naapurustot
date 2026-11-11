/**
 * The panel's active-layer card follows the time slider: scrubbed to an earlier year
 * it shows that year's value (or that year's neighbour estimate), as the map does.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NeighborhoodPanel } from '../components/NeighborhoodPanel';
import { t } from '../utils/i18n';
import type { NeighborhoodProperties } from '../utils/metrics';

const area = (extra: Record<string, unknown>) => ({
  pno: '00100',
  nimi: 'Testi',
  namn: 'Test',
  kunta: 'Helsinki',
  city: 'helsinki_metro',
  he_vakiy: 1000,
  property_price_sqm: 5000,
  ...extra,
}) as unknown as NeighborhoodProperties;

function card(data: NeighborhoodProperties, timeYear: number | null) {
  render(
    <MemoryRouter>
      <NeighborhoodPanel data={data} metroAverages={{ property_price_sqm: 4000 }} onClose={() => {}} activeLayer="property_price" timeYear={timeYear} />
    </MemoryRouter>,
  );
  const label = within(screen.getByRole('complementary')).getByText(t('panel.active_layer'), { exact: false });
  return label.closest('div.rounded-xl') as HTMLElement;
}

const digits = (el: HTMLElement) => (el.textContent ?? '').replace(/\D/g, '');

afterEach(() => cleanup());

describe('active-layer card and the time slider', () => {
  it('shows the current value with no year scrubbed', () => {
    const el = card(area({ property_price_history: [[2021, 3000], [2025, 5000]] }), null);
    expect(digits(el)).toContain('5000');
    expect(el.textContent).not.toContain('2021');
  });

  it('shows the scrubbed year\'s measured value, labelled with the year, and no comparison', () => {
    const el = card(area({ property_price_history: [[2021, 3000], [2025, 5000]] }), 2021);
    expect(el.textContent).toContain('2021');
    expect(digits(el)).toContain('3000');
    expect(digits(el)).not.toContain('5000');
    expect(el.textContent).not.toContain(t('data.neighbour_estimate'));
    expect(el.textContent).not.toMatch(/[▲▼]/);
  });

  it('shows that year\'s neighbour estimate where the year was not measured', () => {
    const el = card(area({ property_price_history: [[2024, 4800], [2025, 5000]], property_price_history__2021_est: 2800 }), 2021);
    expect(digits(el)).toContain('2800');
    expect(el.textContent).toContain(t('data.neighbour_estimate'));
  });
});
