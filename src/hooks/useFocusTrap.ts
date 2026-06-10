import { useEffect } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * PO-3: trap keyboard focus within `ref` while `active`. Tab / Shift+Tab cycle through
 * the container's focusable elements instead of escaping behind the overlay — which is
 * what a `role="dialog" aria-modal="true"` surface must do to be honest (claiming modal
 * semantics without containing focus is worse than not claiming them). On activation it
 * also pulls focus into the container if it isn't already there.
 *
 * Extracted from OnboardingTour's inline Tab-containment so the dialogs share one
 * implementation. Capture phase so it beats App-level key handlers.
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    // Move focus inside on activation if it isn't already (don't steal an existing
    // autofocus within the dialog).
    if (!root.contains(document.activeElement)) {
      const firstFocusable = root.querySelector<HTMLElement>(FOCUSABLE);
      (firstFocusable ?? root).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = root.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      } else if (!root.contains(activeEl)) {
        // Focus had escaped the dialog entirely — pull it back to the first element.
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [ref, active]);
}
