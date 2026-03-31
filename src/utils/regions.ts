/**
 * Region configuration for Finland.
 *
 * Defines all supported regions with their viewports, municipality codes,
 * and data file mappings. This is the single source of truth for geographic
 * scope — the CitySelector, data loader, and map viewport all derive from here.
 *
 * Regions are organized as metro areas / cities. Each region maps to a set of
 * municipality codes and a per-region TopoJSON file that is lazy-loaded when
 * the user navigates to that region.
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
  | 'hyvinkaa'
  | 'kajaani'
  | 'rauma';

export interface RegionConfig {
  /** Display name i18n key */
  labelKey: string;
  /** Map viewport */
  center: [number, number];
  zoom: number;
  bounds: [number, number, number, number];
  /** Municipality codes belonging to this region */
  municipalityCodes: string[];
  /** TopoJSON file path (relative to src/data/regions/) */
  dataFile: string;
}

/**
 * All supported regions. Order determines display order in the selector.
 *
 * Municipality codes sourced from Statistics Finland.
 * Viewports are approximate bounding boxes for each metro area.
 */
export const REGIONS: Record<RegionId, RegionConfig> = {
  helsinki_metro: {
    labelKey: 'city.helsinki_metro',
    center: [24.94, 60.17],
    zoom: 9.2,
    bounds: [24.5, 60.05, 25.4, 60.4],
    municipalityCodes: ['091', '049', '092', '235'],
    dataFile: 'helsinki_metro.topojson',
  },
  turku: {
    labelKey: 'city.turku',
    center: [22.20, 60.50],
    zoom: 9,
    bounds: [21.5, 60.25, 22.9, 60.75],
    municipalityCodes: ['853', '202', '680', '529', '423', '704', '481', '577', '019'],
    dataFile: 'turku.topojson',
  },
  tampere: {
    labelKey: 'city.tampere',
    center: [23.85, 61.55],
    zoom: 8.5,
    bounds: [23.1, 61.2, 25.0, 62.2],
    municipalityCodes: ['837', '536', '980', '211', '418', '604', '562'],
    dataFile: 'tampere.topojson',
  },
  oulu: {
    labelKey: 'city.oulu',
    center: [25.47, 65.01],
    zoom: 9,
    bounds: [25.0, 64.8, 26.1, 65.2],
    municipalityCodes: ['564', '244', '425', '494', '859'],
    dataFile: 'oulu.topojson',
  },
  jyvaskyla: {
    labelKey: 'city.jyvaskyla',
    center: [25.74, 62.24],
    zoom: 9,
    bounds: [25.2, 62.0, 26.3, 62.5],
    municipalityCodes: ['179', '500', '592'],
    dataFile: 'jyvaskyla.topojson',
  },
  lahti: {
    labelKey: 'city.lahti',
    center: [25.66, 60.98],
    zoom: 9,
    bounds: [25.2, 60.8, 26.1, 61.2],
    municipalityCodes: ['398', '111', '098'],
    dataFile: 'lahti.topojson',
  },
  kuopio: {
    labelKey: 'city.kuopio',
    center: [27.68, 62.89],
    zoom: 9,
    bounds: [27.2, 62.7, 28.2, 63.1],
    municipalityCodes: ['297', '749'],
    dataFile: 'kuopio.topojson',
  },
  pori: {
    labelKey: 'city.pori',
    center: [21.80, 61.48],
    zoom: 9,
    bounds: [21.3, 61.3, 22.3, 61.7],
    municipalityCodes: ['609', '886'],
    dataFile: 'pori.topojson',
  },
  joensuu: {
    labelKey: 'city.joensuu',
    center: [29.76, 62.60],
    zoom: 9,
    bounds: [29.3, 62.4, 30.2, 62.8],
    municipalityCodes: ['167', '426'],
    dataFile: 'joensuu.topojson',
  },
  lappeenranta: {
    labelKey: 'city.lappeenranta',
    center: [28.19, 61.06],
    zoom: 9,
    bounds: [27.7, 60.9, 28.7, 61.2],
    municipalityCodes: ['405'],
    dataFile: 'lappeenranta.topojson',
  },
  vaasa: {
    labelKey: 'city.vaasa',
    center: [21.62, 63.10],
    zoom: 9,
    bounds: [21.1, 62.9, 22.1, 63.3],
    municipalityCodes: ['905', '499'],
    dataFile: 'vaasa.topojson',
  },
  kouvola: {
    labelKey: 'city.kouvola',
    center: [26.70, 60.87],
    zoom: 9,
    bounds: [26.2, 60.7, 27.2, 61.1],
    municipalityCodes: ['286'],
    dataFile: 'kouvola.topojson',
  },
  rovaniemi: {
    labelKey: 'city.rovaniemi',
    center: [25.72, 66.50],
    zoom: 8.5,
    bounds: [25.0, 66.2, 26.5, 66.8],
    municipalityCodes: ['698'],
    dataFile: 'rovaniemi.topojson',
  },
  seinajoki: {
    labelKey: 'city.seinajoki',
    center: [22.84, 62.79],
    zoom: 9,
    bounds: [22.3, 62.6, 23.4, 63.0],
    municipalityCodes: ['743'],
    dataFile: 'seinajoki.topojson',
  },
  mikkeli: {
    labelKey: 'city.mikkeli',
    center: [27.27, 61.69],
    zoom: 9,
    bounds: [26.8, 61.5, 27.8, 61.9],
    municipalityCodes: ['491'],
    dataFile: 'mikkeli.topojson',
  },
  kotka: {
    labelKey: 'city.kotka',
    center: [26.95, 60.47],
    zoom: 9.5,
    bounds: [26.5, 60.3, 27.4, 60.6],
    municipalityCodes: ['285', '075'],
    dataFile: 'kotka.topojson',
  },
  salo: {
    labelKey: 'city.salo',
    center: [23.13, 60.39],
    zoom: 9,
    bounds: [22.6, 60.2, 23.6, 60.6],
    municipalityCodes: ['734'],
    dataFile: 'salo.topojson',
  },
  porvoo: {
    labelKey: 'city.porvoo',
    center: [25.66, 60.39],
    zoom: 10,
    bounds: [25.3, 60.2, 26.0, 60.6],
    municipalityCodes: ['638'],
    dataFile: 'porvoo.topojson',
  },
  kokkola: {
    labelKey: 'city.kokkola',
    center: [23.13, 63.84],
    zoom: 9,
    bounds: [22.6, 63.6, 23.6, 64.0],
    municipalityCodes: ['272'],
    dataFile: 'kokkola.topojson',
  },
  hyvinkaa: {
    labelKey: 'city.hyvinkaa',
    center: [24.86, 60.63],
    zoom: 10,
    bounds: [24.5, 60.5, 25.2, 60.8],
    municipalityCodes: ['106'],
    dataFile: 'hyvinkaa.topojson',
  },
  kajaani: {
    labelKey: 'city.kajaani',
    center: [27.73, 64.23],
    zoom: 9,
    bounds: [27.2, 64.0, 28.2, 64.4],
    municipalityCodes: ['205'],
    dataFile: 'kajaani.topojson',
  },
  rauma: {
    labelKey: 'city.rauma',
    center: [21.51, 61.13],
    zoom: 10,
    bounds: [21.1, 61.0, 21.9, 61.3],
    municipalityCodes: ['684'],
    dataFile: 'rauma.topojson',
  },
};

/** All region IDs in display order. */
export const REGION_IDS = Object.keys(REGIONS) as RegionId[];

/** The "all" view viewport showing all of Finland. */
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
