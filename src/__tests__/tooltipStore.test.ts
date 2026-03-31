import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTooltipSnapshot, setTooltipData, subscribeTooltip, type TooltipData } from '../utils/tooltipStore';
import type { NeighborhoodProperties } from '../utils/metrics';

const makeTooltip = (x: number, y: number): TooltipData => ({
  props: { pno: '00100', nimi: 'Helsinki', namn: 'Helsingfors' } as NeighborhoodProperties,
  x,
  y,
});

describe('tooltipStore', () => {
  beforeEach(() => {
    setTooltipData(null);
  });

  it('starts with null snapshot', () => {
    expect(getTooltipSnapshot()).toBeNull();
  });

  it('stores and retrieves tooltip data', () => {
    const data = makeTooltip(100, 200);
    setTooltipData(data);
    expect(getTooltipSnapshot()).toBe(data);
  });

  it('notifies subscribers on change', () => {
    const listener = vi.fn();
    subscribeTooltip(listener);

    setTooltipData(makeTooltip(10, 20));
    expect(listener).toHaveBeenCalledTimes(1);

    setTooltipData(makeTooltip(30, 40));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when setting the same reference', () => {
    const data = makeTooltip(100, 200);
    setTooltipData(data);

    const listener = vi.fn();
    subscribeTooltip(listener);

    setTooltipData(data); // same reference
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes correctly', () => {
    const listener = vi.fn();
    const unsub = subscribeTooltip(listener);

    setTooltipData(makeTooltip(1, 2));
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    setTooltipData(makeTooltip(3, 4));
    expect(listener).toHaveBeenCalledTimes(1); // no additional call
  });

  it('notifies multiple subscribers independently', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeTooltip(a);
    subscribeTooltip(b);

    setTooltipData(makeTooltip(1, 1));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    setTooltipData(makeTooltip(2, 2));
    expect(a).toHaveBeenCalledTimes(1); // unsubscribed
    expect(b).toHaveBeenCalledTimes(2); // still subscribed
  });

  it('notifies on transition from data to null', () => {
    setTooltipData(makeTooltip(1, 1));
    const listener = vi.fn();
    subscribeTooltip(listener);

    setTooltipData(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getTooltipSnapshot()).toBeNull();
  });
});
