import React from 'react';
import type { TrendDataPoint } from '../utils/metrics';

interface SparklineProps {
  data: TrendDataPoint[];
  width?: number;
  height?: number;
  color?: string;
}

const Sparkline: React.FC<SparklineProps> = React.memo(({
  data,
  width = 30,
  height = 12,
  color = '#6b7280',
}) => {
  if (data.length < 2) return null;

  // Single pass: find min/max and build SVG points in one loop.
  // Before: data.map() + Math.min(...spread) + Math.max(...spread) = 3 passes
  // + 2 temporary arrays + 2 spread-to-arguments copies.
  let min = data[0][1];
  let max = min;
  for (let i = 1; i < data.length; i++) {
    const v = data[i][1];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;

  const padding = 1;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points: string[] = [];
  for (let i = 0; i < data.length; i++) {
    const px = padding + (i / (data.length - 1)) * innerW;
    const py = padding + innerH - ((data[i][1] - min) / range) * innerH;
    points.push(`${px},${py}`);
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block flex-shrink-0"
      aria-hidden="true"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});

Sparkline.displayName = 'Sparkline';

export default Sparkline;
