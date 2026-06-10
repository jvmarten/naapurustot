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
 * The armed flag lives in a ref, never in `history.state`: useUrlState syncs the
 * URL with `replaceState(null, …)`, which would clobber any marker stored there.
 * Desktop (fine-pointer) sessions are left untouched — Back navigates as usual.
 *
 * @param overlayOpen  whether any back-dismissable overlay is currently open
 * @param closeTopmost closes the single topmost overlay (mirrors the Escape cascade)
 */
export function useBackGesture(overlayOpen: boolean, closeTopmost: () => void): void {
  const armedRef = useRef(false);
  // Re-point every render so the once-registered popstate listener always calls
  // the latest cascade (which closes over current overlay state).
  const closeRef = useRef(closeTopmost);
  useEffect(() => {
    closeRef.current = closeTopmost;
  });
  const enabledRef = useRef(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches,
  );

  // Runs after every render (cheap ref comparison): keeps the sentinel in lockstep
  // with `overlayOpen`. No dependency array on purpose — after a Back press closes a
  // stacked surface the parent re-renders with `overlayOpen` unchanged (true), and we
  // must still re-arm a fresh sentinel for the next layer.
  useEffect(() => {
    if (!enabledRef.current) return;
    if (overlayOpen && !armedRef.current) {
      armedRef.current = true;
      window.history.pushState({ naapurustotOverlay: true }, '', window.location.href);
    } else if (!overlayOpen && armedRef.current) {
      // Closed by Escape / button / tap — pop our stale sentinel back off.
      armedRef.current = false;
      window.history.back();
    }
  });

  useEffect(() => {
    if (!enabledRef.current) return;
    const onPopState = () => {
      if (!armedRef.current) return;
      // The user pressed Back and the browser popped our sentinel.
      armedRef.current = false;
      closeRef.current();
      // If overlays remain (a stacked surface), the [overlayOpen] effect re-arms.
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
