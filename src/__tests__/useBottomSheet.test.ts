import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBottomSheet } from '../hooks/useBottomSheet';

// Mock window.innerHeight
const INNER_HEIGHT = 800;
Object.defineProperty(window, 'innerHeight', { value: INNER_HEIGHT, writable: true });

function makeTouchEvent(clientY: number): React.TouchEvent {
  return { touches: [{ clientY }] } as unknown as React.TouchEvent;
}

describe('useBottomSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('initializes with peek snap and correct height', () => {
    const { result } = renderHook(() => useBottomSheet());
    expect(result.current.snap).toBe('peek');
    expect(result.current.sheetHeight).toBe(140); // default peekHeight
    expect(result.current.isDragging).toBe(false);
  });

  it('initializes with custom snap position', () => {
    const { result } = renderHook(() => useBottomSheet({ initialSnap: 'half' }));
    expect(result.current.snap).toBe('half');
    expect(result.current.sheetHeight).toBe(INNER_HEIGHT * 0.5);
  });

  it('initializes with full snap position', () => {
    const { result } = renderHook(() => useBottomSheet({ initialSnap: 'full' }));
    expect(result.current.snap).toBe('full');
    expect(result.current.sheetHeight).toBe(INNER_HEIGHT * 0.92);
  });

  it('uses custom peekHeight, halfRatio, fullRatio', () => {
    const { result } = renderHook(() =>
      useBottomSheet({ peekHeight: 200, halfRatio: 0.4, fullRatio: 0.8, initialSnap: 'half' }),
    );
    expect(result.current.sheetHeight).toBe(INNER_HEIGHT * 0.4);
  });

  it('sets isDragging true on touch start', () => {
    const { result } = renderHook(() => useBottomSheet());
    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(600));
    });
    expect(result.current.isDragging).toBe(true);
  });

  it('updates height during touch move (swipe up increases height)', () => {
    const { result } = renderHook(() => useBottomSheet());
    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(600));
    });
    act(() => {
      // Move finger up (lower clientY) → deltaY = 600 - 400 = 200 → height increases
      result.current.handlers.onTouchMove(makeTouchEvent(400));
    });
    // During drag, sheetHeight should reflect the drag
    expect(result.current.sheetHeight).toBe(140 + 200);
    expect(result.current.isDragging).toBe(true);
  });

  it('clamps height at max (fullRatio * innerHeight)', () => {
    const { result } = renderHook(() => useBottomSheet());
    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(700));
    });
    act(() => {
      // Swipe way up → should clamp to max
      result.current.handlers.onTouchMove(makeTouchEvent(0));
    });
    expect(result.current.sheetHeight).toBeLessThanOrEqual(INNER_HEIGHT * 0.92);
  });

  it('clamps height at 0 minimum during drag', () => {
    const { result } = renderHook(() => useBottomSheet());
    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(100));
    });
    act(() => {
      // Swipe down far → deltaY = 100 - 900 = -800 → newHeight = 140 + (-800) = -660 → clamped to 0
      result.current.handlers.onTouchMove(makeTouchEvent(900));
    });
    expect(result.current.sheetHeight).toBe(0);
  });

  it('fast swipe up snaps to full', () => {
    const { result } = renderHook(() => useBottomSheet());

    // Simulate a fast swipe up: start, move up quickly, end
    const now = Date.now();
    vi.setSystemTime(now);
    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(600));
    });
    // Move up significantly
    act(() => {
      result.current.handlers.onTouchMove(makeTouchEvent(200));
    });
    // Very short time elapsed → high velocity
    vi.setSystemTime(now + 50); // 50ms → distance ~400px, velocity = 8 px/ms >> threshold
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(result.current.snap).toBe('full');
    expect(result.current.isDragging).toBe(false);
  });

  it('fast swipe down snaps to peek', () => {
    const { result } = renderHook(() => useBottomSheet({ initialSnap: 'full' }));

    const now = Date.now();
    vi.setSystemTime(now);
    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(200));
    });
    act(() => {
      // Swipe down: move to a height above peek but with high downward velocity
      result.current.handlers.onTouchMove(makeTouchEvent(500));
    });
    vi.setSystemTime(now + 50); // 50ms
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(result.current.snap).toBe('peek');
    expect(result.current.isDragging).toBe(false);
  });

  it('fast swipe down below peek triggers onClose', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useBottomSheet({ onClose, peekHeight: 140 }));

    const now = Date.now();
    vi.setSystemTime(now);
    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(700));
    });
    act(() => {
      // Swipe down so far that currentHeight < peekHeight
      result.current.handlers.onTouchMove(makeTouchEvent(800));
    });
    vi.setSystemTime(now + 20); // fast
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.snap).toBe('peek');
  });

  it('slow drag snaps to nearest position (half)', () => {
    const { result } = renderHook(() => useBottomSheet());

    const now = Date.now();
    vi.setSystemTime(now);
    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(600));
    });
    act(() => {
      // Drag up to around half height (400px)
      result.current.handlers.onTouchMove(makeTouchEvent(340));
    });
    // Slow drag: 2000ms elapsed → velocity = 260/2000 = 0.13 < 0.5 threshold
    vi.setSystemTime(now + 2000);
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(result.current.snap).toBe('half');
    expect(result.current.isDragging).toBe(false);
  });

  it('slow drag below peek triggers onClose', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useBottomSheet({ onClose, peekHeight: 140 }));

    const now = Date.now();
    vi.setSystemTime(now);
    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(700));
    });
    act(() => {
      // Drag down so current height is below peek (e.g., 50px)
      result.current.handlers.onTouchMove(makeTouchEvent(790));
    });
    vi.setSystemTime(now + 2000); // slow
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.snap).toBe('peek');
  });

  it('returns all three handler functions', () => {
    const { result } = renderHook(() => useBottomSheet());
    expect(typeof result.current.handlers.onTouchStart).toBe('function');
    expect(typeof result.current.handlers.onTouchMove).toBe('function');
    expect(typeof result.current.handlers.onTouchEnd).toBe('function');
  });
});
