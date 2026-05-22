import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChunkReloadHandler } from '../utils/chunkReload';

const RELOAD_MARK_KEY = 'naapurustot:chunk-reload-at';
const reload = vi.fn();

function dispatchPreloadError(): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('installChunkReloadHandler', () => {
  const originalLocation = window.location;
  let dispose: () => void;

  beforeEach(() => {
    sessionStorage.clear();
    reload.mockClear();
    Object.defineProperty(window, 'location', {
      value: { reload },
      writable: true,
      configurable: true,
    });
    dispose = installChunkReloadHandler();
  });

  afterEach(() => {
    dispose();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('reloads the page when a dynamic import fails', () => {
    const event = dispatchPreloadError();
    expect(reload).toHaveBeenCalledTimes(1);
    // The error is suppressed because the page is about to reload anyway.
    expect(event.defaultPrevented).toBe(true);
  });

  it('records the reload timestamp to guard against a loop', () => {
    dispatchPreloadError();
    expect(Number(sessionStorage.getItem(RELOAD_MARK_KEY))).toBeGreaterThan(0);
  });

  it('does not reload again right after a reload — lets the error surface', () => {
    sessionStorage.setItem(RELOAD_MARK_KEY, String(Date.now()));
    const event = dispatchPreloadError();
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('reloads again once the cooldown has elapsed', () => {
    sessionStorage.setItem(RELOAD_MARK_KEY, String(Date.now() - 60_000));
    dispatchPreloadError();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads only once when a burst of imports fails together', () => {
    dispatchPreloadError();
    dispatchPreloadError();
    dispatchPreloadError();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
