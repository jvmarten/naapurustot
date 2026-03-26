import { useState, useCallback, useRef } from 'react';

interface UseSwipeNavigationOptions {
  /** Total number of sections */
  sectionCount: number;
  /** Minimum horizontal distance (px) to trigger a swipe. Default 50. */
  threshold?: number;
  /** Max vertical distance (px) before gesture is considered vertical scroll. Default 30. */
  maxVertical?: number;
  /** Velocity threshold (px/ms) for flick gestures. Default 0.3. */
  velocityThreshold?: number;
}

interface UseSwipeNavigationReturn {
  activeSection: number;
  setActiveSection: (index: number) => void;
  /** Current drag offset in px (negative = dragging left) */
  dragOffset: number;
  /** Whether the carousel is animating to a snap position */
  isSnapping: boolean;
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
  /** Call when the CSS transition ends to clear snapping state */
  onTransitionEnd: () => void;
}

/**
 * Carousel-style swipe navigation with finger-following and momentum.
 * Returns a drag offset that should be applied as a translateX on the
 * horizontally-laid-out section container.
 */
export function useSwipeNavigation(options: UseSwipeNavigationOptions): UseSwipeNavigationReturn {
  const {
    sectionCount,
    threshold = 50,
    maxVertical = 30,
    velocityThreshold = 0.3,
  } = options;

  const [activeSection, setActiveSection] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isSnapping, setIsSnapping] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastXRef = useRef(0);
  const trackingRef = useRef(false);
  // null = undecided, 'horizontal' = swiping tabs, 'vertical' = scrolling
  const directionRef = useRef<'horizontal' | 'vertical' | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // If still snapping, finish immediately
    setIsSnapping(false);

    const touch = e.touches[0];
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    startTimeRef.current = Date.now();
    lastXRef.current = touch.clientX;
    trackingRef.current = true;
    directionRef.current = null;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!trackingRef.current) return;

    const touch = e.touches[0];
    const dx = touch.clientX - startXRef.current;
    const dy = touch.clientY - startYRef.current;

    // Decide direction on first significant move
    if (directionRef.current === null) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx < 5 && absDy < 5) return; // too small to decide
      if (absDy > maxVertical && absDy > absDx) {
        directionRef.current = 'vertical';
        trackingRef.current = false;
        return;
      }
      directionRef.current = 'horizontal';
    }

    if (directionRef.current !== 'horizontal') return;

    lastXRef.current = touch.clientX;
    setDragOffset(dx);
  }, [maxVertical]);

  const onTouchEnd = useCallback(() => {
    if (!trackingRef.current || directionRef.current !== 'horizontal') {
      trackingRef.current = false;
      return;
    }
    trackingRef.current = false;

    const dx = lastXRef.current - startXRef.current;
    const dt = Date.now() - startTimeRef.current;
    const velocity = Math.abs(dx) / Math.max(dt, 1); // px/ms

    let newSection = activeSection;

    if (Math.abs(dx) > threshold || velocity > velocityThreshold) {
      if (dx < 0) {
        // Swipe left → next
        newSection = Math.min(activeSection + 1, sectionCount - 1);
      } else {
        // Swipe right → previous
        newSection = Math.max(activeSection - 1, 0);
      }
    }

    // Snap: clear offset and animate via CSS transition
    setDragOffset(0);
    setIsSnapping(true);
    setActiveSection(newSection);
  }, [activeSection, sectionCount, threshold, velocityThreshold]);

  const onTransitionEnd = useCallback(() => {
    setIsSnapping(false);
  }, []);

  return {
    activeSection,
    setActiveSection: useCallback((index: number) => {
      setIsSnapping(true);
      setDragOffset(0);
      setActiveSection(index);
    }, []),
    dragOffset,
    isSnapping,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    onTransitionEnd,
  };
}
