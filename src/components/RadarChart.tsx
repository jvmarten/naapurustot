import React, { useMemo } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { t, useI18nVersion } from '../utils/i18n';
import { getNationalRanges } from '../utils/nationalRanges';

interface RadarChartProps {
  data: NeighborhoodProperties;
  metroAverages: Record<string, number>;
}

/** Axis definition: label i18n key, extractor, source metric(s), inverted */
interface AxisSpec {
  key: string;
  extract: (p: NeighborhoodProperties) => number | null;
  extractAvg: (avg: Record<string, number>) => number;
  /** national_ranges.json properties this axis normalizes against; a multi-metric
   *  (composite) axis averages its constituents' bounds. */
  metrics: string[];
  inverted: boolean;
}

interface AxisDef extends AxisSpec {
  min: number;
  max: number;
}

const AXIS_SPECS: AxisSpec[] = [
  {
    key: 'radar.income',
    extract: (p) => p.hr_mtu,
    extractAvg: (a) => a.hr_mtu,
    metrics: ['hr_mtu'],
    inverted: false,
  },
  {
    key: 'radar.safety',
    extract: (p) => p.crime_index,
    extractAvg: (a) => a.crime_index,
    metrics: ['crime_index'],
    inverted: true,
  },
  {
    key: 'radar.transit',
    extract: (p) => p.transit_stop_density,
    extractAvg: (a) => a.transit_stop_density,
    metrics: ['transit_stop_density'],
    inverted: false,
  },
  {
    key: 'radar.education',
    extract: (p) => p.higher_education_rate,
    extractAvg: (a) => a.higher_education_rate,
    metrics: ['higher_education_rate'],
    inverted: false,
  },
  {
    key: 'radar.services',
    extract: (p) => {
      const g = p.grocery_density;
      const h = p.healthcare_density;
      const s = p.school_density;
      if (g == null && h == null && s == null) return null;
      return ((g ?? 0) + (h ?? 0) + (s ?? 0)) / 3;
    },
    extractAvg: (a) =>
      ((a.grocery_density ?? 0) + (a.healthcare_density ?? 0) + (a.school_density ?? 0)) / 3,
    metrics: ['grocery_density', 'healthcare_density', 'school_density'],
    inverted: false,
  },
  {
    key: 'radar.housing',
    extract: (p) => p.property_price_sqm,
    extractAvg: (a) => a.property_price_sqm,
    metrics: ['property_price_sqm'],
    inverted: true,
  },
];

// PO-1: axis bounds come from the pre-computed national distribution (winsorized
// p2/p98 in national_ranges.json) instead of hardcoded metro-centric literals that
// pegged most of the 3,018 areas near the floor and went stale on data refreshes.
// A composite axis averages its constituents' bounds. normalize() treats a
// degenerate (missing-metric) 0-width range as mid-scale, so an absent range key
// degrades safely rather than corrupting the polygon.
function axisBounds(metrics: string[]): { min: number; max: number } {
  const ranges = getNationalRanges();
  let minSum = 0;
  let maxSum = 0;
  for (const m of metrics) {
    const r = ranges.get(m);
    minSum += r?.min ?? 0;
    maxSum += r?.max ?? 0;
  }
  return { min: minSum / metrics.length, max: maxSum / metrics.length };
}

const AXES: AxisDef[] = AXIS_SPECS.map((spec) => ({ ...spec, ...axisBounds(spec.metrics) }));

const NUM_AXES = AXES.length;
const SIZE = 280;
const CENTER = SIZE / 2;
const RADIUS = 95;
const LABEL_RADIUS = RADIUS + 28;

function normalize(value: number | null, min: number, max: number, inverted: boolean): number {
  if (value == null || Number.isNaN(value)) return 0;
  const range = max - min;
  // A degenerate (zero-width) axis range would make the ratio 0/0 = NaN and
  // corrupt the SVG polygon path. Treat it as mid-scale rather than emitting NaN.
  if (range <= 0) return 50;
  const clamped = Math.max(min, Math.min(max, value));
  const ratio = (clamped - min) / range;
  const score = inverted ? 1 - ratio : ratio;
  return score * 100;
}

function pointOnAxis(axisIndex: number, value: number): [number, number] {
  const angle = (2 * Math.PI * axisIndex) / NUM_AXES - Math.PI / 2;
  const r = (value / 100) * RADIUS;
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
}

function polygonPoints(values: number[]): string {
  return values.map((v, i) => pointOnAxis(i, v).join(',')).join(' ');
}

