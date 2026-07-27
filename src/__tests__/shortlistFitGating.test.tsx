import type React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { ShortlistTray } from '../components/ShortlistTray';
import { defaultWizardAnswers, type WizardAnswers } from '../hooks/useWizardProfile';
import type { NeighborhoodProperties } from '../utils/metrics';

/**
 * The shortlist decision table must not present a "fit for you" percentage to a
 * user who never told it what they want.
 *
 * useWizardProfile seeds its state with `{ ...defaultWizardAnswers }` whenever
 * localStorage holds nothing, so `wizardProfile` is never null. The table's
 * original `p && wizardProfile` check was therefore always true, and every
 * visitor saw a personalised-looking score computed from defaults they had never
 * chosen. ComparisonPanel already gated on isCustomWizardAnswers; these tests
 * lock the same rule onto the tray.
 */

const areaProps = {
  pno: '00100',
  nimi: 'Test area',
  quality_index: 70,
  he_vakiy: 5000,
  hr_mtu: 30000,
  transit_stop_density: 5,
  grocery_density: 3,
  crime_index: 90,
} as unknown as NeighborhoodProperties;

type TrayProps = React.ComponentProps<typeof ShortlistTray>;

function renderTray(wizardProfile: WizardAnswers | null) {
  const props = {
    entries: [{ pno: '00100', name: 'Test area' }],
    onSelect: () => {},
    onRemove: () => {},
    onCompare: () => {},
    onClear: () => {},
    featureFor: () => null,
    shareUrl: '',
    propsFor: () => areaProps,
    layerConfig: null,
    wizardProfile,
  } as unknown as TrayProps;
  const view = render(<ShortlistTray {...props} />);
  // The fit column only exists in table view; the toggle is the aria-pressed button.
  const toggle = view.container.querySelector('button[aria-pressed]');
  expect(toggle, 'table-view toggle must exist').not.toBeNull();
  fireEvent.click(toggle!);
  const table = view.container.querySelector('table');
  expect(table, 'table must render after toggling').not.toBeNull();
  return table!;
}

/** The fit cell is the third column of the single data row. */
function fitCellText(table: HTMLTableElement): string {
  const row = within(table).getAllByRole('row')[1];
  return row.querySelectorAll('td')[2].textContent ?? '';
}

describe('shortlist fit column gating', () => {
  it('shows the set-priorities CTA, not a score, for an untouched default profile', () => {
    const table = renderTray({ ...defaultWizardAnswers });
    const cell = fitCellText(table);
    expect(cell).not.toMatch(/\d+\s*%/);
    expect(cell.trim().length).toBeGreaterThan(0);
  });

  it('treats a null profile the same as an unconfigured one', () => {
    expect(fitCellText(renderTray(null))).not.toMatch(/\d+\s*%/);
  });

  it('scores fit once the user has actually changed a priority', () => {
    const customised: WizardAnswers = {
      ...defaultWizardAnswers,
      transitImportance: defaultWizardAnswers.transitImportance === 5 ? 1 : 5,
    };
    // Guards against the gate being trivially false: a real profile must score.
    expect(fitCellText(renderTray(customised))).toMatch(/\d+\s*%/);
  });

  it('still renders the fit column header in both states', () => {
    for (const profile of [{ ...defaultWizardAnswers }, null]) {
      const table = renderTray(profile);
      expect(within(table).getAllByRole('columnheader').length).toBeGreaterThanOrEqual(4);
    }
  });
});
