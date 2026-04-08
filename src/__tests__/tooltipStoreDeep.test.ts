/**
 * Tests for tooltipStore — the external state store for tooltip data.
 *
 * This runs on the 60Hz mouse-move hot path. Bugs here cause either
 * stale tooltips (missed updates) or excessive re-renders (every listener
 * firing when data hasn't changed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTooltipSnapshot, setTooltipData, subscribeTooltip, type TooltipData } from '../utils/tooltipStore';
import type { NeighborhoodProperties } from '../utils/metrics';

const mockProps = {
  pno: '00100',
  nimi: 'Test',
  namn: 'Test',
} as NeighborhoodProperties;

beforeEach(() => {
  // Reset to null state
  setTooltipData(null);
});

describe('tooltipStore', () => {
  it('starts with null snapshot', () => {
    expect(getTooltipSnapshot()).toBeNull();
  });

  it('returns updated data after setTooltipData', () => {
    const data: TooltipData = { props: mockProps, x: 100, y: 200 };
    setTooltipData(data);
    expect(getTooltipSnapshot()).toBe(data);
  });

  it('notifies subscribers on data change', () => {
    const listener = vi.fn();
    subscribeTooltip(listener);

    const data: TooltipData = { props: mockProps, x: 50, y: 75 };
    setTooltipData(data);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does NOT notify when setting the same data reference', () => {
    const data: TooltipData = { props: mockProps, x: 50, y: 75 };
    setTooltipData(data);

    const listener = vi.fn();
    subscribeTooltip(listener);

    // Set same reference again
    setTooltipData(data);
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = subscribeTooltip(listener);

    unsub();
    setTooltipData({ props: mockProps, x: 1, y: 2 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple concurrent subscribers', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    subscribeTooltip(listener1);
    subscribeTooltip(listener2);

    setTooltipData({ props: mockProps, x: 1, y: 2 });
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing one listener does not affect others', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = subscribeTooltip(listener1);
    subscribeTooltip(listener2);

    unsub1();
    setTooltipData({ props: mockProps, x: 1, y: 2 });
    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('setting to null notifies subscribers', () => {
    setTooltipData({ props: mockProps, x: 1, y: 2 });

    const listener = vi.fn();
    subscribeTooltip(listener);
    setTooltipData(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getTooltipSnapshot()).toBeNull();
  });

  it('rapid updates all notify (no batching/debounce)', () => {
    const listener = vi.fn();
    subscribeTooltip(listener);

    for (let i = 0; i < 10; i++) {
      setTooltipData({ props: mockProps, x: i, y: i });
    }
    expect(listener).toHaveBeenCalledTimes(10);
  });
});
