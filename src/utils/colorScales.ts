import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';

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
  | 'air_quality'
  | 'crime_rate'
  | 'green_space'
  | 'daycare_density'
  | 'school_density'
  | 'healthcare_access'
  | 'single_person_hh'
  | 'cycling_infra'
  | 'restaurant_density'
  | 'grocery_access'
  | 'income_change'
  | 'population_change'
  | 'unemployment_change'
  // Phase 7: New data layers
  | 'voter_turnout'
  | 'party_diversity'
  | 'broadband_coverage'
  | 'ev_charging_density'
  | 'tree_canopy'
  | 'transit_reachability'
  // Quick wins from existing GeoJSON data
  | 'youth_ratio'
  | 'gender_ratio'
  | 'single_parent_hh'
  | 'families_with_children'
  | 'tech_sector_jobs'
  | 'healthcare_workers'
  // Phase 8: More demographic detail + trends
  | 'employment_rate'
  | 'elderly_ratio'
  | 'avg_household_size'
  | 'manufacturing_jobs'
  | 'public_sector_jobs'
  | 'service_sector_jobs'
  | 'new_construction';

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
const perThousand = (v: number) => `${v.toFixed(1)} /1000`;
const gini = (v: number) => `${v.toFixed(2)}`;
const score = (v: number) => `${v.toFixed(0)}/100`;

