import { useState, useCallback, useRef } from 'react';

interface UseSwipeNavigationOptions {
  /** Total number of sections */
  sectionCount: number;
  /** Fraction of container width needed to commit a swipe (0–1). Default 0.3. */
  commitThreshold?: number;
  /** Velocity threshold (px/ms) for flick gestures. Default 0.4. */
  velocityThreshold?: number;
}

interface UseSwipeNavigationReturn {
  activeSection: number;
  setActiveSection: (index: number) => void;
  /** Current drag offset in px (negative = dragging left) */
  dragOffset: number;
  /** Whether the carousel is animating to a snap position */
  isSnapping: boolean;
  /** Whether a horizontal swipe is in progress (used to lock scroll) */
  isSwiping: boolean;
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
    commitThreshold = 0.2,
    velocityThreshold = 0.3,
  } = options;

  const [activeSection, setActiveSection] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isSnapping, setIsSnapping] = useState(false);
  const [isSwiping, setIsSwiping] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastXRef = useRef(0);
  const trackingRef = useRef(false);
  // null = undecided, 'horizontal' = swiping tabs, 'vertical' = scrolling
  const directionRef = useRef<'horizontal' | 'vertical' | null>(null);
  const containerWidthRef = useRef(0);

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

    // Measure container width for proportional threshold
    const el = e.currentTarget as HTMLElement;
    containerWidthRef.current = el.clientWidth || 375;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!trackingRef.current) return;

    const touch = e.touches[0];
    const dx = touch.clientX - startXRef.current;
    const dy = touch.clientY - startYRef.current;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Decide direction on first significant move
    if (directionRef.current === null) {
      // Wait for enough movement to decide
      if (absDx < 8 && absDy < 8) return;

      if (absDy > absDx) {
        // More vertical than horizontal → it's a scroll
        directionRef.current = 'vertical';
        trackingRef.current = false;
        return;
      }
      // More horizontal → it's a swipe
      directionRef.current = 'horizontal';
      setIsSwiping(true);
    }

    if (directionRef.current !== 'horizontal') return;

    // Prevent vertical scrolling while swiping horizontally
    e.preventDefault();

    lastXRef.current = touch.clientX;

    // Add rubber-band resistance at edges
    let offset = dx;
    const isAtStart = activeSection === 0 && dx > 0;
    const isAtEnd = activeSection === sectionCount - 1 && dx < 0;
    if (isAtStart || isAtEnd) {
      offset = dx * 0.3; // rubber-band
    }

    setDragOffset(offset);
  }, [activeSection, sectionCount]);

  const onTouchEnd = useCallback(() => {
    if (!trackingRef.current || directionRef.current !== 'horizontal') {
      trackingRef.current = false;
      setIsSwiping(false);
      return;
    }
    trackingRef.current = false;
    setIsSwiping(false);

    const dx = lastXRef.current - startXRef.current;
    const dt = Date.now() - startTimeRef.current;
    const velocity = Math.abs(dx) / Math.max(dt, 1); // px/ms
    const width = containerWidthRef.current;

    let newSection = activeSection;

    // Commit the swipe only if dragged past 30% of width OR flicked fast enough
    const draggedEnough = Math.abs(dx) > width * commitThreshold;
    const flickedFast = velocity > velocityThreshold;

    if (draggedEnough || flickedFast) {
      if (dx < 0) {
        newSection = Math.min(activeSection + 1, sectionCount - 1);
      } else {
        newSection = Math.max(activeSection - 1, 0);
      }
    }

    // Snap: clear offset and animate via CSS transition
    setDragOffset(0);
    setIsSnapping(true);
    setActiveSection(newSection);
  }, [activeSection, sectionCount, commitThreshold, velocityThreshold]);

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
    isSwiping,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    onTransitionEnd,
  };
}
