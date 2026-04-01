import { useState, useEffect, useRef, useMemo } from 'react';

/**
 * Batch-animate a record of numeric values using a single requestAnimationFrame loop.
 * Far more efficient than calling useAnimatedValue 30+ times individually.
 */
export function useAnimatedValues(
  targets: Record<string, number | null | undefined>,
  duration = 300,
): Record<string, number | null> {
  // Stable serialization for change detection
  const keyStr = Object.keys(targets).sort().join(',');
  const keys = useMemo(() => (keyStr === '' ? [] : keyStr.split(',')), [keyStr]);
  // Memoize serialized string — without this, the join runs on every render
  // even when targets haven't changed (30+ keys × string concat is measurable).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keys + targets values are the real deps
  const serialized = useMemo(() => keys.map(k => `${k}:${targets[k] ?? '_'}`).join('|'), [keyStr, targets]);

  const displayRef = useRef<Record<string, number | null>>({});
  const fromRef = useRef<Record<string, number | null>>({});
  const rafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);
  const [display, setDisplay] = useState<Record<string, number | null>>(() => {
    const init: Record<string, number | null> = {};
    for (const key of keys) {
      const v = targets[key];
      init[key] = v != null && isFinite(Number(v)) ? Number(v) : null;
    }
    displayRef.current = init;
    return init;
  });

  useEffect(() => {
    // Cancel any in-flight animation before processing new targets or early returns.
    cancelAnimationFrame(rafRef.current);

    const targetMap: Record<string, number | null> = {};
    const fromMap: Record<string, number | null> = {};

    for (const key of keys) {
      const v = targets[key];
      const num = v != null && isFinite(Number(v)) ? Number(v) : null;
      targetMap[key] = num;
      fromMap[key] = displayRef.current[key] ?? num;
    }

    fromRef.current = fromMap;
    startRef.current = null;

    if (duration <= 0) {
      displayRef.current = targetMap;
      setDisplay(targetMap);
      return;
    }

    const animate = (timestamp: number) => {
      if (startRef.current == null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic

      const current: Record<string, number | null> = {};
      for (const key of keys) {
        const t = targetMap[key];
        const f = fromRef.current[key];
        if (t == null || f == null) {
          current[key] = t;
        } else {
          current[key] = Math.round((f + (t - f) * eased) * 10) / 10;
        }
      }

      displayRef.current = current;
      setDisplay(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        displayRef.current = targetMap;
        setDisplay(targetMap);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, duration]);

  return display;
}

/**
 * PO-1: Animate a numeric value with a count-up/count-down transition.
 * Uses requestAnimationFrame for smooth ~300ms transitions.
 */
export function useAnimatedValue(target: number | null, duration = 300): number | null {
  const [display, setDisplay] = useState(target);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef<number | null>(null);
  const displayRef = useRef<number | null>(target);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    // Cancel any in-flight animation from the previous render before early returns.
    // Without this, the old RAF loop keeps running and calling setDisplay with stale values.
    cancelAnimationFrame(rafRef.current);

    if (target == null) {
      setDisplay(null);
      displayRef.current = null;
      return;
    }

    const from = displayRef.current ?? target;
    fromRef.current = from;
    startRef.current = null;

    // Skip animation if duration is zero or negative
    if (duration <= 0) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const animate = (timestamp: number) => {
      if (startRef.current == null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = fromRef.current! + (target - fromRef.current!) * eased;

      const rounded = Math.round(current * 10) / 10;
      displayRef.current = rounded;
      setDisplay(rounded);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        displayRef.current = target;
        setDisplay(target);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}
