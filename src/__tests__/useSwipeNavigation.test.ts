/**
 * Tests for useSwipeNavigation — the carousel-style swipe hook used by the
 * mobile profile page and neighborhood wizard.
 *
 * Bugs here cause two very user-visible failures:
 *  1. Swipes get "stuck" or overshoot, navigating to wrong sections.
 *  2. Vertical scroll gets hijacked when the user intended to scroll the page.
 *
 * We cover: direction detection (horizontal vs vertical lock-in), commit
 * thresholds (30% of width), velocity-based flicks, rubber-band edges, and
 * the snapping lifecycle (isSnapping cleared on transitionend).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import type React from 'react';

interface TouchSpec { clientX: number; clientY: number }

function mkTouch({ clientX, clientY }: TouchSpec): Touch {
  return { clientX, clientY } as unknown as Touch;
}

function mkTouchEvent(touches: TouchSpec[], containerWidth = 400): React.TouchEvent {
  const target = {
    clientWidth: containerWidth,
  } as HTMLElement;
  return {
    touches: touches.map(mkTouch),
    currentTarget: target,
    preventDefault: vi.fn(),
  } as unknown as React.TouchEvent;
}

describe('useSwipeNavigation — direction detection', () => {
  it('starts at section 0 with no drag offset', () => {
    const { result } = renderHook(() => useSwipeNavigation({ sectionCount: 3 }));
    expect(result.current.activeSection).toBe(0);
    expect(result.current.dragOffset).toBe(0);
    expect(result.current.isSnapping).toBe(false);
    expect(result.current.isSwiping).toBe(false);
  });

  it('locks to vertical direction and stops tracking when Y-delta exceeds X-delta', () => {
    const { result } = renderHook(() => useSwipeNavigation({ sectionCount: 3 }));

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 100, clientY: 100 }]));
    });
    // Move primarily vertical — should lock to vertical and abort horizontal drag
    act(() => {
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 102, clientY: 150 }]));
    });

    expect(result.current.isSwiping).toBe(false);
    expect(result.current.dragOffset).toBe(0);

    // Subsequent horizontal moves must NOT start tracking mid-gesture
    act(() => {
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 300, clientY: 150 }]));
    });
    expect(result.current.dragOffset).toBe(0);
  });

  it('locks to horizontal direction when X-delta exceeds Y-delta', () => {
    const { result } = renderHook(() => useSwipeNavigation({ sectionCount: 3 }));

    // Move to section 1 so dragging left doesn't hit the rubber-band edge.
    act(() => { result.current.setActiveSection(1); });
    act(() => { result.current.onTransitionEnd(); });

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 200, clientY: 100 }]));
    });
    act(() => {
      // Drag left by 50px (toward section 2 — not rubber-banded from middle section)
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 150, clientY: 102 }]));
    });

    expect(result.current.isSwiping).toBe(true);
    // dragOffset = dx = -50 (no rubber-band because section 1 is not at either edge)
    expect(result.current.dragOffset).toBe(-50);
  });

  it('waits for a minimum movement (8px) before deciding direction', () => {
    const { result } = renderHook(() => useSwipeNavigation({ sectionCount: 3 }));

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 100, clientY: 100 }]));
    });
    // Tiny move — no lock yet
    act(() => {
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 104, clientY: 102 }]));
    });

    expect(result.current.isSwiping).toBe(false);
    expect(result.current.dragOffset).toBe(0);
  });
});

describe('useSwipeNavigation — commit thresholds', () => {
  it('does NOT advance section when dragged less than commitThreshold of width', () => {
    const { result } = renderHook(() =>
      useSwipeNavigation({ sectionCount: 3, commitThreshold: 0.5, velocityThreshold: 99 }),
    );

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 300, clientY: 100 }], 400));
    });
    // Drag left 50px — 12.5% of width, below 50% threshold
    act(() => {
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 250, clientY: 102 }], 400));
    });
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(result.current.activeSection).toBe(0);
    // Snapping back to 0
    expect(result.current.isSnapping).toBe(true);
  });

  it('advances section when dragged past commitThreshold', () => {
    const { result } = renderHook(() =>
      useSwipeNavigation({ sectionCount: 3, commitThreshold: 0.3, velocityThreshold: 99 }),
    );

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 300, clientY: 100 }], 400));
    });
    // Drag left 150px — 37.5% of width, exceeds 30%
    act(() => {
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 150, clientY: 102 }], 400));
    });
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(result.current.activeSection).toBe(1);
  });

  it('goes back a section when dragged right past threshold', () => {
    const { result } = renderHook(() =>
      useSwipeNavigation({ sectionCount: 3, commitThreshold: 0.3, velocityThreshold: 99 }),
    );

    // Start on section 1
    act(() => {
      result.current.setActiveSection(1);
    });
    act(() => { result.current.onTransitionEnd(); });

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 100, clientY: 100 }], 400));
    });
    act(() => {
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 250, clientY: 102 }], 400));
    });
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(result.current.activeSection).toBe(0);
  });
});

describe('useSwipeNavigation — velocity-based flicks', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('commits section advance on fast flick even below commitThreshold', () => {
    const { result } = renderHook(() =>
      useSwipeNavigation({ sectionCount: 3, commitThreshold: 0.9, velocityThreshold: 0.3 }),
    );

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 300, clientY: 100 }], 400));
    });
    // Small drag (50px in 10ms = 5 px/ms >> 0.3 threshold)
    act(() => {
      vi.advanceTimersByTime(10);
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 250, clientY: 102 }], 400));
    });
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(result.current.activeSection).toBe(1);
  });
});

describe('useSwipeNavigation — rubber-band at edges', () => {
  it('applies 30% resistance when dragging right on the first section', () => {
    const { result } = renderHook(() => useSwipeNavigation({ sectionCount: 3 }));

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 100, clientY: 100 }], 400));
    });
    // Drag right from section 0 — should be dampened to 30% of input
    act(() => {
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 200, clientY: 102 }], 400));
    });

    // dx = 100, rubber-banded = 30
    expect(result.current.dragOffset).toBeCloseTo(30, 1);
  });

  it('applies resistance when dragging left on the last section', () => {
    const { result } = renderHook(() => useSwipeNavigation({ sectionCount: 3 }));

    act(() => { result.current.setActiveSection(2); });
    act(() => { result.current.onTransitionEnd(); });

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 300, clientY: 100 }], 400));
    });
    act(() => {
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 200, clientY: 102 }], 400));
    });

    // dx = -100, rubber-banded = -30
    expect(result.current.dragOffset).toBeCloseTo(-30, 1);
  });

  it('does not overflow past the last section even on a strong flick', () => {
    const { result } = renderHook(() =>
      useSwipeNavigation({ sectionCount: 3, velocityThreshold: 0.1 }),
    );
    act(() => { result.current.setActiveSection(2); });
    act(() => { result.current.onTransitionEnd(); });

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 300, clientY: 100 }], 400));
    });
    act(() => {
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 100, clientY: 102 }], 400));
    });
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(result.current.activeSection).toBe(2);
  });

  it('does not underflow past the first section', () => {
    const { result } = renderHook(() =>
      useSwipeNavigation({ sectionCount: 3, velocityThreshold: 0.1 }),
    );

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 100, clientY: 100 }], 400));
    });
    act(() => {
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 400, clientY: 102 }], 400));
    });
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(result.current.activeSection).toBe(0);
  });
});

describe('useSwipeNavigation — snapping lifecycle', () => {
  it('clears isSnapping when onTransitionEnd fires', () => {
    const { result } = renderHook(() => useSwipeNavigation({ sectionCount: 3 }));

    act(() => { result.current.setActiveSection(1); });
    expect(result.current.isSnapping).toBe(true);

    act(() => { result.current.onTransitionEnd(); });
    expect(result.current.isSnapping).toBe(false);
  });

  it('setActiveSection directly navigates and marks as snapping', () => {
    const { result } = renderHook(() => useSwipeNavigation({ sectionCount: 3 }));

    act(() => { result.current.setActiveSection(2); });
    expect(result.current.activeSection).toBe(2);
    expect(result.current.isSnapping).toBe(true);
    expect(result.current.dragOffset).toBe(0);
  });

  it('cancels snap state on a new touchstart during in-flight animation', () => {
    const { result } = renderHook(() => useSwipeNavigation({ sectionCount: 3 }));

    act(() => { result.current.setActiveSection(1); });
    expect(result.current.isSnapping).toBe(true);

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 100, clientY: 100 }]));
    });
    expect(result.current.isSnapping).toBe(false);
  });
});

describe('useSwipeNavigation — ignores touches not locked to horizontal', () => {
  it('touchEnd after vertical-locked gesture does not change section', () => {
    const { result } = renderHook(() => useSwipeNavigation({ sectionCount: 3 }));

    act(() => {
      result.current.handlers.onTouchStart(mkTouchEvent([{ clientX: 100, clientY: 100 }]));
    });
    act(() => {
      // Vertical lock
      result.current.handlers.onTouchMove(mkTouchEvent([{ clientX: 102, clientY: 200 }]));
    });
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(result.current.activeSection).toBe(0);
    expect(result.current.isSwiping).toBe(false);
  });
});
