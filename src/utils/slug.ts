/**
 * Slug utilities for neighborhood profile page URLs.
 *
 * URL format: /alue/{pno}-{slugified-name}
 * Example: /alue/00100-helsinki-keskusta-etu-toolo
 *
 * The postal code prefix guarantees uniqueness and enables O(1) lookup.
 */

/** Strip diacritics and Finnish special characters, then slugify. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    // Replace Finnish characters before NFD decomposition, as NFD may not
    // decompose all characters identically across environments.
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove combining diacritical marks
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Build a URL slug from postal code and Finnish name. */
export function toSlug(pno: string, nimi: string): string {
  return `${pno}-${slugify(nimi)}`;
}

/** Extract postal code from a slug. Returns null if it does not match the
 *  `{pno}-{slugified-name}` shape (optionally just `{pno}`, or `{pno}-` when
 *  the name is empty — which is what `toSlug` produces in that case).
 *  Previously this accepted any 5-digit prefix (e.g. "12345abcde") and also
 *  permitted consecutive/trailing dashes ("00100---foo", "00100-foo--bar"),
 *  silently stripping garbage after the first five chars. */
export function parseSlug(slug: string): string | null {
  if (!/^\d{5}(?:-(?:[a-z0-9]+(?:-[a-z0-9]+)*)?)?$/.test(slug.toLowerCase())) return null;
  return slug.slice(0, 5);
}
