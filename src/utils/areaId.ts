/**
 * Statistical-area identifiers, for every country the map covers.
 *
 * An area id is the publisher's own code, stored bare:
 *   - Finland: a 5-digit Paavo postal code, e.g. `00100`.
 *   - Sweden:  a DeSO code (SCB), e.g. `0180C1090` — 4-digit municipality, a
 *     letter A–C, 4 digits.
 *
 * The formats are disjoint, so an id names its country without a prefix and every
 * Finnish URL, favourite, note and indexed page stays valid. A new country must
 * bring a pattern that cannot match any existing one (see docs/SWEDEN_EXPANSION.md).
 *
 * This is the single place that knows the formats: URL params, slugs, localStorage
 * and the server's sync validation all go through it (the server keeps a copy).
 */

export type CountryId = 'fi' | 'se';

const AREA_ID_RE = /^(?:\d{5}|\d{4}[A-C]\d{4})$/;

/** True when `s` is a well-formed area id in canonical form. */
export function isAreaId(s: string): boolean {
  return AREA_ID_RE.test(s);
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
  return id.length === 5 ? 'fi' : 'se';
}

/**
 * Country of any feature id on the map: an area id, or a region id (the all-country
 * view's region features carry their region id as `pno`; Swedish ones start `se_`).
 */
export function countryOfId(id: unknown): CountryId {
  const s = String(id ?? '');
  return s.startsWith('se_') || (s.length === 9 && isAreaId(s)) ? 'se' : 'fi';
}
