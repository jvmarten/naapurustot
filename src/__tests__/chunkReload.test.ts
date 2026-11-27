import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChunkReloadHandler, isChunkReloadPending } from '../utils/chunkReload';

const RELOAD_MARK_KEY = 'naapurustot:chunk-reload-at';
const reload = vi.fn();

function dispatchPreloadError(payload?: Error): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  if (payload) Object.assign(event, { payload });
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

  it('on cooldown, lets a stylesheet failure pass so the module still loads (NAAPURUSTOT-WEB-10)', () => {
    sessionStorage.setItem(RELOAD_MARK_KEY, String(Date.now()));
    const event = dispatchPreloadError(new Error('Unable to preload CSS for https://naapurustot.fi/assets/maplibre-x.css'));
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(isChunkReloadPending()).toBe(false);
  });

  it('on cooldown, still surfaces a failed module import', () => {
    sessionStorage.setItem(RELOAD_MARK_KEY, String(Date.now()));
    const event = dispatchPreloadError(new TypeError('Failed to fetch dynamically imported module: /assets/App-x.js'));
    expect(event.defaultPrevented).toBe(false);
  });

  it('a stylesheet failure outside the cooldown still reloads once (stale deploy)', () => {
    dispatchPreloadError(new Error('Unable to preload CSS for https://naapurustot.fi/assets/old.css'));
    expect(reload).toHaveBeenCalledTimes(1);
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

  it('flags a pending reload so in-flight crash reports can be dropped', () => {
    // Before any failure there is nothing to suppress.
    expect(isChunkReloadPending()).toBe(false);
    dispatchPreloadError();
    expect(reload).toHaveBeenCalledTimes(1);
    // Now navigating away: the undefined-lazy crash Vite's swallowed import produces
    // (NAAPURUSTOT-WEB-S) should be treated as transient teardown noise.
    expect(isChunkReloadPending()).toBe(true);
  });

  it('does not flag a pending reload when the cooldown blocks recovery', () => {
    // On cooldown the handler lets the error surface (a real "reload didn't help"
    // signal), so reporting must stay enabled.
    sessionStorage.setItem(RELOAD_MARK_KEY, String(Date.now()));
    dispatchPreloadError();
    expect(reload).not.toHaveBeenCalled();
    expect(isChunkReloadPending()).toBe(false);
  });
});
