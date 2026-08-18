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
import { formatUv, type UvBand } from './uv';

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
 * How fast playback runs, in minutes of clock per second of real time.
 *
 * ONE NUMBER COULD NOT DO THIS JOB, and two rounds of lowering it is the
 * evidence: 40 → 20 → 10, each time because the previous pace outran what
 * someone was trying to watch. The reason no constant works is that the thing
 * being watched does not move at a constant rate. Shadow length goes as
 * cot(altitude), and cot runs away near zero — so the shadow TIP accelerates
 * enormously as the sun drops, even though the sun's own altitude changes at a
 * fairly steady rate.
 *
 * Measured with this repo's own `sunPosition`, a 20 m building at Helsinki on
 * 15 August, tip travel per clock-minute:
 *
 *     sun at 40°     0.06 m      (shadow 24 m)
 *     sun at  5°     5.5  m      (shadow 233 m)
 *     sun at  1°   136    m      (shadow 1254 m)
 *
 * That is a factor of about two thousand across one afternoon. A pace that is
 * calm at noon is a stampede at 21:00, and no single number can be right for
 * both. So the pace became a choice, and these are the three:
 *
 * 2 min/s — THE LOW SUN. A clock-hour in 30 s, a day in 12 minutes (which
 * nobody should sit through, and nobody has to: this is for an interval you
 * picked, not for the day). The stretch from 5° to 1° of altitude is 35
 * clock-minutes at Helsinki in August — 3.5 seconds at the default, and the
 * span over which that tip goes from 5 m a minute to 136. This rung gives it
 * 17.5 seconds. Shade crossing a courtyard, climbing a wall, leaving a window.
 * It is also the one setting that costs LESS: at 0.2 minutes a tick the
 * accumulator emits two steps a second instead of ten, so the shadow sweep runs
 * a fifth as often. Nothing slower, because the clock's resolution is one
 * minute (`atMinuteOfDay` rounds) and below this you watch a clock tick rather
 * than shade move.
 *
 * 10 min/s — THE DEFAULT, and unchanged. A clock-hour in 6 s, a day in 2 min
 * 24 s. Where the conversation landed, and a default is still a claim.
 *
 * 30 min/s — THE WHOLE DAY AS ONE MOTION. A day in 48 s: long enough to be a
 * view of it, short enough to watch without having to decide to. For subjects
 * whose scale is the day rather than a moment in it — the terminator crossing a
 * continental frame, a courtyard's whole cycle of light. Not a rescue from
 * waiting: see the correction below.
 *
 * A CORRECTION, since this comment carried the error for two commits. It read
 * "an hour of clock is three minutes of real time, so a June sunrise-to-sunset
 * is about twelve minutes to sit through". Both figures were wrong by 30× and
 * 6×: at 10 min/s a clock-hour takes 6 SECONDS and a Helsinki June day (~19 h)
 * takes about 1 min 54 s. The day figure in the same breath (144 s) was right,
 * which is how it survived. Nothing was ever slow to sit through, so the fast
 * rung is not for escaping a wait — it is for seeing a day whole, which the
 * drag cannot show at all.
 */
const PLAY_SPEEDS = [
  { pace: 2, labelKey: 'live.time.speed_slow' },
  { pace: 10, labelKey: 'live.time.speed_normal' },
  { pace: 30, labelKey: 'live.time.speed_fast' },
] as const;

const DEFAULT_PACE = 10;

const SPEED_KEY = 'live.speed';

/**
 * The stored pace, narrowed against the current ladder rather than trusted.
 *
 * A pace that was an option last month and is not one now would otherwise come
 * back as a playback rate that no label on screen accounts for. `Number(null)`
 * and `Number('')` are both 0, which is not in the list, so a missing or
 * corrupt key falls to the default without a branch of its own.
 */
function readStoredPace(): number {
  try {
    const stored = Number(localStorage.getItem(SPEED_KEY));
    return PLAY_SPEEDS.some((s) => s.pace === stored) ? stored : DEFAULT_PACE;
  } catch {
    return DEFAULT_PACE;
  }
}