const RadarChart: React.FC<RadarChartProps> = React.memo(function RadarChart({ data, metroAverages }) {
  useI18nVersion();
  const dataValues = useMemo(
    () => AXES.map((a) => normalize(a.extract(data), a.min, a.max, a.inverted)),
    [data],
  );

  const avgValues = useMemo(
    () => AXES.map((a) => normalize(a.extractAvg(metroAverages), a.min, a.max, a.inverted)),
    [metroAverages],
  );

  // EM4: normalize() maps a missing metric to 0 (plotted at the centre — exactly
  // where a genuine worst score also lands). Track which axes have NO input so
  // we can render them distinctly (hollow marker + "no data" in the aria text)
  // instead of conflating absent data with the lowest possible score.
  const missing = useMemo(
    () => AXES.map((a) => {
      const v = a.extract(data);
      return v == null || Number.isNaN(v);
    }),
    [data],
  );

  // QW-4: Accessibility — build descriptive label with all axis values and the
  // top 2 strongest dimensions so screen readers can convey the chart contents.
  // Computed inline (not memoized) so the t()-built string always reflects the
  // current language: useI18nVersion() above re-renders on a language change /
  // lazy dictionary arrival, and the work (a few maps over ~6 axes) is trivial.
  // A memo keyed on [data, dataValues] went stale because neither identity
  // changes on a language switch.
  const ariaLabel = (() => {
    const name = (data.nimi || data.pno || '').toString();
    const items = AXES.map((axis, i) => ({
      label: t(axis.key),
      value: Math.round(dataValues[i]),
      missing: missing[i],
    }));
    const valuesText = items
      .map((it) => `${it.label} ${it.missing ? t('panel.radar_no_data') : it.value}`)
      .join(', ');
    const top2 = items
      .filter((it) => !it.missing)
      .sort((a, b) => b.value - a.value)
      .slice(0, 2)
      .map((s) => s.label)
      .join(', ');
    const title = t('panel.radar_title');
    const strongest = t('aria.radar_strongest');
    return name
      ? `${title}: ${name} — ${valuesText}. ${strongest}: ${top2}.`
      : `${title} — ${valuesText}. ${strongest}: ${top2}.`;
  })();

  const gridLevels = [20, 40, 60, 80, 100];

  return (
    <div className="flex flex-col items-center gap-1">
      <h3 className="text-xs font-semibold text-surface-600 dark:text-surface-300 uppercase tracking-wide">
        {t('panel.radar_title')}
      </h3>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="overflow-visible"
        role="img"
        aria-label={ariaLabel}
      >
        {/* Grid rings */}
        {gridLevels.map((level) => (
          <polygon
            key={level}
            points={Array.from({ length: NUM_AXES }, (_, i) =>
              pointOnAxis(i, level).join(','),
            ).join(' ')}
            fill="none"
            className="stroke-surface-200 dark:stroke-surface-700"
            strokeWidth={level === 100 ? 1 : 0.5}
          />
        ))}

        {/* Axis lines */}
        {AXES.map((_, i) => {
          const [x, y] = pointOnAxis(i, 100);
          return (
            <line
              key={i}
              x1={CENTER}
              y1={CENTER}
              x2={x}
              y2={y}
              className="stroke-surface-300 dark:stroke-surface-600"
              strokeWidth={0.5}
            />
          );
        })}

        {/* Metro average polygon (dashed) */}
        <polygon
          points={polygonPoints(avgValues)}
          fill="none"
          className="stroke-surface-400 dark:stroke-surface-500"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />

        {/* Data polygon — animated via interpolated values from parent */}
        <polygon
          points={polygonPoints(dataValues)}
          fill="#6366f1"
          fillOpacity={0.2}
          stroke="#6366f1"
          strokeWidth={2}
        />

        {/* Data points — positions update smoothly via animated values. EM4: an
            axis with no data renders as a hollow ring (not a filled dot) so it
            doesn't read as a real worst-score vertex at the centre. */}
        {dataValues.map((v, i) => {
          if (!Number.isFinite(v)) return null;
          const [x, y] = pointOnAxis(i, v);
          return missing[i]
            ? <circle key={i} cx={x} cy={y} r={3} fill="white" className="dark:fill-surface-900" stroke="#94a3b8" strokeWidth={1.5} />
            : <circle key={i} cx={x} cy={y} r={3} fill="#6366f1" />;
        })}

        {/* Axis labels */}
        {AXES.map((axis, i) => {
          const angle = (2 * Math.PI * i) / NUM_AXES - Math.PI / 2;
          const lx = CENTER + LABEL_RADIUS * Math.cos(angle);
          const ly = CENTER + LABEL_RADIUS * Math.sin(angle);

          let textAnchor: 'start' | 'middle' | 'end' = 'middle';
          if (Math.cos(angle) < -0.1) textAnchor = 'end';
          else if (Math.cos(angle) > 0.1) textAnchor = 'start';

          let dy = '0.35em';
          if (Math.sin(angle) < -0.5) dy = '0em';
          else if (Math.sin(angle) > 0.5) dy = '0.7em';

          return (
            <text
              key={i}
              x={lx}
              y={ly}
              textAnchor={textAnchor}
              dy={dy}
              className="fill-surface-600 dark:fill-surface-300 text-[10px]"
              style={{ fontSize: 10 }}
            >
              {t(axis.key)}
            </text>
          );
        })}
      </svg>
      {/* EM4: name the axes with no data so a sparse area's hollow vertices aren't
          misread as genuinely poor scores. */}
      {missing.some(Boolean) && (
        <p className="text-[10px] text-surface-500 dark:text-surface-400 text-center max-w-[16rem]">
          {t('panel.radar_no_data')}: {AXES.filter((_, i) => missing[i]).map((a) => t(a.key)).join(', ')}
        </p>
      )}
    </div>
  );
});

