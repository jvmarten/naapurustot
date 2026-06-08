/**
 * Tests for profileUrl.ts — the localized profile-page URL builder used by
 * national-scope features (CF-6). National results come from the geometry-stripped
 * region_properties.json, so the correlation explorer and discovery wizard
 * navigate to the area's profile page instead of flying the map. A wrong URL here
 * means a national result opens a 404 or the wrong neighborhood.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildProfileUrl } from '../utils/profileUrl';
import { setLang } from '../utils/i18n';

afterEach(() => { setLang('fi'); });

describe('buildProfileUrl', () => {
  it('builds a Finnish profile URL by default', () => {
    setLang('fi');
    expect(buildProfileUrl('00100', 'Helsinki keskusta')).toBe('/alue/00100-helsinki-keskusta/');
  });

  it('builds an English profile URL', () => {
    setLang('en');
    expect(buildProfileUrl('00100', 'Helsinki keskusta')).toBe('/en/area/00100-helsinki-keskusta/');
  });

  it('builds a Swedish profile URL', () => {
    setLang('sv');
    expect(buildProfileUrl('00100', 'Helsinki keskusta')).toBe('/sv/omrade/00100-helsinki-keskusta/');
  });

  it('slugifies Finnish special characters', () => {
    setLang('fi');
    expect(buildProfileUrl('00250', 'Käpylä')).toBe('/alue/00250-kapyla/');
  });

  it('falls back to the postal code when the name is empty', () => {
    setLang('fi');
    expect(buildProfileUrl('00100', '')).toBe('/alue/00100-00100/');
  });

  it('always ends in a trailing slash', () => {
    setLang('en');
    expect(buildProfileUrl('02100', 'Tapiola').endsWith('/')).toBe(true);
  });
});
