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
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove combining diacritical marks
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Build a URL slug from postal code and Finnish name. */
export function toSlug(pno: string, nimi: string): string {
  return `${pno}-${slugify(nimi)}`;
}

/** Extract postal code from a slug (first 5 characters). Returns null if invalid. */
export function parseSlug(slug: string): string | null {
  const pno = slug.slice(0, 5);
  return /^\d{5}$/.test(pno) ? pno : null;
}
