import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { setErrorReporter } from '../utils/errorReporter';
import { t } from '../utils/i18n';

/**
 * Reported bug: pressing "Show full neighborhood profile" always landed on the
 * boundary's fallback first, and only "Try again" / "Reload" got the user to the
 * page — with two buttons that read as the same action.
 *
 * The route swap tears the whole App subtree down in the same commit that mounts
 * the profile page, so a throw there is one-shot: the retry worked because the
 * teardown was already done, not because anything about the page changed. These
 * pin the resulting contract — one silent retry, a fallback that offers two
 * genuinely different outcomes, and no latching across navigations.
 */

/** Throws on its first N renders, then renders fine. Mirrors a one-shot commit error. */
function makeFlaky(failures: number) {
  let seen = 0;
  return function Flaky() {
    if (seen < failures) {
      seen += 1;
      throw new Error('boom');
    }
    return <div>recovered</div>;
  };
}

function AlwaysThrows(): React.ReactElement {
  throw new Error('always broken');
}

let consoleError: ReturnType<typeof vi.spyOn>;

// React's dev build re-surfaces errors it recovered from during concurrent
// rendering through reportError(), which jsdom turns into an uncaught exception.
// Every throw in this file is deliberate, so swallow those while it runs.
const swallowDeliberateThrows = (e: ErrorEvent) => e.preventDefault();

beforeEach(() => {
  window.addEventListener('error', swallowDeliberateThrows);
  // The boundary logs every catch; keep the test output readable.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener('error', swallowDeliberateThrows);
  consoleError.mockRestore();
  setErrorReporter(null);
});

describe('ErrorBoundary silent recovery', () => {
  it('recovers from a one-shot error without ever showing the fallback', async () => {
    const Flaky = makeFlaky(1);
    render(<ErrorBoundary><Flaky /></ErrorBoundary>);

    // The microtask-deferred remount runs before the assertion.
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('recovered')).toBeTruthy();
    expect(screen.queryByText(t('error.boundary_title'))).toBeNull();
  });

  it('stops retrying and shows the fallback when the error repeats', async () => {
    render(<ErrorBoundary><AlwaysThrows /></ErrorBoundary>);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText(t('error.boundary_title'))).toBeTruthy();
  });

  it('reports the caught error with its component stack', async () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    render(<ErrorBoundary><AlwaysThrows /></ErrorBoundary>);
    await act(async () => { await Promise.resolve(); });

    expect(reporter).toHaveBeenCalled();
    expect((reporter.mock.calls[0][0] as Error).message).toBe('always broken');
    expect(reporter.mock.calls[0][1]).toHaveProperty('componentStack');
  });

  it('survives a reporter that throws', async () => {
    setErrorReporter(() => { throw new Error('sentry is down'); });
    render(<ErrorBoundary><AlwaysThrows /></ErrorBoundary>);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText(t('error.boundary_title'))).toBeTruthy();
  });
});

describe('ErrorBoundary fallback actions', () => {
  async function showFallback() {
    const view = render(<ErrorBoundary><AlwaysThrows /></ErrorBoundary>);
    await act(async () => { await Promise.resolve(); });
    return view;
  }

  it('offers "go back" and "try again" — not two ways to re-attempt the same thing', async () => {
    await showFallback();
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual([t('error.go_back'), t('error.retry')]);
    // Reload is an escalation now, not a second primary button.
    expect(labels).not.toContain(t('error.reload'));
  });

  it('escalates to reload once a manual retry has failed', async () => {
    await showFallback();
    fireEvent.click(screen.getByText(t('error.retry')));
    await act(async () => { await Promise.resolve(); });

    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual([t('error.go_back'), t('error.reload')]);
  });

  it('"go back" leaves the broken view via history', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    // jsdom starts at length 1; pretend the user navigated here.
    const lengthSpy = vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    await showFallback();

    fireEvent.click(screen.getByText(t('error.go_back')));
    expect(back).toHaveBeenCalled();

    back.mockRestore();
    lengthSpy.mockRestore();
  });

  it('"go back" falls back to the map when there is no history to pop', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign, reload: vi.fn() },
    });
    await showFallback();

    fireEvent.click(screen.getByText(t('error.go_back')));
    expect(assign).toHaveBeenCalledWith('/');

    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });
});

describe('ErrorBoundary resetKey', () => {
  it('clears a showing fallback when the route changes', async () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/alue/00100-a"><AlwaysThrows /></ErrorBoundary>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(t('error.boundary_title'))).toBeTruthy();

    // Navigating elsewhere must not inherit the previous route's crash.
    rerender(<ErrorBoundary resetKey="/"><div>map</div></ErrorBoundary>);
    expect(screen.getByText('map')).toBeTruthy();
    expect(screen.queryByText(t('error.boundary_title'))).toBeNull();
  });

  it('does not reset while the route is unchanged', async () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/alue/00100-a"><AlwaysThrows /></ErrorBoundary>,
    );
    await act(async () => { await Promise.resolve(); });

    rerender(<ErrorBoundary resetKey="/alue/00100-a"><AlwaysThrows /></ErrorBoundary>);
    expect(screen.getByText(t('error.boundary_title'))).toBeTruthy();
  });
});

describe('ErrorBoundary recovery budget', () => {
  it('resets the burst counters after a healthy period', async () => {
    vi.useFakeTimers();
    try {
      // First one-shot error: spends the single generic retry.
      const First = makeFlaky(1);
      const { rerender } = render(<ErrorBoundary><First /></ErrorBoundary>);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText('recovered')).toBeTruthy();

      // Stay healthy long enough for the budget to be refilled.
      await act(async () => { vi.advanceTimersByTime(10_000); });

      // A second, unrelated one-shot error must still recover silently.
      const Second = makeFlaky(1);
      rerender(<ErrorBoundary><Second /></ErrorBoundary>);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText('recovered')).toBeTruthy();
      expect(screen.queryByText(t('error.boundary_title'))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
