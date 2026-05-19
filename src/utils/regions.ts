/**
 * Region configuration for Finland.
 *
 * Defines all supported regions with their viewports, municipality codes,
 * and data file mappings. This is the single source of truth for geographic
 * scope — the CitySelector, data loader, and map viewport all derive from here.
 *
 * Regions are organized as Tilastokeskus seutukunnat (sub-regions / metro areas).
 * Each region maps to a set of municipality codes and a per-region TopoJSON file
 * that is lazy-loaded when the user navigates to that region.
 *
 * Municipality memberships are aligned to the canonical
 * `seutukunta_1_20250101` classification (see `scripts/seutukunnat.json`).
 * The 22 currently-scaffolded region IDs cover 21 of Finland's 69 seutukunnat
 * (helsinki_metro absorbed the former standalone hyvinkaa region); the
 * remaining ~47 seutukunnat are added in CF-5 Phase D batches.
 *
 * NOTE on partial coverage: a region's `municipalityCodes` list reflects the
 * canonical seutukunta extent. The current TopoJSON files for regions with
 * `hasData: true` cover only a subset of those munis until the data pipeline
 * is re-run for the expanded muni sets. This is intentional under the
 * partial-coverage stance — gray/hatched fallback handles the gaps.
 */

/** A region identifier. */
export type RegionId =
  | 'helsinki_metro'
  | 'turku'
  | 'tampere'
  | 'oulu'
  | 'jyvaskyla'
  | 'lahti'
  | 'kuopio'
  | 'pori'
  | 'joensuu'
  | 'lappeenranta'
  | 'vaasa'
  | 'kouvola'
  | 'rovaniemi'
  | 'seinajoki'
  | 'mikkeli'
  | 'kotka'
  | 'salo'
  | 'porvoo'
  | 'kokkola'
  | 'kajaani'
  | 'rauma';

export interface RegionConfig {
  /** Display name i18n key */
  labelKey: string;
  /** Map viewport */
  center: [number, number];
  zoom: number;
  bounds: [number, number, number, number];
  /** Municipality codes belonging to this region (canonical seutukunta extent) */
  municipalityCodes: string[];
  /** TopoJSON file path (relative to src/data/regions/) */
  dataFile: string;
  /** Whether this region has populated data and should appear in the selector */
  hasData?: boolean;
}

/**
 * All supported regions. Order determines display order in the selector.
 *
 * Municipality codes sourced from Tilastokeskus `seutukunta_1_20250101`.
 * Viewports are approximate bounding boxes — narrower than the full seutukunta
 * extent for regions where the current data only covers a subset.
 */
