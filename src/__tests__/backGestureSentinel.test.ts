import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackGesture } from '../hooks/useBackGesture';

/**
 * CF-5: back-gesture sentinel. We mock a coarse-pointer device and stub the
 * History API so we can assert the push/pop bookkeeping without a real browser
 * back stack (jsdom's history.back() is async and does not reliably emit popstate).
 */
function mockCoarsePointer(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('coarse') ? matches : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('useBackGesture', () => {
  let pushSpy: ReturnType<typeof vi.spyOn>;
  let backSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('arms a single sentinel when an overlay opens on a coarse-pointer device', () => {
    mockCoarsePointer(true);
    const { rerender } = renderHook(({ open }) => useBackGesture(open, () => {}), {
      initialProps: { open: false },
    });
    expect(pushSpy).not.toHaveBeenCalled();

    rerender({ open: true });
    expect(pushSpy).toHaveBeenCalledTimes(1);

    // A second open transition while still armed must NOT push another sentinel.
    rerender({ open: true });
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a fine-pointer (desktop) device', () => {
    mockCoarsePointer(false);
    const { rerender } = renderHook(({ open }) => useBackGesture(open, () => {}), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('pops the stale sentinel via history.back when closed by other means', () => {
    mockCoarsePointer(true);
    const { rerender } = renderHook(({ open }) => useBackGesture(open, () => {}), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();

    // Overlay closed via Escape/button → consume the sentinel.
    rerender({ open: false });
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('a Back press (popstate) while armed closes the topmost overlay', () => {
    mockCoarsePointer(true);
    const closeTopmost = vi.fn();
    const { rerender } = renderHook(({ open }) => useBackGesture(open, closeTopmost), {
      initialProps: { open: false },
    });
    rerender({ open: true });

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(closeTopmost).toHaveBeenCalledTimes(1);
    // Disarmed: history.back() must NOT fire (the entry was already popped).
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('ignores popstate when no overlay is armed', () => {
    mockCoarsePointer(true);
    const closeTopmost = vi.fn();
    renderHook(() => useBackGesture(false, closeTopmost));
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(closeTopmost).not.toHaveBeenCalled();
  });

  it('re-arms a fresh sentinel when a stacked overlay remains open after Back', () => {
    mockCoarsePointer(true);
    // closeTopmost closes one layer; the parent keeps `open` true (another remains).
    const { rerender } = renderHook(({ open }) => useBackGesture(open, () => {}), {
      initialProps: { open: true },
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);

    // Back press pops sentinel + disarms; overlay still open → effect re-arms.
    window.dispatchEvent(new PopStateEvent('popstate'));
    rerender({ open: true });
    expect(pushSpy).toHaveBeenCalledTimes(2);
  });
});
