import React from 'react';
import type { NeighborhoodProperties } from '../../utils/metrics';
import { t, type Lang } from '../../utils/i18n';

interface JsonLdProps {
  properties: NeighborhoodProperties;
  center: [number, number];
  url: string;
  /** Active route language; defaults to Finnish so existing callers are unaffected. */
  lang?: Lang;
}

export const JsonLd: React.FC<JsonLdProps> = ({ properties, center, url, lang = 'fi' }) => {
  const cityName = properties.city ? t(`city.${properties.city}`) : 'Finland';
  // Mirror the page's display-name rule and the prerenderer's getDisplayName so the
  // client-rendered JSON-LD matches the visible <h1> and the static prerendered markup
  // (previously it always emitted the Finnish name, diverging on the /sv/ route).
  const displayName = lang === 'sv' && properties.namn ? properties.namn : properties.nimi;

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
    ...(properties.quality_index != null && {
      additionalProperty: [{
        '@type': 'PropertyValue',
        name: 'Quality Index',
        value: Math.round(properties.quality_index),
        maxValue: 100,
      }],
    }),
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
    </>
  );
};
