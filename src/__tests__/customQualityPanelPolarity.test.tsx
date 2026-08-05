import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CustomQualityPanel } from '../components/CustomQualityPanel';
import { QUALITY_FACTORS, getDefaultWeights, isPreferenceFactor } from '../utils/qualityIndex';
import { getLang } from '../utils/i18n';

/**
 * The panel is where the polarity model becomes visible: a signed factor must get a
 * −100…+100 track, a fixed-direction one must not, and neither may announce a bare
 * number to a screen reader — "-40" says nothing about which end it favours.
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
  it('gives signed factors a -100..100 track and fixed-direction factors 0..100', () => {
    renderPanel();
    let checkedSigned = 0;
    let checkedFixed = 0;
    for (const f of QUALITY_FACTORS) {
      const el = sliderFor(f.id);
      if (!el) continue; // behind "Show more"
      if (isPreferenceFactor(f)) {
        expect(el.min, `${f.id} min`).toBe('-100');
        checkedSigned++;
      } else {
        expect(el.min, `${f.id} min`).toBe('0');
        checkedFixed++;
      }
      expect(el.max, `${f.id} max`).toBe('100');
    }
    // Guard against the assertions silently covering nothing.
    expect(checkedSigned).toBeGreaterThan(0);
    expect(checkedFixed).toBeGreaterThan(0);
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

  it('renders both end labels on a signed slider and none on a fixed one', () => {
    renderPanel();
    const signedPrimary = QUALITY_FACTORS.filter((f) => f.primary && isPreferenceFactor(f));
    expect(signedPrimary.length, 'at least one signed primary factor').toBeGreaterThan(0);
    // The end labels are the only thing telling the user which way "+" points.
    expect(screen.getAllByText(/←/).length).toBe(signedPrimary.length);
    expect(screen.getAllByText(/→/).length).toBe(signedPrimary.length);
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
