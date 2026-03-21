import { useMemo } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { t } from '../utils/i18n';

interface RadarChartProps {
  data: NeighborhoodProperties;
  metroAverages: Record<string, number>;
}

/** Axis definition: label i18n key, extractor, min, max, inverted */
interface AxisDef {
  key: string;
  extract: (p: NeighborhoodProperties) => number | null;
  extractAvg: (avg: Record<string, number>) => number;
  min: number;
  max: number;
  inverted: boolean;
}

const AXES: AxisDef[] = [
  {
    key: 'radar.income',
    extract: (p) => p.hr_mtu,
    extractAvg: (a) => a.hr_mtu,
    min: 15000,
    max: 55000,
    inverted: false,
  },
  {
    key: 'radar.safety',
    extract: (p) => p.crime_index,
    extractAvg: (a) => a.crime_index,
    min: 20,
    max: 170,
    inverted: true,
  },
  {
    key: 'radar.transit',
    extract: (p) => p.transit_stop_density,
    extractAvg: (a) => a.transit_stop_density,
    min: 5,
    max: 200,
    inverted: false,
  },
  {
    key: 'radar.education',
    extract: (p) => p.higher_education_rate,
    extractAvg: (a) => a.higher_education_rate,
    min: 10,
    max: 80,
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
    min: 0.5,
    max: 25,
    inverted: false,
  },
  {
    key: 'radar.housing',
    extract: (p) => p.property_price_sqm,
    extractAvg: (a) => a.property_price_sqm,
    min: 1000,
    max: 12000,
    inverted: true,
  },
];

const NUM_AXES = AXES.length;
const SIZE = 280;
const CENTER = SIZE / 2;
const RADIUS = 95;
const LABEL_RADIUS = RADIUS + 28;

function normalize(value: number | null, min: number, max: number, inverted: boolean): number {
  if (value == null) return 0;
  if (max === min) return 50;
  const clamped = Math.max(min, Math.min(max, value));
  const ratio = (clamped - min) / (max - min);
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

export default function RadarChart({ data, metroAverages }: RadarChartProps) {
  const dataValues = useMemo(
    () => AXES.map((a) => normalize(a.extract(data), a.min, a.max, a.inverted)),
    [data],
  );

  const avgValues = useMemo(
    () => AXES.map((a) => normalize(a.extractAvg(metroAverages), a.min, a.max, a.inverted)),
    [metroAverages],
  );

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
        aria-label={t('panel.radar_title')}
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

        {/* Data polygon */}
        <polygon
          points={polygonPoints(dataValues)}
          fill="#6366f1"
          fillOpacity={0.2}
          stroke="#6366f1"
          strokeWidth={2}
        />

        {/* Data points */}
        {dataValues.map((v, i) => {
          const [x, y] = pointOnAxis(i, v);
          return <circle key={i} cx={x} cy={y} r={3} fill="#6366f1" />;
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
    </div>
  );
}
