import { useState, useEffect, useRef } from 'react';

/**
 * PO-1: Animate a numeric value with a count-up/count-down transition.
 * Uses requestAnimationFrame for smooth ~300ms transitions.
 */
export function useAnimatedValue(target: number | null, duration = 300): number | null {
  const [display, setDisplay] = useState(target);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (target == null) {
      setDisplay(null);
      return;
    }

    const from = display ?? target;
    fromRef.current = from;
    startRef.current = null;

    const animate = (timestamp: number) => {
      if (startRef.current == null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = fromRef.current! + (target - fromRef.current!) * eased;

      setDisplay(Math.round(current * 10) / 10);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplay(target);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}
