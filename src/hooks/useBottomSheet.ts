import { useState, useCallback, useRef, useEffect } from 'react';

type SnapPosition = 'peek' | 'half' | 'full';

interface UseBottomSheetOptions {
  peekHeight?: number;
  halfRatio?: number;
  fullRatio?: number;
  initialSnap?: SnapPosition;
  onClose?: () => void;
}

interface UseBottomSheetReturn {
  sheetHeight: number;
  isDragging: boolean;
  snap: SnapPosition;
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
}

/** Velocity threshold in px/ms for fast swipe detection. */
const VELOCITY_THRESHOLD = 0.5;

function getSnapHeight(
  snap: SnapPosition,
  peekHeight: number,
  halfRatio: number,
  fullRatio: number,
): number {
  const vh = window.innerHeight;
  switch (snap) {
    case 'peek':
      return peekHeight;
    case 'half':
      return vh * halfRatio;
    case 'full':
      return vh * fullRatio;
  }
}

/**
 * Unified bottom sheet behavior with touch drag and velocity-based snapping.
 * Manages snap positions (peek / half / full), drag state, and an optional
 * onClose callback triggered when the sheet is swiped below the peek threshold.
 */
export function useBottomSheet(options: UseBottomSheetOptions = {}): UseBottomSheetReturn {
  const {
    peekHeight = 140,
    halfRatio = 0.5,
    fullRatio = 0.92,
    initialSnap = 'peek',
    onClose,
  } = options;

  const [snap, setSnap] = useState<SnapPosition>(initialSnap);
  const [isDragging, setIsDragging] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  // Refs for tracking the touch gesture
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const startHeightRef = useRef(0);

  // Read frequently-changing state from refs inside callbacks to avoid
  // recreating onTouchStart/onTouchEnd ~60 times/second during drags.
  // Consolidated into a single effect (no deps) so all three refs are
  // updated atomically after every render, before the next touch event.
  const dragHeightRef = useRef(dragHeight);
  const snapRef = useRef(snap);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    dragHeightRef.current = dragHeight;
    snapRef.current = snap;
    onCloseRef.current = onClose;
  });

  const resolveHeight = useCallback(
    (s: SnapPosition) => getSnapHeight(s, peekHeight, halfRatio, fullRatio),
    [peekHeight, halfRatio, fullRatio],
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      startYRef.current = touch.clientY;
      startTimeRef.current = Date.now();
      startHeightRef.current = dragHeightRef.current ?? resolveHeight(snapRef.current);
      setIsDragging(true);
    },
    [resolveHeight],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      const deltaY = startYRef.current - touch.clientY; // positive = swipe up
      const newHeight = Math.max(0, startHeightRef.current + deltaY);
      const maxHeight = window.innerHeight * fullRatio;
      setDragHeight(Math.min(newHeight, maxHeight));
    },
    [fullRatio],
  );

  const onTouchEnd = useCallback(() => {
    setIsDragging(false);

    const currentHeight = dragHeightRef.current ?? resolveHeight(snapRef.current);
    const elapsed = Date.now() - startTimeRef.current;
    const distancePx = currentHeight - startHeightRef.current;
    // Positive velocity = upward movement
    const velocity = elapsed > 0 ? distancePx / elapsed : 0;

    const peekH = peekHeight;
    const halfH = resolveHeight('half');
    const fullH = resolveHeight('full');

    let nextSnap: SnapPosition;

    if (velocity > VELOCITY_THRESHOLD) {
      // Fast swipe up → full
      nextSnap = 'full';
    } else if (velocity < -VELOCITY_THRESHOLD) {
      // Fast swipe down → peek, or close if below peek
      if (currentHeight < peekH) {
        setDragHeight(null);
        setSnap('peek');
        onCloseRef.current?.();
        return;
      }
      nextSnap = 'peek';
    } else {
      // Slow drag — snap to nearest position
      if (currentHeight < peekH) {
        setDragHeight(null);
        setSnap('peek');
        onCloseRef.current?.();
        return;
      }

      const distances: [SnapPosition, number][] = [
        ['peek', Math.abs(currentHeight - peekH)],
        ['half', Math.abs(currentHeight - halfH)],
        ['full', Math.abs(currentHeight - fullH)],
      ];
      distances.sort((a, b) => a[1] - b[1]);
      nextSnap = distances[0][0];
    }

    setSnap(nextSnap);
    setDragHeight(null);
  }, [peekHeight, resolveHeight]);

  const sheetHeight = isDragging && dragHeight !== null ? dragHeight : resolveHeight(snap);

  return {
    sheetHeight,
    isDragging,
    snap,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
