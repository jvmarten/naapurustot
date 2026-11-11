import { describe, it, expect, beforeAll } from 'vitest';
import { installPointerKindTracking } from '../utils/pointerKind';

function pointer(type: string, pointerType: string) {
  const e = new Event(type, { bubbles: true }) as Event & { pointerType: string };
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  window.dispatchEvent(e);
}

describe('pointer kind tracking (hover tooltips)', () => {
  beforeAll(() => installPointerKindTracking());

  it('hides tooltips after touch and shows them again for a mouse', () => {
    pointer('pointerdown', 'touch');
    expect(document.documentElement.dataset.pointer).toBe('touch');
    // A touchscreen laptop used with a mouse: the device class says coarse, the
    // pointer in use says mouse, and the tooltip follows the pointer.
    pointer('pointermove', 'mouse');
    expect(document.documentElement.dataset.pointer).toBe('mouse');
  });

  it('treats a pen like a mouse', () => {
    pointer('pointerdown', 'touch');
    pointer('pointermove', 'pen');
    expect(document.documentElement.dataset.pointer).toBe('mouse');
  });
});
