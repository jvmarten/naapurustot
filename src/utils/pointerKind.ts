/**
 * Hover tooltips belong to a mouse (or pen), not to a device class.
 *
 * They used to be hidden by `@media (hover: none) and (pointer: coarse)`, which asks
 * what the device's PRIMARY pointer is. Touchscreen laptops, convertibles in tablet
 * mode and browser device emulation answer "coarse" while the person is using a
 * mouse, so the map drew its hover outline and never showed the value under it.
 * Hidden only for touch, a tap's emulated mousemove would otherwise flash a tooltip
 * on a phone, so the question is which pointer was used LAST: pointer events fire
 * before the compatibility mouse events, so the attribute is set before the hover
 * that follows a tap. `html[data-pointer="touch"] .tooltip-desktop` hides them.
 */
export function installPointerKindTracking(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = document.documentElement;
  const set = (kind: 'touch' | 'mouse') => {
    if (root.dataset.pointer !== kind) root.dataset.pointer = kind;
  };
  // Until the first pointer event, the device class is the best guess there is.
  try {
    if (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) set('touch');
  } catch { /* matchMedia unavailable */ }
  const onPointer = (e: PointerEvent) => set(e.pointerType === 'touch' ? 'touch' : 'mouse');
  window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
  window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
}
