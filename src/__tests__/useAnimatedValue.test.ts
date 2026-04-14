/**
 * Tests for useAnimatedValue — the count-up/count-down animation hook used
 * throughout the UI (quality index badges, stat cards, trend deltas).
 *
 * Regressions here manifest as:
 *  - Stale values "stuck" on screen after navigation.
 *  - Infinite animation loops when target flips between null and a number.
 *  - The previous bug this hook was rewritten to fix: the RAF from a previous
 *    render would keep firing setDisplay, stepping the number away from the
 *    new target — so we explicitly assert that rapid target changes cancel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnimatedValue } from '../hooks/useAnimatedValue';

// rAF in jsdom does not run timestamps. We install a controllable mock so the
// tests can drive each frame deterministically.
let rafQueue: Array<{ id: number; cb: FrameRequestCallback }>;
let rafNext: number;
let currentTime: number;

function flushRaf(toTimestamp: number): void {
  currentTime = toTimestamp;
  const pending = rafQueue;
  rafQueue = [];
  for (const { cb } of pending) {
    cb(currentTime);
  }
}

beforeEach(() => {
  rafQueue = [];
  rafNext = 1;
  currentTime = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = rafNext++;
    rafQueue.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQueue = rafQueue.filter((entry) => entry.id !== id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAnimatedValue', () => {
  it('returns the target immediately on mount', () => {
    const { result } = renderHook(() => useAnimatedValue(50));
    expect(result.current).toBe(50);
  });

  it('returns null when target is null', () => {
    const { result } = renderHook(() => useAnimatedValue(null));
    expect(result.current).toBeNull();
  });

  it('switches to null immediately when target becomes null', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedValue(v), {
      initialProps: { v: 50 as number | null },
    });
    rerender({ v: null });
    expect(result.current).toBeNull();
  });

  it('animates from current display to new target over duration', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedValue(v, 300), {
      initialProps: { v: 0 as number | null },
    });
    expect(result.current).toBe(0);

    rerender({ v: 100 });

    // Start frame (timestamp becomes start)
    act(() => flushRaf(1000));
    expect(result.current).toBe(0);

    // Midway (~50% of 300ms duration)
    act(() => flushRaf(1150));
    // Ease-out cubic at t=0.5: 1-(0.5)^3 = 0.875 → display ≈ 87.5
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(100);

    // Past end
    act(() => flushRaf(1400));
    expect(result.current).toBe(100);
  });

  it('cancels the previous animation when target changes mid-flight', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedValue(v, 300), {
      initialProps: { v: 0 as number | null },
    });

    rerender({ v: 100 });
    act(() => flushRaf(1000));
    act(() => flushRaf(1100)); // ~33% through

    // There should still be a pending RAF entry for the first animation.
    expect(rafQueue.length).toBeGreaterThan(0);
    const framesBeforeChange = rafQueue.length;

    // Interrupt with a new target — the prior animation's RAF chain must stop.
    rerender({ v: 200 });

    // After change, the old animation's queued frame was cancelled. The new
    // animation is scheduled fresh (so queue might be the same size, but the
    // prior id is gone).
    expect(rafQueue.length).toBeLessThanOrEqual(framesBeforeChange);

    // Drive the new animation to completion
    act(() => flushRaf(2000));
    act(() => flushRaf(2400));

    expect(result.current).toBe(200);
  });

  it('skips animation entirely when duration <= 0', () => {
    const { result, rerender } = renderHook(({ v, d }) => useAnimatedValue(v, d), {
      initialProps: { v: 0 as number | null, d: 0 },
    });
    rerender({ v: 999, d: 0 });

    // No RAF should be queued (duration <= 0 early-returns)
    expect(rafQueue.length).toBe(0);
    expect(result.current).toBe(999);
  });

  it('settles exactly on the target at the end of the animation', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedValue(v, 100), {
      initialProps: { v: 0 as number | null },
    });
    rerender({ v: 42.7 });

    act(() => flushRaf(500));
    // Big jump past the end
    act(() => flushRaf(2000));

    expect(result.current).toBe(42.7);
  });

  it('rounds intermediate frames to one decimal place', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedValue(v, 300), {
      initialProps: { v: 0 as number | null },
    });
    rerender({ v: 100 });

    act(() => flushRaf(1000));
    act(() => flushRaf(1050));

    // Display value should be rounded to 1 decimal
    const display = result.current!;
    expect(display).toBe(Math.round(display * 10) / 10);
  });

  it('can animate negative deltas (count down)', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedValue(v, 100), {
      initialProps: { v: 80 as number | null },
    });
    rerender({ v: 20 });

    act(() => flushRaf(1000));
    act(() => flushRaf(1050));
    // Midway the value is between 80 and 20 (monotonically decreasing)
    expect(result.current).toBeLessThan(80);
    expect(result.current).toBeGreaterThan(20);

    act(() => flushRaf(1200));
    expect(result.current).toBe(20);
  });

  it('unmount cancels the pending animation frame', () => {
    const { rerender, unmount } = renderHook(({ v }) => useAnimatedValue(v, 300), {
      initialProps: { v: 0 as number | null },
    });
    rerender({ v: 100 });
    act(() => flushRaf(1000));
    expect(rafQueue.length).toBeGreaterThan(0);

    unmount();

    // All frames must be cancelled on unmount.
    expect(rafQueue.length).toBe(0);
  });
});
