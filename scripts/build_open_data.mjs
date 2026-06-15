#!/usr/bin/env node
/**
 * CF-14: open-data program.
 *
 * Emits a one-step-loadable bulk dataset and a frozen static JSON API from the
 * already-built artifacts (region_properties.json, the data-source registry and
 * build_metadata.json) — no network, no bundle cost. Runs in the build:pages
 * chain after the app build.
 *
 *   dist/avoin-data/naapurustot_areas.csv        3,018 rows × ~60 raw metrics
 *   dist/avoin-data/naapurustot_timeseries.csv   long-format history series
 *   dist/avoin-data/codebook.csv + codebook.json column dictionary + provenance
 *   dist/avoin-data/index.html                   trilingual landing page
 *   dist/api/v1/areas/{pno}.json                 per-area record w/ provenance
 *   dist/api/v1/areas.json                       area index
 *   dist/api/v1/metrics.json                     machine-readable codebook
 *
 * The `v1` prefix freezes the public contract; /api/ and /avoin-data/ sit outside
 * the robots.txt /data/ disallow, so both are crawlable.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const ORIGIN = 'https://naapurustot.fi';

const PROPS = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'region_properties.json'), 'utf-8'));
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'data_sources.json'), 'utf-8'));
const BUILD_METADATA = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'build_metadata.json'), 'utf-8'));
// IN-1 planning corpus: { pno: [{ name, kind, ptype, subtype, status, date, url, source }] }.
const PLANNING = JSON.parse(readFileSync(join(ROOT, 'scripts', 'area_planning.json'), 'utf-8'));
const PLANNING_MANIFEST = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'planning_manifest.json'), 'utf-8'));
const LOCALES = {
  fi: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'fi.json'), 'utf-8')),
  en: JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'en.json'), 'utf-8')),
};

const regionName = (city, lang) =>
  (city && (LOCALES[lang]?.[`city.${city}`] || LOCALES.fi[`city.${city}`])) || '';

// Human label + unit per exported metric. Build-only (no bundle); descriptions are
// real translations of the underlying statistic — never fabricated values.
const METRIC_INFO = {
  he_vakiy: { fi: 'Väkiluku', en: 'Population', unit: 'persons' },
  population_density: { fi: 'Väestötiheys', en: 'Population density', unit: '/km²' },
  he_kika: { fi: 'Asukkaiden keski-ikä', en: 'Average age of residents', unit: 'years' },
  child_ratio: { fi: 'Lasten (0–6 v) osuus', en: 'Children (0–6) share', unit: '%' },
  youth_ratio_pct: { fi: 'Nuorten osuus', en: 'Youth share', unit: '%' },
  elderly_ratio_pct: { fi: 'Ikääntyneiden (65+) osuus', en: 'Elderly (65+) share', unit: '%' },
  pensioner_share: { fi: 'Eläkeläisten osuus', en: 'Pensioners share', unit: '%' },
  student_share: { fi: 'Opiskelijoiden osuus', en: 'Students share', unit: '%' },
  foreign_language_pct: { fi: 'Vieraskielisten osuus', en: 'Foreign-language speakers share', unit: '%' },
  gender_ratio: { fi: 'Sukupuolijakauma (naisia/miehiä)', en: 'Gender ratio (women per men)', unit: '' },
  families_with_children_pct: { fi: 'Lapsiperheiden osuus', en: 'Families with children share', unit: '%' },
  single_parent_hh_pct: { fi: 'Yhden vanhemman perheiden osuus', en: 'Single-parent households share', unit: '%' },
  single_person_hh_pct: { fi: 'Yhden hengen talouksien osuus', en: 'Single-person households share', unit: '%' },
  avg_household_size: { fi: 'Asuntokunnan keskikoko', en: 'Average household size', unit: 'persons' },
  hr_mtu: { fi: 'Asukkaiden mediaanitulot', en: 'Median income of residents', unit: '€' },
  hr_ktu: { fi: 'Asukkaiden keskitulot', en: 'Mean income of residents', unit: '€' },
  income_change_pct: { fi: 'Mediaanitulon muutos', en: 'Median income change', unit: '%' },
  unemployment_rate: { fi: 'Työttömyysaste', en: 'Unemployment rate', unit: '%' },
  unemployment_change_pct: { fi: 'Työttömyysasteen muutos', en: 'Unemployment rate change', unit: '%' },
  employment_rate: { fi: 'Työllisyysaste', en: 'Employment rate', unit: '%' },
  higher_education_rate: { fi: 'Korkeakoulutettujen osuus', en: 'Higher education rate', unit: '%' },
  manufacturing_jobs_pct: { fi: 'Teollisuuden työpaikkojen osuus', en: 'Manufacturing jobs share', unit: '%' },
  service_sector_jobs_pct: { fi: 'Palvelualan työpaikkojen osuus', en: 'Service sector jobs share', unit: '%' },
  public_sector_jobs_pct: { fi: 'Julkisen sektorin työpaikkojen osuus', en: 'Public sector jobs share', unit: '%' },
  tech_sector_pct: { fi: 'Teknologia-alan työpaikkojen osuus', en: 'Tech sector jobs share', unit: '%' },
  healthcare_workers_pct: { fi: 'Terveys- ja sosiaalialan työpaikkojen osuus', en: 'Health & social work jobs share', unit: '%' },
  property_price_sqm: { fi: 'Asuntojen neliöhinta', en: 'Property price', unit: '€/m²' },
  property_price_change_pct: { fi: 'Asuntohintojen muutos', en: 'Property price change', unit: '%' },
  rental_price_sqm: { fi: 'Vuokrataso', en: 'Rent level', unit: '€/m²/month' },
  price_to_rent_ratio: { fi: 'Hinta-vuokrasuhde', en: 'Price-to-rent ratio', unit: '' },
  ownership_rate: { fi: 'Omistusasuntojen osuus', en: 'Home ownership rate', unit: '%' },
  rental_rate: { fi: 'Vuokra-asuntojen osuus', en: 'Rental dwellings share', unit: '%' },
  detached_house_share: { fi: 'Omakotitalojen osuus', en: 'Detached houses share', unit: '%' },
  ra_as_kpa: { fi: 'Asuntojen keskipinta-ala', en: 'Average dwelling size', unit: 'm²' },
  avg_construction_year: { fi: 'Rakennusten keskimääräinen rakennusvuosi', en: 'Average building construction year', unit: 'year' },
  new_construction_pct: { fi: 'Uudisrakentamisen osuus', en: 'New construction share', unit: '%' },
  grocery_density: { fi: 'Ruokakauppojen tiheys', en: 'Grocery store density', unit: '/km²' },
  restaurant_density: { fi: 'Ravintoloiden tiheys', en: 'Restaurant density', unit: '/km²' },
  school_density: { fi: 'Koulujen tiheys', en: 'School density', unit: '/km²' },
  school_quality_score: { fi: 'Koulujen laatuindeksi (YTL)', en: 'School quality score (YTL)', unit: '' },
  daycare_density: { fi: 'Päiväkotien tiheys', en: 'Daycare density', unit: '/km²' },
  healthcare_density: { fi: 'Terveyspalvelujen tiheys', en: 'Healthcare facility density', unit: '/km²' },
  sports_facility_density: { fi: 'Liikuntapaikkojen tiheys', en: 'Sports facility density', unit: '/km²' },
  transit_stop_density: { fi: 'Joukkoliikennepysäkkien tiheys', en: 'Transit stop density', unit: '/km²' },
  transit_reachability_score: { fi: 'Joukkoliikenteen saavutettavuus', en: 'Transit reachability score', unit: '' },
  cycling_density: { fi: 'Pyöräilyinfran tiheys', en: 'Cycling infrastructure density', unit: '/km²' },
  ev_charging_density: { fi: 'Sähköauton latauspisteiden tiheys', en: 'EV charging point density', unit: '/km²' },
  walkability_index: { fi: 'Käveltävyysindeksi', en: 'Walkability index', unit: '' },
  broadband_coverage_pct: { fi: 'Laajakaistan kattavuus', en: 'Broadband coverage', unit: '%' },
  crime_index: { fi: 'Rikollisuusindeksi', en: 'Crime index', unit: '/1000' },
  crime_index_change_pct: { fi: 'Rikollisuusindeksin muutos', en: 'Crime index change', unit: '%' },
  traffic_accident_rate: { fi: 'Liikenneonnettomuuksien määrä', en: 'Traffic accident rate', unit: '' },
  air_quality_index: { fi: 'Ilmanlaatuindeksi', en: 'Air quality index', unit: '' },
  noise_pollution: { fi: 'Melutaso', en: 'Noise level', unit: 'dB' },
  tree_canopy_pct: { fi: 'Puuston latvuspeitto', en: 'Tree canopy cover', unit: '%' },
  water_proximity_m: { fi: 'Etäisyys vesistöön', en: 'Distance to water', unit: 'm' },
  light_pollution: { fi: 'Valosaaste (VIIRS-säteily)', en: 'Light pollution (VIIRS radiance)', unit: '' },
  voter_turnout_pct: { fi: 'Äänestysaktiivisuus', en: 'Voter turnout', unit: '%' },
  party_diversity_index: { fi: 'Puoluekannatuksen monimuotoisuus', en: 'Party diversity index', unit: '' },
  population_change_pct: { fi: 'Väestönmuutos', en: 'Population change', unit: '%' },
};

// CF-10: latent Paavo decision columns that CF-13 renders on every profile but
// that the registry-labelled METRIC_INFO filter dropped (the full age pyramid, the
// NACE sector employment breakdown, household income classes, tenure & dwelling
// types, education levels, household composition, …). Build-only (no bundle).
// Each value traces to Statistics Finland's Paavo postal-code open data — these are
// the raw source columns from which the headline metrics above are derived; every
// group summation was verified against region_properties.json. Provenance is kept
// INLINE here (source + vintage + publisher), never added to data_sources.json.
const PAAVO = { source: 'Tilastokeskus (Paavo)', vintage: 2024, publisher: 'tilastokeskus' };
const lat = (fi, en, unit) => ({ fi, en, unit, ...PAAVO });
const LATENT_METRIC_INFO = {
  // Age structure (number of residents per age band)
  he_0_2: lat('0–2-vuotiaat', 'Residents aged 0–2', 'persons'),
  he_3_6: lat('3–6-vuotiaat', 'Residents aged 3–6', 'persons'),
  he_7_12: lat('7–12-vuotiaat', 'Residents aged 7–12', 'persons'),
  he_13_15: lat('13–15-vuotiaat', 'Residents aged 13–15', 'persons'),
  he_16_17: lat('16–17-vuotiaat', 'Residents aged 16–17', 'persons'),
  he_18_19: lat('18–19-vuotiaat', 'Residents aged 18–19', 'persons'),
  he_20_24: lat('20–24-vuotiaat', 'Residents aged 20–24', 'persons'),
  he_25_29: lat('25–29-vuotiaat', 'Residents aged 25–29', 'persons'),
  he_30_34: lat('30–34-vuotiaat', 'Residents aged 30–34', 'persons'),
  he_35_39: lat('35–39-vuotiaat', 'Residents aged 35–39', 'persons'),
  he_40_44: lat('40–44-vuotiaat', 'Residents aged 40–44', 'persons'),
  he_45_49: lat('45–49-vuotiaat', 'Residents aged 45–49', 'persons'),
  he_50_54: lat('50–54-vuotiaat', 'Residents aged 50–54', 'persons'),
  he_55_59: lat('55–59-vuotiaat', 'Residents aged 55–59', 'persons'),
  he_60_64: lat('60–64-vuotiaat', 'Residents aged 60–64', 'persons'),
  he_65_69: lat('65–69-vuotiaat', 'Residents aged 65–69', 'persons'),
  he_70_74: lat('70–74-vuotiaat', 'Residents aged 70–74', 'persons'),
  he_75_79: lat('75–79-vuotiaat', 'Residents aged 75–79', 'persons'),
  he_80_84: lat('80–84-vuotiaat', 'Residents aged 80–84', 'persons'),
  he_85_: lat('85 vuotta täyttäneet', 'Residents aged 85 and over', 'persons'),
  he_miehet: lat('Miehet', 'Men', 'persons'),
  he_naiset: lat('Naiset', 'Women', 'persons'),
  // Education (residents aged 18+ by highest completed level)
  ko_ika18y: lat('18 vuotta täyttäneet yhteensä', 'Residents aged 18 and over (education base)', 'persons'),
  ko_perus: lat('Vain perusasteen suorittaneet', 'Completed basic education only', 'persons'),
  ko_koul: lat('Tutkinnon suorittaneet yhteensä', 'With a post-basic qualification (total)', 'persons'),
  ko_yliop: lat('Ylioppilastutkinnon suorittaneet', 'With matriculation examination', 'persons'),
  ko_ammat: lat('Ammatillisen tutkinnon suorittaneet', 'With a vocational qualification', 'persons'),
  ko_al_kork: lat('Alemman korkeakouluasteen suorittaneet', 'With lower-level tertiary education', 'persons'),
  ko_yl_kork: lat('Ylemmän korkeakouluasteen suorittaneet', 'With higher-level tertiary education', 'persons'),
  // Residents' income (income recipients, income-class mix, aggregate purchasing power)
  hr_tuy: lat('Tulonsaajat (18 v täyttäneet)', 'Income recipients (aged 18+)', 'persons'),
  hr_pi_tul: lat('Alimpaan tuloluokkaan kuuluvat asukkaat', 'Residents in the lowest income category', 'persons'),
  hr_ke_tul: lat('Keskimmäiseen tuloluokkaan kuuluvat asukkaat', 'Residents in the middle income category', 'persons'),
  hr_hy_tul: lat('Ylimpään tuloluokkaan kuuluvat asukkaat', 'Residents in the highest income category', 'persons'),
  hr_ovy: lat('Asukkaiden ostovoimakertymä', 'Aggregate purchasing power of residents', '€'),
  // Main type of activity
  pt_vakiy: lat('Asukkaat (pääasiallinen toiminta)', 'Residents (main-activity table)', 'persons'),
  pt_tyoll: lat('Työlliset', 'Employed', 'persons'),
  pt_tyott: lat('Työttömät', 'Unemployed', 'persons'),
  pt_0_14: lat('0–14-vuotiaat (työvoiman ulkopuolella)', 'Children aged 0–14 (outside labour force)', 'persons'),
  pt_opisk: lat('Opiskelijat', 'Students', 'persons'),
  pt_elakel: lat('Eläkeläiset', 'Pensioners', 'persons'),
  pt_muut: lat('Muut työvoiman ulkopuolella olevat', 'Others outside the labour force', 'persons'),
  // Households (total, size, occupancy, tenure)
  te_taly: lat('Asuntokunnat yhteensä', 'Households, total', 'households'),
  te_takk: lat('Asuntokuntien keskikoko', 'Average household size', 'persons'),
  te_as_valj: lat('Asumisväljyys', 'Floor area per person (occupancy rate)', 'm²/person'),
  te_yks: lat('Yhden hengen asuntokunnat', 'One-person households', 'households'),
  te_omis_as: lat('Omistusasunnoissa asuvat asuntokunnat', 'Owner-occupied households', 'households'),
  te_vuok_as: lat('Vuokra-asunnoissa asuvat asuntokunnat', 'Rented households', 'households'),
  te_muu_as: lat('Muissa asunnoissa asuvat asuntokunnat', 'Other-tenure households', 'households'),
  // Household income (median/mean, income-class mix, aggregate purchasing power)
  tr_mtu: lat('Asuntokuntien mediaanitulot', 'Median household income', '€'),
  tr_ktu: lat('Asuntokuntien keskitulot', 'Mean household income', '€'),
  tr_kuty: lat('Asuntokunnat (tulot)', 'Households (income base)', 'households'),
  tr_pi_tul: lat('Alimpaan tuloluokkaan kuuluvat asuntokunnat', 'Households in the lowest income category', 'households'),
  tr_ke_tul: lat('Keskimmäiseen tuloluokkaan kuuluvat asuntokunnat', 'Households in the middle income category', 'households'),
  tr_hy_tul: lat('Ylimpään tuloluokkaan kuuluvat asuntokunnat', 'Households in the highest income category', 'households'),
  tr_ovy: lat('Asuntokuntien ostovoimakertymä', 'Aggregate purchasing power of households', '€'),
  // Workplaces by industry (NACE sections + aggregates)
  tp_tyopy: lat('Työpaikat yhteensä', 'Workplaces (jobs), total', 'jobs'),
  tp_alku_a: lat('Alkutuotannon työpaikat (A)', 'Primary production jobs (NACE A)', 'jobs'),
  tp_jalo_bf: lat('Jalostuksen työpaikat (B–F)', 'Secondary production jobs (NACE B–F)', 'jobs'),
  tp_palv_gu: lat('Palveluiden työpaikat (G–U)', 'Services jobs (NACE G–U)', 'jobs'),
  tp_a_maat: lat('Maa-, metsä- ja kalatalous (A)', 'Agriculture, forestry & fishing (NACE A)', 'jobs'),
  tp_b_kaiv: lat('Kaivostoiminta (B)', 'Mining & quarrying (NACE B)', 'jobs'),
  tp_c_teol: lat('Teollisuus (C)', 'Manufacturing (NACE C)', 'jobs'),
  tp_d_ener: lat('Energiahuolto (D)', 'Electricity, gas & energy (NACE D)', 'jobs'),
  tp_e_vesi: lat('Vesi- ja jätehuolto (E)', 'Water supply & waste management (NACE E)', 'jobs'),
  tp_f_rake: lat('Rakentaminen (F)', 'Construction (NACE F)', 'jobs'),
  tp_g_kaup: lat('Tukku- ja vähittäiskauppa (G)', 'Wholesale & retail trade (NACE G)', 'jobs'),
  tp_h_kulj: lat('Kuljetus ja varastointi (H)', 'Transportation & storage (NACE H)', 'jobs'),
  tp_i_majo: lat('Majoitus- ja ravitsemistoiminta (I)', 'Accommodation & food service (NACE I)', 'jobs'),
  tp_j_info: lat('Informaatio ja viestintä (J)', 'Information & communication (NACE J)', 'jobs'),
  tp_k_raho: lat('Rahoitus- ja vakuutustoiminta (K)', 'Financial & insurance activities (NACE K)', 'jobs'),
  tp_l_kiin: lat('Kiinteistöalan toiminta (L)', 'Real estate activities (NACE L)', 'jobs'),
  tp_m_erik: lat('Ammatillinen, tieteellinen ja tekninen toiminta (M)', 'Professional, scientific & technical (NACE M)', 'jobs'),
  tp_n_hall: lat('Hallinto- ja tukipalvelutoiminta (N)', 'Administrative & support services (NACE N)', 'jobs'),
  tp_o_julk: lat('Julkinen hallinto ja maanpuolustus (O)', 'Public administration & defence (NACE O)', 'jobs'),
  tp_p_koul: lat('Koulutus (P)', 'Education (NACE P)', 'jobs'),
  tp_q_terv: lat('Terveys- ja sosiaalipalvelut (Q)', 'Human health & social work (NACE Q)', 'jobs'),
  tp_r_taid: lat('Taiteet, viihde ja virkistys (R)', 'Arts, entertainment & recreation (NACE R)', 'jobs'),
  tp_s_muup: lat('Muu palvelutoiminta (S)', 'Other service activities (NACE S)', 'jobs'),
  tp_t_koti: lat('Kotitalouksien toiminta työnantajina (T)', 'Households as employers (NACE T)', 'jobs'),
  tp_u_kans: lat('Kansainvälisten organisaatioiden toiminta (U)', 'Extraterritorial organisations (NACE U)', 'jobs'),
  tp_x_tunt: lat('Toimiala tuntematon (X)', 'Industry unknown (NACE X)', 'jobs'),
  // Buildings and dwellings by type
  ra_raky: lat('Rakennukset yhteensä', 'Buildings, total', 'buildings'),
  ra_asrak: lat('Asuinrakennukset', 'Residential buildings', 'buildings'),
  ra_muut: lat('Muut rakennukset', 'Other (non-residential) buildings', 'buildings'),
  ra_asunn: lat('Asunnot yhteensä', 'Dwellings, total', 'dwellings'),
  ra_kt_as: lat('Kerrostaloasunnot', 'Dwellings in blocks of flats', 'dwellings'),
  ra_pt_as: lat('Pientaloasunnot', 'Dwellings in small houses', 'dwellings'),
  ra_muu_as: lat('Muut asunnot', 'Other dwellings', 'dwellings'),
  ra_ke: lat('Kesämökit', 'Free-time residences (summer cottages)', 'buildings'),
};

// Only export metrics that are both registered (provenance) and have a label.
const METRIC_COLUMNS = Object.keys(METRIC_INFO).filter((k) => BUILD_METADATA.metrics[k]);
// Relax the filter: also export latent Paavo columns that are actually present in
// the data (at least one finite value), even though they carry no registry layer.
const LATENT_COLUMNS = Object.keys(LATENT_METRIC_INFO).filter((k) =>
  PROPS.some((p) => typeof p[k] === 'number' && Number.isFinite(p[k])),
);
const LATENT_SET = new Set(LATENT_COLUMNS);
const EXPORT_COLUMNS = [...METRIC_COLUMNS, ...LATENT_COLUMNS];

// Read one exported value. Returns null for "blank". Latent Paavo columns apply
// the -1 confidentiality guard (Statistics Finland suppresses small cells with a
// negative sentinel) so suppressed values never leak as -1; the headline metrics
// keep legitimate negatives (e.g. income/price change percentages).
function cellValue(p, col) {
  const v = p[col];
  if (v == null) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  if (LATENT_SET.has(col) && typeof v === 'number' && v < 0) return null;
  return v;
}

// Provenance for any exported column: registry first, then the inline Paavo source.
function provenance(col) {
  const reg = REGISTRY.metrics[col] ?? {};
  const li = LATENT_METRIC_INFO[col];
  return {
    source: reg.source ?? li?.source,
    vintage: reg.vintage ?? li?.vintage,
    granularity: reg.granularity ?? (li ? 'postal' : undefined),
    is_proxy: Boolean(reg.is_proxy),
  };
}

// Long-format history series → their representative metric column.
const HISTORY_SERIES = [
  { key: 'population_history', metric: 'he_vakiy' },
  { key: 'income_history', metric: 'hr_mtu' },
  { key: 'unemployment_history', metric: 'unemployment_rate' },
  { key: 'property_price_history', metric: 'property_price_sqm' },
  { key: 'crime_index_history', metric: 'crime_index' },
];

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvRow = (cells) => cells.map(csvCell).join(',');

mkdirSync(join(DIST, 'avoin-data'), { recursive: true });

// --- areas.csv -------------------------------------------------------------
const ID_COLUMNS = ['pno', 'nimi', 'namn', 'region_id', 'region_fi', 'region_en'];
const areaRows = [csvRow([...ID_COLUMNS, ...EXPORT_COLUMNS])];
for (const p of PROPS) {
  if (!p.pno) continue;
  const idCells = [p.pno, p.nimi, p.namn ?? '', p.city ?? '', regionName(p.city, 'fi'), regionName(p.city, 'en')];
  const metricCells = EXPORT_COLUMNS.map((m) => {
    const v = cellValue(p, m);
    return v == null ? '' : v;
  });
  areaRows.push(csvRow([...idCells, ...metricCells]));
}
writeFileSync(join(DIST, 'avoin-data', 'naapurustot_areas.csv'), areaRows.join('\n') + '\n');

// --- timeseries.csv --------------------------------------------------------
const tsRows = [csvRow(['pno', 'metric', 'year', 'value'])];
for (const p of PROPS) {
  if (!p.pno) continue;
  for (const { key, metric } of HISTORY_SERIES) {
    const series = p[key];
    if (!Array.isArray(series)) continue;
    for (const point of series) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const [year, value] = point;
      if (value == null || !Number.isFinite(Number(value))) continue;
      tsRows.push(csvRow([p.pno, metric, year, value]));
    }
  }
}
writeFileSync(join(DIST, 'avoin-data', 'naapurustot_timeseries.csv'), tsRows.join('\n') + '\n');

// --- codebook (csv + json) -------------------------------------------------
function codebookEntry(col) {
  const info = METRIC_INFO[col] ?? LATENT_METRIC_INFO[col] ?? { fi: col, en: col, unit: '' };
  const reg = REGISTRY.metrics[col] ?? {};
  const li = LATENT_METRIC_INFO[col];
  const meta = BUILD_METADATA.metrics[col] ?? {};
  const publisherId = reg.publisher ?? li?.publisher;
  const pub = REGISTRY.publishers[publisherId] ?? {};
  return {
    column: col,
    label_fi: info.fi,
    label_en: info.en,
    unit: info.unit,
    source: reg.source ?? li?.source ?? '',
    publisher: pub.name ?? publisherId ?? '',
    license: pub.license ?? '',
    vintage: reg.vintage ?? li?.vintage ?? '',
    granularity: reg.granularity ?? (li ? 'postal' : ''),
    is_proxy: Boolean(reg.is_proxy),
    coverage_pct: meta.coverage_pct ?? '',
    row_count: meta.row_count ?? '',
  };
}
// Planning CSV (naapurustot_kaavat_hankkeet.csv) column dictionary. Real geometry,
// so is_proxy=false; provenance kept inline (Väylävirasto national + city zoning).
const PLANNING_VINTAGE = String(PLANNING_MANIFEST.snapshot ?? '').slice(0, 4) || '2026';
const PLANNING_SOURCE = 'Väylävirasto; Helsinki, Tampere, Turku, Vantaa, Jyväskylä (asemakaavoitus)';
const planCb = (column, fi, en) => ({
  column, label_fi: fi, label_en: en, unit: '',
  source: PLANNING_SOURCE, publisher: 'Väylävirasto / kunnat', license: 'CC BY 4.0',
  vintage: PLANNING_VINTAGE, granularity: 'plan/project geometry', is_proxy: false,
  coverage_pct: '', row_count: '',
});
const PLANNING_CODEBOOK = [
  planCb('pno', 'Postinumeroalue', 'Postal-code area'),
  planCb('region', 'Seutukunta (tunniste)', 'Sub-region (id)'),
  planCb('type', 'Tyyppi (rail/road/zoning)', 'Type (rail/road/zoning)'),
  planCb('status', 'Tila (kaynnissa/vireilla/hyvaksytty)', 'Status (in progress / pending / approved)'),
  planCb('name', 'Kaavan tai hankkeen nimi', 'Plan or project name'),
  planCb('date', 'Ajankohta', 'Date or period'),
  planCb('source_url', 'Lähde-URL', 'Source URL'),
  planCb('is_proxy', 'Proxy-lippu (aina false)', 'Proxy flag (always false)'),
];
const codebook = [...EXPORT_COLUMNS.map(codebookEntry), ...PLANNING_CODEBOOK];
const cbCols = ['column', 'label_fi', 'label_en', 'unit', 'source', 'publisher', 'license', 'vintage', 'granularity', 'is_proxy', 'coverage_pct', 'row_count'];
const cbRows = [csvRow(cbCols), ...codebook.map((e) => csvRow(cbCols.map((c) => e[c])))];
writeFileSync(join(DIST, 'avoin-data', 'codebook.csv'), cbRows.join('\n') + '\n');
writeFileSync(join(DIST, 'avoin-data', 'codebook.json'), JSON.stringify({ generated: BUILD_METADATA.generated, columns: codebook }, null, 2) + '\n');

// --- planning CSV (kaavat ja hankkeet, long format) ------------------------
const cityByPno = new Map(PROPS.map((p) => [p.pno, p.city ?? '']));
const planCsvRows = [csvRow(['pno', 'region', 'type', 'status', 'name', 'date', 'source_url', 'is_proxy'])];
let planningRowCount = 0;
for (const pno of Object.keys(PLANNING).sort()) {
  const region = cityByPno.get(pno) ?? '';
  for (const e of PLANNING[pno]) {
    planCsvRows.push(csvRow([pno, region, e.ptype, e.status, e.name, e.date, e.url, 'false']));
    planningRowCount++;
  }
}
writeFileSync(join(DIST, 'avoin-data', 'naapurustot_kaavat_hankkeet.csv'), planCsvRows.join('\n') + '\n');

// --- static API: /api/v1/ --------------------------------------------------
mkdirSync(join(DIST, 'api', 'v1', 'areas'), { recursive: true });
const areaIndex = [];
for (const p of PROPS) {
  if (!p.pno) continue;
  const metrics = {};
  for (const col of EXPORT_COLUMNS) {
    const v = cellValue(p, col);
    if (v == null) continue;
    metrics[col] = { value: v, ...provenance(col) };
  }
  const record = {
    pno: p.pno,
    name: p.nimi,
    name_sv: p.namn ?? null,
    region: { id: p.city ?? null, name_fi: regionName(p.city, 'fi'), name_en: regionName(p.city, 'en') },
    metrics,
  };
  const planning = PLANNING[p.pno];
  if (Array.isArray(planning) && planning.length) {
    record.planning = planning.map((e) => ({
      name: e.name,
      kind: e.kind,
      type: e.ptype,
      category: e.subtype,
      status: e.status,
      date: e.date,
      url: e.url,
      source: e.source,
    }));
  }
  writeFileSync(join(DIST, 'api', 'v1', 'areas', `${p.pno}.json`), JSON.stringify(record));
  areaIndex.push({ pno: p.pno, name: p.nimi, region: p.city ?? null, url: `${ORIGIN}/api/v1/areas/${p.pno}.json` });
}
writeFileSync(join(DIST, 'api', 'v1', 'areas.json'), JSON.stringify({ generated: BUILD_METADATA.generated, count: areaIndex.length, areas: areaIndex }));
writeFileSync(join(DIST, 'api', 'v1', 'metrics.json'), JSON.stringify({ generated: BUILD_METADATA.generated, license: 'See per-column license', columns: codebook }, null, 2) + '\n');

// --- trilingual landing page ----------------------------------------------
const PAGE = {
  fi: {
    title: 'Avoin data — lataa koko aineisto | naapurustot.fi',
    h1: 'Avoin data',
    intro: `Koko naapurustot.fi-aineisto ladattavissa: ${areaIndex.length} postinumeroaluetta ja ${EXPORT_COLUMNS.length} muuttujaa raakanumeroina (mm. koko ikäpyramidi, toimialoittaiset työpaikat, tulonsaaja- ja tuloluokkajakaumat, asuntokuntien hallintamuoto ja koulutustasot). Kaikki perustuu avoimeen, todennettavaan julkiseen dataan.`,
    files: 'Tiedostot',
    api: 'JSON-rajapinta (jäädytetty v1-sopimus)',
    planning: 'Kaavat ja hankkeet',
    planning_desc: `Asemakaavat ja infrahankkeet pitkässä muodossa: ${planningRowCount} riviä ${Object.keys(PLANNING).length} postinumeroalueelta. Väyläviraston rata- ja tiehankkeet kattavat koko maan; asemakaavat ovat toistaiseksi viidestä kaupungista (Helsinki, Tampere, Turku, Vantaa, Jyväskylä). Valtakunnallinen kaava-aineisto laajenee Ryhti-järjestelmän myötä noin 2029.`,
    license: 'Lisenssit per sarake — ks. koodikirja. Tilastokeskuksen aineisto CC BY 4.0, OpenStreetMap ODbL.',
  },
  en: {
    title: 'Open data — download the full dataset | naapurustot.fi',
    h1: 'Open data',
    intro: `The full naapurustot.fi dataset, downloadable: ${areaIndex.length} postal code areas and ${EXPORT_COLUMNS.length} variables as raw numerics (incl. the full age pyramid, jobs by industry, income-recipient and income-class breakdowns, household tenure and education levels). Everything is based on open, verifiable public data.`,
    files: 'Files',
    api: 'JSON API (frozen v1 contract)',
    planning: 'Plans and infrastructure projects',
    planning_desc: `Local detailed plans and infrastructure projects in long format: ${planningRowCount} rows across ${Object.keys(PLANNING).length} postal-code areas. Väylävirasto rail and road projects are nationwide; detailed plans currently cover five cities (Helsinki, Tampere, Turku, Vantaa, Jyväskylä). National zoning coverage expands via the Ryhti system around 2029.`,
    license: 'Per-column licensing — see the codebook. Statistics Finland data CC BY 4.0, OpenStreetMap ODbL.',
  },
  sv: {
    title: 'Öppna data — ladda ner hela datamängden | naapurustot.fi',
    h1: 'Öppna data',
    intro: `Hela naapurustot.fi-datamängden för nedladdning: ${areaIndex.length} postnummerområden och ${EXPORT_COLUMNS.length} variabler som råa siffror. Allt bygger på öppna, verifierbara offentliga data.`,
    files: 'Filer',
    api: 'JSON-API (fryst v1-kontrakt)',
    planning: 'Planer och infrastrukturprojekt',
    planning_desc: `Detaljplaner och infrastrukturprojekt i långt format: ${planningRowCount} rader. Trafikledsverkets projekt täcker hela landet; detaljplaner finns tills vidare för fem städer.`,
    license: 'Licens per kolumn — se kodboken. Statistikcentralens data CC BY 4.0, OpenStreetMap ODbL.',
  },
};

// schema.org Dataset JSON-LD so the corpus is eligible for Google Dataset Search.
// DataDownload distributions cover every CSV plus the frozen JSON API.
const buildYear = String(BUILD_METADATA.generated ?? '').slice(0, 4) || '2026';
const dl = (name, encodingFormat, path) => ({ '@type': 'DataDownload', name, encodingFormat, contentUrl: `${ORIGIN}${path}` });
const datasetLd = {
  '@context': 'https://schema.org',
  '@type': 'Dataset',
  name: 'naapurustot.fi — Suomen postinumeroalueiden avoin data',
  alternateName: 'naapurustot.fi open data corpus',
  description: `Koko naapurustot.fi-aineisto koneluettavassa muodossa: ${areaIndex.length} postinumeroaluetta ja ${EXPORT_COLUMNS.length} muuttujaa (väestö ja ikärakenne, tulot ja tuloluokat, koulutus, työpaikat toimialoittain, asuminen ja asuntokunnat, palvelut, turvallisuus, liikenne ja ympäristö), aikasarjat sekä kaavat ja infrahankkeet. Perustuu avoimeen, todennettavaan julkiseen dataan (Tilastokeskus Paavo, OpenStreetMap, Väylävirasto ym.).`,
  url: `${ORIGIN}/avoin-data/`,
  sameAs: `${ORIGIN}/avoin-data/`,
  license: 'https://creativecommons.org/licenses/by/4.0/',
  isAccessibleForFree: true,
  creator: { '@type': 'Organization', name: 'naapurustot.fi', url: ORIGIN },
  publisher: { '@type': 'Organization', name: 'naapurustot.fi', url: ORIGIN },
  inLanguage: ['fi', 'en', 'sv'],
  keywords: ['postinumeroalue', 'Suomi', 'Finland', 'Paavo', 'Tilastokeskus', 'väestö', 'tulot', 'asuminen', 'työpaikat', 'kaavoitus', 'infrahankkeet', 'open data', 'neighbourhood statistics'],
  spatialCoverage: { '@type': 'Place', name: 'Finland', geo: { '@type': 'GeoShape', box: '59.5 19.1 70.1 31.6' } },
  temporalCoverage: `2020/${buildYear}`,
  dateModified: String(BUILD_METADATA.generated ?? '').slice(0, 10) || buildYear,
  distribution: [
    dl('naapurustot_areas.csv', 'text/csv', '/avoin-data/naapurustot_areas.csv'),
    dl('naapurustot_timeseries.csv', 'text/csv', '/avoin-data/naapurustot_timeseries.csv'),
    dl('naapurustot_kaavat_hankkeet.csv', 'text/csv', '/avoin-data/naapurustot_kaavat_hankkeet.csv'),
    dl('codebook.csv', 'text/csv', '/avoin-data/codebook.csv'),
    dl('codebook.json', 'application/json', '/avoin-data/codebook.json'),
    dl('API v1 — areas index', 'application/json', '/api/v1/areas.json'),
    dl('API v1 — metrics codebook', 'application/json', '/api/v1/metrics.json'),
  ],
};
// Escape "<" to keep the JSON-LD safe inside <script> and valid JSON.
const datasetLdJson = JSON.stringify(datasetLd).replace(/</g, '\\u003c');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const L = PAGE.fi;
const landing = `<!doctype html>
<html lang="fi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(L.title)}</title>
    <meta name="description" content="${esc(L.intro)}" />
    <link rel="canonical" href="${ORIGIN}/avoin-data/" />
    <link rel="alternate" type="application/atom+xml" title="naapurustot.fi data updates" href="${ORIGIN}/data-updates.atom" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="robots" content="index, follow" />
    <script type="application/ld+json">${datasetLdJson}</script>
    <style>body{font-family:system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1.25rem;line-height:1.6;color:#1a2230}a{color:#005ea8}h1{margin:.2rem 0}h2{margin-top:2rem;font-size:1.15rem}ul{padding-left:1.2rem}code{background:#f1f3f5;padding:.1rem .3rem;border-radius:4px}@media(prefers-color-scheme:dark){body{background:#0f1318;color:#e6e8ec}a{color:#69b4f0}code{background:#252b34}}</style>
  </head>
  <body>
    <p><a href="/">naapurustot.fi</a></p>
    <h1>${esc(L.h1)}</h1>
    <p>${esc(L.intro)}</p>
    <h2>${esc(L.files)}</h2>
    <ul>
      <li><a href="/avoin-data/naapurustot_areas.csv">naapurustot_areas.csv</a> — ${areaIndex.length} × ${EXPORT_COLUMNS.length}</li>
      <li><a href="/avoin-data/naapurustot_timeseries.csv">naapurustot_timeseries.csv</a></li>
      <li><a href="/avoin-data/naapurustot_kaavat_hankkeet.csv">naapurustot_kaavat_hankkeet.csv</a> — ${planningRowCount}</li>
      <li><a href="/avoin-data/codebook.csv">codebook.csv</a> · <a href="/avoin-data/codebook.json">codebook.json</a></li>
    </ul>
    <h2>${esc(L.planning)}</h2>
    <p>${esc(L.planning_desc)}</p>
    <h2>${esc(L.api)}</h2>
    <ul>
      <li><code><a href="/api/v1/areas.json">/api/v1/areas.json</a></code></li>
      <li><code>/api/v1/areas/{postal_code}.json</code></li>
      <li><code><a href="/api/v1/metrics.json">/api/v1/metrics.json</a></code></li>
    </ul>
    <p>${esc(L.license)}</p>
  </body>
</html>
`;
writeFileSync(join(DIST, 'avoin-data', 'index.html'), landing);

console.log(`CF-14 open data: ${areaIndex.length} areas, ${METRIC_COLUMNS.length}+${LATENT_COLUMNS.length} (registry+latent) metric columns, ${planningRowCount} planning rows → dist/avoin-data/ + dist/api/v1/ (${areaIndex.length} area JSON files).`);
