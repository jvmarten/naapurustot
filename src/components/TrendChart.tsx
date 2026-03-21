import React from 'react';
import type { TrendDataPoint } from '../utils/metrics';
import { t } from '../utils/i18n';

interface TrendChartProps {
  title: string;
  data: TrendDataPoint[];
  color: string;
  formatValue: (v: number) => string;
  unit?: string;
}

const CHART_W = 280;
const CHART_H = 80;
const PAD_L = 4;
const PAD_R = 4;
const PAD_T = 6;
const PAD_B = 18;

const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;

export const TrendChart: React.FC<TrendChartProps> = ({ title, data, color, formatValue, unit }) => {
  if (!data || data.length < 2) return null;

  const years = data.map(d => d[0]);
  const values = data.map(d => d[1]);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  // Add 10% padding to the value range
  const paddedMin = minV - range * 0.1;
  const paddedRange = range * 1.2;

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const yearRange = maxYear - minYear || 1;

  const toX = (year: number) => PAD_L + ((year - minYear) / yearRange) * PLOT_W;
  const toY = (value: number) => PAD_T + PLOT_H - ((value - paddedMin) / paddedRange) * PLOT_H;

  const points = data.map(([y, v]) => `${toX(y).toFixed(1)},${toY(v).toFixed(1)}`);
  const polyline = points.join(' ');

  // Area fill
  const areaPath = `M ${toX(years[0]).toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)} `
    + data.map(([y, v]) => `L ${toX(y).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
    + ` L ${toX(years[years.length - 1]).toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)} Z`;

  // Trend direction
  const firstVal = values[0];
  const lastVal = values[values.length - 1];
  const changePct = firstVal !== 0 ? ((lastVal - firstVal) / Math.abs(firstVal) * 100) : null;
  const changeSign = changePct != null && changePct >= 0 ? '+' : '';

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-surface-600 dark:text-surface-300">{title}</span>
        {changePct != null && (
        <span className={`text-xs font-semibold ${changePct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
          {changeSign}{changePct.toFixed(1)}%
          <span className="ml-0.5 text-[10px]">
            {changePct >= 0 ? '\u2197' : '\u2198'}
          </span>
        </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        style={{ maxHeight: 80 }}
      >
        {/* Area fill */}
        <path d={areaPath} fill={color} opacity={0.1} />

        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(frac => {
          const y = PAD_T + PLOT_H * (1 - frac);
          return (
            <line
              key={frac}
              x1={PAD_L}
              y1={y}
              x2={PAD_L + PLOT_W}
              y2={y}
              stroke="currentColor"
              className="text-surface-200 dark:text-surface-800"
              strokeWidth={0.5}
              strokeDasharray="2,2"
            />
          );
        })}

        {/* Data line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {data.map(([y, v], i) => (
          <circle
            key={i}
            cx={toX(y)}
            cy={toY(v)}
            r={2.5}
            fill="white"
            stroke={color}
            strokeWidth={1.5}
          />
        ))}

        {/* Value labels for first and last */}
        <text
          x={toX(years[0])}
          y={toY(firstVal) - 5}
          textAnchor="start"
          className="fill-surface-500 dark:fill-surface-400"
          fontSize={8}
          fontWeight={500}
        >
          {formatValue(firstVal)}
        </text>
        <text
          x={toX(years[years.length - 1])}
          y={toY(lastVal) - 5}
          textAnchor="end"
          className="fill-surface-500 dark:fill-surface-400"
          fontSize={8}
          fontWeight={600}
        >
          {formatValue(lastVal)}
        </text>

        {/* Year labels */}
        {years.map((year, i) => (
          <text
            key={year}
            x={toX(year)}
            y={CHART_H - 2}
            textAnchor={i === 0 ? 'start' : i === years.length - 1 ? 'end' : 'middle'}
            className="fill-surface-400 dark:fill-surface-500"
            fontSize={8}
          >
            {year.toString().slice(2)}
          </text>
        ))}
      </svg>
      {unit && (
        <div className="text-[10px] text-surface-400 dark:text-surface-500 text-right -mt-0.5">
          {unit}
        </div>
      )}
    </div>
  );
};

interface TrendSectionProps {
  incomeData: TrendDataPoint[] | null;
  populationData: TrendDataPoint[] | null;
  unemploymentData: TrendDataPoint[] | null;
}

export const TrendSection: React.FC<TrendSectionProps> = ({
  incomeData,
  populationData,
  unemploymentData,
}) => {
  const hasAny = incomeData || populationData || unemploymentData;
  if (!hasAny) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-3">
        {t('panel.trends')}
      </h3>
      <div className="space-y-4 bg-surface-50 dark:bg-surface-900/40 rounded-xl p-3">
        {incomeData && (
          <TrendChart
            title={t('panel.trend_income')}
            data={incomeData}
            color="#10b981"
            formatValue={(v) => `${Math.round(v / 1000)}k`}
            unit={t('panel.trend_unit_euro')}
          />
        )}
        {populationData && (
          <TrendChart
            title={t('panel.trend_population')}
            data={populationData}
            color="#6366f1"
            formatValue={(v) => v.toLocaleString('fi-FI')}
          />
        )}
        {unemploymentData && (
          <TrendChart
            title={t('panel.trend_unemployment')}
            data={unemploymentData}
            color="#f43f5e"
            formatValue={(v) => `${v.toFixed(1)}%`}
          />
        )}
      </div>
    </div>
  );
};
