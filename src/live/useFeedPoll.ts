/**
 * The polling loop every realtime feed on /live/ needs, once.
 *
 * Trains had all of this inline, and the second feed would have copied it. The
 * rules below are not incidental — each one exists because the obvious version
 * was wrong in a way that only shows up in production — so they belong in one
 * place that a new feed inherits rather than in a comment a new feed is trusted
 * to have read.
 *
 * WHAT IT GUARANTEES:
 *
 *  - POLLING STOPS WHILE THE TAB IS HIDDEN, and resumes on `visibilitychange`
 *    rather than waiting out the interval. This is a page people leave open, and
 *    an abandoned tab asking a free public endpoint for data nobody is looking
 *    at, forever, is not a reasonable thing to ship. Resuming immediately is
 *    what stops the returning user seeing a stale frame.
 *
 *  - A FAILED POLL KEEPS THE DATA ALREADY ON SCREEN. A dropped request means we
 *    do not know the state NOW, not that the world emptied. Blanking the layer
 *    would make one flaky response look like the feed going down; the readout
 *    says it failed while the last known state stays drawn.
 *
 *  - ONE TIMER, EVER. The scheduler clears any pending timer before setting the
 *    next, so a visibility-driven tick landing on top of an in-flight one cannot
 *    leave two loops running at twice the poll rate.
 *
 *  - SWITCHING THE FEED OFF CLEARS IT. Not just "stops updating it" — the caller
 *    is handed an explicit clear so the layer actually disappears instead of
 *    lingering until something else happens to repaint.
 *
 * The result is deliberately delivered through a callback rather than returned
 * as state: these feeds are drawn on a canvas at up to 60 Hz from refs, and
 * routing every poll through a React render would re-render the page for data
 * that never touches the DOM.
 */
import { useEffect } from 'react';

export interface FeedPollOptions<T> {
  /** Whether the feed is switched on. False tears the loop down and clears. */
  enabled: boolean;
  /**
   * An instant to fetch ONCE for, or null to follow real time on `intervalMs`.
   *
   * This is what the page's clock reaches a feed through. A polling loop and an
   * archive request are the same request with a different `endtime` (see
   * fmi.ts), and the only structural difference is that the archive does not
   * repeat: the past does not change, so re-asking for 06:20 every five minutes
   * would be asking a free public service to send the same answer forever.
   *
   * The caller is expected to have QUANTISED and DEBOUNCED this — a pointer drag
   * produces an instant per pixel, and each one landing here is a request.
   */
  at?: number | null;
  /** Fetches one snapshot. Must reject — not return empty — on a bad response. */
  fetcher: (signal: AbortSignal, at: number | null) => Promise<T>;
  /** Milliseconds between polls, measured from the end of the previous one. */
  intervalMs: number;
  /** Called with each successful snapshot, and the instant it answers for. */
  onData: (data: T, at: number | null) => void;
  /**
   * Called when a poll fails for a reason worth reporting — never for an abort,
   * which means the caller replaced the request, not that anything went wrong.
   */
  onError: () => void;
  /** Called when the feed is switched off or unmounted. */
  onClear: () => void;
}

export function useFeedPoll<T>({
  enabled,
  at = null,
  fetcher,
  intervalMs,
  onData,
  onError,
  onClear,
}: FeedPollOptions<T>): void {
  useEffect(() => {
    if (!enabled) {
      onClear();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let stopped = false;

    const schedule = () => {
      // An archive request answers for a fixed instant, and a fixed instant does
      // not change. Polling it would re-download an identical response forever.
      if (stopped || at !== null) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void tick(), intervalMs);
    };

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden && at === null) {
        schedule();
        return;
      }
      controller?.abort();
      const active = new AbortController();
      controller = active;
      try {
        const data = await fetcher(active.signal, at);
        if (stopped || active.signal.aborted) return;
        onData(data, at);
      } catch (err) {
        // An abort is us replacing the request, not a failure to report.
        if ((err as Error)?.name === 'AbortError' || stopped) return;
        onError();
      } finally {
        schedule();
      }
    };

    const onVisibility = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // The callbacks are expected to be stable (refs and setState, not fresh
    // closures over render state); listing them would tear the loop down and
    // re-request on every render, which is the bug this shape exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, fetcher, at]);
}
