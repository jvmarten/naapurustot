/**
 * Slug utilities for neighborhood profile page URLs.
 *
 * URL format: /alue/{pno}-{slugified-name}
 * Example: /alue/00100-helsinki-keskusta-etu-toolo
 *
 * The postal code prefix guarantees uniqueness and enables O(1) lookup.
 */

/**
 * Lowercase and strip diacritics / Finnish special characters, WITHOUT slugifying.
 *
 * Maps `ä→a`, `ö→o`, `å→a` (the standard Finnish folding) before NFD decomposition,
 * because NFD does not decompose those identically across environments, then removes
 * any remaining combining marks. Whitespace and punctuation are preserved.
 *
 * Used both here (as the first stage of {@link slugify}) and by the search bar to
 * make queries accent-insensitive — so "Toolo" matches "Töölö" and "Aanekoski"
 * matches "Äänekoski". Keep the two in lockstep: the slug pipeline and search
 * folding normalise the same characters the same way.
 */
export function fold(text: string): string {
  return text
    .toLowerCase()
    // Replace Finnish characters before NFD decomposition, as NFD may not
    // decompose all characters identically across environments.
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // remove combining diacritical marks
}

/** Strip diacritics and Finnish special characters, then slugify. */
function slugify(text: string): string {
  return fold(text)
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
