import React from 'react';
import type { NeighborhoodProperties } from '../../utils/metrics';

interface JsonLdProps {
  properties: NeighborhoodProperties;
  center: [number, number];
  url: string;
}

export const JsonLd: React.FC<JsonLdProps> = ({ properties, center, url }) => {
  const cityName = properties.city === 'helsinki_metro' ? 'Helsinki'
    : properties.city === 'turku' ? 'Turku'
    : properties.city === 'tampere' ? 'Tampere'
    : 'Finland';

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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
    </>
  );
};
