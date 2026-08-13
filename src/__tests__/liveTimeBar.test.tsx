import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TimeBar } from '../live/TimeBar';
import { sunPosition, sunTimes } from '../utils/sun';
import { minuteOfDay } from '../live/timeControl';

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
const Harness: React.FC<{ onScrub?: (d: Date) => void }> = ({ onScrub }) => {
  const [when, setWhen] = useState(WHEN);
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
    />
  );
};

const playButton = () => screen.getByRole('button', { name: /play|toista|spela/i });

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
