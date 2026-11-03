/**
 * The countries the map covers, and everything about them that code branches on.
 *
 * Adding a country starts here: give it an id, its ISO alpha-3 code, the shape of its
 * area ids and the prefix of its region ids. Code that needs to know "which country is
 * this" asks this file (directly or through areaId.ts / regions.ts); code that needs a
 * per-country value keys a `Partial<Record<CountryId, …>>` by the id. Nothing outside
 * this file should spell out `'se'` to decide what a feature is.
 *
 * The HOME country is Finland: its area ids are the bare postal codes every existing
 * URL carries, its regions have no prefix, and its data is the default for anything a
 * per-country table leaves out (national ranges, stops, labels, quality-index inputs).
 */

export type CountryId = 'fi' | 'se';

export interface CountryDef {
  id: CountryId;
  /** ISO 3166-1 alpha-3, as the basemap tiles and Natural Earth borders name it. */
  iso3: string;
  /** The publisher's area-id format. Patterns must be disjoint across countries. */
  area: RegExp;
  /** Region-id prefix, three characters ending in `_` ('se_'); '' only for HOME. */
  regionPrefix: string;
}

export const HOME_COUNTRY: CountryId = 'fi';

export const COUNTRIES: readonly CountryDef[] = [
  // Paavo postal code, e.g. 00100.
  { id: 'fi', iso3: 'FIN', area: /^\d{5}$/, regionPrefix: '' },
  // SCB DeSO 2025: 4-digit municipality, a letter A–C, 4 digits, e.g. 0180C1090.
  { id: 'se', iso3: 'SWE', area: /^\d{4}[A-C]\d{4}$/, regionPrefix: 'se_' },
];

export const COUNTRY_IDS: readonly CountryId[] = COUNTRIES.map((c) => c.id);

/** Countries other than HOME — the ones whose regions carry a prefix. */
export const PREFIXED_COUNTRIES: readonly CountryDef[] = COUNTRIES.filter((c) => c.regionPrefix);

export function countryDef(id: CountryId): CountryDef {
  return COUNTRIES.find((c) => c.id === id)!;
}

/** Country of a region id: the one whose prefix it carries, else HOME. */
export function regionCountry(id: string): CountryId {
  for (const c of PREFIXED_COUNTRIES) if (id.startsWith(c.regionPrefix)) return c.id;
  return HOME_COUNTRY;
}

/** Country whose area-id pattern `id` matches, or null. */
export function areaCountry(id: string): CountryId | null {
  for (const c of COUNTRIES) if (c.area.test(id)) return c.id;
  return null;
}

/** HOME-first lookup in a per-country table: the country's own entry, else `fallback`. */
export function forCountry<T>(table: Partial<Record<CountryId, T>> | undefined, country: CountryId | null | undefined, fallback: T): T {
  return (country && table?.[country]) ?? fallback;
}
