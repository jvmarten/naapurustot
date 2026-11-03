/**
 * Hub pages for Sweden's 71 FA25 regions, in all three languages, at the same
 * /kaupunki/, /en/city/ and /sv/stad/ routes as Finland's seutukunta hubs. Called from
 * prerender-hubs.mjs, which passes its page shell and helpers so the two countries' hubs
 * share one template, one head-integrity check and one stylesheet.
 *
 * Region hubs ONLY (213 pages): no municipality pages, ranking pages, comparison pages or
 * social cards. Each of those is a separate decision about page count and about which
 * Swedish metrics to rank (docs/SWEDEN_EXPANSION.md §18).
 *
 * Every figure is SCB's: the area rows straight from se_deso.geojson, the region figures
 * from region_aggregates.json (computeMetroAverages, the same numbers the map shows for
 * the region). Nothing here is put on a scale with Finland's.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const TEXT = {
  fi: {
    title: (r) => `${r} (Ruotsi) — DeSO-alueet ja tilastot | naapurustot.fi`,
    desc: (r, n) => `${r}, Ruotsi: ${n} DeSO-tilastoaluetta ja niiden tilastot — väkiluku, taloudellinen standardi, työllisyys, asuminen ja palvelut. Lähde: SCB.`,
    lead: (r, n, pop, k) => `${r} on Ruotsin toiminnallinen analyysialue (FA25), johon kuuluu ${k === 1 ? 'yksi kunta' : `${k} kuntaa`}. naapurustot.fi kattaa sen ${n} DeSO-tilastoaluetta, joissa asuu noin ${pop} ihmistä.`,
    summary: (n, pop) => `${n} DeSO-aluetta · noin ${pop} asukasta`,
    country: 'Ruotsi',
    statsHeading: 'Alueen tunnusluvut',
    munisHeading: 'Kunnat',
    areasHeading: 'DeSO-alueet',
    tableCaption: (r) => `${r} — DeSO-alueet väkiluvun mukaan`,
    colArea: 'Alue', colCode: 'DeSO-koodi', colPop: 'Väkiluku', colEcon: 'Taloudellinen standardi (mediaani)',
    mapCta: (r) => `Avaa ${r} kartalla`,
    sources: 'Lähde: Statistiska centralbyrån (SCB), DeSO 2025 -aluejako, CC0. Alueet: Tillväxtverketin toiminnalliset analyysialueet FA25. Määritelmät noudattavat SCB:tä, eikä lukuja verrata Suomen lukuihin samalla asteikolla.',
    footer: 'Tiedot: Statistiska centralbyrån (SCB), Skolverket, OpenStreetMap ja muut avoimet julkiset lähteet.',
    back: '← Kaikki alueet',
    dirHeading: 'Ruotsi',
    dirLead: (n, pop) => `${n} Ruotsin toiminnallista analyysialuetta (FA25), yhteensä noin ${pop} asukasta.`,
    dirCaption: 'Ruotsin alueet',
    colRegion: 'Alue', colAreas: 'DeSO-alueita',
  },
  en: {
    title: (r) => `${r} (Sweden) — DeSO areas & statistics | naapurustot.fi`,
    desc: (r, n) => `${r}, Sweden: ${n} DeSO statistical areas and their statistics — population, economic standard, employment, housing and services. Source: SCB.`,
    lead: (r, n, pop, k) => `${r} is a Swedish functional analysis region (FA25) made up of ${k === 1 ? 'one municipality' : `${k} municipalities`}. naapurustot.fi covers its ${n} DeSO statistical areas, home to about ${pop} people.`,
    summary: (n, pop) => `${n} DeSO areas · about ${pop} residents`,
    country: 'Sweden',
    statsHeading: 'The region in figures',
    munisHeading: 'Municipalities',
    areasHeading: 'DeSO areas',
    tableCaption: (r) => `${r} — DeSO areas by population`,
    colArea: 'Area', colCode: 'DeSO code', colPop: 'Population', colEcon: 'Economic standard (median)',
    mapCta: (r) => `Open ${r} on the map`,
    sources: 'Source: Statistics Sweden (SCB), DeSO 2025 areas, CC0. Regions: Tillväxtverket\'s functional analysis regions FA25. Definitions follow SCB and are never put on one scale with Finland\'s figures.',
    footer: 'Data: Statistics Sweden (SCB), Skolverket, OpenStreetMap and other open public sources.',
    back: '← All areas',
    dirHeading: 'Sweden',
    dirLead: (n, pop) => `${n} Swedish functional analysis regions (FA25), about ${pop} residents in all.`,
    dirCaption: 'Swedish regions',
    colRegion: 'Region', colAreas: 'DeSO areas',
  },
  sv: {
    title: (r) => `${r} (Sverige) — DeSO-områden och statistik | naapurustot.fi`,
    desc: (r, n) => `${r}, Sverige: ${n} DeSO-områden och deras statistik — folkmängd, ekonomisk standard, sysselsättning, boende och service. Källa: SCB.`,
    lead: (r, n, pop, k) => `${r} är en funktionell analysregion (FA25) i Sverige med ${k === 1 ? 'en kommun' : `${k} kommuner`}. naapurustot.fi täcker dess ${n} DeSO-områden, där omkring ${pop} personer bor.`,
    summary: (n, pop) => `${n} DeSO-områden · omkring ${pop} invånare`,
    country: 'Sverige',
    statsHeading: 'Regionen i siffror',
    munisHeading: 'Kommuner',
    areasHeading: 'DeSO-områden',
    tableCaption: (r) => `${r} — DeSO-områden efter folkmängd`,
    colArea: 'Område', colCode: 'DeSO-kod', colPop: 'Folkmängd', colEcon: 'Ekonomisk standard (median)',
    mapCta: (r) => `Öppna ${r} på kartan`,
    sources: 'Källa: Statistiska centralbyrån (SCB), DeSO 2025, CC0. Regioner: Tillväxtverkets funktionella analysregioner FA25. Definitionerna följer SCB och ställs aldrig på samma skala som Finlands siffror.',
    footer: 'Data: Statistiska centralbyrån (SCB), Skolverket, OpenStreetMap och andra öppna offentliga källor.',
    back: '← Alla områden',
    dirHeading: 'Sverige',
    dirLead: (n, pop) => `${n} svenska funktionella analysregioner (FA25), sammanlagt omkring ${pop} invånare.`,
    dirCaption: 'Svenska regioner',
    colRegion: 'Region', colAreas: 'DeSO-områden',
  },
};

/** Region figures shown on the hub: SCB's measures, each formatted as on the map. */
const STATS = [
  { prop: 'economic_standard_median', label: 'layer.economic_standard', fmt: 'sek' },
  { prop: 'unemployment_rate', label: 'layer.unemployment', fmt: 'pct' },
  { prop: 'employment_rate', label: 'layer.employment_rate', fmt: 'pct' },
  { prop: 'higher_education_rate', label: 'layer.education', fmt: 'pct' },
  { prop: 'foreign_background_pct', label: 'layer.foreign_background', fmt: 'pct' },
  { prop: 'elderly_ratio_pct', label: 'layer.elderly_ratio', fmt: 'pct' },
  { prop: 'ownership_rate', label: 'layer.ownership', fmt: 'pct' },
];

