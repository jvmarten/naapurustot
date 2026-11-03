/**
 * Statistical-area identifiers, for every country the map covers.
 *
 * An area id is the publisher's own code, stored bare — Finland's 5-digit Paavo postal
 * code (`00100`), Sweden's SCB DeSO code (`0180C1090`). The formats live in
 * `countries.ts` (`CountryDef.area`) and are disjoint, so an id names its country
 * without a prefix and every Finnish URL, favourite, note and indexed page stays valid.
 *
 * This is the single place URL params, slugs, localStorage and the server's sync
 * validation go through (the server keeps a copy of the patterns).
 */

import { COUNTRIES, HOME_COUNTRY, areaCountry, regionCountry, type CountryId } from './countries.ts';

export type { CountryId } from './countries.ts';

/** True when `s` is a well-formed area id in canonical form. */
export function isAreaId(s: string): boolean {
  return COUNTRIES.some((c) => c.area.test(s));
}

/**
 * Canonical form of a possibly lower-cased id (slugs are lower-case, DeSO codes are
 * published upper-case), or null when it is not an area id at all.
 */
export function normalizeAreaId(s: string): string | null {
  const id = s.toUpperCase();
  return isAreaId(id) ? id : null;
}

/** Country an area id belongs to. Only meaningful for ids that pass `isAreaId`. */
export function countryOf(id: string): CountryId {
  return areaCountry(id) ?? HOME_COUNTRY;
}

/**
 * Country of any feature id on the map: an area id, or a region id (the all-country
 * view's region features carry their region id as `pno`, prefixed outside HOME).
 */
export function countryOfId(id: unknown): CountryId {
  const s = String(id ?? '');
  return areaCountry(s) ?? regionCountry(s);
}
