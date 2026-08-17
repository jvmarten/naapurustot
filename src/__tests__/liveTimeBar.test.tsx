import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { TimeBar } from '../live/TimeBar';
import { sunPosition, sunTimes } from '../utils/sun';
import { MINUTES_PER_DAY, minuteOfDay } from '../live/timeControl';

/**
 * The /live/ clock's playback pace.
 *
 * Pinned because the pace is a UX decision hiding inside a constant, and a
 * constant is trivially "tidied" upward by anyone who thinks a day ought to be
 * over quickly. It ought not to be: playback here is not a way of getting
 * somewhere — the track is the whole day, and you drag for that — it is for
 * watching a change happen, shade crossing a courtyard or the terminator
 * crossing the map, and each of those takes several seconds of watching to read
 * at all. What is asserted is the consequence rather than the number: a real
 * second must move the clock by a small fraction of an hour, so a whole day
 * takes minutes to watch rather than seconds.
 *
 * The floor is deliberately not the setting. It sits where the *reason* stops
 * holding, which leaves room to tune the feel without rewriting the test — and
 * catches the one change that would break it, a return to a pace that plays the
 * day faster than anyone can watch it.
 *
 * THE BAR IS DRIVEN CONTROLLED HERE, which is the only way the question can be
 * asked. Playback steps from `when`, so a bar whose `when` never changes
 * re-answers the same first step ten times a second and measures the STEP, not
 * the pace — the two differ by the tick rate, and a test that conflates them
 * passes at any speed.
 */

const CENTRE: [number, number] = [24.94, 60.17];
const WHEN = new Date('2026-08-12T09:00:00Z');

/** The bar wired to its own clock, as LivePage wires it. */
const Harness: React.FC<{
  onScrub?: (d: Date) => void;
  from?: Date;
  onPlayingChange?: (playing: boolean) => void;
}> = ({ onScrub, from, onPlayingChange }) => {
  const [when, setWhen] = useState(from ?? WHEN);
  return (
    <TimeBar
      when={when}
      live={false}
      onScrub={(d) => {
        setWhen(d);
        onScrub?.(d);
      }}
      onNow={() => {}}
      center={CENTRE}
      sun={sunPosition(when, CENTRE[1], CENTRE[0])}
      times={sunTimes(when, CENTRE[1], CENTRE[0])}
      shadowRatio={1.4}
      showSun={false}
      onPlayingChange={onPlayingChange}
    />
  );
};

const playButton = () => screen.getByRole('button', { name: /play|toista|spela/i });

/** The pace picker — a real <select>, so a combobox and never the play button. */
const paceSelect = () => screen.getByRole('combobox', { name: /speed|nopeus|hastighet/i });

