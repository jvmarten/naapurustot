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
  | 'rauma'
  // CF-5 Phase D1 — remaining 48 seutukunnat (boundary scaffold, no data yet)
  | 'aanekoski'
  | 'aboland_turunmaa'
  | 'alands_landsbygd'
  | 'alands_skargard'
  | 'etela_pirkanmaa'
  | 'forssa'
  | 'haapavesi_siikalatva'
  | 'hameenlinna'
  | 'imatra'
  | 'ita_lappi'
  | 'jakobstadsregionen'
  | 'jamsa'
  | 'jarviseutu'
  | 'joutsa'
  | 'kaustinen'
  | 'kehys_kainuu'
  | 'kemi_tornio'
  | 'keski_karjala'
  | 'keuruu'
  | 'koillis_savo'
  | 'koillismaa'
  | 'kuusiokunnat'
  | 'loimaa'
  | 'lounais_pirkanmaa'
  | 'loviisa'
  | 'luoteis_pirkanmaa'
  | 'mariehamns_stad'
  | 'nivala_haapajarvi'
  | 'oulunkaari'
  | 'pieksamaki'
  | 'pielisen_karjala'
  | 'pohjois_lappi'
  | 'pohjois_satakunta'
  | 'raahe'
  | 'raasepori'
  | 'riihimaki'
  | 'saarijarvi_viitasaari'
  | 'savonlinna'
  | 'sisa_savo'
  | 'suupohja'
  | 'sydosterbotten'
  | 'torniolaakso'
  | 'tunturi_lappi'
  | 'vakka_suomi'
  | 'varkaus'
  | 'yla_pirkanmaa'
  | 'yla_savo'
  | 'ylivieska';

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

  // --- CF-5 Phase D1: remaining 48 seutukunnat ---
  // Boundary geometry is drawn (src/data/seutukunnat.topojson) but no
  // postal-code data is ingested yet. hasData is omitted so they stay out of
  // the CitySelector until Phase D2 populates them. Viewports are derived
  // from each seutukunta bounding box (scripts/build_seutukunta_boundaries.mjs).
  aanekoski: {
    // Äänekoski (seutukunta 135, 2 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.aanekoski',
    center: [26.03653, 62.69963],
    zoom: 8.9,
    bounds: [25.47397, 62.47851, 26.59909, 62.92074],
    municipalityCodes: ['275', '992'],
    dataFile: 'aanekoski.topojson',
  },
  aboland_turunmaa: {
    // Åboland-Turunmaa (seutukunta 021, 2 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.aboland_turunmaa',
    center: [21.98482, 60.11175],
    zoom: 8.2,
    bounds: [21.05234, 59.7581, 22.91731, 60.46539],
    municipalityCodes: ['322', '445'],
    dataFile: 'aboland_turunmaa.topojson',
  },
  alands_landsbygd: {
    // Ålands landsbygd (seutukunta 212, 9 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.alands_landsbygd',
    center: [19.80715, 60.1879],
    zoom: 8.6,
    bounds: [19.30413, 59.83578, 20.31017, 60.54001],
    municipalityCodes: ['043', '060', '065', '076', '170', '417', '438', '736', '771'],
    dataFile: 'alands_landsbygd.topojson',
  },
  alands_skargard: {
    // Ålands skärgård (seutukunta 213, 6 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.alands_skargard',
    center: [20.70832, 60.2122],
    zoom: 8.2,
    bounds: [20.17326, 59.7702, 21.24338, 60.65419],
    municipalityCodes: ['035', '062', '295', '318', '766', '941'],
    dataFile: 'alands_skargard.topojson',
  },
  etela_pirkanmaa: {
    // Etelä-Pirkanmaa (seutukunta 063, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.etela_pirkanmaa',
    center: [23.76229, 61.14008],
    zoom: 9,
    bounds: [23.2273, 60.93971, 24.29727, 61.34045],
    municipalityCodes: ['020', '887', '908'],
    dataFile: 'etela_pirkanmaa.topojson',
  },
  forssa: {
    // Forssa (seutukunta 053, 5 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.forssa',
    center: [23.59944, 60.82897],
    zoom: 9.2,
    bounds: [23.13564, 60.63808, 24.06324, 61.01985],
    municipalityCodes: ['061', '103', '169', '834', '981'],
    dataFile: 'forssa.topojson',
  },
  haapavesi_siikalatva: {
    // Haapavesi-Siikalatva (seutukunta 175, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.haapavesi_siikalatva',
    center: [25.86778, 64.23499],
    zoom: 8,
    bounds: [24.86516, 63.84104, 26.8704, 64.62894],
    municipalityCodes: ['071', '630', '791'],
    dataFile: 'haapavesi_siikalatva.topojson',
  },
  hameenlinna: {
    // Hämeenlinna (seutukunta 051, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.hameenlinna',
    center: [24.50831, 61.03473],
    zoom: 8.5,
    bounds: [23.75676, 60.74457, 25.25987, 61.32488],
    municipalityCodes: ['082', '109', '165'],
    dataFile: 'hameenlinna.topojson',
  },
  imatra: {
    // Imatra (seutukunta 093, 4 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.imatra',
    center: [29.19806, 61.47179],
    zoom: 8.1,
    bounds: [28.2522, 61.07925, 30.14391, 61.86432],
    municipalityCodes: ['153', '580', '689', '700'],
    dataFile: 'imatra.topojson',
  },
  ita_lappi: {
    // Itä-Lappi (seutukunta 194, 5 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.ita_lappi',
    center: [28.24259, 66.99845],
    zoom: 6.8,
    bounds: [26.46814, 65.80059, 30.01704, 68.1963],
    municipalityCodes: ['320', '583', '614', '732', '742'],
    dataFile: 'ita_lappi.topojson',
  },
  jakobstadsregionen: {
    // Jakobstadsregionen (seutukunta 154, 5 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.jakobstadsregionen',
    center: [22.9112, 63.60581],
    zoom: 8.3,
    bounds: [22.07831, 63.28205, 23.74408, 63.92956],
    municipalityCodes: ['288', '440', '598', '599', '893'],
    dataFile: 'jakobstadsregionen.topojson',
  },
  jamsa: {
    // Jämsä (seutukunta 134, 1 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.jamsa',
    center: [25.06053, 61.92073],
    zoom: 8.8,
    bounds: [24.52464, 61.63065, 25.59641, 62.2108],
    municipalityCodes: ['182'],
    dataFile: 'jamsa.topojson',
  },
  jarviseutu: {
    // Järviseutu (seutukunta 146, 5 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.jarviseutu',
    center: [23.86332, 63.0868],
    zoom: 8.3,
    bounds: [23.20704, 62.67555, 24.51959, 63.49805],
    municipalityCodes: ['005', '052', '403', '759', '934'],
    dataFile: 'jarviseutu.topojson',
  },
  joutsa: {
    // Joutsa (seutukunta 132, 2 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.joutsa',
    center: [26.0154, 61.82583],
    zoom: 9,
    bounds: [25.49704, 61.60845, 26.53375, 62.04322],
    municipalityCodes: ['172', '435'],
    dataFile: 'joutsa.topojson',
  },
  kaustinen: {
    // Kaustinen (seutukunta 161, 6 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.kaustinen',
    center: [24.22936, 63.5012],
    zoom: 8.4,
    bounds: [23.42241, 63.11643, 25.03632, 63.88598],
    municipalityCodes: ['074', '236', '421', '584', '849', '924'],
    dataFile: 'kaustinen.topojson',
  },
  kehys_kainuu: {
    // Kehys-Kainuu (seutukunta 181, 4 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.kehys_kainuu',
    center: [28.836, 64.61212],
    zoom: 7.2,
    bounds: [27.11844, 63.70336, 30.55356, 65.52089],
    municipalityCodes: ['105', '290', '620', '777'],
    dataFile: 'kehys_kainuu.topojson',
  },
  kemi_tornio: {
    // Kemi-Tornio (seutukunta 192, 5 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.kemi_tornio',
    center: [24.97606, 65.94433],
    zoom: 7.9,
    bounds: [23.88479, 65.55102, 26.06732, 66.33764],
    municipalityCodes: ['240', '241', '751', '845', '851'],
    dataFile: 'kemi_tornio.topojson',
  },
  keski_karjala: {
    // Keski-Karjala (seutukunta 124, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.keski_karjala',
    center: [30.04257, 62.06921],
    zoom: 8.5,
    bounds: [29.29597, 61.72207, 30.78918, 62.41635],
    municipalityCodes: ['260', '707', '848'],
    dataFile: 'keski_karjala.topojson',
  },
  keuruu: {
    // Keuruu (seutukunta 133, 2 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.keuruu',
    center: [24.63246, 62.34399],
    zoom: 8.7,
    bounds: [24.013, 62.02319, 25.25191, 62.66479],
    municipalityCodes: ['249', '495'],
    dataFile: 'keuruu.topojson',
  },
  koillis_savo: {
    // Koillis-Savo (seutukunta 113, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.koillis_savo',
    center: [28.56767, 63.16742],
    zoom: 7.8,
    bounds: [28.03773, 62.58009, 29.0976, 63.75475],
    municipalityCodes: ['204', '687', '857'],
    dataFile: 'koillis_savo.topojson',
  },
  koillismaa: {
    // Koillismaa (seutukunta 178, 2 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.koillismaa',
    center: [28.9255, 65.8681],
    zoom: 7.7,
    bounds: [27.71254, 65.25035, 30.13847, 66.48585],
    municipalityCodes: ['305', '832'],
    dataFile: 'koillismaa.topojson',
  },
  kuusiokunnat: {
    // Kuusiokunnat (seutukunta 144, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.kuusiokunnat',
    center: [23.87277, 62.64148],
    zoom: 8.5,
    bounds: [23.16123, 62.36333, 24.58431, 62.91963],
    municipalityCodes: ['010', '300', '989'],
    dataFile: 'kuusiokunnat.topojson',
  },
  loimaa: {
    // Loimaa (seutukunta 025, 6 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.loimaa',
    center: [22.72712, 60.80616],
    zoom: 8.8,
    bounds: [22.16031, 60.51088, 23.29393, 61.10144],
    municipalityCodes: ['019', '284', '430', '480', '561', '636'],
    dataFile: 'loimaa.topojson',
  },
  lounais_pirkanmaa: {
    // Lounais-Pirkanmaa (seutukunta 068, 2 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.lounais_pirkanmaa',
    center: [22.90876, 61.36254],
    zoom: 8.5,
    bounds: [22.43416, 61.00122, 23.38336, 61.72385],
    municipalityCodes: ['619', '790'],
    dataFile: 'lounais_pirkanmaa.topojson',
  },
  loviisa: {
    // Loviisa (seutukunta 016, 2 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.loviisa',
    center: [26.17265, 60.50182],
    zoom: 9,
    bounds: [25.801, 60.2413, 26.54429, 60.76234],
    municipalityCodes: ['407', '434'],
    dataFile: 'loviisa.topojson',
  },
  luoteis_pirkanmaa: {
    // Luoteis-Pirkanmaa (seutukunta 061, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.luoteis_pirkanmaa',
    center: [23.05824, 62.00465],
    zoom: 8.7,
    bounds: [22.5226, 61.67514, 23.59388, 62.33417],
    municipalityCodes: ['143', '250', '581'],
    dataFile: 'luoteis_pirkanmaa.topojson',
  },
  mariehamns_stad: {
    // Mariehamns stad (seutukunta 211, 1 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.mariehamns_stad',
    center: [19.94116, 60.08874],
    zoom: 11,
    bounds: [19.91888, 60.0485, 19.96343, 60.12899],
    municipalityCodes: ['478'],
    dataFile: 'mariehamns_stad.topojson',
  },
  nivala_haapajarvi: {
    // Nivala-Haapajärvi (seutukunta 176, 5 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.nivala_haapajarvi',
    center: [25.45526, 63.76988],
    zoom: 8.3,
    bounds: [24.61871, 63.42912, 26.2918, 64.11064],
    municipalityCodes: ['069', '317', '535', '626', '691'],
    dataFile: 'nivala_haapajarvi.topojson',
  },
  oulunkaari: {
    // Oulunkaari (seutukunta 173, 4 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.oulunkaari',
    center: [26.48874, 65.11276],
    zoom: 7.3,
    bounds: [24.8151, 64.26517, 28.16238, 65.96036],
    municipalityCodes: ['139', '615', '785', '889'],
    dataFile: 'oulunkaari.topojson',
  },
  pieksamaki: {
    // Pieksämäki (seutukunta 105, 2 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.pieksamaki',
    center: [27.44489, 62.03781],
    zoom: 8.1,
    bounds: [26.662, 61.5456, 28.22778, 62.53002],
    municipalityCodes: ['178', '593'],
    dataFile: 'pieksamaki.topojson',
  },
  pielisen_karjala: {
    // Pielisen Karjala (seutukunta 125, 2 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.pielisen_karjala',
    center: [29.79971, 63.44041],
    zoom: 7.5,
    bounds: [28.35959, 62.9984, 31.23983, 63.88241],
    municipalityCodes: ['422', '541'],
    dataFile: 'pielisen_karjala.topojson',
  },
  pohjois_lappi: {
    // Pohjois-Lappi (seutukunta 197, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.pohjois_lappi',
    center: [27.11983, 68.51779],
    zoom: 6.4,
    bounds: [24.90317, 66.94292, 29.3365, 70.09266],
    municipalityCodes: ['148', '758', '890'],
    dataFile: 'pohjois_lappi.topojson',
  },
  pohjois_satakunta: {
    // Pohjois-Satakunta (seutukunta 044, 4 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.pohjois_satakunta',
    center: [22.2703, 61.9986],
    zoom: 8.7,
    bounds: [21.67897, 61.68607, 22.86163, 62.31113],
    municipalityCodes: ['181', '214', '230', '747'],
    dataFile: 'pohjois_satakunta.topojson',
  },
  raahe: {
    // Raahe (seutukunta 174, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.raahe',
    center: [24.75536, 64.60667],
    zoom: 8.4,
    bounds: [23.99046, 64.30022, 25.52027, 64.91313],
    municipalityCodes: ['625', '678', '748'],
    dataFile: 'raahe.topojson',
  },
  raasepori: {
    // Raasepori (seutukunta 014, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.raasepori',
    center: [23.55506, 59.9859],
    zoom: 8.5,
    bounds: [22.80957, 59.7658, 24.30055, 60.206],
    municipalityCodes: ['078', '149', '710'],
    dataFile: 'raasepori.topojson',
  },
  riihimaki: {
    // Riihimäki (seutukunta 052, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.riihimaki',
    center: [24.61984, 60.74015],
    zoom: 8.9,
    bounds: [24.04675, 60.55249, 25.19293, 60.92782],
    municipalityCodes: ['086', '433', '694'],
    dataFile: 'riihimaki.topojson',
  },
  saarijarvi_viitasaari: {
    // Saarijärvi-Viitasaari (seutukunta 138, 8 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.saarijarvi_viitasaari',
    center: [25.30316, 63.06656],
    zoom: 7.9,
    bounds: [24.27205, 62.52083, 26.33427, 63.61229],
    municipalityCodes: ['216', '226', '256', '265', '312', '601', '729', '931'],
    dataFile: 'saarijarvi_viitasaari.topojson',
  },
  savonlinna: {
    // Savonlinna (seutukunta 103, 4 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.savonlinna',
    center: [28.77907, 61.97253],
    zoom: 8.2,
    bounds: [27.86132, 61.52731, 29.69683, 62.41776],
    municipalityCodes: ['046', '681', '740', '768'],
    dataFile: 'savonlinna.topojson',
  },
  sisa_savo: {
    // Sisä-Savo (seutukunta 115, 4 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.sisa_savo',
    center: [26.78966, 62.77772],
    zoom: 8.5,
    bounds: [26.03984, 62.424, 27.53948, 63.13144],
    municipalityCodes: ['686', '778', '844', '921'],
    dataFile: 'sisa_savo.topojson',
  },
  suupohja: {
    // Suupohja (seutukunta 141, 4 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.suupohja',
    center: [22.09338, 62.3099],
    zoom: 8.6,
    bounds: [21.52349, 61.97976, 22.66326, 62.64005],
    municipalityCodes: ['151', '218', '232', '846'],
    dataFile: 'suupohja.topojson',
  },
  sydosterbotten: {
    // Sydösterbotten (seutukunta 153, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.sydosterbotten',
    center: [21.41622, 62.36075],
    zoom: 8.3,
    bounds: [21.04147, 61.95383, 21.79097, 62.76767],
    municipalityCodes: ['231', '287', '545'],
    dataFile: 'sydosterbotten.topojson',
  },
  torniolaakso: {
    // Torniolaakso (seutukunta 193, 2 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.torniolaakso',
    center: [24.34574, 66.58751],
    zoom: 8.3,
    bounds: [23.64107, 66.16551, 25.05041, 67.00952],
    municipalityCodes: ['854', '976'],
    dataFile: 'torniolaakso.topojson',
  },
  tunturi_lappi: {
    // Tunturi-Lappi (seutukunta 196, 4 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.tunturi_lappi',
    center: [23.28008, 68.12488],
    zoom: 6.6,
    bounds: [20.55233, 66.93788, 26.00784, 69.31188],
    municipalityCodes: ['047', '261', '273', '498'],
    dataFile: 'tunturi_lappi.topojson',
  },
  vakka_suomi: {
    // Vakka-Suomi (seutukunta 024, 6 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.vakka_suomi',
    center: [21.56572, 60.76482],
    zoom: 8.7,
    bounds: [21.00298, 60.43972, 22.12847, 61.08991],
    municipalityCodes: ['304', '400', '631', '833', '895', '918'],
    dataFile: 'vakka_suomi.topojson',
  },
  varkaus: {
    // Varkaus (seutukunta 114, 3 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.varkaus',
    center: [28.03341, 62.34678],
    zoom: 8.5,
    bounds: [27.40851, 61.98776, 28.6583, 62.70579],
    municipalityCodes: ['171', '420', '915'],
    dataFile: 'varkaus.topojson',
  },
  yla_pirkanmaa: {
    // Ylä-Pirkanmaa (seutukunta 069, 4 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.yla_pirkanmaa',
    center: [23.97437, 62.10494],
    zoom: 8.4,
    bounds: [23.21782, 61.71554, 24.73091, 62.49434],
    municipalityCodes: ['177', '508', '702', '936'],
    dataFile: 'yla_pirkanmaa.topojson',
  },
  yla_savo: {
    // Ylä-Savo (seutukunta 111, 7 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.yla_savo',
    center: [27.11968, 63.5144],
    zoom: 8,
    bounds: [26.07054, 62.99183, 28.16882, 64.03697],
    municipalityCodes: ['140', '239', '263', '402', '595', '762', '925'],
    dataFile: 'yla_savo.topojson',
  },
  ylivieska: {
    // Ylivieska (seutukunta 177, 6 munis). CF-5 Phase D1 scaffold — boundary drawn, no postal-code data yet.
    labelKey: 'city.ylivieska',
    center: [24.38213, 64.02191],
    zoom: 8.2,
    bounds: [23.50408, 63.65089, 25.26018, 64.39294],
    municipalityCodes: ['009', '208', '483', '563', '746', '977'],
    dataFile: 'ylivieska.topojson',
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
