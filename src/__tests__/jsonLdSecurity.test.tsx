/**
 * Security-critical tests for JsonLd component.
 *
 * JsonLd renders structured data inline via dangerouslySetInnerHTML. If the
 * neighborhood name, postal code, or city ID contained a literal `</script>`
 * (or any `<`), the browser would terminate the JSON script block and parse
 * the rest as HTML — enabling stored XSS via any data source that contributes
 * to those fields.
 *
 * The defense is a JSON serializer that escapes every `<` as `\u003c`. These
 * tests assert that defense holds for every realistic and hostile input shape
 * that can reach the component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { JsonLd } from '../components/profile/JsonLd';
import type { NeighborhoodProperties } from '../utils/metrics';

vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

function makeProps(overrides: Partial<NeighborhoodProperties> = {}): NeighborhoodProperties {
  return {
    pno: '00100',
    nimi: 'Kruununhaka',
    namn: 'Kronohagen',
    kunta: '091',
    city: 'helsinki_metro',
    he_vakiy: 5000,
    quality_index: 75,
    // Required by NeighborhoodProperties but unused by JsonLd:
    he_kika: null, ko_ika18y: null, ko_yl_kork: null, ko_al_kork: null, ko_ammat: null,
    ko_perus: null, hr_mtu: null, hr_ktu: null, pt_tyoll: null, pt_tyott: null,
    pt_opisk: null, pt_vakiy: null, pt_elakel: null, ra_asunn: null, ra_as_kpa: null,
    ra_pt_as: null, te_takk: null, te_taly: null, te_omis_as: null, te_vuok_as: null,
    pinta_ala: null, he_0_2: null, he_3_6: null, unemployment_rate: null,
    higher_education_rate: null, pensioner_share: null, foreign_language_pct: null,
    ownership_rate: null, rental_rate: null, population_density: null, child_ratio: null,
    student_share: null, detached_house_share: null, property_price_sqm: null,
    transit_stop_density: null, air_quality_index: null, crime_index: null,
    daycare_density: null, school_density: null, healthcare_density: null,
    single_person_hh_pct: null, cycling_density: null, restaurant_density: null,
    grocery_density: null, sports_facility_density: null, income_history: null,
    population_history: null, unemployment_history: null, income_change_pct: null,
    population_change_pct: null, unemployment_change_pct: null, voter_turnout_pct: null,
    party_diversity_index: null, broadband_coverage_pct: null, ev_charging_density: null,
    tree_canopy_pct: null, transit_reachability_score: null, youth_ratio_pct: null,
    gender_ratio: null, single_parent_hh_pct: null, families_with_children_pct: null,
    tech_sector_pct: null, healthcare_workers_pct: null, employment_rate: null,
    elderly_ratio_pct: null, avg_household_size: null, manufacturing_jobs_pct: null,
    public_sector_jobs_pct: null, service_sector_jobs_pct: null, new_construction_pct: null,
    he_naiset: null, he_miehet: null, he_18_19: null, he_20_24: null, he_25_29: null,
    he_65_69: null, he_70_74: null, he_75_79: null, he_80_84: null, he_85_: null,
    te_eil_np: null, te_laps: null, tp_tyopy: null, tp_j_info: null, tp_q_terv: null,
    tp_jalo_bf: null, tp_o_julk: null, tp_palv_gu: null, ra_raky: null,
    rental_price_sqm: null, price_to_rent_ratio: null, walkability_index: null,
    traffic_accident_rate: null, property_price_change_pct: null, school_quality_score: null,
    light_pollution: null, noise_pollution: null, water_proximity_m: null,
    avg_construction_year: null,
    ...overrides,
  };
}

function collectScriptHtml(container: HTMLElement): string {
  const scripts = container.querySelectorAll('script[type="application/ld+json"]');
  return Array.from(scripts).map((s) => s.innerHTML).join('\n');
}

describe('JsonLd — XSS hardening', () => {
  it('escapes literal </script> injected via neighborhood name', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps({ nimi: 'Hostile</script><img src=x onerror=alert(1)>' })}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/alue/00100-foo"
      />,
    );
    const html = collectScriptHtml(container);
    // The raw closing tag MUST NOT survive serialization: if it did, the
    // browser would break out of the <script> element.
    expect(html).not.toContain('</script>');
    // The "<" from <img must also be escaped.
    expect(html).not.toContain('<img');
    // The escaped form must be present (the raw character is replaced with \u003c).
    expect(html).toContain('\\u003c');
  });

  it('escapes every < in the postal code field', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps({ pno: '<svg/onload=alert(1)>' })}
        center={[24.94, 60.17]}
        url="https://x/"
      />,
    );
    const html = collectScriptHtml(container);
    expect(html).not.toMatch(/<(?!\/script|script)/);
  });

  it('escapes < injected via the URL field', () => {
    // The `url` prop comes from window.location on the profile page — in
    // principle user-controllable via path/query. Must never break out of
    // the script block.
    const { container } = render(
      <JsonLd
        properties={makeProps()}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/alue/00100-</script><img src=x>"
      />,
    );
    const html = collectScriptHtml(container);
    expect(html).not.toContain('</script>');
    expect(html).not.toContain('<img');
  });

  it('produces valid JSON after escaping — \\u003c is a legal JSON escape', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps({ nimi: '</script>' })}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/x"
      />,
    );
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    // Both <script> tags must hold parseable JSON (the \u003c escape is valid JSON).
    for (const s of scripts) {
      expect(() => JSON.parse(s.innerHTML)).not.toThrow();
    }
  });

  it('preserves content integrity — unescaped characters roundtrip via JSON.parse', () => {
    const hostileName = 'Töölö & Etu-Töölö';
    const { container } = render(
      <JsonLd
        properties={makeProps({ nimi: hostileName })}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/x"
      />,
    );
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const place = JSON.parse(scripts[0].innerHTML) as { name: string };
    // Non-attack characters survive intact through escape
    expect(place.name).toBe(hostileName);
  });

  it('emits exactly two <script type="application/ld+json"> blocks (Place + Breadcrumb)', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps()}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/alue/00100"
      />,
    );
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBe(2);
  });

  it('omits additionalProperty when quality_index is null', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps({ quality_index: null })}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/x"
      />,
    );
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const place = JSON.parse(scripts[0].innerHTML);
    expect(place.additionalProperty).toBeUndefined();
  });

  it('includes quality_index as additionalProperty when set', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps({ quality_index: 82 })}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/x"
      />,
    );
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const place = JSON.parse(scripts[0].innerHTML);
    expect(place.additionalProperty).toEqual([{
      '@type': 'PropertyValue',
      name: 'Quality Index',
      value: 82,
      maxValue: 100,
    }]);
  });

  it('builds a breadcrumb with three positions and a working city link', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps({ city: 'turku', nimi: 'Portsa' })}
        center={[22.27, 60.45]}
        url="https://naapurustot.fi/alue/20100"
      />,
    );
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const crumb = JSON.parse(scripts[1].innerHTML);
    expect(crumb.itemListElement).toHaveLength(3);
    expect(crumb.itemListElement[1].item).toBe('https://naapurustot.fi/?city=turku');
    expect(crumb.itemListElement[2].name).toBe('Portsa');
  });

  it('defaults the city breadcrumb to helsinki_metro when city is null', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps({ city: null })}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/alue/00100"
      />,
    );
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const crumb = JSON.parse(scripts[1].innerHTML);
    expect(crumb.itemListElement[1].item).toBe('https://naapurustot.fi/?city=helsinki_metro');
  });

  it('places GeoCoordinates as [longitude, latitude] derived from center tuple', () => {
    // A classic bug is swapping lng/lat. Schema.org expects latitude as `latitude`.
    const { container } = render(
      <JsonLd
        properties={makeProps()}
        center={[24.5, 60.3]}
        url="https://naapurustot.fi/alue/00100"
      />,
    );
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const place = JSON.parse(scripts[0].innerHTML);
    expect(place.geo.latitude).toBe(60.3);
    expect(place.geo.longitude).toBe(24.5);
  });

  it('rounds quality_index (schema.org value must be integer)', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps({ quality_index: 74.6 })}
        center={[24.94, 60.17]}
        url="https://x/"
      />,
    );
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const place = JSON.parse(scripts[0].innerHTML);
    expect(place.additionalProperty[0].value).toBe(75);
  });
});