/**
 * How often playback advances the clock, in ms.
 *
 * NOT a frame. Every step re-renders the page and re-runs the shadow sweep, and
 * near the horizon it also invalidates the terrain mask (which is keyed on the
 * instant, because a tenth of a degree of altitude is a factor of two in shadow
 * length down there). At 10 Hz each step is one clock-minute at the default —
 * well under what the eye reads as a jump — which is the point where paying
 * more buys nothing: the shadows are already moving continuously to look at.
 *
 * THIS IS NOT THE SPEED KNOB, and now that there is a real one the distinction
 * has teeth. Ten steps a second of one minute each and one step a second of ten
 * minutes each play the same day in the same time, but the second is a
 * slideshow — the sweep pays for a step either way, so dropping the rate saves
 * nothing and spends the smoothness that makes the motion legible. The pace
 * varies minutes-per-STEP; the tick rate is fixed. That is also why the fast
 * rung is free: 30 min/s costs exactly the sweeps that 10 min/s does.
 */
const PLAY_STEP_MS = 100;

/**
 * Minimum pixels between hour labels before the ruler starts skipping them.
 *
 * Sized for the label the ruler actually prints, which is now two digits and
 * nothing else — `hourLabel` dropped Intl for `HH` when the clock went 24-hour.
 * At 44 px this was still reserving room for "12 PM", so a phone-width track
 * labelled every third hour where every second one fits, and a desktop one
 * carried more air between the numbers than the ticks under them.
 */
const LABEL_MIN_PX = 30;

/** Tidy label intervals, in hours. */
const LABEL_STEPS = [1, 2, 3, 4, 6, 12];

function labelStep(width: number): number {
  const wanted = (LABEL_MIN_PX * 24) / Math.max(1, width);
  return LABEL_STEPS.find((s) => s >= wanted) ?? 24;
}

/** One published hour of the UV index, with the exposure band it falls in. */
export interface UvReadout {
  index: number;
  at: number;
  clearSky: number | null;
  band: UvBand;
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
  /**
   * The UV index under the playhead, or null when there is none to show.
   *
   * Null covers three different situations — the feed is off, its day has not
   * arrived, and the model does not reach this instant — and the bar treats them
   * identically on purpose. A number here is the whole of what this row can
   * honestly carry; which of the three it is, and that the number is a model at
   * all, is the honesty strip's sentence to make.
   */
  uv: UvReadout | null;
  /**
   * Told when playback starts and stops.
   *
   * The page does not need this to draw — every layer answers for `when`, and
   * `when` is already arriving. It needs it to know that `when` is about to keep
   * arriving, which is a different fact and the one the measured feeds' network
   * behaviour turns on. See `ARCHIVE_PLAYBACK_DEBOUNCE_MS` in LivePage.
   */
  onPlayingChange?: (playing: boolean) => void;
}

