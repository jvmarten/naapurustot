export type LayerId =
  | 'quality_index'
  | 'median_income'
  | 'unemployment'
  | 'education'
  | 'foreign_lang'
  | 'avg_age'
  | 'pensioners'
  | 'ownership'
  | 'rental'
  | 'apt_size'
  | 'detached_houses'
  | 'student_share'
  | 'population_density'
  | 'child_ratio'
  | 'property_price'
  | 'transit_access'
  | 'air_quality';

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
const density = (v: number) => `${v.toLocaleString('fi-FI')} /km²`;
const sqm = (v: number) => `${v.toFixed(1)} m²`;
const euroSqm = (v: number) => `${v.toLocaleString('fi-FI')} €/m²`;
const stops = (v: number) => `${v.toFixed(1)} /km²`;

export const LAYERS: LayerConfig[] = [
  {
    id: 'quality_index',
    labelKey: 'layer.quality_index',
    property: 'quality_index',
    unit: '',
    colors: ['#7c3aed', '#a855f7', '#ef4444', '#f97316', '#eab308', '#facc15', '#84cc16', '#22c55e'],
    stops: [0, 15, 30, 45, 55, 70, 85, 100],
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
  // --- Phase 1: Housing & Demographics ---
  {
    id: 'ownership',
    labelKey: 'layer.ownership',
    property: 'ownership_rate',
    unit: '%',
    colors: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#8c2d04'],
    stops: [10, 20, 30, 40, 50, 60, 70, 85],
    format: pct,
  },
  {
    id: 'rental',
    labelKey: 'layer.rental',
    property: 'rental_rate',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [10, 20, 30, 40, 50, 60, 70, 85],
    format: pct,
  },
  {
    id: 'apt_size',
    labelKey: 'layer.apt_size',
    property: 'ra_as_kpa',
    unit: 'm²',
    colors: ['#f2f0f7', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d'],
    stops: [30, 40, 50, 60, 70, 80, 90, 110],
    format: sqm,
  },
  {
    id: 'detached_houses',
    labelKey: 'layer.detached_houses',
    property: 'detached_house_share',
    unit: '%',
    colors: ['#f7fcfd', '#e5f5f9', '#ccece6', '#99d8c9', '#66c2a4', '#41ae76', '#238b45', '#005824'],
    stops: [0, 5, 10, 20, 30, 40, 55, 75],
    format: pct,
  },
  {
    id: 'student_share',
    labelKey: 'layer.student_share',
    property: 'student_share',
    unit: '%',
    colors: ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'],
    stops: [2, 4, 6, 8, 10, 14, 18, 25],
    format: pct,
  },
  {
    id: 'population_density',
    labelKey: 'layer.population_density',
    property: 'population_density',
    unit: '/km²',
    colors: ['#fff7ec', '#fee8c8', '#fdd49e', '#fdbb84', '#fc8d59', '#ef6548', '#d7301f', '#990000'],
    stops: [500, 1000, 2000, 4000, 6000, 8000, 12000, 20000],
    format: density,
  },
  {
    id: 'child_ratio',
    labelKey: 'layer.child_ratio',
    property: 'child_ratio',
    unit: '%',
    colors: ['#f7fcf0', '#e0f3db', '#ccebc5', '#a8ddb5', '#7bccc4', '#4eb3d3', '#2b8cbe', '#08589e'],
    stops: [2, 4, 6, 8, 10, 12, 15, 20],
    format: pct,
  },
  // --- Phase 2: External data ---
  {
    id: 'property_price',
    labelKey: 'layer.property_price',
    property: 'property_price_sqm',
    unit: '€/m²',
    colors: ['#ffffb2', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
    stops: [1000, 2000, 3000, 4000, 5000, 6000, 8000, 12000],
    format: euroSqm,
  },
  {
    id: 'transit_access',
    labelKey: 'layer.transit_access',
    property: 'transit_stop_density',
    unit: '/km²',
    colors: ['#f7f4f9', '#e7e1ef', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#91003f'],
    stops: [5, 10, 20, 40, 60, 80, 120, 200],
    format: stops,
  },
  {
    id: 'air_quality',
    labelKey: 'layer.air_quality',
    property: 'air_quality_index',
    unit: '',
    colors: ['#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027'],
    stops: [1, 1.5, 2, 2.5, 3, 3.5, 4, 5],
    format: age,
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
  const interpolation: any[] = ['interpolate', ['linear'], ['get', layer.property]];
  for (let i = 0; i < layer.stops.length; i++) {
    interpolation.push(layer.stops[i], layer.colors[i]);
  }
  // Show gray for features where the property is null/missing
  return [
    'case',
    ['all', ['has', layer.property], ['!=', ['get', layer.property], null]],
    interpolation,
    '#d1d5db',
  ];
}
