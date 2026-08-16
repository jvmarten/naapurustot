import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildLiveSearch,
  formatView,
  formatWhen,
  parseLiveUrl,
  readStoredView,
  writeStoredView,
  VIEW_STORAGE_KEY,
} from '../live/urlState';

/**
 * /live/'s address-bar codec.
 *
 * The two things worth guarding here are both distinctions rather than values,
 * and both are load-bearing for what a shared link MEANS:
 *
 *   absent `t` vs present `t`  — "now" vs an instant somebody pinned. Writing
 *   `t` while the page is live would mint links that freeze a page the sender
 *   was watching move.
 *
 *   absent `f` vs empty `f`    — "this link says nothing about feeds" vs "every
 *   feed is off". Collapsing them either wipes the recipient's own toggles on
 *   every link, or makes an all-off view unshareable.
 */
describe('live URL state', () => {
  describe('parseLiveUrl', () => {
    it('reads a camera as [lng, lat] from a lat,lon,zoom string', () => {
      const s = parseLiveUrl('?at=60.16990,24.93840,15.50');
      expect(s.view).toEqual({ center: [24.9384, 60.1699], zoom: 15.5 });
    });

    it('reads a pinned instant', () => {
      const s = parseLiveUrl('?t=2026-08-16T15:42Z');
      expect(s.when?.toISOString()).toBe('2026-08-16T15:42:00.000Z');
    });

    it('reports no instant for a link without t, which means live', () => {
      expect(parseLiveUrl('?at=60,25,12').when).toBeNull();
    });

    it('distinguishes an absent feed list from an empty one', () => {
      expect(parseLiveUrl('?at=60,25,12').feeds).toBeNull();
      expect(parseLiveUrl('?f=').feeds).toEqual([]);
      expect(parseLiveUrl('?f=shadows,trains').feeds).toEqual(['shadows', 'trains']);
    });

    it('keeps the good fields of a link whose other fields are corrupt', () => {
      const s = parseLiveUrl('?at=notacoordinate&t=2026-08-16T15:42Z');
      expect(s.view).toBeNull();
      expect(s.when).not.toBeNull();
    });

    it('rejects out-of-range and malformed cameras rather than clamping them', () => {
      expect(parseLiveUrl('?at=91,25,12').view).toBeNull();
      expect(parseLiveUrl('?at=60,181,12').view).toBeNull();
      expect(parseLiveUrl('?at=60,25,40').view).toBeNull();
      expect(parseLiveUrl('?at=60,25').view).toBeNull();
      expect(parseLiveUrl('?at=60,25,12,7').view).toBeNull();
      expect(parseLiveUrl('?at=,,').view).toBeNull();
    });

    it('rejects an instant that is not the exact minute-precision UTC form', () => {
      // A local-time stamp would arrive with its `+` decoded as a space, so the
      // strict form is what stops a plausible wrong hour getting through.
      expect(parseLiveUrl('?t=2026-08-16T18:42+03:00').when).toBeNull();
      expect(parseLiveUrl('?t=2026-08-16T18:42 03:00').when).toBeNull();
      expect(parseLiveUrl('?t=2026-08-16T15:42:37Z').when).toBeNull();
      expect(parseLiveUrl('?t=yesterday').when).toBeNull();
      expect(parseLiveUrl('?t=2026-13-40T99:99Z').when).toBeNull();
    });

    it('survives a query string with no params at all', () => {
      expect(parseLiveUrl('')).toEqual({ view: null, when: null, feeds: null });
    });
  });

  describe('buildLiveSearch', () => {
    const view = { center: [24.9384, 60.1699] as [number, number], zoom: 15.5 };

    it('writes the camera latitude first, and readably', () => {
      expect(buildLiveSearch('', { view, when: null, feeds: null })).toBe(
        '?at=60.16990,24.93840,15.50',
      );
    });

    it('omits t while the page is live and writes it once pinned', () => {
      expect(buildLiveSearch('', { view: null, when: null, feeds: null })).toBe('');
      const at = new Date('2026-08-16T15:42:37.123Z');
      expect(buildLiveSearch('', { view: null, when: at, feeds: null })).toBe(
        '?t=2026-08-16T15:42Z',
      );
    });

    it('drops a stale t when the page goes back to live', () => {
      const out = buildLiveSearch('?t=2026-08-16T15%3A42Z', { view: null, when: null, feeds: null });
      expect(out).toBe('');
    });

    it('reads back a link whether the separators arrived encoded or not', () => {
      const raw = parseLiveUrl('?at=60.16990,24.93840,15.50&t=2026-08-16T15:42Z');
      const encoded = parseLiveUrl('?at=60.16990%2C24.93840%2C15.50&t=2026-08-16T15%3A42Z');
      expect(raw).toEqual(encoded);
      expect(raw.view).not.toBeNull();
      expect(raw.when).not.toBeNull();
    });

    it('writes an empty f for a view with every feed off', () => {
      expect(buildLiveSearch('', { view: null, when: null, feeds: [] })).toBe('?f=');
    });

    it('preserves params it does not own', () => {
      const out = buildLiveSearch('?lang=en&utm_source=x', { view, when: null, feeds: null });
      expect(out).toContain('lang=en');
      expect(out).toContain('utm_source=x');
      expect(out).toContain('at=');
    });

    it('round-trips through parseLiveUrl', () => {
      const when = new Date('2026-08-16T15:42:00.000Z');
      const search = buildLiveSearch('', { view, when, feeds: ['shadows', 'trains'] });
      const back = parseLiveUrl(search);
      expect(back.view).toEqual(view);
      expect(back.when?.getTime()).toBe(when.getTime());
      expect(back.feeds).toEqual(['shadows', 'trains']);
    });
  });

  describe('formatting', () => {
    it('truncates the instant to the minute rather than rounding past it', () => {
      expect(formatWhen(new Date('2026-08-16T15:42:59.999Z'))).toBe('2026-08-16T15:42Z');
    });

    it('gives an invalid date no stamp at all', () => {
      expect(formatWhen(new Date(NaN))).toBe('');
    });

    it('holds the camera to metre precision', () => {
      expect(formatView({ center: [24.938401234, 60.169901234], zoom: 15.499999 })).toBe(
        '60.16990,24.93840,15.50',
      );
    });
  });

  describe('the remembered camera', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips through localStorage', () => {
      const view = { center: [25.4651, 65.0121] as [number, number], zoom: 14 };
      writeStoredView(view);
      expect(readStoredView()).toEqual({ center: [25.4651, 65.0121], zoom: 14 });
    });

    it('reports nothing rather than throwing on a corrupt entry', () => {
      localStorage.setItem(VIEW_STORAGE_KEY, 'not a camera');
      expect(readStoredView()).toBeNull();
    });

    it('reports nothing when the browser has never been here', () => {
      expect(readStoredView()).toBeNull();
    });
  });
});
