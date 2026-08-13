import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sunPosition, type SunPosition, type SunTimes } from '../utils/sun';
import { t } from '../utils/i18n';
import {
  MINUTES_PER_DAY,
  MS_PER_MINUTE,
  addDays,
  atMinuteOfDay,
  clockTime,
  compassPoint,
  formatShadowRatio,
  hourLabel,
  isoDate,
  minuteOfDay,
  shortDate,
  skyStops,
  startOfDay,
} from './timeControl';

/**
 * The /live/ page's clock, as a bar across the bottom of the map.
 *
 * The reference is shademap.app's timeline, and the functional parts are the
 * same: a day-wide track you drag, a date you can step, a readout of where the
 * sun is. Three things here are deliberately not the same.
 *
 * THE BAND IS THE SKY, NOT A HIGHLIGHT. shademap paints a flat yellow bar
 * between sunrise and sunset. This samples the sun's real altitude every eight
 * minutes at the place the map is looking at and colours each sample (see
 * `skyStops`), so what you get is the actual shape of the day: twilight as a
 * gradient with civil, nautical and astronomical bands in it, a band that
 * narrows as you pan north in October, polar night as an unbroken dark bar and
 * the midnight sun as one that never darkens. It costs about 180 solar
 * evaluations per day-and-place, memoised, and it is the difference between a
 * decoration and a reading.
 *
 * THE TRACK IS THE WHOLE DAY, ALWAYS. shademap's ruler scrolls, so the visible
 * window is a few hours and you drag to travel. Fitting midnight to midnight
 * means the playhead's position is itself information — you can see at a glance
 * that it is early, that sunset is close, how much daylight is left — and it
 * makes the control a slider rather than a scroll surface, which is what lets it
 * carry `role="slider"` and full keyboard handling honestly.
 *
 * THE CLOCK IS SHARED. Everything else on this page answers for whatever instant
 * this bar is showing, not just the shadows (timeControl.ts explains the model,
 * and each feed's `time` in feeds.ts says how far it can follow). So the bar has
 * to state whether it is following real time or has been moved off it — the
 * pulsing dot and the "Now" button — because a page called /live/ showing 03:00
 * needs to say so.
 */

/**
 * How many minutes the playhead moves per second of playback.
 *
 * A DAY IN 72 SECONDS, NOT 36. This ran at 40 min/s, which puts the whole day
 * behind you in about the time it takes to notice it started — and playback is
 * not a way of getting somewhere (the track is the whole day; you drag for
 * that). It is for watching a change happen: shade crossing a courtyard, the
 * terminator crossing the map, a train working down a line. Every one of those
 * is a thing you have to keep your eye on for a few seconds to see at all, and
 * at 40 min/s the sun's own arc outran them.
 *
 * Halving it is also what makes the far end of the day reachable by watching:
 * an hour of clock is 90 s of real time rather than 45, so sunrise-to-sunset in
 * June is still under two minutes.
 */
const PLAY_MINUTES_PER_SECOND = 20;

/**
 * How often playback advances the clock, in ms.
 *
 * NOT a frame. Every step re-renders the page and re-runs the shadow sweep, and
 * near the horizon it also invalidates the terrain mask (which is keyed on the
 * instant, because a tenth of a degree of altitude is a factor of two in shadow
 * length down there). At 10 Hz a full day takes 72 s and each step is a tenth of
 * what the eye reads as motion, which is the point where paying more buys
 * nothing: the shadows are already moving continuously to look at.
 */
const PLAY_STEP_MS = 100;

/** Minimum pixels between hour labels before the ruler starts skipping them. */
const LABEL_MIN_PX = 44;

/** Tidy label intervals, in hours. */
const LABEL_STEPS = [1, 2, 3, 4, 6, 12];

function labelStep(width: number): number {
  const wanted = (LABEL_MIN_PX * 24) / Math.max(1, width);
  return LABEL_STEPS.find((s) => s >= wanted) ?? 24;
}

