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

// Only export metrics that are both registered (provenance) and have a label.
const METRIC_COLUMNS = Object.keys(METRIC_INFO).filter((k) => BUILD_METADATA.metrics[k]);

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
const areaRows = [csvRow([...ID_COLUMNS, ...METRIC_COLUMNS])];
for (const p of PROPS) {
  if (!p.pno) continue;
  const idCells = [p.pno, p.nimi, p.namn ?? '', p.city ?? '', regionName(p.city, 'fi'), regionName(p.city, 'en')];
  const metricCells = METRIC_COLUMNS.map((m) => {
    const v = p[m];
    return v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '' : v;
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
  const info = METRIC_INFO[col] ?? { fi: col, en: col, unit: '' };
  const reg = REGISTRY.metrics[col] ?? {};
  const meta = BUILD_METADATA.metrics[col] ?? {};
  const pub = REGISTRY.publishers[reg.publisher] ?? {};
  return {
    column: col,
    label_fi: info.fi,
    label_en: info.en,
    unit: info.unit,
    source: reg.source ?? '',
    publisher: pub.name ?? reg.publisher ?? '',
    license: pub.license ?? '',
    vintage: reg.vintage ?? '',
    granularity: reg.granularity ?? '',
    is_proxy: Boolean(reg.is_proxy),
    coverage_pct: meta.coverage_pct ?? '',
    row_count: meta.row_count ?? '',
  };
}
const codebook = METRIC_COLUMNS.map(codebookEntry);
const cbCols = ['column', 'label_fi', 'label_en', 'unit', 'source', 'publisher', 'license', 'vintage', 'granularity', 'is_proxy', 'coverage_pct', 'row_count'];
const cbRows = [csvRow(cbCols), ...codebook.map((e) => csvRow(cbCols.map((c) => e[c])))];
writeFileSync(join(DIST, 'avoin-data', 'codebook.csv'), cbRows.join('\n') + '\n');
writeFileSync(join(DIST, 'avoin-data', 'codebook.json'), JSON.stringify({ generated: BUILD_METADATA.generated, columns: codebook }, null, 2) + '\n');

// --- static API: /api/v1/ --------------------------------------------------
mkdirSync(join(DIST, 'api', 'v1', 'areas'), { recursive: true });
const areaIndex = [];
for (const p of PROPS) {
  if (!p.pno) continue;
  const metrics = {};
  for (const col of METRIC_COLUMNS) {
    const v = p[col];
    if (v == null || (typeof v === 'number' && !Number.isFinite(v))) continue;
    const reg = REGISTRY.metrics[col] ?? {};
    metrics[col] = { value: v, source: reg.source, vintage: reg.vintage, granularity: reg.granularity, is_proxy: Boolean(reg.is_proxy) };
  }
  const record = {
    pno: p.pno,
    name: p.nimi,
    name_sv: p.namn ?? null,
    region: { id: p.city ?? null, name_fi: regionName(p.city, 'fi'), name_en: regionName(p.city, 'en') },
    metrics,
  };
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
    intro: `Koko naapurustot.fi-aineisto ladattavissa: ${areaIndex.length} postinumeroaluetta ja ~${METRIC_COLUMNS.length} mittaria, raakanumeroina. Kaikki perustuu avoimeen, todennettavaan julkiseen dataan.`,
    files: 'Tiedostot',
    api: 'JSON-rajapinta (jäädytetty v1-sopimus)',
    license: 'Lisenssit per sarake — ks. koodikirja. Tilastokeskuksen aineisto CC BY 4.0, OpenStreetMap ODbL.',
  },
  en: {
    title: 'Open data — download the full dataset | naapurustot.fi',
    h1: 'Open data',
    intro: `The full naapurustot.fi dataset, downloadable: ${areaIndex.length} postal code areas and ~${METRIC_COLUMNS.length} metrics as raw numerics. Everything is based on open, verifiable public data.`,
    files: 'Files',
    api: 'JSON API (frozen v1 contract)',
    license: 'Per-column licensing — see the codebook. Statistics Finland data CC BY 4.0, OpenStreetMap ODbL.',
  },
  sv: {
    title: 'Öppna data — ladda ner hela datamängden | naapurustot.fi',
    h1: 'Öppna data',
    intro: `Hela naapurustot.fi-datamängden för nedladdning: ${areaIndex.length} postnummerområden och ~${METRIC_COLUMNS.length} mätare som råa siffror. Allt bygger på öppna, verifierbara offentliga data.`,
    files: 'Filer',
    api: 'JSON-API (fryst v1-kontrakt)',
    license: 'Licens per kolumn — se kodboken. Statistikcentralens data CC BY 4.0, OpenStreetMap ODbL.',
  },
};
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
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="robots" content="index, follow" />
    <style>body{font-family:system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1.25rem;line-height:1.6;color:#1a2230}a{color:#005ea8}h1{margin:.2rem 0}h2{margin-top:2rem;font-size:1.15rem}ul{padding-left:1.2rem}code{background:#f1f3f5;padding:.1rem .3rem;border-radius:4px}@media(prefers-color-scheme:dark){body{background:#0f1318;color:#e6e8ec}a{color:#69b4f0}code{background:#252b34}}</style>
  </head>
  <body>
    <p><a href="/">naapurustot.fi</a></p>
    <h1>${esc(L.h1)}</h1>
    <p>${esc(L.intro)}</p>
    <h2>${esc(L.files)}</h2>
    <ul>
      <li><a href="/avoin-data/naapurustot_areas.csv">naapurustot_areas.csv</a> — ${areaIndex.length} × ${METRIC_COLUMNS.length}</li>
      <li><a href="/avoin-data/naapurustot_timeseries.csv">naapurustot_timeseries.csv</a></li>
      <li><a href="/avoin-data/codebook.csv">codebook.csv</a> · <a href="/avoin-data/codebook.json">codebook.json</a></li>
    </ul>
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

console.log(`CF-14 open data: ${areaIndex.length} areas, ${METRIC_COLUMNS.length} metric columns → dist/avoin-data/ + dist/api/v1/ (${areaIndex.length} area JSON files).`);
