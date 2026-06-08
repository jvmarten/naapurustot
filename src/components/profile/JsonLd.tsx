import React from 'react';
import type { NeighborhoodProperties } from '../../utils/metrics';
import { t, type Lang } from '../../utils/i18n';
import {
  computeNeighbourhoodPercentiles,
  type HasProperties,
  type NeighbourhoodPercentiles,
} from '../../utils/percentileRanks';

interface JsonLdProps {
  properties: NeighborhoodProperties;
  center: [number, number];
  url: string;
  /** Active route language; defaults to Finnish so existing callers are unaffected. */
  lang?: Lang;
  /**
   * CF-11: the national cohort (every loaded area) and this area's regional
   * cohort, used to derive verifiable "top X%" percentiles for the FAQ and the
   * additionalProperty list. Both are optional and additive: when omitted (the
   * default, and the unit-test path) the component emits only the Place +
   * BreadcrumbList nodes exactly as before. When supplied, it additionally emits
   * a FAQPage node and percentile PropertyValues that mirror the prerendered
   * HTML (scripts/prerender.mjs), keeping hydrated and static markup in sync.
   */
  nationalFeatures?: ReadonlyArray<HasProperties | Record<string, unknown>>;
  regionFeatures?: ReadonlyArray<HasProperties | Record<string, unknown>>;
}

