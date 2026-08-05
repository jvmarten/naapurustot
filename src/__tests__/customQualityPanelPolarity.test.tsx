import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
