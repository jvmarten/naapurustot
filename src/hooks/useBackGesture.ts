import { useEffect, useRef } from 'react';

/**
 * CF-5: Back-gesture dismissal of mobile sheets and modals.
 *
 * On a touch / coarse-pointer device, pressing the hardware Back button (Android)
 * or the edge swipe-back (iOS) while a bottom sheet or modal is open should close
 * the topmost surface instead of leaving the site. While `overlayOpen` is true we
 * push a single history sentinel; a Back press pops it and we route through
 * `closeTopmost` (the App's Escape-cascade priority logic). Closing by any other
 * means (Escape key, close button, backdrop tap) consumes the now-stale sentinel
 * with `history.back()`.
 *
 * The armed flag lives outside `history.state`: useUrlState syncs the URL with
 * `replaceState(null, …)`, which would clobber any marker stored there. Desktop
 * (fine-pointer) sessions are left untouched — Back navigates as usual.
 *
 * M6 — ONE shared owner for every instance. The hook is instantiated more than
 * once (App's overlay cascade + the mobile Layers sheet), and the two instances
 * used to be blind to each other: each kept a private `armed` ref and its own
 * `popstate` listener. So closing the Layers sheet "by other means" ran a
 * `history.back()` whose popstate the *App* listener answered — firing App's
 * cascade and wiping the pinned comparison. Routing every instance through the
 * module-level sentinel stack below means a Back press closes only the current
 * topmost overlay, and dropping one instance's stale sentinel never reaches
 * another instance's cascade. Registration is LIFO (overlays open and close in
 * stack order); the non-topmost-close path is handled conservatively so it can
 * never `history.back()` the wrong instance's sentinel.
 *
 * @param overlayOpen  whether any back-dismissable overlay is currently open
 * @param closeTopmost closes the single topmost overlay (mirrors the Escape cascade)
 */

interface Handle {
  close: () => void;
  armed: boolean;
}

// Shared across all useBackGesture instances — the single sentinel owner.
const stack: Handle[] = []; // registered open overlays, topmost last
let sentinels = 0; // history entries we have pushed (may briefly exceed stack.length)
let selfBacks = 0; // pending `history.back()` echoes we initiated, to ignore in onPopState
let listenerBound = false;

function onPopState(): void {
  if (selfBacks > 0) {
    // The echo of a history.back() WE called to drop a stale sentinel — not a
    // user Back. Swallow it so it can't cascade into another overlay.
    selfBacks -= 1;
    return;
  }
  if (sentinels === 0) return; // none of our sentinels are live
  // A real Back press popped the top sentinel: close only the topmost overlay.
  sentinels -= 1;
  const top = stack.pop();
  if (top) {
    top.armed = false;
    top.close();
    // If that instance is still open (App's cascade closed one of several
    // surfaces), its render effect re-registers a fresh sentinel next tick.
  }
}

function bindListener(): void {
  if (listenerBound || typeof window === 'undefined') return;
  window.addEventListener('popstate', onPopState);
  listenerBound = true;
}

export function useBackGesture(overlayOpen: boolean, closeTopmost: () => void): void {
  // Keep the latest cascade in a ref (updated in an effect, never during render) so
  // the stable handle below always closes over current overlay state.
  const closeRef = useRef(closeTopmost);
  useEffect(() => {
    closeRef.current = closeTopmost;
  });

  // Stable per-instance handle; `close` always routes to the latest closeRef. The
  // initializer object is re-created each render but React keeps only the first, and
  // the closure captures the stable closeRef, so the throwaways are harmless.
  const handleRef = useRef<Handle>({ close: () => closeRef.current(), armed: false });

  // Coarse-pointer detection is captured at this instance's first render (not at
  // module load) so tests that mock matchMedia before mounting see the right value.
  const enabledRef = useRef<boolean>(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches,
  );
  const enabled = enabledRef.current;

  // Reconcile this instance's membership with `overlayOpen` after every render.
  // No dependency array on purpose — App re-renders with `overlayOpen` still true
  // after closing one of several stacked surfaces, and must re-arm for the next.
  useEffect(() => {
    if (!enabled) return;
    const handle = handleRef.current!;
    if (overlayOpen && !handle.armed) {
      bindListener();
      handle.armed = true;
      stack.push(handle);
      sentinels += 1;
      window.history.pushState({ naapurustotOverlay: true }, '', window.location.href);
    } else if (!overlayOpen && handle.armed) {
      // Closed by Escape / button / backdrop tap — drop our stale sentinel.
      handle.armed = false;
      const idx = stack.indexOf(handle);
      const wasTopmost = idx === stack.length - 1;
      if (idx !== -1) stack.splice(idx, 1);
      if (wasTopmost) {
        // LIFO: our sentinel is the top browser entry, so back() pops exactly it.
        sentinels -= 1;
        selfBacks += 1;
        window.history.back();
      }
      // Non-topmost close (rare — overlays normally close in stack order): leave
      // the stale sentinel for the next Back to absorb rather than back() here,
      // which would pop a *different* instance's top entry.
    }
  });

  // Unregister on unmount so a torn-down instance can't be closed later, and so
  // the shared counters stay consistent (also what keeps tests isolated).
  useEffect(() => {
    if (!enabledRef.current) return;
    const handle = handleRef.current!;
    return () => {
      const idx = stack.indexOf(handle);
      if (idx !== -1) stack.splice(idx, 1);
      if (handle.armed) {
        handle.armed = false;
        sentinels -= 1;
      }
    };
  }, []);
}

/**
 * Test-only: reset the module-level sentinel stack between tests. Production never
 * calls this; the state is process-global, so without a reset one test's armed
 * overlay would leak into the next (mirrors i18n's `__testInject*` pattern).
 */
export function __resetBackGestureForTest(): void {
  stack.length = 0;
  sentinels = 0;
  selfBacks = 0;
}