/** Localized FAQ/percentile copy, mirroring TEXT in scripts/prerender.mjs. */
const FAQ_TEXT: Record<Lang, {
  faqPopQ: (n: string) => string;
  faqPopA: (n: string, v: string) => string;
  faqIncQ: (n: string) => string;
  faqIncA: (n: string, v: string) => string;
  faqRankQ: (n: string) => string;
  faqRankA: (n: string, top: number, regTop: number | null, region: string) => string;
  faqIncRankQ: (n: string) => string;
  faqIncRankA: (n: string, top: number, regTop: number | null, region: string) => string;
  faqTransitRankQ: (n: string) => string;
  faqTransitRankA: (n: string, top: number, regTop: number | null, region: string) => string;
  faqCrimeRankQ: (n: string) => string;
  faqCrimeRankA: (n: string, top: number, regTop: number | null, region: string) => string;
  faqAirRankQ: (n: string) => string;
  faqAirRankA: (n: string, top: number, regTop: number | null, region: string) => string;
  faqTreeRankQ: (n: string) => string;
  faqTreeRankA: (n: string, top: number, regTop: number | null, region: string) => string;
  faqEduRankQ: (n: string) => string;
  faqEduRankA: (n: string, top: number, regTop: number | null, region: string) => string;
  faqEmpRankQ: (n: string) => string;
  faqEmpRankA: (n: string, top: number, regTop: number | null, region: string) => string;
}> = {
  fi: {
    faqPopQ: (n) => `Mikä on ${n} väkiluku?`,
    faqPopA: (n, v) => `${n} väkiluku on noin ${v} asukasta.`,
    faqIncQ: (n) => `Mikä on mediaanitulo alueella ${n}?`,
    faqIncA: (n, v) => `Mediaanitulo alueella ${n} on noin ${v} € vuodessa.`,
    faqRankQ: (n) => `Miten ${n} sijoittuu laatuindeksissä?`,
    faqRankA: (n, top, regTop, region) =>
      `${n} kuuluu laatuindeksissä koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqIncRankQ: (n) => `Kuinka korkeat tulot alueella ${n} on?`,
    faqIncRankA: (n, top, regTop, region) =>
      `${n} kuuluu mediaanituloltaan koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqTransitRankQ: (n) => `Miten hyvin ${n} on joukkoliikenteen saavutettavissa?`,
    faqTransitRankA: (n, top, regTop, region) =>
      `${n} kuuluu joukkoliikenteen saavutettavuudessa koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqCrimeRankQ: (n) => `Kuinka turvallinen ${n} on?`,
    faqCrimeRankA: (n, top, regTop, region) =>
      `${n} kuuluu turvallisuudessa koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqAirRankQ: (n) => `Millainen ilmanlaatu alueella ${n} on?`,
    faqAirRankA: (n, top, regTop, region) =>
      `${n} kuuluu ilmanlaadultaan koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqTreeRankQ: (n) => `Kuinka vehreä ${n} on?`,
    faqTreeRankA: (n, top, regTop, region) =>
      `${n} kuuluu puuston latvuspeitossa koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqEduRankQ: (n) => `Kuinka korkeasti koulutettuja ${n} asukkaat ovat?`,
    faqEduRankA: (n, top, regTop, region) =>
      `${n} kuuluu korkeakoulutusasteessa koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
    faqEmpRankQ: (n) => `Kuinka korkea työllisyysaste alueella ${n} on?`,
    faqEmpRankA: (n, top, regTop, region) =>
      `${n} kuuluu työllisyysasteessa koko maan parhaaseen ${top} %:iin` +
      `${regTop != null && region ? ` ja seutukunnan ${region} parhaaseen ${regTop} %:iin` : ''}.`,
  },
  en: {
    faqPopQ: (n) => `What is the population of ${n}?`,
    faqPopA: (n, v) => `${n} has a population of about ${v}.`,
    faqIncQ: (n) => `What is the median income in ${n}?`,
    faqIncA: (n, v) => `The median income in ${n} is about €${v} per year.`,
    faqRankQ: (n) => `How does ${n} rank for quality of life?`,
    faqRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for quality of life` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqIncRankQ: (n) => `How high are incomes in ${n}?`,
    faqIncRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for median income` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqTransitRankQ: (n) => `How well is ${n} served by public transport?`,
    faqTransitRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for public-transport access` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqCrimeRankQ: (n) => `How safe is ${n}?`,
    faqCrimeRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for safety` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqAirRankQ: (n) => `What is the air quality in ${n}?`,
    faqAirRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for air quality` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqTreeRankQ: (n) => `How green is ${n}?`,
    faqTreeRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for tree canopy cover` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqEduRankQ: (n) => `How highly educated are residents of ${n}?`,
    faqEduRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for higher education` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
    faqEmpRankQ: (n) => `How high is the employment rate in ${n}?`,
    faqEmpRankA: (n, top, regTop, region) =>
      `${n} ranks in the top ${top}% nationally for employment rate` +
      `${regTop != null && region ? ` and in the top ${regTop}% within the ${region} sub-region` : ''}.`,
  },
  sv: {
    faqPopQ: (n) => `Vad är folkmängden i ${n}?`,
    faqPopA: (n, v) => `${n} har en folkmängd på cirka ${v}.`,
    faqIncQ: (n) => `Vad är medianinkomsten i ${n}?`,
    faqIncA: (n, v) => `Medianinkomsten i ${n} är cirka ${v} € per år.`,
    faqRankQ: (n) => `Hur placerar sig ${n} i kvalitetsindexet?`,
    faqRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i kvalitetsindexet` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqIncRankQ: (n) => `Hur höga är inkomsterna i ${n}?`,
    faqIncRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i medianinkomst` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqTransitRankQ: (n) => `Hur väl betjänas ${n} av kollektivtrafik?`,
    faqTransitRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i kollektivtrafikens tillgänglighet` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqCrimeRankQ: (n) => `Hur säkert är ${n}?`,
    faqCrimeRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i säkerhet` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqAirRankQ: (n) => `Hur är luftkvaliteten i ${n}?`,
    faqAirRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i luftkvalitet` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqTreeRankQ: (n) => `Hur grönt är ${n}?`,
    faqTreeRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i krontäckning` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqEduRankQ: (n) => `Hur högutbildade är invånarna i ${n}?`,
    faqEduRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i högre utbildning` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
    faqEmpRankQ: (n) => `Hur hög är sysselsättningsgraden i ${n}?`,
    faqEmpRankA: (n, top, regTop, region) =>
      `${n} hör till de bästa ${top} % i landet i sysselsättningsgrad` +
      `${regTop != null && region ? ` och till de bästa ${regTop} % i regionen ${region}` : ''}.`,
  },
};

/** Locale-aware integer formatting, matching the prerenderer's fmtNum. */
const LOCALE_TAG: Record<Lang, string> = { fi: 'fi-FI', en: 'en-US', sv: 'sv-SE' };
function fmtInt(n: number, lang: Lang): string {
  return Math.round(n).toLocaleString(LOCALE_TAG[lang], { maximumFractionDigits: 0 });
}

interface QA { q: string; a: string }

/**
 * CF-11: templated Q&A from this area's real values, mirroring buildFaq() in
 * scripts/prerender.mjs so the client FAQPage matches the prerendered one.
 * Ranking answers require the supplied cohorts; the population/income facts do
 * not, but the whole FAQ block is gated on cohorts being present so default
 * callers keep emitting only Place + BreadcrumbList.
 */
function buildFaq(
  properties: NeighborhoodProperties,
  name: string,
  region: string,
  lang: Lang,
  pct: NeighbourhoodPercentiles,
): QA[] {
  const T = FAQ_TEXT[lang];
  const qa: QA[] = [];
  const pop = Number(properties.he_vakiy);
  if (Number.isFinite(pop)) qa.push({ q: T.faqPopQ(name), a: T.faqPopA(name, fmtInt(pop, lang)) });
  const inc = Number(properties.hr_mtu);
  if (Number.isFinite(inc) && inc > 0) qa.push({ q: T.faqIncQ(name), a: T.faqIncA(name, fmtInt(inc, lang)) });
  if (pct.quality.nationalTop != null) {
    qa.push({ q: T.faqRankQ(name), a: T.faqRankA(name, pct.quality.nationalTop, pct.quality.regionalTop, region) });
  }
  if (pct.income.nationalTop != null) {
    qa.push({ q: T.faqIncRankQ(name), a: T.faqIncRankA(name, pct.income.nationalTop, pct.income.regionalTop, region) });
  }
  if (pct.transit.nationalTop != null) {
    qa.push({ q: T.faqTransitRankQ(name), a: T.faqTransitRankA(name, pct.transit.nationalTop, pct.transit.regionalTop, region) });
  }
  // CF-8: broaden the verifiable superlatives — crime/safety, air quality, tree
  // canopy, higher education and employment, each ranked from its own direction.
  if (pct.crime.nationalTop != null) {
    qa.push({ q: T.faqCrimeRankQ(name), a: T.faqCrimeRankA(name, pct.crime.nationalTop, pct.crime.regionalTop, region) });
  }
  if (pct.air.nationalTop != null) {
    qa.push({ q: T.faqAirRankQ(name), a: T.faqAirRankA(name, pct.air.nationalTop, pct.air.regionalTop, region) });
  }
  if (pct.treeCanopy.nationalTop != null) {
    qa.push({ q: T.faqTreeRankQ(name), a: T.faqTreeRankA(name, pct.treeCanopy.nationalTop, pct.treeCanopy.regionalTop, region) });
  }
  if (pct.education.nationalTop != null) {
    qa.push({ q: T.faqEduRankQ(name), a: T.faqEduRankA(name, pct.education.nationalTop, pct.education.regionalTop, region) });
  }
  if (pct.employment.nationalTop != null) {
    qa.push({ q: T.faqEmpRankQ(name), a: T.faqEmpRankA(name, pct.employment.nationalTop, pct.employment.regionalTop, region) });
  }
  return qa;
}

export const JsonLd: React.FC<JsonLdProps> = ({
  properties,
  center,
  url,
  lang = 'fi',
  nationalFeatures,
  regionFeatures,
}) => {
  const cityName = properties.city ? t(`city.${properties.city}`) : 'Finland';
  // Mirror the page's display-name rule and the prerenderer's getDisplayName so the
  // client-rendered JSON-LD matches the visible <h1> and the static prerendered markup
  // (previously it always emitted the Finnish name, diverging on the /sv/ route).
  const displayName = lang === 'sv' && properties.namn ? properties.namn : properties.nimi;

  // CF-11: derive national + regional percentiles only when the cohorts are
  // supplied. Without them we cannot rank against a real distribution, so we
  // fall back to the legacy behaviour (Place + BreadcrumbList, quality_index as
  // a raw 0–100 score) and skip the FAQPage and percentile properties entirely.
  const hasCohorts = !!nationalFeatures && nationalFeatures.length > 0;
  const pct: NeighbourhoodPercentiles | null = hasCohorts
    ? computeNeighbourhoodPercentiles(
        properties as unknown as Record<string, unknown>,
        nationalFeatures as Array<HasProperties | Record<string, unknown>>,
        (regionFeatures ?? nationalFeatures) as Array<HasProperties | Record<string, unknown>>,
      )
    : null;

  const additionalProperty: Array<Record<string, unknown>> = [];
  if (properties.quality_index != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'Quality Index',
      value: Math.round(properties.quality_index),
      maxValue: 100,
    });
  }
  // CF-11: verifiable national + within-region "top X%" superlatives, matching
  // the prerenderer's additionalProperty names exactly.
  if (pct) {
    const pctProps: Array<[string, number | null]> = [
      ['qualityIndexTopPercentileNational', pct.quality.nationalTop],
      ['qualityIndexTopPercentileRegional', pct.quality.regionalTop],
      ['medianIncomeTopPercentileNational', pct.income.nationalTop],
      ['medianIncomeTopPercentileRegional', pct.income.regionalTop],
      ['transitReachabilityTopPercentileNational', pct.transit.nationalTop],
      ['transitReachabilityTopPercentileRegional', pct.transit.regionalTop],
      // CF-8: additional verifiable superlatives (crime/safety, air, tree canopy,
      // higher education, employment), national + within-region.
      ['safetyTopPercentileNational', pct.crime.nationalTop],
      ['safetyTopPercentileRegional', pct.crime.regionalTop],
      ['airQualityTopPercentileNational', pct.air.nationalTop],
      ['airQualityTopPercentileRegional', pct.air.regionalTop],
      ['treeCanopyTopPercentileNational', pct.treeCanopy.nationalTop],
      ['treeCanopyTopPercentileRegional', pct.treeCanopy.regionalTop],
      ['higherEducationTopPercentileNational', pct.education.nationalTop],
      ['higherEducationTopPercentileRegional', pct.education.regionalTop],
      ['employmentRateTopPercentileNational', pct.employment.nationalTop],
      ['employmentRateTopPercentileRegional', pct.employment.regionalTop],
    ];
    for (const [name, value] of pctProps) {
      if (value != null) additionalProperty.push({ '@type': 'PropertyValue', name, value });
    }
  }

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: displayName,
    description: `${displayName} (${properties.pno}) – ${cityName}`,
    url,
    address: {
      '@type': 'PostalAddress',
      postalCode: properties.pno,
      addressLocality: cityName,
      addressCountry: 'FI',
    },
    // Only advertise coordinates when they are real. A null-geometry feature
    // (prerendered fast path, or a failed region-geometry fetch) yields [0,0] —
    // a point in the Gulf of Guinea — so omit the geo block rather than emit it.
    ...(Number.isFinite(center[0]) && Number.isFinite(center[1]) && (center[0] !== 0 || center[1] !== 0) && {
      geo: {
        '@type': 'GeoCoordinates',
        latitude: center[1],
        longitude: center[0],
      },
    }),
    ...(additionalProperty.length > 0 && { additionalProperty }),
    isPartOf: {
      '@type': 'WebSite',
      url: 'https://naapurustot.fi',
    },
  };

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'naapurustot.fi', item: 'https://naapurustot.fi' },
      { '@type': 'ListItem', position: 2, name: cityName, item: `https://naapurustot.fi/?city=${properties.city ?? 'helsinki_metro'}` },
      { '@type': 'ListItem', position: 3, name: displayName },
    ],
  };

  // CF-11: FAQPage that mirrors the prerendered noscript Q&A. Built only when
  // cohorts are supplied (so the ranking answers are real); the localized region
  // name comes from the same `t('city.*')` key the rest of the component uses.
  const faq = pct ? buildFaq(properties, displayName, properties.city ? cityName : '', lang, pct) : [];
  const faqPage = faq.length > 0
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.map(({ q, a }) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      }
    : null;

  // Escape closing script tags in JSON output to prevent XSS.
  // A literal "</script>" inside the JSON would close the <script> element
  // and allow arbitrary HTML injection. Replacing "</" with "<\/" is safe
  // JSON (the backslash is ignored by JSON parsers) and blocks the attack.
  const safeJson = (obj: object) => JSON.stringify(obj).replace(/</g, '\\u003c');

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJson(schema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJson(breadcrumb) }}
      />
      {faqPage && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJson(faqPage) }}
        />
      )}
    </>
  );
};
