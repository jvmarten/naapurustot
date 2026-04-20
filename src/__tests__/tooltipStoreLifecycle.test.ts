/**
 * Tooltip store — lifecycle, concurrency, and edge cases.
 *
 * Priority 3: Performance-critical path (60Hz mousemove). Bugs here
 * cause stale tooltips, memory leaks, or unnecessary re-renders.
 *
 * Targets untested paths:
 * - Multiple rapid updates (simulating mousemove)
 * - Double unsubscribe safety
 * - Subscribing during notification loop
 * - Setting data back to null and back to data
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTooltipSnapshot, setTooltipData, subscribeTooltip, type TooltipData } from '../utils/tooltipStore';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeTooltip(x: number, y: number, pno = '00100'): TooltipData {
  return {
    props: { pno, nimi: 'Test', namn: 'Test' } as NeighborhoodProperties,
    x,
    y,
  };
}

beforeEach(() => {
  setTooltipData(null);
});

describe('tooltipStore — rapid updates', () => {
  it('only notifies for actual changes during rapid updates', () => {
    const listener = vi.fn();
    subscribeTooltip(listener);

    const data = makeTooltip(0, 0);
    // Simulate rapid mousemove: set same reference multiple times
    setTooltipData(data);
    setTooltipData(data);
    setTooltipData(data);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies for each new data reference', () => {
    const listener = vi.fn();
    subscribeTooltip(listener);

    setTooltipData(makeTooltip(1, 1));
    setTooltipData(makeTooltip(2, 2));
    setTooltipData(makeTooltip(3, 3));

    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('tooltipStore — null transitions', () => {
  it('handles null → data → null → data cycle', () => {
    const listener = vi.fn();
    subscribeTooltip(listener);

    const d1 = makeTooltip(1, 1);
    const d2 = makeTooltip(2, 2);

    setTooltipData(d1);
    expect(getTooltipSnapshot()).toBe(d1);
    expect(listener).toHaveBeenCalledTimes(1);

    setTooltipData(null);
    expect(getTooltipSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    setTooltipData(d2);
    expect(getTooltipSnapshot()).toBe(d2);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('does not notify when setting null to null', () => {
    const listener = vi.fn();
    subscribeTooltip(listener);

    setTooltipData(null);
    setTooltipData(null);
    setTooltipData(null);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('tooltipStore — unsubscribe safety', () => {
  it('double unsubscribe does not throw', () => {
    const listener = vi.fn();
    const unsub = subscribeTooltip(listener);

    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it('unsubscribed listener does not receive updates', () => {
    const listener = vi.fn();
    const unsub = subscribeTooltip(listener);
    unsub();

    setTooltipData(makeTooltip(1, 1));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('tooltipStore — subscriber independence', () => {
  it('unsubscribing one listener does not affect others', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();

    const unsubA = subscribeTooltip(a);
    subscribeTooltip(b);
    subscribeTooltip(c);

    setTooltipData(makeTooltip(1, 1));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);

    unsubA();

    setTooltipData(makeTooltip(2, 2));
    expect(a).toHaveBeenCalledTimes(1); // unsubscribed
    expect(b).toHaveBeenCalledTimes(2);
    expect(c).toHaveBeenCalledTimes(2);
  });
});

describe('tooltipStore — snapshot consistency', () => {
  it('getTooltipSnapshot returns current state immediately after set', () => {
    const data = makeTooltip(42, 84, '00200');
    setTooltipData(data);

    const snapshot = getTooltipSnapshot();
    expect(snapshot).toBe(data);
    expect(snapshot!.x).toBe(42);
    expect(snapshot!.y).toBe(84);
    expect(snapshot!.props.pno).toBe('00200');
  });
});