export const LAYERS: LayerConfig[] = [
  {
    id: 'quality_index',
    labelKey: 'layer.quality_index',
    property: 'quality_index',
    unit: '',
    colors: ['#7c3aed', '#a855f7', '#ef4444', '#f97316', '#facc15', '#84cc16', '#22c55e', '#14b8a6'],
    stops: [0, 14, 28, 43, 57, 71, 86, 100],
    format: (v: number) => v.toFixed(0),
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
    stops: [18, 22, 26, 30, 34, 38, 42, 48],
    format: age,
  },
  {
    id: 'crime_rate',
    labelKey: 'layer.crime_rate',
    property: 'crime_index',
    unit: '/1000',
    colors: ['#f7fcf5', '#d5efcf', '#a1d99b', '#74c476', '#f9d057', '#fd8d3c', '#e5533d', '#b00026'],
    stops: [20, 35, 50, 65, 80, 100, 130, 170],
    format: perThousand,
  },
  // --- Phase 3: Services & Amenities ---
  {
    id: 'green_space',
    labelKey: 'layer.green_space',
    property: 'green_space_pct',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [5, 10, 20, 30, 45, 60, 75, 90],
    format: pct,
  },
  {
    id: 'daycare_density',
    labelKey: 'layer.daycare_density',
    property: 'daycare_density',
    unit: '/km²',
    colors: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#99000d'],
    stops: [0.5, 1, 2, 3, 5, 8, 12, 20],
    format: density,
  },
  {
    id: 'school_density',
    labelKey: 'layer.school_density',
    property: 'school_density',
    unit: '/km²',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [0.5, 1, 2, 3, 5, 8, 12, 20],
    format: density,
  },
  {
    id: 'healthcare_access',
    labelKey: 'layer.healthcare_access',
    property: 'healthcare_density',
    unit: '/km²',
    colors: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#8c2d04'],
    stops: [0.5, 1, 2, 4, 6, 10, 15, 25],
    format: density,
  },
  {
    id: 'restaurant_density',
    labelKey: 'layer.restaurant_density',
    property: 'restaurant_density',
    unit: '/km²',
    colors: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#b10026'],
    stops: [5, 10, 20, 40, 80, 150, 300, 600],
    format: density,
  },
  {
    id: 'grocery_access',
    labelKey: 'layer.grocery_access',
    property: 'grocery_density',
    unit: '/km²',
    colors: ['#f7fcf0', '#e0f3db', '#ccebc5', '#a8ddb5', '#7bccc4', '#4eb3d3', '#2b8cbe', '#08589e'],
    stops: [0.5, 1, 2, 4, 6, 10, 15, 25],
    format: density,
  },
  {
    id: 'cycling_infra',
    labelKey: 'layer.cycling_infra',
    property: 'cycling_density',
    unit: '/km²',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [2, 5, 10, 20, 40, 60, 100, 150],
    format: density,
  },
  {
    id: 'single_person_hh',
    labelKey: 'layer.single_person_hh',
    property: 'single_person_hh_pct',
    unit: '%',
    colors: ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'],
    stops: [10, 20, 30, 40, 50, 60, 70, 85],
    format: pct,
  },
  // CF-4: Change over time layers
  {
    id: 'income_change',
    labelKey: 'layer.income_change',
    property: 'income_change_pct',
    unit: '%',
    colors: ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [-15, -10, -5, 0, 5, 10, 15, 25],
    format: pct,
  },
  {
    id: 'population_change',
    labelKey: 'layer.population_change',
    property: 'population_change_pct',
    unit: '%',
    colors: ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [-15, -10, -5, 0, 5, 10, 15, 25],
    format: pct,
  },
  {
    id: 'unemployment_change',
    labelKey: 'layer.unemployment_change',
    property: 'unemployment_change_pct',
    unit: '%',
    colors: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
    stops: [-30, -20, -10, 0, 10, 20, 30, 50],
    format: pct,
  },
  // --- Phase 7: New data layers ---
  // #1 Voting & Political
  {
    id: 'voter_turnout',
    labelKey: 'layer.voter_turnout',
    property: 'voter_turnout_pct',
    unit: '%',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [40, 50, 55, 60, 65, 70, 75, 85],
    format: pct,
  },
  {
    id: 'party_diversity',
    labelKey: 'layer.party_diversity',
    property: 'party_diversity_index',
    unit: '',
    colors: ['#f7f4f9', '#e7e1ef', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#91003f'],
    stops: [0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.85],
    format: gini,
  },
  // #8 Internet & Connectivity
  {
    id: 'broadband_coverage',
    labelKey: 'layer.broadband_coverage',
    property: 'broadband_coverage_pct',
    unit: '%',
    colors: ['#ffffb2', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
    stops: [30, 50, 60, 70, 80, 85, 90, 98],
    format: pct,
  },
  {
    id: 'ev_charging_density',
    labelKey: 'layer.ev_charging_density',
    property: 'ev_charging_density',
    unit: '/km²',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [0.5, 1, 2, 4, 6, 10, 15, 25],
    format: density,
  },
  // #10 Tree Canopy / Urban Heat Island
  {
    id: 'tree_canopy',
    labelKey: 'layer.tree_canopy',
    property: 'tree_canopy_pct',
    unit: '%',
    colors: ['#ffffcc', '#d9f0a3', '#addd8e', '#78c679', '#41ab5d', '#238443', '#006837', '#004529'],
    stops: [5, 10, 15, 20, 30, 40, 55, 75],
    format: pct,
  },
  // #12 Accessibility
  {
    id: 'transit_reachability',
    labelKey: 'layer.transit_reachability',
    property: 'transit_reachability_score',
    unit: '/100',
    colors: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [10, 20, 30, 40, 50, 60, 70, 85],
    format: score,
  },
  // #11 Quick wins — derived from existing GeoJSON fields
  {
    id: 'youth_ratio',
    labelKey: 'layer.youth_ratio',
    property: 'youth_ratio_pct',
    unit: '%',
    colors: ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'],
    stops: [3, 5, 7, 9, 11, 13, 16, 20],
    format: pct,
  },
  {
    id: 'gender_ratio',
    labelKey: 'layer.gender_ratio',
    property: 'gender_ratio',
    unit: '',
    colors: ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2],
    format: (v: number) => `${v.toFixed(2)}`,
  },
  {
    id: 'single_parent_hh',
    labelKey: 'layer.single_parent_hh',
    property: 'single_parent_hh_pct',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [2, 4, 6, 8, 10, 14, 18, 25],
    format: pct,
  },
  {
    id: 'families_with_children',
    labelKey: 'layer.families_with_children',
    property: 'families_with_children_pct',
    unit: '%',
    colors: ['#f7fcf0', '#e0f3db', '#ccebc5', '#a8ddb5', '#7bccc4', '#4eb3d3', '#2b8cbe', '#08589e'],
    stops: [5, 10, 15, 20, 25, 30, 35, 45],
    format: pct,
  },
  {
    id: 'tech_sector_jobs',
    labelKey: 'layer.tech_sector_jobs',
    property: 'tech_sector_pct',
    unit: '%',
    colors: ['#f7f4f9', '#e7e1ef', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#91003f'],
    stops: [2, 4, 6, 8, 12, 16, 22, 30],
    format: pct,
  },
  {
    id: 'healthcare_workers',
    labelKey: 'layer.healthcare_workers',
    property: 'healthcare_workers_pct',
    unit: '%',
    colors: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#8c2d04'],
    stops: [2, 4, 6, 8, 10, 14, 18, 25],
    format: pct,
  },
  // #12 Phase 8: More demographic detail + trends
  {
    id: 'employment_rate',
    labelKey: 'layer.employment_rate',
    property: 'employment_rate',
    unit: '%',
    colors: ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850'],
    stops: [30, 40, 50, 55, 60, 65, 70, 80],
    format: pct,
  },
  {
    id: 'elderly_ratio',
    labelKey: 'layer.elderly_ratio',
    property: 'elderly_ratio_pct',
    unit: '%',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [5, 10, 15, 20, 25, 30, 35, 45],
    format: pct,
  },
  {
    id: 'avg_household_size',
    labelKey: 'layer.avg_household_size',
    property: 'avg_household_size',
    unit: '',
    colors: ['#f7f4f9', '#e7e1ef', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#91003f'],
    stops: [1.0, 1.3, 1.5, 1.7, 1.9, 2.2, 2.5, 3.0],
    format: (v: number) => `${v.toFixed(2)}`,
  },
  {
    id: 'manufacturing_jobs',
    labelKey: 'layer.manufacturing_jobs',
    property: 'manufacturing_jobs_pct',
    unit: '%',
    colors: ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'],
    stops: [1, 3, 5, 8, 12, 18, 25, 35],
    format: pct,
  },
  {
    id: 'public_sector_jobs',
    labelKey: 'layer.public_sector_jobs',
    property: 'public_sector_jobs_pct',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [1, 3, 5, 8, 12, 16, 22, 30],
    format: pct,
  },
  {
    id: 'service_sector_jobs',
    labelKey: 'layer.service_sector_jobs',
    property: 'service_sector_jobs_pct',
    unit: '%',
    colors: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#8c2d04'],
    stops: [30, 45, 55, 65, 70, 80, 85, 95],
    format: pct,
  },
  {
    id: 'new_construction',
    labelKey: 'layer.new_construction',
    property: 'new_construction_pct',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [0, 2, 5, 8, 12, 18, 25, 40],
    format: pct,
  },
];

// Colorblind-safe palettes (8 stops each)
export type ColorblindType = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';

const CB_PALETTES: Record<Exclude<ColorblindType, 'off'>, string[]> = {
  // Viridis — safe for protanopia (red-blind)
  protanopia: ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#9fda3a', '#fde725'],
  // Cividis — optimized for deuteranopia (green-blind)
  deuteranopia: ['#00204d', '#1a3a5c', '#40546a', '#696e78', '#918985', '#bba58e', '#e6c28f', '#ffe945'],
  // Inferno-like — safe for tritanopia (blue-blind)
  tritanopia: ['#000004', '#2c115f', '#711f81', '#b63679', '#ee605e', '#fb9d3a', '#f7e54a', '#fcffa4'],
};

let colorblindMode: ColorblindType = 'off';

export function setColorblindMode(mode: ColorblindType) {
  colorblindMode = mode;
  try { localStorage.setItem('naapurustot-colorblind', mode); } catch { /* localStorage unavailable */ }
}

export function getColorblindMode(): ColorblindType {
  return colorblindMode;
}

// Initialize from localStorage
const VALID_CB_MODES = new Set<string>(['protanopia', 'deuteranopia', 'tritanopia']);
try {
  const stored = localStorage.getItem('naapurustot-colorblind');
  if (stored === '1') colorblindMode = 'protanopia'; // migrate old boolean
  else if (stored && VALID_CB_MODES.has(stored)) colorblindMode = stored as ColorblindType;
} catch { /* localStorage unavailable */ }

export function getLayerById(id: LayerId): LayerConfig {
  const layer = LAYERS.find((l) => l.id === id) ?? LAYERS[0];
  if (colorblindMode === 'off') return layer;
  const palette = CB_PALETTES[colorblindMode];
  const cbColors = palette.length === layer.colors.length
    ? palette
    : layer.colors.length > 8
      ? [...palette, ...palette.slice(-2)] // extend for 10-stop layers
      : palette.slice(0, layer.colors.length);
  return { ...layer, colors: cbColors };
}

export function getColorForValue(layer: LayerConfig, value: number | null | undefined): string {
  if (value == null) return '#333';
  for (let i = layer.stops.length - 1; i >= 0; i--) {
    if (value >= layer.stops[i]) return layer.colors[i];
  }
  return layer.colors[0];
}

export function buildFillColorExpression(layer: LayerConfig): ExpressionSpecification {
  const interpolation: unknown[] = ['interpolate', ['linear'], ['get', layer.property]];
  for (let i = 0; i < layer.stops.length; i++) {
    interpolation.push(layer.stops[i], layer.colors[i]);
  }
  // Show gray for features where the property is null/missing
  return [
    'case',
    ['all', ['has', layer.property], ['!=', ['get', layer.property], null]],
    interpolation,
    '#d1d5db',
  ] as unknown as ExpressionSpecification;
}