export const REGIONS: Record<RegionId, RegionConfig> = {
  helsinki_metro: {
    // Helsingin seutukunta (code 011) — 17 munis: Helsinki, Espoo, Vantaa,
    // Kauniainen, Hyvinkää, Järvenpää, Karkkila, Kerava, Kirkkonummi, Lohja,
    // Mäntsälä, Nurmijärvi, Pornainen, Sipoo, Siuntio, Tuusula, Vihti.
    labelKey: 'city.helsinki_metro',
    center: [24.94, 60.17],
    zoom: 9.2,
    bounds: [24.5, 60.05, 25.4, 60.4],
    municipalityCodes: ['049', '091', '092', '106', '186', '224', '235', '245', '257', '444', '505', '543', '611', '753', '755', '858', '927'],
    dataFile: 'helsinki_metro.topojson',
    hasData: true,
  },
  turku: {
    // Turun seutukunta (code 023) — 11 munis. Aura (019) belongs to Loimaa
    // seutukunta and is intentionally excluded.
    labelKey: 'city.turku',
    center: [22.20, 60.50],
    zoom: 9,
    bounds: [21.5, 60.25, 22.9, 60.75],
    municipalityCodes: ['202', '423', '481', '503', '529', '538', '577', '680', '704', '738', '853'],
    dataFile: 'turku.topojson',
    hasData: true,
  },
  tampere: {
    // Tampereen seutukunta (code 064) — 11 munis.
    labelKey: 'city.tampere',
    center: [23.85, 61.55],
    zoom: 8.5,
    bounds: [23.1, 61.2, 25.0, 62.2],
    municipalityCodes: ['108', '211', '291', '418', '536', '562', '604', '635', '837', '922', '980'],
    dataFile: 'tampere.topojson',
    hasData: true,
  },
  oulu: {
    // Oulun seutukunta (code 171) — 7 munis.
    labelKey: 'city.oulu',
    center: [25.47, 65.01],
    zoom: 9,
    bounds: [25.0, 64.8, 26.1, 65.2],
    municipalityCodes: ['072', '244', '425', '436', '494', '564', '859'],
    dataFile: 'oulu.topojson',
  },
  jyvaskyla: {
    // Jyväskylän seutukunta (code 131) — 7 munis.
    labelKey: 'city.jyvaskyla',
    center: [25.74, 62.24],
    zoom: 9,
    bounds: [25.2, 62.0, 26.3, 62.5],
    municipalityCodes: ['077', '179', '410', '500', '592', '850', '892'],
    dataFile: 'jyvaskyla.topojson',
  },
  lahti: {
    // Lahden seutukunta (code 071) — 10 munis.
    labelKey: 'city.lahti',
    center: [25.66, 60.98],
    zoom: 9,
    bounds: [25.2, 60.8, 26.1, 61.2],
    municipalityCodes: ['016', '081', '098', '111', '142', '316', '398', '560', '576', '781'],
    dataFile: 'lahti.topojson',
  },
  kuopio: {
    // Kuopion seutukunta (code 112) — 2 munis (exact 1:1 with previous config).
    labelKey: 'city.kuopio',
    center: [27.68, 62.89],
    zoom: 9,
    bounds: [27.2, 62.7, 28.2, 63.1],
    municipalityCodes: ['297', '749'],
    dataFile: 'kuopio.topojson',
  },
  pori: {
    // Porin seutukunta (code 043) — 8 munis.
    labelKey: 'city.pori',
    center: [21.80, 61.48],
    zoom: 9,
    bounds: [21.3, 61.3, 22.3, 61.7],
    municipalityCodes: ['079', '102', '271', '484', '531', '608', '609', '886'],
    dataFile: 'pori.topojson',
  },
  joensuu: {
    // Joensuun seutukunta (code 122) — 8 munis.
    labelKey: 'city.joensuu',
    center: [29.76, 62.60],
    zoom: 9,
    bounds: [29.3, 62.4, 30.2, 62.8],
    municipalityCodes: ['090', '146', '167', '176', '276', '309', '426', '607'],
    dataFile: 'joensuu.topojson',
  },
  lappeenranta: {
    // Lappeenrannan seutukunta (code 091) — 5 munis.
    labelKey: 'city.lappeenranta',
    center: [28.19, 61.06],
    zoom: 9,
    bounds: [27.7, 60.9, 28.7, 61.2],
    municipalityCodes: ['405', '416', '441', '739', '831'],
    dataFile: 'lappeenranta.topojson',
  },
  vaasa: {
    // Vaasan seutukunta (code 152) — 6 munis.
    labelKey: 'city.vaasa',
    center: [21.62, 63.10],
    zoom: 9,
    bounds: [21.1, 62.9, 22.1, 63.3],
    municipalityCodes: ['280', '399', '475', '499', '905', '946'],
    dataFile: 'vaasa.topojson',
  },
  kouvola: {
    // Kouvolan seutukunta (code 081) — 1 muni (exact 1:1 with previous config).
    labelKey: 'city.kouvola',
    center: [26.70, 60.87],
    zoom: 9,
    bounds: [26.2, 60.7, 27.2, 61.1],
    municipalityCodes: ['286'],
    dataFile: 'kouvola.topojson',
  },
  rovaniemi: {
    // Rovaniemen seutukunta (code 191) — 2 munis (adds Ranua, 683).
    labelKey: 'city.rovaniemi',
    center: [25.72, 66.50],
    zoom: 8.5,
    bounds: [25.0, 66.2, 26.5, 66.8],
    municipalityCodes: ['683', '698'],
    dataFile: 'rovaniemi.topojson',
  },
  seinajoki: {
    // Seinäjoen seutukunta (code 142) — 6 munis.
    labelKey: 'city.seinajoki',
    center: [22.84, 62.79],
    zoom: 9,
    bounds: [22.3, 62.6, 23.4, 63.0],
    municipalityCodes: ['145', '152', '233', '301', '408', '743'],
    dataFile: 'seinajoki.topojson',
  },
  mikkeli: {
    // Mikkelin seutukunta (code 101) — 5 munis.
    labelKey: 'city.mikkeli',
    center: [27.27, 61.69],
    zoom: 9,
    bounds: [26.8, 61.5, 27.8, 61.9],
    municipalityCodes: ['097', '213', '491', '507', '623'],
    dataFile: 'mikkeli.topojson',
  },
  kotka: {
    // Kotka-Haminan seutukunta (code 082) — 5 munis.
    labelKey: 'city.kotka',
    center: [26.95, 60.47],
    zoom: 9.5,
    bounds: [26.5, 60.3, 27.4, 60.6],
    municipalityCodes: ['075', '285', '489', '624', '935'],
    dataFile: 'kotka.topojson',
  },
  salo: {
    // Salon seutukunta (code 022) — 2 munis (adds Somero, 761).
    labelKey: 'city.salo',
    center: [23.13, 60.39],
    zoom: 9,
    bounds: [22.6, 60.2, 23.6, 60.6],
    municipalityCodes: ['734', '761'],
    dataFile: 'salo.topojson',
  },
  porvoo: {
    // Porvoon seutukunta (code 015) — 4 munis.
    labelKey: 'city.porvoo',
    center: [25.66, 60.39],
    zoom: 10,
    bounds: [25.3, 60.2, 26.0, 60.6],
    municipalityCodes: ['018', '504', '616', '638'],
    dataFile: 'porvoo.topojson',
  },
  kokkola: {
    // Kokkolan seutukunta (code 162) — 2 munis (adds Kannus, 217).
    labelKey: 'city.kokkola',
    center: [23.13, 63.84],
    zoom: 9,
    bounds: [22.6, 63.6, 23.6, 64.0],
    municipalityCodes: ['217', '272'],
    dataFile: 'kokkola.topojson',
  },
  kajaani: {
    // Kajaanin seutukunta (code 182) — 4 munis.
    labelKey: 'city.kajaani',
    center: [27.73, 64.23],
    zoom: 9,
    bounds: [27.2, 64.0, 28.2, 64.4],
    municipalityCodes: ['205', '578', '697', '765'],
    dataFile: 'kajaani.topojson',
  },
  rauma: {
    // Rauman seutukunta (code 041) — 4 munis.
    labelKey: 'city.rauma',
    center: [21.51, 61.13],
    zoom: 10,
    bounds: [21.1, 61.0, 21.9, 61.3],
    municipalityCodes: ['050', '051', '684', '783'],
    dataFile: 'rauma.topojson',
  },
};

/** All region IDs in display order. */
export const REGION_IDS = Object.keys(REGIONS) as RegionId[];

/** Region IDs that have populated data and should appear in the selector. */
export const REGION_IDS_WITH_DATA = REGION_IDS.filter(id => REGIONS[id].hasData);

/** Viewport for the "all cities" view, showing the full extent of Finland. */
export const ALL_FINLAND_VIEWPORT = {
  center: [25.0, 64.0] as [number, number],
  zoom: 4.8,
  bounds: [19.5, 59.0, 31.5, 70.5] as [number, number, number, number],
};

/** Get all municipality codes across all regions. */
export function getAllMunicipalityCodes(): string[] {
  return REGION_IDS.flatMap(id => REGIONS[id].municipalityCodes);
}

/** Find which region a municipality code belongs to. */
export function getRegionByMunicipality(code: string): RegionId | null {
  for (const id of REGION_IDS) {
    if (REGIONS[id].municipalityCodes.includes(code)) return id;
  }
  return null;
}