/**
 * One labelled number in the sun readout, reserved at its widest value.
 *
 * THE POINT IS THE FIXED WIDTH, not the styling. These sit in the same row as
 * the controls, which absorbs any width the readout gives up. Every one of these
 * values changes character count as you scrub — altitude crosses zero and gains
 * a minus sign, azimuth runs 9° to 360°, the shadow ratio flips between a number
 * and a dash — so the readout kept resizing and the controls beside it shifted
 * under the user's own cursor.
 *
 * `tabular-nums` alone does not fix it: it equalises digit WIDTHS, not digit
 * COUNTS. The reservation is what makes the row's width independent of the time
 * being shown, and `ch` is the natural unit for it once the digits are tabular.
 */
const SunStat: React.FC<{ label: string; width: string; children: React.ReactNode }> = ({
  label,
  width,
  children,
}) => (
  <span className="whitespace-nowrap text-surface-500 dark:text-surface-400">
    {label}{' '}
    <b
      className="inline-block text-right font-semibold tabular-nums text-surface-800 dark:text-surface-100"
      style={{ minWidth: width }}
    >
      {children}
    </b>
  </span>
);

interface TimeBarProps {
  when: Date;
  /** Whether the page is following real time rather than a scrubbed instant. */
  live: boolean;
  /** Move the clock to an instant. Always leaves live mode. */
  onScrub: (when: Date) => void;
  /** Snap back to real time and resume following it. */
  onNow: () => void;
  /** Map centre, [lon, lat] — the place the sky band is computed for. */
  center: [number, number];
  sun: SunPosition;
  times: SunTimes;
  shadowRatio: number | null;
  /** Whether the sun readout is switched on in the sidebar. */
  showSun: boolean;
}

