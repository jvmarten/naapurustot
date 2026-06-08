import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { t, getLang, setLang, useI18nVersion, type Lang } from '../utils/i18n';

/**
 * PO-14: Public privacy & data-handling notice (FI/EN/SV, prerendered).
 *
 * Describes ONLY what the system actually does, traceable to the real
 * architecture:
 *  - The map works fully WITHOUT an account; no analytics cookies (self-hosted
 *    Umami, cookieless). Account is optional and stores username, a hashed
 *    password, an optional email, and synced favorites/shortlist/notes/
 *    preferences (see src/utils/api.ts).
 *  - Third parties: Cloudflare Turnstile (signup bot check), Sentry (error
 *    reporting, opt-in via build), self-hosted Umami (cookieless analytics).
 *  - Self-service export (JSON download) and account deletion (CF-13, UserMenu).
 *  - Contact reuses the existing site channel info@naapurustot.fi (ContactMenu).
 *
 * The prerendered <noscript> (scripts/prerender.mjs) mirrors the substance for
 * SEO / answer engines, exactly like the shipped Data Sources page.
 */

const SECTION_KEYS = [
  'privacy.s_noaccount',
  'privacy.s_account',
  'privacy.s_basis',
  'privacy.s_thirdparties',
  'privacy.s_retention',
  'privacy.s_rights',
  'privacy.s_contact',
] as const;

export const PrivacyPage: React.FC<{ lang: Lang }> = ({ lang }) => {
  useEffect(() => {
    if (getLang() !== lang) void setLang(lang);
  }, [lang]);
  useI18nVersion();

  useEffect(() => {
    document.title = `${t('privacy.title')} | naapurustot.fi`;
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <main className="min-h-screen bg-surface-50 dark:bg-surface-950 text-surface-800 dark:text-surface-200">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Link
          to="/"
          className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t('sources.back_to_map')}
        </Link>

        <h1 className="mt-4 text-3xl font-bold text-surface-900 dark:text-white">
          {t('privacy.title')}
        </h1>
        <p className="mt-3 text-surface-600 dark:text-surface-400 leading-relaxed">
          {t('privacy.subtitle')}
        </p>

        {SECTION_KEYS.map((key) => (
          <section key={key}>
            <h2 className="mt-8 mb-2 text-lg font-semibold text-surface-900 dark:text-white">
              {t(`${key}_h`)}
            </h2>
            <p className="text-surface-600 dark:text-surface-400 leading-relaxed whitespace-pre-line">
              {t(`${key}_b`)}
            </p>
            {key === 'privacy.s_contact' && (
              <p className="mt-1 text-surface-600 dark:text-surface-400 leading-relaxed">
                <a
                  href="mailto:info@naapurustot.fi"
                  className="text-brand-600 dark:text-brand-400 hover:underline"
                >
                  info@naapurustot.fi
                </a>
              </p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
};

export default PrivacyPage;
