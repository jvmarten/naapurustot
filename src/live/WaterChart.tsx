import React, { useEffect, useMemo, useState } from 'react';
import { t } from '../utils/i18n';
import { clockTime, shortDate } from './timeControl';
import { fetchWaterHistory, formatWaterC, type WaterHistory, type WaterPoint } from './watertemp';

/**
 * A beach sensor's water temperature over the last week, month or two years.
 *
 * One series, so no legend: the panel's title names it. Each span draws what the
 * sensor's own file holds for it — the publisher's 3-hour or daily MEANS where it
 * publishes them (Uiras), and otherwise every reading in the window (Sensoripaja,
 * whose files are readings only) — and the caption says which, because a daily
 * mean and a reading are different claims. Nothing is averaged here.
 *
 * A long series is THINNED, not averaged: per pixel column the first, lowest,
 * highest and last reading are kept, so every drawn point is a real reading and a
 * spike survives at any span. The line breaks across a hole in the series rather
 * than bridging it — a straight segment over a week the probe was out of the water
 * would draw temperatures nobody measured.
 *
 * `heavy` defers the download to a click: Sensoripaja serves two years of
 * readings uncompressed (up to 2.7 MB), which is not a cost to impose on someone
 * who only clicked the dot to read its name.
 */

type Span = '7d' | '30d' | '2y';
const SPANS: Span[] = ['7d', '30d', '2y'];
const DAY = 86_400_000;
const WINDOW: Record<Span, number> = { '7d': 7 * DAY, '30d': 30 * DAY, '2y': 731 * DAY };
const W = 272;
const H = 128;
const L = 30;
const R = 6;
const TOP = 6;
const B = 16;

let yearFmt: Intl.DateTimeFormat | null = null;
const monthYear = (at: number) =>
  (yearFmt ??= new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' })).format(at);
// A two-year axis holds every date twice, so a point read off it carries its year.
let fullFmt: Intl.DateTimeFormat | null = null;
const fullDate = (at: number) =>
  (fullFmt ??= new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })).format(at);

/** The series a span draws, and which caption names it. */
function pick(h: WaterHistory, span: Span): { points: WaterPoint[]; note: string } {
  if (span === '30d' && h.h3.length > 1) return { points: h.h3, note: 'h3' };
  if (span === '2y' && h.d1.length > 1) return { points: h.d1, note: 'd1' };
  const last = h.raw.length ? h.raw[h.raw.length - 1].at : 0;
  return { points: h.raw.filter((p) => p.at > last - WINDOW[span]), note: 'raw' };
}

/** First, lowest, highest and last reading per pixel column — real points only. */
function thin(points: WaterPoint[], from: number, to: number): WaterPoint[] {
  if (points.length <= 4 * W) return points;
  const out: WaterPoint[] = [];
  let col = -1;
  let bucket: WaterPoint[] = [];
  const flush = () => {
    if (bucket.length === 0) return;
    let lo = bucket[0];
    let hi = bucket[0];
    for (const p of bucket) {
      if (p.celsius < lo.celsius) lo = p;
      if (p.celsius > hi.celsius) hi = p;
    }
    const keep = new Set([bucket[0], lo, hi, bucket[bucket.length - 1]]);
    out.push(...bucket.filter((p) => keep.has(p)));
    bucket = [];
  };
  for (const p of points) {
    const c = Math.floor(((p.at - from) / (to - from || 1)) * W);
    if (c !== col) {
      flush();
      col = c;
    }
    bucket.push(p);
  }
  flush();
  return out;
}

/** Round tick values covering [lo, hi], three to five of them. */
function ticks(lo: number, hi: number): number[] {
  const span = Math.max(hi - lo, 0.5);
  const step = [0.5, 1, 2, 5, 10].find((s) => span / s <= 4) ?? 10;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(1));
  return out;
}

