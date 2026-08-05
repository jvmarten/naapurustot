import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CustomQualityPanel } from '../components/CustomQualityPanel';
import { QUALITY_FACTORS, getDefaultWeights } from '../utils/qualityIndex';
import { getLang } from '../utils/i18n';

/**
 * The panel is where the direction model becomes visible: every factor gets a
 * −100…+100 zero-centred track, and none may announce a bare number to a screen
 * reader — "-40" says nothing about which end of the metric it favours.
 */

function renderPanel(weights = getDefaultWeights()) {
  return render(
    <CustomQualityPanel weights={weights} onChange={vi.fn()} onClose={vi.fn()} />,
  );
}

/** The panel hides non-primary factors behind "Show more", so assert over what it renders. */
function sliderFor(factorId: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(`input.slider-${factorId}`);
}

describe('CustomQualityPanel — slider polarity', () => {
  it('gives every rendered factor a zero-centred -100..100 track', () => {
    renderPanel();
    let checked = 0;
    for (const f of QUALITY_FACTORS) {
      const el = sliderFor(f.id);
      if (!el) continue; // behind "Show more"
      expect(el.min, `${f.id} min`).toBe('-100');
      expect(el.max, `${f.id} max`).toBe('100');
      checked++;
    }
    // Guard against the assertions silently covering nothing.
    expect(checked).toBeGreaterThan(0);
    cleanup();
  });

  it('names every slider and spells its direction out for assistive tech', () => {
    renderPanel();
    for (const f of QUALITY_FACTORS) {
      const el = sliderFor(f.id);
      if (!el) continue;
      // Accessible name comes from the visible label, not a bare range input.
      const labelledBy = el.getAttribute('aria-labelledby');
      expect(labelledBy, `${f.id} aria-labelledby`).toBe(`qw-label-${f.id}`);
      expect(document.getElementById(labelledBy!)?.textContent, `${f.id} label text`)
        .toContain(f.label[getLang()]);
      // …and the value is never announced as a naked number.
      const vt = el.getAttribute('aria-valuetext');
      expect(vt, `${f.id} aria-valuetext`).toBeTruthy();
      expect(vt, `${f.id} aria-valuetext is not just digits`).not.toMatch(/^-?\d+$/);
    }
    cleanup();
  });

  it('renders both end labels on every visible slider', () => {
    renderPanel();
    const primary = QUALITY_FACTORS.filter((f) => f.primary);
    expect(primary.length, 'at least one primary factor').toBeGreaterThan(0);
    // The end labels are the only thing telling the user which way "+" points.
    expect(screen.getAllByText(/←/).length).toBe(primary.length);
    expect(screen.getAllByText(/→/).length).toBe(primary.length);
    cleanup();
  });

  it('shows the hazard-labelled defaults as negative, not as bare magnitudes', () => {
    renderPanel();
    // "Melu -7" reads as "we want less noise, weighted 7" — the default weighting
    // is legible for the first time.
    expect(sliderFor('noise_pollution')!.value).toBe('-7');
    expect(sliderFor('traffic_accidents')!.value).toBe('-8');
    expect(sliderFor('noise_pollution')!.getAttribute('aria-valuetext')).toContain('7');
    cleanup();
  });

  it('announces a negative weight as favouring lower values, not as "-40"', () => {
    const w = { ...getDefaultWeights(), transit: -40 };
    renderPanel(w);
    const el = sliderFor('transit')!;
    expect(el.value).toBe('-40');
    expect(el.getAttribute('aria-valuetext')).toContain('40');
    expect(el.getAttribute('aria-valuetext')).not.toBe('-40');
    cleanup();
  });
});

describe('CustomQualityPanel — exact value entry', () => {
  // Regression: ZERO_DETENT used to run on every change event. Because the range is
  // controlled, a keyboard step from 0 was snapped back to 0 and the value never
  // moved — a keyboard user was trapped, and ±1..±4 were unreachable by any input.
  it('a keyboard step from 0 is NOT swallowed by the zero detent', () => {
    const onChange = vi.fn();
    render(<CustomQualityPanel weights={{ ...getDefaultWeights(), transit: 0 }} onChange={onChange} onClose={vi.fn()} />);
    const el = sliderFor('transit')!;
    // fireEvent.change is what a native arrow step produces (no pointer involved).
    fireEvent.change(el, { target: { value: '1' } });
    expect(el.value).toBe('1');
    fireEvent.change(el, { target: { value: '3' } });
    expect(el.value).toBe('3');
    cleanup();
  });

  it('still snaps to zero during an actual pointer drag', () => {
    render(<CustomQualityPanel weights={{ ...getDefaultWeights(), transit: 40 }} onChange={vi.fn()} onClose={vi.fn()} />);
    const el = sliderFor('transit')!;
    fireEvent.pointerDown(el);
    fireEvent.change(el, { target: { value: '3' } });
    expect(el.value, 'a near-zero drag snaps to 0 so it cannot invert the factor').toBe('0');
    fireEvent.pointerUp(el);
    cleanup();
  });

  it('accepts an exact typed value, including a negative one', () => {
    render(<CustomQualityPanel weights={getDefaultWeights()} onChange={vi.fn()} onClose={vi.fn()} />);
    // One field per rendered slider, so take the first.
    const field = (screen.getAllByLabelText(/tarkka arvo/i) as HTMLInputElement[])[0];
    // "-" alone must survive as an in-progress draft rather than resolving to 0.
    fireEvent.change(field, { target: { value: '-' } });
    expect(field.value).toBe('-');
    fireEvent.change(field, { target: { value: '-37' } });
    expect(field.value).toBe('-37');
    cleanup();
  });

  it('clamps a typed value beyond the range instead of storing it', () => {
    render(<CustomQualityPanel weights={getDefaultWeights()} onChange={vi.fn()} onClose={vi.fn()} />);
    const field = (screen.getAllByLabelText(/tarkka arvo/i) as HTMLInputElement[])[0];
    fireEvent.change(field, { target: { value: '999' } });
    // The draft echoes what was typed, but the slider it drives is clamped to +100
    // rather than carrying an out-of-range weight into the index.
    expect(field.value).toBe('999');
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.value).toBe('100');
    cleanup();
  });

  it('does not set inputMode — iOS numeric keypads have no minus key', () => {
    render(<CustomQualityPanel weights={getDefaultWeights()} onChange={vi.fn()} onClose={vi.fn()} />);
    const fields = screen.getAllByLabelText(/tarkka arvo/i) as HTMLInputElement[];
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) expect(f.getAttribute('inputmode')).toBeNull();
    cleanup();
  });
});