/** CF-3: one series (a pinned area) in the overlaid comparison radar. */
export interface RadarSeries {
  name: string;
  color: string;
  data: NeighborhoodProperties;
}

/**
 * CF-3: overlaid multi-series radar for the ComparisonPanel — plots the 2–3
 * pinned areas as overlapping polygons on the same national-range axes the
 * single-area radar uses, for an at-a-glance shape comparison.
 */
export const ComparisonRadarChart: React.FC<{ series: RadarSeries[] }> = React.memo(
  function ComparisonRadarChart({ series }) {
    useI18nVersion();
    const seriesValues = useMemo(
      () =>
        series.map((s) =>
          AXES.map((a) => normalize(a.extract(s.data), a.min, a.max, a.inverted)),
        ),
      [series],
    );
    const seriesMissing = useMemo(
      () =>
        series.map((s) =>
          AXES.map((a) => {
            const v = a.extract(s.data);
            return v == null || Number.isNaN(v);
          }),
        ),
      [series],
    );

    // Same rationale as the single-area chart: build the t()-dependent string
    // inline so it always reflects the current language.
    const ariaLabel = (() => {
      const perSeries = series.map((s, si) => {
        const values = AXES.map((axis, i) =>
          `${t(axis.key)} ${seriesMissing[si][i] ? t('panel.radar_no_data') : Math.round(seriesValues[si][i])}`,
        ).join(', ');
        return `${s.name} — ${values}`;
      });
      return `${t('compare.radar')}: ${perSeries.join('. ')}.`;
    })();

    const gridLevels = [20, 40, 60, 80, 100];

    return (
      <div className="flex flex-col items-center gap-1 px-5 py-4">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="overflow-visible"
          role="img"
          aria-label={ariaLabel}
        >
          {gridLevels.map((level) => (
            <polygon
              key={level}
              points={Array.from({ length: NUM_AXES }, (_, i) =>
                pointOnAxis(i, level).join(','),
              ).join(' ')}
              fill="none"
              className="stroke-surface-200 dark:stroke-surface-700"
              strokeWidth={level === 100 ? 1 : 0.5}
            />
          ))}
          {AXES.map((_, i) => {
            const [x, y] = pointOnAxis(i, 100);
            return (
              <line
                key={i}
                x1={CENTER}
                y1={CENTER}
                x2={x}
                y2={y}
                className="stroke-surface-300 dark:stroke-surface-600"
                strokeWidth={0.5}
              />
            );
          })}
          {series.map((s, si) => (
            <polygon
              key={s.name + si}
              points={polygonPoints(seriesValues[si])}
              fill={s.color}
              fillOpacity={0.12}
              stroke={s.color}
              strokeWidth={2}
            />
          ))}
          {series.map((s, si) =>
            seriesValues[si].map((v, i) => {
              if (!Number.isFinite(v)) return null;
              const [x, y] = pointOnAxis(i, v);
              // EM4 (carried over): an axis with no data renders as a hollow ring so
              // it doesn't read as a genuine worst-score vertex at the centre.
              return seriesMissing[si][i]
                ? <circle key={`${si}-${i}`} cx={x} cy={y} r={3} fill="white" className="dark:fill-surface-900" stroke={s.color} strokeWidth={1.5} />
                : <circle key={`${si}-${i}`} cx={x} cy={y} r={3} fill={s.color} />;
            }),
          )}
          {AXES.map((axis, i) => {
            const angle = (2 * Math.PI * i) / NUM_AXES - Math.PI / 2;
            const lx = CENTER + LABEL_RADIUS * Math.cos(angle);
            const ly = CENTER + LABEL_RADIUS * Math.sin(angle);
            let textAnchor: 'start' | 'middle' | 'end' = 'middle';
            if (Math.cos(angle) < -0.1) textAnchor = 'end';
            else if (Math.cos(angle) > 0.1) textAnchor = 'start';
            let dy = '0.35em';
            if (Math.sin(angle) < -0.5) dy = '0em';
            else if (Math.sin(angle) > 0.5) dy = '0.7em';
            return (
              <text
                key={i}
                x={lx}
                y={ly}
                textAnchor={textAnchor}
                dy={dy}
                className="fill-surface-600 dark:fill-surface-300 text-[10px]"
                style={{ fontSize: 10 }}
              >
                {t(axis.key)}
              </text>
            );
          })}
        </svg>
        {/* Series legend — the SVG polygons are color-only, so name them. */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-surface-600 dark:text-surface-300">
              <span aria-hidden className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
        {seriesMissing.some((m) => m.some(Boolean)) && (
          <p className="text-[10px] text-surface-500 dark:text-surface-400 text-center max-w-[18rem]">
            {t('panel.radar_no_data')}: {AXES.filter((_, i) => seriesMissing.some((m) => m[i])).map((a) => t(a.key)).join(', ')}
          </p>
        )}
      </div>
    );
  },
);

export default RadarChart;