/** Sweden's regions from the build input, largest first; [] when it is absent. */
export function loadSeRegions(root) {
  const path = join(root, 'public', 'data', 'se_deso.geojson');
  if (!existsSync(path)) return [];
  const features = JSON.parse(readFileSync(path, 'utf-8')).features;
  const aggregates = JSON.parse(readFileSync(join(root, 'src', 'data', 'region_aggregates.json'), 'utf-8')).regions ?? {};
  const byRegion = new Map();
  for (const f of features) {
    const p = f.properties;
    if (!p?.pno || !p?.nimi || !p?.city) continue;
    if (!byRegion.has(p.city)) byRegion.set(p.city, []);
    byRegion.get(p.city).push(f);
  }
  return [...byRegion.entries()]
    .map(([id, feats]) => {
      let totalPop = 0, lat = 0, lon = 0;
      const munis = new Map();
      for (const f of feats) {
        const p = f.properties;
        if (Number.isFinite(Number(p.he_vakiy))) totalPop += Number(p.he_vakiy);
        lat += p.lat; lon += p.lon;
        if (p.municipality) munis.set(p.municipality, (munis.get(p.municipality) || 0) + 1);
      }
      return {
        id, features: feats, count: feats.length, totalPop, avg: aggregates[id] ?? {},
        center: [lon / feats.length, lat / feats.length],
        munis: [...munis.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'sv')),
      };
    })
    .sort((a, b) => b.totalPop - a.totalPop || a.id.localeCompare(b.id));
}

