export type LayerId =
  | 'quality_index'
  | 'median_income'
  | 'unemployment'
  | 'education'
  | 'foreign_lang'
  | 'avg_age'
  | 'pensioners';

export interface LayerConfig {
  id: LayerId;
  labelKey: string;
  property: string;
  unit: string;
  colors: string[];
  stops: number[];
  format: (v: number) => string;
}

const euro = (v: number) => `${v.toLocaleString('fi-FI')} €`;
const pct = (v: number) => `${v.toFixed(1)} %`;
const age = (v: number) => `${v.toFixed(1)}`;

export const LAYERS: LayerConfig[] = [
  {
    id: 'quality_index',
    labelKey: 'layer.quality_index',
    property: 'quality_index',
    unit: '',
    colors: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#a855f7'],
    stops: [0, 25, 50, 75, 100],
    format: (v: number) => `${v.toFixed(0)} / 100`,
  },
  {
    id: 'median_income',
    labelKey: 'layer.median_income',
    property: 'hr_mtu',
    unit: '€',
    colors: ['#1a1a2e', '#16213e', '#0f3460', '#1a759f', '#34a0a4', '#76c893', '#b5e48c', '#d9ed92'],
    stops: [15000, 20000, 25000, 30000, 35000, 40000, 45000, 55000],
    format: euro,
  },
  {
    id: 'unemployment',
    labelKey: 'layer.unemployment',
    property: 'unemployment_rate',
    unit: '%',
    colors: ['#d9ed92', '#b5e48c', '#99d98c', '#76c893', '#52b69a', '#34a0a4', '#168aad', '#1a759f', '#1e6091', '#184e77'],
    stops: [2, 4, 6, 8, 10, 12, 15, 18, 22, 28],
    format: pct,
  },
  {
    id: 'education',
    labelKey: 'layer.education',
    property: 'higher_education_rate',
    unit: '%',
    colors: ['#1a1a2e', '#16213e', '#0f3460', '#533483', '#7b2d8e', '#e94560', '#f38375', '#f8c291'],
    stops: [10, 20, 30, 40, 50, 60, 70, 80],
    format: pct,
  },
  {
    id: 'foreign_lang',
    labelKey: 'layer.foreign_lang',
    property: 'foreign_language_pct',
    unit: '%',
    colors: ['#f0f0f0', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#980043', '#67001f'],
    stops: [2, 5, 10, 15, 20, 25, 35, 50],
    format: pct,
  },
  {
    id: 'avg_age',
    labelKey: 'layer.avg_age',
    property: 'he_kika',
    unit: '',
    colors: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#b10026'],
    stops: [28, 32, 36, 38, 40, 42, 45, 50],
    format: age,
  },
  {
    id: 'pensioners',
    labelKey: 'layer.pensioners',
    property: 'pensioner_share',
    unit: '%',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [5, 10, 15, 20, 25, 30, 35, 45],
    format: pct,
  },
];

export function getLayerById(id: LayerId): LayerConfig {
  return LAYERS.find((l) => l.id === id) ?? LAYERS[0];
}

export function getColorForValue(layer: LayerConfig, value: number | null | undefined): string {
  if (value == null) return '#333';
  for (let i = layer.stops.length - 1; i >= 0; i--) {
    if (value >= layer.stops[i]) return layer.colors[i];
  }
  return layer.colors[0];
}

export function buildFillColorExpression(layer: LayerConfig): any[] {
  const expr: any[] = ['interpolate', ['linear'], ['coalesce', ['get', layer.property], 0]];
  for (let i = 0; i < layer.stops.length; i++) {
    expr.push(layer.stops[i], layer.colors[i]);
  }
  return expr;
}
