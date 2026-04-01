import React from 'react';
import type { NeighborhoodProperties } from '../../utils/metrics';
import { t } from '../../utils/i18n';

interface JsonLdProps {
  properties: NeighborhoodProperties;
  center: [number, number];
  url: string;
}

export const JsonLd: React.FC<JsonLdProps> = ({ properties, center, url }) => {
  const cityName = properties.city ? t(`city.${properties.city}`) : 'Finland';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: properties.nimi,
    description: `${properties.nimi} (${properties.pno}) – ${cityName}`,
    url,
    address: {
      '@type': 'PostalAddress',
      postalCode: properties.pno,
      addressLocality: cityName,
      addressCountry: 'FI',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: center[1],
      longitude: center[0],
    },
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
      { '@type': 'ListItem', position: 3, name: properties.nimi },
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
