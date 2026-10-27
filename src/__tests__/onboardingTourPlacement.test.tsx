import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingTour } from '../components/OnboardingTour';

/**
 * Where the tour card lands relative to the anchor it describes. Step 2 spotlights
 * the layer panel, which on desktop is a wrapper up to 80vh tall: there is room for
 * the card neither above nor below it, and "below" put the card — Next button
 * included — under the fold (1366×650: card at y=576–836, unclickable).
 */

const anchors: HTMLElement[] = [];

function anchor(id: string, left: number, top: number, width: number, height: number) {
  const el = document.createElement('div');
  el.setAttribute('data-tour-id', id);
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(el);
  anchors.push(el);
}

function viewport(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

/** Renders the tour and advances from the welcome step to the layers step. */
function layersStepCard() {
  render(<OnboardingTour onComplete={vi.fn()} />);
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  return screen.getByRole('dialog').querySelector<HTMLElement>('[tabindex="-1"]')!;
}

describe('OnboardingTour card placement', () => {
  afterEach(() => {
    anchors.splice(0).forEach((el) => el.remove());
  });

  it('sits beside an anchor too tall to fit the card above or below it', () => {
    viewport(1366, 650);
    anchor('layers', 1110, 56, 240, 504); // desktop panel: 90 px below, 56 above
    const card = layersStepCard();
    expect(card.style.left).toBe(`${1110 - 320 - 16}px`);
    expect(card.style.transform).toBe('translateY(-50%)');
    // Centred on the panel, and a full-height card (≤ 300 px) stays on screen.
    const top = parseFloat(card.style.top);
    expect(top).toBe(56 + 504 / 2);
    expect(top - 150).toBeGreaterThanOrEqual(0);
    expect(top + 150).toBeLessThanOrEqual(650);
  });

  it('clamps the side placement into a short viewport', () => {
    viewport(844, 390);
    anchor('layers', 588, 56, 240, 312);
    const card = layersStepCard();
    expect(card.style.left).toBe(`${588 - 320 - 16}px`);
    expect(parseFloat(card.style.top) + 150).toBeLessThanOrEqual(390);
  });

  it('still goes below a short anchor with room under it', () => {
    viewport(1366, 650);
    anchor('layers', 1110, 56, 240, 44); // folded panel
    const card = layersStepCard();
    expect(card.style.top).toBe(`${56 + 44 + 16}px`);
    expect(card.style.transform).toBe('translateY(0)');
  });

  it('still flips above the mobile layers button', () => {
    viewport(390, 844);
    anchor('layers', 322, 756, 56, 56);
    const card = layersStepCard();
    expect(card.style.top).toBe(`${756 - 16}px`);
    expect(card.style.transform).toBe('translateY(-100%)');
  });
});