/** Pick a pace by its minutes-per-second value. */
function setPace(value: number) {
  act(() => {
    const el = paceSelect() as HTMLSelectElement;
    el.value = String(value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * Run the page's timers for `ms`, flushing React between ticks.
 *
 * One `advanceTimersByTime(1000)` inside a single `act` would batch every
 * update to the end of it, so the ref playback reads from would never see the
 * clock move and the ten ticks would all step from the same instant. The
 * component under test is the one that has to accumulate.
 */
function runPlayback(ms: number, stepMs = 25) {
  for (let elapsed = 0; elapsed < ms; elapsed += stepMs) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}

// The pace persists — which means without this, a test that picks a speed hands
// it to whichever test runs next. Found the honest way: the ladder assertion
// below failed with the previous case's 30 min/s still selected.
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TimeBar playback', () => {
  it('moves the clock by a small fraction of an hour per real second', () => {
    vi.useFakeTimers();
    const scrubs: Date[] = [];
    render(<Harness onScrub={(d) => scrubs.push(d)} />);

    act(() => playButton().click());
    runPlayback(1000);

    expect(scrubs.length).toBeGreaterThan(0);
    const perSecond = minuteOfDay(scrubs[scrubs.length - 1]) - minuteOfDay(WHEN);
    expect(perSecond).toBeGreaterThan(0);
    expect(perSecond).toBeLessThanOrEqual(15);
  });

  it('takes minutes of real time to play a whole day', () => {
    vi.useFakeTimers();
    const scrubs: Date[] = [];
    render(<Harness onScrub={(d) => scrubs.push(d)} />);

    act(() => playButton().click());
    runPlayback(1000);

    const perSecond = minuteOfDay(scrubs[scrubs.length - 1]) - minuteOfDay(WHEN);
    expect((24 * 60) / perSecond).toBeGreaterThan(120);
  });

  /**
   * THE SLOW RUNG IS THE ONE THAT CAN SILENTLY NOT WORK, and this is the test
   * that says so. `atMinuteOfDay` rounds to the whole minute, so a pace whose
   * per-tick delta is below 0.5 minutes round-trips to no movement at all: the
   * page would fire `onScrub` ten times a second with an unchanging instant and
   * present as hung. The fractional accumulator is what prevents it, and it is
   * invisible at the default (10 min/s is exactly 1.000 minute a tick), so
   * nothing else in this file would notice it being removed.
   */
  it('advances at a pace whose per-tick step is below the clock resolution', () => {
    vi.useFakeTimers();
    const scrubs: Date[] = [];
    render(<Harness onScrub={(d) => scrubs.push(d)} />);

    setPace(2); // 0.2 minutes per 100 ms tick — five ticks to one clock-minute
    act(() => playButton().click());
    runPlayback(3000);

    expect(scrubs.length).toBeGreaterThan(0);
    const moved = minuteOfDay(scrubs[scrubs.length - 1]) - minuteOfDay(WHEN);
    expect(moved).toBeGreaterThan(0);
    // Three real seconds at 2 min/s is six clock-minutes. Bounded on both sides:
    // too low means the accumulator is dropping the remainder, too high means
    // the pace is being ignored and the default is running.
    expect(moved).toBeGreaterThanOrEqual(5);
    expect(moved).toBeLessThanOrEqual(7);
  });

  it('emits no redundant scrub while the fraction is still building', () => {
    vi.useFakeTimers();
    const scrubs: Date[] = [];
    render(<Harness onScrub={(d) => scrubs.push(d)} />);

    setPace(2);
    act(() => playButton().click());
    runPlayback(1000);

    // Ten ticks in a second, but only two whole minutes to report. Scrubbing on
    // every tick would re-run the shadow sweep for an instant that has not
    // changed — the slow setting is supposed to cost LESS, not the same.
    expect(scrubs.length).toBeLessThanOrEqual(3);
  });

  /**
   * The midnight wrap must not eat the overshoot.
   *
   * This could not go wrong while the step was a fixed 1.000 minute: from a
   * seconds-zeroed clock `next` could only ever reach exactly 1440, so landing
   * hard on 00:00 lost nothing. A 3-minute step reaches 1441 or 1442, and
   * hard-landing silently drops one or two clock-minutes once per simulated
   * day. Every step across the boundary must be the same size as every step
   * either side of it.
   */
  it('carries the overshoot across midnight instead of landing hard on 00:00', () => {
    vi.useFakeTimers();
    const scrubs: Date[] = [];
    // 23:58 — with a 3-minute step the wrap tick lands at 1441, the case that
    // loses a minute if the remainder is thrown away.
    const nearMidnight = new Date('2026-08-12T23:58:00');
    render(<Harness from={nearMidnight} onScrub={(d) => scrubs.push(d)} />);

    setPace(30);
    act(() => playButton().click());
    runPlayback(600);

    expect(scrubs.length).toBeGreaterThanOrEqual(4);
    // THE STARTING INSTANT IS PART OF THE CHAIN, and leaving it out is how the
    // first version of this test passed against the very bug it was written
    // for: from 23:58 the wrap happens on the FIRST tick, so every delta
    // between consecutive scrubs was already a clean 3 whether or not the
    // overshoot survived. The dropped minute is only visible against `when`.
    const seq = [nearMidnight, ...scrubs];
    const deltas = seq.slice(1).map((d, i) => {
      let stepped = minuteOfDay(d) - minuteOfDay(seq[i]);
      if (stepped < 0) stepped += MINUTES_PER_DAY; // crossed the boundary
      return stepped;
    });
    expect(deltas.every((s) => s === 3)).toBe(true);
    // And it genuinely crossed, rather than passing this by never wrapping.
    expect(scrubs.some((d) => minuteOfDay(d) < minuteOfDay(nearMidnight))).toBe(true);
  });

  it('changes pace mid-playback without stopping or losing the interval', () => {
    vi.useFakeTimers();
    const scrubs: Date[] = [];
    render(<Harness onScrub={(d) => scrubs.push(d)} />);

    act(() => playButton().click());
    runPlayback(1000);
    const atDefault = minuteOfDay(scrubs[scrubs.length - 1]) - minuteOfDay(WHEN);

    const before = scrubs.length;
    setPace(30);
    runPlayback(1000);

    // Still playing: picking a speed is a statement about how fast the clock
    // moves, not about where it should be, so unlike every other control in the
    // row it must not call setPlaying(false).
    expect(scrubs.length).toBeGreaterThan(before);
    const afterSwitch =
      minuteOfDay(scrubs[scrubs.length - 1]) - minuteOfDay(scrubs[before - 1]);
    expect(afterSwitch).toBeGreaterThan(atDefault);
  });

  it('offers a pace below and above the default, and defaults to neither end', () => {
    render(<Harness />);
    const options = [...(paceSelect() as HTMLSelectElement).options].map((o) => Number(o.value));

    expect(options.length).toBeGreaterThanOrEqual(3);
    const selected = Number((paceSelect() as HTMLSelectElement).value);
    // The whole point of the control: whatever the ladder is, the default must
    // have something slower AND something faster available, or one of the two
    // users this was built for has no rung to reach for.
    expect(Math.min(...options)).toBeLessThan(selected);
    expect(Math.max(...options)).toBeGreaterThan(selected);
  });

  /**
   * Every option's visible text must open with its own value, because the pill
   * shows `{pace} min/s` derived from state while the option text is written by
   * hand — so the two can drift, and a correct chip over a lying dropdown is
   * exactly the kind of near-miss nobody reads twice.
   */
  it('labels every pace option with the value it actually selects', () => {
    render(<Harness />);
    for (const o of [...(paceSelect() as HTMLSelectElement).options]) {
      expect(o.textContent?.trim().startsWith(`${o.value} min/s`)).toBe(true);
    }
  });

  it('remembers the pace across a remount, and rejects a stored value off the ladder', () => {
    const first = render(<Harness />);
    const ladder = [...(paceSelect() as HTMLSelectElement).options].map((o) => Number(o.value));
    const other = ladder.find((v) => v !== Number((paceSelect() as HTMLSelectElement).value))!;
    setPace(other);
    first.unmount();

    const second = render(<Harness />);
    expect(Number((paceSelect() as HTMLSelectElement).value)).toBe(other);
    second.unmount();

    // A pace that was an option once and is not one now must not come back as a
    // playback rate no label on screen accounts for.
    localStorage.setItem('live.speed', '999');
    render(<Harness />);
    expect(ladder).toContain(Number((paceSelect() as HTMLSelectElement).value));
  });

  it('stops playing when the track is grabbed', () => {
    vi.useFakeTimers();
    const scrubs: Date[] = [];
    render(<Harness onScrub={(d) => scrubs.push(d)} />);

    act(() => playButton().click());
    runPlayback(1000);
    const played = scrubs.length;
    expect(played).toBeGreaterThan(0);

    const track = screen.getByRole('slider');
    // jsdom implements neither the Pointer Capture API nor layout, so both are
    // supplied: the capture as a no-op, and the absent layout as the 0×0 rect
    // that makes `setFromClientX` return without scrubbing. That isolates the
    // thing under test — whatever else a pointer-down does, it clears `playing`,
    // or the playhead fights the pointer for as long as the drag lasts.
    track.setPointerCapture = () => {};
    track.hasPointerCapture = () => true;
    act(() => {
      track.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    runPlayback(2000);

    expect(scrubs.length).toBe(played);
  });
});

/**
 * Playback has to be visible outside the bar, and this is why.
 *
 * The measured feeds' refinement request is debounced 400 ms, and playback
 * advances the clock in steps that arrive SLOWER than that — a whole minute per
 * 100 ms tick at the default pace moves the 5-minute archive quantum every
 * 500 ms — so every step settled the debounce and fired a request, each aborted
 * by the next, for as long as anyone watched a day go by. A debounce cannot fix
 * that: it only suppresses what arrives faster than itself.
 *
 * LivePage's fix is to stretch that wait past any gap between quanta while the
 * playhead is moving, which requires knowing that it is. Nothing about the
 * PICTURE depends on this callback, so nothing about the picture breaks if it
 * silently stops firing — the requests just come back. That is exactly the kind
 * of regression a test has to hold, so it is held here rather than left to the
 * network tab.
 */
describe('TimeBar reports playback outward', () => {
  /**
   * The play control by either of its two names.
   *
   * `playButton` above only matches the idle label, which is right for the tests
   * that press it once — but this one has to press it again to stop, and by then
   * it is labelled "Pause".
   */
  const playToggle = () =>
    screen.getByRole('button', { name: /play|toista|spela|pause|keskeyt|pausa/i });

  it('tells the page when playback starts and when it stops', () => {
    vi.useFakeTimers();
    const states: boolean[] = [];
    render(<Harness onPlayingChange={(p) => states.push(p)} />);

    // Reported on mount, so the page never has to assume an initial state.
    expect(states).toEqual([false]);

    act(() => playToggle().click());
    expect(states[states.length - 1]).toBe(true);

    act(() => playToggle().click());
    expect(states[states.length - 1]).toBe(false);
  });

  it('reports the stop that a pointer-down on the track causes', () => {
    // Playback also ends without the play button — grabbing the track clears it
    // (see the drag test above). The page has to hear about that one too, or the
    // refinement stays suppressed while the playhead sits still.
    vi.useFakeTimers();
    const states: boolean[] = [];
    render(<Harness onPlayingChange={(p) => states.push(p)} />);
    act(() => playButton().click());
    expect(states[states.length - 1]).toBe(true);

    const track = screen.getByRole('slider');
    track.setPointerCapture = () => {};
    track.hasPointerCapture = () => true;
    act(() => {
      track.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    expect(states[states.length - 1]).toBe(false);
  });
});

/**
 * The clock's keyboard, which is the whole of its accessible operation.
 *
 * The track carries `role="slider"` with a full `aria-value*` set, and the ARIA
 * slider pattern is a contract: a reader who is told "press Up to increase" and
 * gets nothing has no other way to move the instant that every layer on the page
 * answers for. Up and Down were missing, and missing in the worst way — they
 * fell through the handler without `preventDefault`, so the key scrolled the
 * page while focus stayed on the control.
 *
 * The assertions are on the MINUTES SCRUBBED TO rather than on which branch ran,
 * because the step sizes are themselves the decision: five minutes is what a
 * shadow visibly moves by, one is for landing on a stated sunrise, an hour is
 * for crossing the day.
 */
describe('TimeBar keyboard', () => {
  /**
   * Press a key on the track, and answer with the minute-of-day it scrubbed to.
   *
   * Torn down before returning: several presses per case, and a second bar left
   * mounted makes `getByRole('slider')` ambiguous rather than wrong, which
   * fails in a way that looks like the component rather than the test.
   */
  function press(init: KeyboardEventInit): { minute: number | null; prevented: boolean } {
    const scrubs: Date[] = [];
    render(<Harness onScrub={(d) => scrubs.push(d)} />);
    const track = screen.getByRole('slider');
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    act(() => {
      track.dispatchEvent(event);
    });
    cleanup();
    return {
      minute: scrubs.length > 0 ? minuteOfDay(scrubs[scrubs.length - 1]) : null,
      prevented: event.defaultPrevented,
    };
  }

  const base = minuteOfDay(WHEN);

  it('moves the clock with both the horizontal and the vertical arrows', () => {
    expect(press({ key: 'ArrowRight' }).minute).toBe(base + 5);
    expect(press({ key: 'ArrowLeft' }).minute).toBe(base - 5);
    // The pair the ARIA pattern requires and this handler used to ignore.
    expect(press({ key: 'ArrowUp' }).minute).toBe(base + 5);
    expect(press({ key: 'ArrowDown' }).minute).toBe(base - 5);
  });

  it('gives every arrow the same Shift fine step', () => {
    expect(press({ key: 'ArrowRight', shiftKey: true }).minute).toBe(base + 1);
    expect(press({ key: 'ArrowUp', shiftKey: true }).minute).toBe(base + 1);
    expect(press({ key: 'ArrowDown', shiftKey: true }).minute).toBe(base - 1);
  });

  it('steps an hour with PageUp/PageDown and the day with Home/End', () => {
    expect(press({ key: 'PageUp' }).minute).toBe(base + 60);
    expect(press({ key: 'PageDown' }).minute).toBe(base - 60);
    expect(press({ key: 'Home' }).minute).toBe(0);
    expect(press({ key: 'End' }).minute).toBe(MINUTES_PER_DAY - 1);
  });

  it('consumes every key it handles, so none of them scrolls the page', () => {
    // The reason Up and Down were worse than inert: unhandled, they reached the
    // document and scrolled it out from under a control that still had focus.
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']) {
      expect(press({ key }).prevented, key).toBe(true);
    }
  });

  it('leaves keys it does not handle alone', () => {
    const tab = press({ key: 'Tab' });
    expect(tab.minute).toBeNull();
    expect(tab.prevented).toBe(false);
  });
});
