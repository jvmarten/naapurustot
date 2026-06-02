import { useState, useEffect } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * PO-1: true when the user has asked their OS to reduce motion. Plain function for
 * non-reactive callers (animation frames, map camera moves) that just need the
 * current value at the moment they animate.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false;
}

/** PO-1: reactive prefers-reduced-motion for components that should re-render on change. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}
