/**
 * Build the in-app route to a neighborhood's profile page for the current
 * language. Used by national-scope features (CF-6) whose source dataset is
 * geometry-stripped (region_properties.json), so the map cannot fly to the
 * area — we navigate to its profile page instead.
 */
import { toSlug } from './slug';
import { getLang } from './i18n';

/** Localized profile-page URL for a postal-code area (trailing slash included). */
export function buildProfileUrl(pno: string, name: string): string {
  const slug = toSlug(pno, name || pno);
  const lang = getLang();
  const base = lang === 'en' ? '/en/area/' : lang === 'sv' ? '/sv/omrade/' : '/alue/';
  return `${base}${slug}/`;
}