export const WaterChart: React.FC<{ url: string; when: number; heavy?: boolean }> = ({
  url,
  when,
  heavy = false,
}) => {
  const [asked, setAsked] = useState(!heavy);
  const [history, setHistory] = useState<WaterHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [span, setSpan] = useState<Span>('7d');
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    setAsked(!heavy);
  }, [url, heavy]);

  useEffect(() => {
    if (!asked) return;
    const ac = new AbortController();
    setHistory(null);
    setFailed(false);
    fetchWaterHistory(url, ac.signal).then(setHistory, () => {
      if (!ac.signal.aborted) setFailed(true);
    });
    return () => ac.abort();
  }, [url, asked]);

  const shown = useMemo(() => (history ? pick(history, span) : null), [history, span]);

  const geom = useMemo(() => {
    const all = shown?.points ?? [];
    if (all.length < 2) return null;
    const from = all[0].at;
    const to = all[all.length - 1].at;
    // HOLES ARE FOUND ON THE READINGS, THEN EACH STRETCH IS THINNED. The thinned
    // series' spacing is the renderer's (days apart at two years), so a gap test
    // on it would call every segment a hole; the sensor's own spacing decides.
    const gaps = all.slice(1).map((p, i) => p.at - all[i].at).sort((a, b) => a - b);
    const hole = (gaps[gaps.length >> 1] ?? 0) * 3;
    const runs: WaterPoint[][] = [[all[0]]];
    for (let i = 1; i < all.length; i++) {
      if (all[i].at - all[i - 1].at > hole) runs.push([]);
      runs[runs.length - 1].push(all[i]);
    }
    const thinned = runs.map((run) => thin(run, from, to));
    const points = thinned.flat();
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) {
      lo = Math.min(lo, p.celsius);
      hi = Math.max(hi, p.celsius);
    }
    const ys = ticks(lo, hi);
    const y0 = Math.min(ys[0], lo);
    const y1 = Math.max(ys[ys.length - 1], hi);
    const x = (at: number) => L + ((at - from) / (to - from)) * (W - L - R);
    const y = (c: number) => TOP + (1 - (c - y0) / (y1 - y0 || 1)) * (H - TOP - B);
    let line = '';
    for (const run of thinned) {
      run.forEach((p, i) => {
        line += `${i === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.celsius).toFixed(1)}`;
      });
    }
    const whole = ys.length > 1 && Number.isInteger(ys[1] - ys[0]);
    const xs = [0, 1 / 3, 2 / 3, 1].map((f) => from + f * (to - from));
    return { from, to, lo, hi, ys, whole, x, y, line, xs, points };
  }, [shown]);

  if (!asked) {
    return (
      <div className="space-y-1 pt-1">
        <button
          type="button"
          onClick={() => setAsked(true)}
          className="rounded bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white dark:bg-sky-500 dark:text-surface-950"
        >
          {t('live.water.chart_load')}
        </button>
        <p className="text-[10px] leading-snug text-surface-500 dark:text-surface-400">
          {t('live.water.chart_heavy')}
        </p>
      </div>
    );
  }

  const points = geom?.points ?? [];
  const label = (at: number) => (span === '2y' ? monthYear(at) : shortDate(new Date(at)));
  const pointLabel = (p: WaterPoint) =>
    `${formatWaterC(p.celsius)} °C · ${span === '2y' ? fullDate(p.at) : shortDate(new Date(p.at))}${shown?.note === 'd1' ? '' : ` ${clockTime(p.at)}`}`;

  const nearest = (at: number) => {
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].at - at) < Math.abs(points[best].at - at)) best = i;
    }
    return best;
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!geom) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setHover(nearest(geom.from + ((px - L) / (W - L - R)) * (geom.to - geom.from)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!geom || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    setHover((h) => Math.min(points.length - 1, Math.max(0, (h ?? points.length - 1) + step)));
  };

  const hovered = hover !== null && points[hover] ? points[hover] : null;

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex gap-1" role="group" aria-label={t('live.water.chart_span')}>
        {SPANS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={span === s}
            onClick={() => {
              setSpan(s);
              setHover(null);
            }}
            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
              span === s
                ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-surface-950'
                : 'bg-surface-100 text-surface-600 hover:text-surface-900 dark:bg-surface-800 dark:text-surface-300 dark:hover:text-white'
            }`}
          >
            {t(`live.water.span_${s}`)}
          </button>
        ))}
      </div>

      <p className="min-h-[1rem] text-[11px] tabular-nums text-surface-600 dark:text-surface-300">
        {failed
          ? t('live.water.chart_failed')
          : !history
            ? t('live.water.chart_loading')
            : !geom
              ? t('live.water.chart_empty')
              : hovered
                ? pointLabel(hovered)
                : t('live.water.chart_range')
                    .replace('{low}', formatWaterC(geom.lo))
                    .replace('{high}', formatWaterC(geom.hi))}
      </p>

      {geom && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          role="img"
          aria-label={t('live.water.chart_aria')
            .replace('{low}', formatWaterC(geom.lo))
            .replace('{high}', formatWaterC(geom.hi))}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          {geom.ys.map((v) => (
            <g key={v}>
              <line
                x1={L}
                x2={W - R}
                y1={geom.y(v)}
                y2={geom.y(v)}
                className="stroke-surface-200 dark:stroke-surface-800"
                strokeWidth={1}
              />
              <text
                x={L - 4}
                y={geom.y(v)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-surface-500 text-[9px] dark:fill-surface-400"
              >
                {geom.whole ? formatWaterC(v).replace(/\.0$/, '') : formatWaterC(v)}°
              </text>
            </g>
          ))}
          {geom.xs.map((at, i) => (
            <text
              key={i}
              x={geom.x(at)}
              y={H - 3}
              textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}
              className="fill-surface-500 text-[9px] dark:fill-surface-400"
            >
              {label(at)}
            </text>
          ))}
          {when >= geom.from && when <= geom.to && (
            <line
              x1={geom.x(when)}
              x2={geom.x(when)}
              y1={TOP}
              y2={H - B}
              strokeDasharray="3 3"
              className="stroke-amber-500"
              strokeWidth={1}
            />
          )}
          <path
            d={geom.line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-sky-600 dark:stroke-sky-400"
          />
          {hovered && (
            <g>
              <line
                x1={geom.x(hovered.at)}
                x2={geom.x(hovered.at)}
                y1={TOP}
                y2={H - B}
                className="stroke-surface-400 dark:stroke-surface-500"
                strokeWidth={1}
              />
              <circle
                cx={geom.x(hovered.at)}
                cy={geom.y(hovered.celsius)}
                r={4}
                strokeWidth={2}
                className="fill-sky-600 stroke-white dark:fill-sky-400 dark:stroke-surface-950"
              />
            </g>
          )}
        </svg>
      )}

      {geom && shown && (
        <p className="text-[10px] leading-snug text-surface-500 dark:text-surface-400">
          {t(`live.water.note_${shown.note}`)}
        </p>
      )}
    </div>
  );
};