export const TimeBar: React.FC<TimeBarProps> = ({
  when,
  live,
  onScrub,
  onNow,
  center,
  sun,
  times,
  shadowRatio,
  showSun,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);
  const [playing, setPlaying] = useState(false);

  // Measured rather than guessed from a breakpoint: the track shares its row
  // with nothing, but the sidebar opens and closes beside it, so its width is
  // not a function of the viewport's.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dayStart = useMemo(() => startOfDay(when), [when]);
  const dayKey = dayStart.getTime();

  // Rounded to a tenth of a degree: the band is a picture of the sky, and moving
  // the map by a few hundred metres cannot change it, but recomputing 180 solar
  // positions on every pan event would still cost the frame it is drawn in.
  const bandLat = Math.round(center[1] * 10) / 10;
  const bandLon = Math.round(center[0] * 10) / 10;
  const gradient = useMemo(
    () => `linear-gradient(to right, ${skyStops(new Date(dayKey), bandLat, bandLon)})`,
    [dayKey, bandLat, bandLon],
  );

  const minute = minuteOfDay(when);
  const pct = (m: number) => `${(m / MINUTES_PER_DAY) * 100}%`;

  /** Position on the track for an instant, or null when it is not today. */
  const positionOf = useCallback(
    (date: Date | null): string | null => {
      if (!date) return null;
      const m = (date.getTime() - dayKey) / MS_PER_MINUTE;
      return m >= 0 && m <= MINUTES_PER_DAY ? pct(m) : null;
    },
    [dayKey],
  );

  const sunrisePos = positionOf(times.sunrise);
  const sunsetPos = positionOf(times.sunset);

  // Where real time sits on today's track, so a scrubbed page still shows how
  // far it has travelled. Ticks with the clock rather than with the scrubber, so
  // it stays honest on a page left open.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const nowPos = live ? null : positionOf(new Date(nowMs));

  /* ------------------------------------------------------------- dragging */

  const setFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onScrub(atMinuteOfDay(when, f * (MINUTES_PER_DAY - 1)));
    },
    [onScrub, when],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Capture on the track itself, so a drag that leaves the bar — or the
    // window — keeps steering the clock instead of stopping wherever the
    // pointer happened to cross the edge.
    e.currentTarget.setPointerCapture(e.pointerId);
    setPlaying(false);
    setFromClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setFromClientX(e.clientX);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Shift is the FINE step, not the coarse one. The default of five minutes is
    // what a shadow visibly moves by; one minute is for landing on a stated
    // sunrise, which is the only thing anyone needs single-minute precision for.
    const fine = e.shiftKey ? 1 : 5;
    const step =
      e.key === 'ArrowLeft' ? -fine
      : e.key === 'ArrowRight' ? fine
      : e.key === 'PageDown' ? -60
      : e.key === 'PageUp' ? 60
      : 0;
    if (step !== 0) {
      e.preventDefault();
      setPlaying(false);
      onScrub(atMinuteOfDay(when, minute + step));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setPlaying(false);
      onScrub(atMinuteOfDay(when, e.key === 'Home' ? 0 : MINUTES_PER_DAY - 1));
    }
  };

  /* -------------------------------------------------------------- playback */

  // Kept in refs so the interval can be set up once per play/pause rather than
  // torn down and rebuilt on every tick it causes. Written in an effect, not
  // during render: a render that React throws away must not be able to move
  // the clock the next tick reads from.
  const whenRef = useRef(when);
  const scrubRef = useRef(onScrub);
  useEffect(() => {
    whenRef.current = when;
    scrubRef.current = onScrub;
  });

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const next = minuteOfDay(whenRef.current) + (PLAY_MINUTES_PER_SECOND * PLAY_STEP_MS) / 1000;
      // Wraps to the next day rather than stopping at midnight: the interesting
      // thing to watch is the sun coming back round, and a playback that halts
      // at the end of the track makes the user reach for the date arrows to
      // continue something they were already watching.
      if (next >= MINUTES_PER_DAY) scrubRef.current(atMinuteOfDay(addDays(whenRef.current, 1), 0));
      else scrubRef.current(atMinuteOfDay(whenRef.current, next));
    }, PLAY_STEP_MS);
    return () => clearInterval(id);
  }, [playing]);

  // Returning to real time is a statement that the page should follow the world
  // again, which playback contradicts.
  const goNow = () => {
    setPlaying(false);
    onNow();
  };

  /* ---------------------------------------------------------------- render */

  const step = labelStep(width);
  const hours: { h: number; text: string }[] = [];
  for (let h = step; h < 24; h += step) {
    hours.push({ h, text: hourLabel(new Date(dayKey + h * 3_600_000)) });
  }

  // Ten minutes ahead rather than one: at the equinox the sun moves ~0.004° a
  // minute near the horizon, which rounds away against a float comparison.
  const rising =
    sunPosition(new Date(when.getTime() + 600_000), center[1], center[0]).altitude > sun.altitude;

  const chip =
    'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors';
  const ghost =
    'border border-surface-300 text-surface-700 hover:bg-surface-100 dark:border-surface-700 dark:text-surface-200 dark:hover:bg-surface-800';

  return (
    <footer className="border-t border-surface-200 bg-white px-3 pb-2.5 pt-2 dark:border-surface-800 dark:bg-surface-950">
      {/* The track and its hour labels share one positioning context so the
          playhead can run through both as a single line. */}
      <div className="relative select-none">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label={t('live.time.scrub')}
          aria-valuemin={0}
          aria-valuemax={MINUTES_PER_DAY - 1}
          aria-valuenow={Math.round(minute)}
          aria-valuetext={`${shortDate(when)} ${clockTime(when)}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
          className="relative h-8 w-full cursor-ew-resize overflow-hidden rounded-md ring-1 ring-inset ring-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:ring-white/10"
          style={{ background: gradient, touchAction: 'none' }}
        >
          {/* Hour ticks, every hour regardless of which ones get labels: they
              are the grid the playhead is read against, and at 24 of them they
              cost nothing. Drawn in both black and white alpha so they stay
              visible against midnight and against noon. */}
          {Array.from({ length: 23 }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`absolute bottom-0 w-px ${(i + 1) % step === 0 ? 'h-3 bg-black/25' : 'h-1.5 bg-black/15'}`}
              style={{ left: pct((i + 1) * 60) }}
            />
          ))}

          {/* Sunrise and sunset, marked where they actually fall. The band
              already shows them as a colour change; these say which is which
              without making the reader interpret a gradient. */}
          {sunrisePos && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-px bg-white/70"
              style={{ left: sunrisePos }}
            />
          )}
          {sunsetPos && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-px bg-white/70"
              style={{ left: sunsetPos }}
            />
          )}

          {/* Real time, shown only once the clock has been moved off it. */}
          {nowPos && (
            <span
              aria-hidden="true"
              title={t('live.time.now')}
              className="absolute inset-y-0 w-0.5 bg-emerald-400 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{ left: nowPos }}
            />
          )}
        </div>

        {/* Hour labels, below the band rather than on it: the band runs from
            near-black at 03:00 to near-white at noon, so no single ink stays
            legible across it. */}
        <div className="relative mt-0.5 h-3.5" aria-hidden="true">
          {hours.map(({ h, text }) => (
            <span
              key={h}
              className="absolute -translate-x-1/2 text-[10px] leading-none tabular-nums text-surface-400 dark:text-surface-500"
              style={{ left: pct(h * 60) }}
            >
              {text}
            </span>
          ))}
        </div>

        {/* The playhead, over both rows. `pointer-events-none` so it can never
            swallow a drag aimed at the track underneath it. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-0.5 bottom-0 w-px bg-amber-500 dark:bg-amber-400"
          style={{ left: pct(minute) }}
        >
          <span className="absolute -left-[5px] -top-[5px] h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-amber-500 dark:border-t-amber-400" />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
        {/* Date stepper. The label doubles as a native date picker, which is the
            only control here that can reach a month away without 30 clicks. */}
        <div className="flex items-center rounded-lg border border-surface-300 dark:border-surface-700">
          <button
            type="button"
            onClick={() => onScrub(addDays(when, -1))}
            aria-label={t('live.time.prev_day')}
            className="px-2 py-1.5 text-xs text-surface-600 hover:text-surface-900 dark:text-surface-300 dark:hover:text-white"
          >
            ‹
          </button>
          <label className="relative cursor-pointer px-1 text-xs font-semibold tabular-nums text-surface-800 dark:text-surface-100">
            {shortDate(when)}
            <input
              type="date"
              value={isoDate(when)}
              aria-label={t('live.time.date')}
              onChange={(e) => {
                const [y, m, d] = e.target.value.split('-').map(Number);
                if (!y || !m || !d) return;
                const next = new Date(when);
                next.setFullYear(y, m - 1, d);
                onScrub(next);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          <button
            type="button"
            onClick={() => onScrub(addDays(when, 1))}
            aria-label={t('live.time.next_day')}
            className="px-2 py-1.5 text-xs text-surface-600 hover:text-surface-900 dark:text-surface-300 dark:hover:text-white"
          >
            ›
          </button>
        </div>

        {/* The clock itself. Amber when scrubbed, and carrying a live dot when
            not — the one place the page states which of the two it is doing. */}
        <span
          className={`${chip} tabular-nums ${
            live
              ? 'bg-surface-100 text-surface-900 dark:bg-surface-800 dark:text-white'
              : 'bg-amber-500 text-white'
          }`}
        >
          {live && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"
            />
          )}
          <span className="text-sm">{clockTime(when)}</span>
          {live && <span className="sr-only">{t('live.time.following')}</span>}
        </span>

        {!live && (
          <button type="button" onClick={goNow} className={`${chip} ${ghost}`}>
            {t('live.time.now')}
          </button>
        )}

        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-pressed={playing}
          aria-label={playing ? t('live.time.pause') : t('live.time.play')}
          className={`${chip} ${ghost}`}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        </button>

        {showSun && (
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {/* Widths are the widest each field can render: "-90.0°", "360° NE",
                ">99×", "00:00", "24.0 h". See SunStat for why they are pinned. */}
            <SunStat label={t('live.sun.altitude')} width="7ch">
              {sun.altitude.toFixed(1)}° {rising ? '↑' : '↓'}
            </SunStat>
            <SunStat label={t('live.sun.azimuth')} width="7.5ch">
              {sun.azimuth.toFixed(0)}° {compassPoint(sun.azimuth)}
            </SunStat>
            <SunStat label={t('live.sun.shadow_ratio')} width="5.5ch">
              {formatShadowRatio(shadowRatio)}
            </SunStat>
            <SunStat label={t('live.sun.sunrise')} width="5ch">
              {clockTime(times.sunrise)}
            </SunStat>
            <SunStat label={t('live.sun.sunset')} width="5ch">
              {clockTime(times.sunset)}
            </SunStat>
            <SunStat label={t('live.sun.day_length')} width="6ch">
              {times.dayLength.toFixed(1)} h
            </SunStat>
          </div>
        )}
      </div>
    </footer>
  );
};
