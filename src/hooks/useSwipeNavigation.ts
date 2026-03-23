import { useState, useCallback, useRef } from 'react';

interface UseSwipeNavigationOptions {
  /** Total number of sections */
  sectionCount: number;
  /** Minimum horizontal distance (px) to trigger a swipe. Default 50. */
  threshold?: number;
  /** Max vertical distance (px) allowed — prevents conflict with vertical scrolling. Default 80. */
  maxVertical?: number;
}

interface UseSwipeNavigationReturn {
  activeSection: number;
  setActiveSection: (index: number) => void;
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
}

/**
 * Detects horizontal swipe gestures to navigate between sections.
 * Ignores gestures that are primarily vertical (scrolling).
 */
export function useSwipeNavigation(options: UseSwipeNavigationOptions): UseSwipeNavigationReturn {
  const { sectionCount, threshold = 50, maxVertical = 80 } = options;

  const [activeSection, setActiveSection] = useState(0);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);
  const trackedRef = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    lastXRef.current = touch.clientX;
    lastYRef.current = touch.clientY;
    trackedRef.current = true;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!trackedRef.current) return;
    const touch = e.touches[0];
    lastXRef.current = touch.clientX;
    lastYRef.current = touch.clientY;
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!trackedRef.current) return;
    trackedRef.current = false;

    const dx = lastXRef.current - startXRef.current;
    const dy = Math.abs(lastYRef.current - startYRef.current);

    // Ignore if primarily vertical gesture
    if (dy > maxVertical || Math.abs(dx) < threshold) return;

    if (dx < -threshold) {
      // Swipe left → next section
      setActiveSection((prev) => Math.min(prev + 1, sectionCount - 1));
    } else if (dx > threshold) {
      // Swipe right → previous section
      setActiveSection((prev) => Math.max(prev - 1, 0));
    }
  }, [sectionCount, threshold, maxVertical]);

  return {
    activeSection,
    setActiveSection,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
