import React, { useEffect, useMemo, useState } from 'react';
import { t } from '../utils/i18n';
import { clockTime, shortDate } from './timeControl';
import {
  fetchWaterHistory,
  formatWaterC,
  type WaterHistory,
  type WaterPoint,
  type WaterSpan,
} from './watertemp';

/**
 * A beach sensor's water temperature over the last week, month or two years.
 *
 * One series, so no legend: the panel's title names it. Each span draws the
 * series the PUBLISHER keeps for it — every reading for the week, its 3-hour means
 * for the month, its daily means for two years (see watertemp.ts) — and the
 * caption says which, because a daily mean and a reading are different claims.
 * The line breaks across a hole in the series rather than bridging it: a straight
 * segment over a week the probe was out of the water would draw temperatures
 * nobody measured.
 *
 * Hover (or arrow keys, once focused) reads off the nearest published point, and
 * the page's clock is drawn as a dashed line so the chart and the map can be
 * read against each other.
 */

const SPANS: WaterSpan[] = ['raw', 'h3', 'd1'];
const W = 272;
const H = 128;
const L = 30;
const R = 6;
const TOP = 6;
const B = 16;

let yearFmt: Intl.DateTimeFormat | null = null;
const monthYear = (at: number) =>
  (yearFmt ??= new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' })).format(at);

/** Round tick values covering [lo, hi], three to five of them. */
function ticks(lo: number, hi: number): number[] {
  const span = Math.max(hi - lo, 0.5);
  const step = [0.5, 1, 2, 5, 10].find((s) => span / s <= 4) ?? 10;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(1));
  return out;
}

/** The path, split into a new subpath wherever the series has a hole. */
function linePath(points: WaterPoint[], x: (at: number) => number, y: (c: number) => number): string {
  if (points.length === 0) return '';
  const gaps = points.slice(1).map((p, i) => p.at - points[i].at).sort((a, b) => a - b);
  const hole = (gaps[gaps.length >> 1] ?? 0) * 3;
  let d = '';
  points.forEach((p, i) => {
    const jump = i === 0 || p.at - points[i - 1].at > hole;
    d += `${jump ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.celsius).toFixed(1)}`;
  });
  return d;
}

export const WaterChart: React.FC<{ id: string; when: number }> = ({ id, when }) => {
  const [history, setHistory] = useState<WaterHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [span, setSpan] = useState<WaterSpan>('raw');
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setHistory(null);
    setFailed(false);
    fetchWaterHistory(id, ac.signal).then(setHistory, () => {
      if (!ac.signal.aborted) setFailed(true);
    });
    return () => ac.abort();
  }, [id]);

  const points = useMemo(() => history?.[span] ?? [], [history, span]);
  const geom = useMemo(() => {
    if (points.length < 2) return null;
    const from = points[0].at;
    const to = points[points.length - 1].at;
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
    const line = linePath(points, x, y);
    const xs = [0, 1 / 3, 2 / 3, 1].map((f) => from + f * (to - from));
    return { from, to, lo, hi, ys, x, y, line, xs };
  }, [points]);

  const label = (at: number) => (span === 'd1' ? monthYear(at) : shortDate(new Date(at)));
  const pointLabel = (p: WaterPoint) =>
    `${formatWaterC(p.celsius)} °C · ${shortDate(new Date(p.at))}${span === 'd1' ? '' : ` ${clockTime(p.at)}`}`;

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
    const at = geom.from + ((px - L) / (W - L - R)) * (geom.to - geom.from);
    setHover(nearest(at));
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
                {Number.isInteger(geom.ys[1] - geom.ys[0]) ? formatWaterC(v).replace(/\.0$/, '') : formatWaterC(v)}°
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

      {geom && (
        <p className="text-[10px] leading-snug text-surface-500 dark:text-surface-400">
          {t(`live.water.note_${span}`)}
        </p>
      )}
    </div>
  );
};
