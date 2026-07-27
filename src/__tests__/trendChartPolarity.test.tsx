import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TrendChart } from '../components/TrendChart';
import type { TrendDataPoint } from '../utils/metrics';

/**
 * UX CF-2: the change label's hue must follow metric polarity, not the raw sign.
 * Rising unemployment and rising crime were rendering emerald (and a falling crime
 * rate rose) — the one surface in the app whose colour contradicted its own number.
 * The ↗/↘ glyph is deliberately NOT flipped: it describes direction, which is
 * factually correct either way, and it must keep matching the aria-label.
 */
const rising: TrendDataPoint[] = [[2020, 10], [2023, 12]];
const falling: TrendDataPoint[] = [[2020, 12], [2023, 10]];

function changeLabel(container: HTMLElement) {
  return container.querySelector('.font-semibold') as HTMLElement | null;
}

describe('TrendChart polarity colouring (CF-2)', () => {
  it('colours a rise emerald by default (higher is better)', () => {
    const { container } = render(
      <TrendChart title="Tulot" data={rising} color="#10b981" formatValue={String} />
    );
    expect(changeLabel(container)?.className).toContain('text-emerald-500');
  });

  it('colours a rise rose when higher is worse', () => {
    const { container } = render(
      <TrendChart title="Rikollisuus" data={rising} color="#8b5cf6" formatValue={String} higherIsBetter={false} />
    );
    const label = changeLabel(container)!;
    expect(label.className).toContain('text-rose-500');
    expect(label.className).not.toContain('text-emerald-500');
    // The arrow still reports the true direction.
    expect(label.textContent).toContain('↗');
  });

  it('colours a fall emerald when higher is worse', () => {
    const { container } = render(
      <TrendChart title="Työttömyysaste" data={falling} color="#f43f5e" formatValue={String} higherIsBetter={false} />
    );
    const label = changeLabel(container)!;
    expect(label.className).toContain('text-emerald-500');
    expect(label.textContent).toContain('↘');
  });

  it('still colours a fall rose for a higher-is-better metric', () => {
    const { container } = render(
      <TrendChart title="Tulot" data={falling} color="#10b981" formatValue={String} />
    );
    expect(changeLabel(container)?.className).toContain('text-rose-500');
  });
});