/** The Swedish section of the /kaupungit/ directory page. */
export function buildSeDirectorySection(seRegions, lang, h) {
  if (!seRegions.length) return '';
  const T = TEXT[lang];
  const pop = seRegions.reduce((s, r) => s + r.totalPop, 0);
  const rows = seRegions.map((r) =>
    `        <tr><td><a href="${h.CITY_PREFIX[lang]}/${h.escapeHtml(r.id)}/">${h.escapeHtml(h.getRegionName(r.id, lang))}</a></td>` +
    `<td class="num">${h.fmtNum(r.count, lang)}</td><td class="num">${h.fmtNum(r.totalPop, lang)}</td></tr>`).join('\n');
  return `      <h2>${h.escapeHtml(T.dirHeading)}</h2>
      <p>${h.escapeHtml(T.dirLead(seRegions.length, h.fmtNum(pop, lang)))}</p>
      <table>
        <caption>${h.escapeHtml(T.dirCaption)}</caption>
        <thead><tr><th scope="col">${h.escapeHtml(T.colRegion)}</th><th scope="col" class="num">${h.escapeHtml(T.colAreas)}</th><th scope="col" class="num">${h.escapeHtml(T.colPop)}</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

/** One Swedish region hub page. `h` carries prerender-hubs.mjs's shell and helpers. */
export function buildSeRegionHub(region, lang, h) {
  const { escapeHtml, fmtNum, getRegionName, toSlug, htmlPage, safeJson, LOCALES, LOCALE_TAG, ORIGIN } = h;
  const T = TEXT[lang];
  const name = getRegionName(region.id, lang);
  const alternates = Object.fromEntries(['fi', 'en', 'sv'].map((l) => [l, h.cityUrl(region.id, l)]));
  const label = (k) => LOCALES[lang]?.[k] || LOCALES.fi[k] || k;
  const num = (v, d) => Number(v).toLocaleString(LOCALE_TAG[lang], { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt = (v, f) => (v == null || !Number.isFinite(Number(v)) ? null : f === 'sek' ? `${fmtNum(v, lang)} kr` : `${num(v, 1)} %`);

  const stats = STATS.map((s) => [label(s.label), fmt(region.avg[s.prop], s.fmt)]).filter(([, v]) => v != null)
    .map(([l, v]) => `        <tr><th scope="row">${escapeHtml(l)}</th><td class="num">${escapeHtml(v)}</td></tr>`).join('\n');
  const munis = region.munis.map(([m, n]) => `${escapeHtml(m)} (${fmtNum(n, lang)})`).join(' · ');
  const rows = [...region.features]
    .sort((a, b) => (Number(b.properties.he_vakiy) || 0) - (Number(a.properties.he_vakiy) || 0) || a.properties.pno.localeCompare(b.properties.pno))
    .map((f) => {
      const p = f.properties;
      const econ = Number(p.economic_standard_median) > 0 ? `${fmtNum(p.economic_standard_median, lang)} kr` : '—';
      const pop = Number.isFinite(Number(p.he_vakiy)) ? fmtNum(p.he_vakiy, lang) : '—';
      return `        <tr><td><a href="${h.AREA_PREFIX[lang]}/${escapeHtml(toSlug(p.pno, p.nimi))}/">${escapeHtml(p.nimi)}</a></td>` +
        `<td>${escapeHtml(p.pno)}</td><td class="num">${pop}</td><td class="num">${econ}</td></tr>`;
    }).join('\n');

  const nameEsc = escapeHtml(name);
  const body = `      <p class="crumbs"><a href="/">naapurustot.fi</a> / <a href="${h.DIRECTORY_PATH[lang]}">${escapeHtml(h.TEXT[lang].dirCrumb)}</a> / ${escapeHtml(T.country)} / ${nameEsc}</p>
      <h1>${nameEsc}</h1>
      <p class="lead">${escapeHtml(T.lead(name, fmtNum(region.count, lang), fmtNum(region.totalPop, lang), region.munis.length))}</p>
      <p class="summary"><span>${escapeHtml(T.summary(fmtNum(region.count, lang), fmtNum(region.totalPop, lang)))}</span></p>
      <p><a class="cta" href="/?city=${escapeHtml(region.id)}">${escapeHtml(T.mapCta(name))}</a></p>
${stats ? `      <h2>${escapeHtml(T.statsHeading)}</h2>
      <table>
        <tbody>
${stats}
        </tbody>
      </table>` : ''}
      <h2>${escapeHtml(T.munisHeading)}</h2>
      <p>${munis}</p>
      <h2>${escapeHtml(T.areasHeading)}</h2>
      <table>
        <caption>${escapeHtml(T.tableCaption(name))}</caption>
        <thead><tr><th scope="col">${escapeHtml(T.colArea)}</th><th scope="col">${escapeHtml(T.colCode)}</th><th scope="col" class="num">${escapeHtml(T.colPop)}</th><th scope="col" class="num">${escapeHtml(T.colEcon)}</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
      <p class="note">${escapeHtml(T.sources)}</p>
      <p><a href="${h.DIRECTORY_PATH[lang]}">${escapeHtml(T.back)}</a></p>`;

  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    description: T.desc(name, region.count),
    url: alternates[lang],
    inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'naapurustot.fi', url: ORIGIN },
    about: {
      '@type': 'Place',
      name,
      address: { '@type': 'PostalAddress', addressCountry: 'SE' },
      geo: { '@type': 'GeoCoordinates', latitude: Math.round(region.center[1] * 1e5) / 1e5, longitude: Math.round(region.center[0] * 1e5) / 1e5 },
    },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: h.TEXT[lang].dirCrumb, item: h.dirUrl(lang) },
      { '@type': 'ListItem', position: 3, name },
    ],
  };
  const jsonLd = [collection, breadcrumb].map((o) => `    <script type="application/ld+json">${safeJson(o)}</script>`).join('\n');

  return htmlPage({
    lang,
    title: T.title(name),
    description: T.desc(name, region.count),
    canonical: alternates[lang],
    alternates,
    jsonLd,
    body,
    footer: T.footer,
    rights: 'Data: Statistics Sweden (SCB), CC0, and other public sources',
  });
}