export const TimeBar: React.FC<TimeBarProps> = ({
  when,
  live,
  onScrub,
  onNow,
  center,
  sun,
  times,
  onPlayingChange,
  shadowRatio,
  showSun,
  uv,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);
  const [playing, setPlaying] = useState(false);
  /**
   * Minutes of clock per real second, and TimeBar's own state.
   *
   * It lives here rather than in LivePage — which owns the other two stored
   * keys — because the page answers for the instant, not for how fast the
   * instant moves. `playing` used to be justified the same way, on the grounds
   * that nothing outside this bar reads it. That turned out to be false: the
   * measured feeds' refinement request has to know whether the playhead is
   * still moving, so it is reported out (`onPlayingChange`) while staying owned
   * here. The pace genuinely is private; this one is not.
   */
  const [pace, setPace] = useState(readStoredPace);

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  useEffect(() => {
    try {
      localStorage.setItem(SPEED_KEY, String(pace));
    } catch {
      /* private mode — the pace still holds for this session */
    }
  }, [pace]);

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
    // UP AND DOWN ARE PEERS OF RIGHT AND LEFT, which the ARIA slider pattern
    // requires and this handler used to ignore — so the key a screen-reader user
    // is told to press did nothing here, and worse than nothing: unhandled, it
    // fell through without `preventDefault` and scrolled the page while focus
    // stayed on the track. On a page whose every layer answers to this one
    // control, half its documented keys failing is the difference between the
    // clock being operable from a keyboard and not.
    const step =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -fine
      : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? fine
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
  //
  // THE PACE IS ON THIS LIST FOR THE SAME REASON, and it is what lets the speed
  // change mid-playback without a seam: the interval stays keyed on [playing],
  // so picking a new speed never tears it down and never loses a tick.
  const whenRef = useRef(when);
  const scrubRef = useRef(onScrub);
  const paceRef = useRef(pace);
  useEffect(() => {
    whenRef.current = when;
    scrubRef.current = onScrub;
    paceRef.current = pace;
  });

  /**
   * The sub-minute remainder the CLOCK cannot hold.
   *
   * `atMinuteOfDay` does `setMinutes(Math.round(...))` and `startOfDay` zeroes
   * the seconds, so `when` has whole-minute resolution and any fraction handed
   * to it is destroyed on the way in. That was invisible while the pace was a
   * constant of 10 min/s, because 10 × 100 ms is exactly 1.000 minute a tick.
   * It stops being invisible the moment the pace is a choice: at 2 min/s the
   * per-tick delta is 0.2, `Math.round` takes every one of them back to the
   * minute it started on, and the clock would sit still while `onScrub` fired
   * ten times a second — a frozen page that looks exactly like a hung one.
   *
   * So the fraction accumulates here and a scrub is emitted only when a whole
   * minute has built up. The whole-minute base is re-read from `whenRef` every
   * tick rather than integrated locally, so this carries a remainder and never
   * a position — at most one minute of state, which cannot drift.
   */
  const carryRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    // Each play run starts on a whole minute. A remainder left over from the
    // last run belongs to a pace and a position the user has since left.
    carryRef.current = 0;
    const id = setInterval(() => {
      carryRef.current += (paceRef.current * PLAY_STEP_MS) / 1000;
      const whole = Math.floor(carryRef.current);
      if (whole < 1) return;
      carryRef.current -= whole;
      const next = minuteOfDay(whenRef.current) + whole;
      // Wraps to the next day rather than stopping at midnight: the interesting
      // thing to watch is the sun coming back round, and a playback that halts
      // at the end of the track makes the user reach for the date arrows to
      // continue something they were already watching.
      //
      // THE OVERSHOOT CARRIES ACROSS THE WRAP, and it only started being able
      // to. While the step was a fixed 1.000 minute, `next` could only ever
      // reach exactly 1440 from a seconds-zeroed clock, so landing hard on 00:00
      // lost nothing. At 30 min/s the step is 3, `next` reaches 1441 or 1442,
      // and hard-landing would silently eat one or two minutes once per
      // simulated day — the one place where making the step a choice changed
      // arithmetic that used to be exact.
      if (next >= MINUTES_PER_DAY) {
        scrubRef.current(atMinuteOfDay(addDays(whenRef.current, 1), next - MINUTES_PER_DAY));
      } else {
        scrubRef.current(atMinuteOfDay(whenRef.current, next));
      }
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
              className="absolute -translate-x-1/2 text-[10px] leading-none tabular-nums text-surface-500 dark:text-surface-400"
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
          {/* `focus-within`, because the focusable element here is the date
              input stretched invisibly over the label — `opacity-0` hides its
              UA focus ring along with everything else, so tabbing along this
              row went track (amber ring) → ‹ (ring) → nowhere → › (ring). The
              speed pill below already carries this exact treatment and its
              comment already names this control's missing ring as a bug; this
              is that bug, fixed rather than described. */}
          <label className="relative cursor-pointer rounded-md px-1 text-xs font-semibold tabular-nums text-surface-800 focus-within:ring-2 focus-within:ring-inset focus-within:ring-amber-500 dark:text-surface-100">
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
              : 'bg-amber-500 text-amber-950'
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

        {/* Play, joined to the rate it plays at.

            NOT a fifth peer control in this row. The pace is a property of this
            button — it does nothing when nothing is playing — and a separate
            chip beside it would have said they were two things at the same
            level. The joined pill is the shape the date stepper already uses
            for ‹ 14.8. › eleven lines above, so the row gains a control without
            gaining an idiom.

            THE PACE IS ALSO A READOUT, and that is what makes persisting it
            honest: a stored speed the user cannot see would ambush them on the
            next visit with a day that flies or crawls for no stated reason. If
            a later redesign hides the number behind a glyph, the persistence
            has to go with it. */}
        <div className="flex items-center rounded-lg border border-surface-300 dark:border-surface-700">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
            aria-label={playing ? t('live.time.pause') : t('live.time.play')}
            className="px-2.5 py-1.5 text-xs text-surface-700 hover:text-surface-900 dark:text-surface-200 dark:hover:text-white"
          >
            <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
          </button>
          {/* A native <select> stretched invisibly over a compact label — the
              trick the date input in this same row uses. It buys the phone an
              OS picker showing the full sentence, and the keyboard one Tab stop
              with arrows, type-ahead and Esc already working; none of that is
              code here. `focus-within` because it is the variant this repo
              already uses, and because the date input's own invisible focus is
              a bug not worth copying. */}
          <label className="relative flex cursor-pointer items-center gap-1 rounded-r-lg border-l border-surface-300 px-2 py-1.5 text-xs font-semibold tabular-nums text-surface-800 focus-within:ring-2 focus-within:ring-inset focus-within:ring-amber-500 dark:border-surface-700 dark:text-surface-100">
            {/* Reserved at two digits for the reason SunStat gives: the row
                absorbs width, and a control must not resize under the cursor
                clicking it. 2 → 30 is a character, and it moves the wrap. */}
            <span aria-hidden="true" className="inline-block text-right" style={{ minWidth: '2ch' }}>
              {pace}
            </span>
            <span aria-hidden="true">min/s</span>
            {/* Load-bearing. `10 min/s` in this row would otherwise read as a
                seventh SunStat — a measured quantity — on a page whose whole
                subject is which numbers are measured. The caret, the border and
                the mono weight are the three things saying it is a setting. */}
            <span aria-hidden="true" className="text-[9px] text-surface-500 dark:text-surface-400">
              ▾
            </span>
            <select
              value={pace}
              onChange={(e) => setPace(Number(e.target.value))}
              aria-label={t('live.time.speed')}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 dark:[color-scheme:dark]"
            >
              {PLAY_SPEEDS.map(({ pace: p, labelKey }) => (
                <option key={p} value={p}>
                  {t(labelKey)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {(showSun || uv) && (
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {/* Widths are the widest each field can render: "-90.0°", "360° NE",
                ">99×", "00:00", "24.0 h". See SunStat for why they are pinned. */}
            {showSun && (
              <>
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
              </>
            )}
            {/* THE ONE MODELLED NUMBER IN A ROW OF EXACT ONES, so it is drawn
                differently from all of them: italic, which is this page's mark
                for a value a publisher predicted rather than an instrument
                measured, and inked with the WHO band's own colour so "3.6" also
                says "moderate" without spending a column on the word.

                The colour is not the only channel carrying the band — an
                `sr-only` span says it, the tooltip says it, and the honesty
                strip states it in a full sentence with the hour and the source.
                It arrives through a CSS variable because Tailwind cannot compile
                a class built from a runtime value, and the two inks are needed
                because this row renders on white and on near-black.

                Reserved at 4ch for "11.5". Finland does not reach that — the
                summer peak in Helsinki is around 6 — but the band table goes to
                extreme and a reserved width that a real value can overflow is
                the bug SunStat exists to prevent. */}
            {uv && (
              <SunStat label={t('live.sun.uv')} width="4ch">
                <span
                  className="italic text-[color:var(--uv-ink)] dark:text-[color:var(--uv-ink-dark)]"
                  style={
                    {
                      '--uv-ink': uv.band.light,
                      '--uv-ink-dark': uv.band.dark,
                    } as React.CSSProperties
                  }
                  title={`${t(uv.band.key)} · ${t('live.uv.modelled')}`}
                >
                  {formatUv(uv.index)}
                </span>
                <span className="sr-only"> {t(uv.band.key)}</span>
              </SunStat>
            )}
          </div>
        )}
      </div>
    </footer>
  );
};
