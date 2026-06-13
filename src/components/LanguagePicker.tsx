import React, { useState, useCallback } from 'react';
import { t, useI18nVersion, type Lang } from '../utils/i18n';

interface LanguagePickerProps {
  lang: Lang;
  /** L3: returns a promise that settles when the lazy dictionary finishes loading,
   *  so the clicked language can show an in-flight spinner. */
  onLangChange: (lang: Lang) => void | Promise<void>;
  /** ARIA role for each button — e.g. "menuitem" when rendered inside a role="menu".
   *  Omit for a plain control (e.g. the onboarding tour). */
  itemRole?: string;
  /** Show the globe + "Language" caption above the toggle (default true). */
  showLabel?: boolean;
}

/**
 * T5: the shared FI/EN/SV language toggle, extracted from SettingsDropdown so the
 * onboarding tour can offer a language choice up-front. Owns its own in-flight
 * spinner state; switching persists + lazy-fetches the dictionary via onLangChange.
 */
export const LanguagePicker: React.FC<LanguagePickerProps> = ({ lang, onLangChange, itemRole, showLabel = true }) => {
  useI18nVersion();
  // L3: language whose dictionary is still loading after a click, so the button
  // shows a spinner instead of feeling unresponsive while the UI sits in Finnish.
  const [pendingLang, setPendingLang] = useState<Lang | null>(null);
  const handleLangClick = useCallback((l: Lang) => {
    if (l === lang) return;
    const result = onLangChange(l);
    if (result && typeof (result as Promise<void>).then === 'function') {
      setPendingLang(l);
      void (result as Promise<void>).finally(() => setPendingLang((p) => (p === l ? null : p)));
    }
  }, [lang, onLangChange]);

  return (
    <>
      {showLabel && (
        // O2: label the row (a globe + "Language" caption) so the FI/EN/SV switch is
        // self-identifying, not a bare button row.
        <div className="flex items-center gap-3 mb-2">
          <svg className="w-4 h-4 text-surface-500 dark:text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.5 0 4.5-4 4.5-9S14.5 3 12 3m0 18c-2.5 0-4.5-4-4.5-9S9.5 3 12 3M3.5 9h17M3.5 15h17" />
          </svg>
          <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{t('settings.language')}</span>
        </div>
      )}
      <div className="flex rounded-lg border border-surface-200 dark:border-surface-700/40 overflow-hidden">
        {(['fi', 'en', 'sv'] as const).map((l) => (
          <button
            key={l}
            role={itemRole}
            onClick={() => handleLangClick(l)}
            aria-pressed={lang === l}
            className={`flex-1 py-2 text-xs font-semibold uppercase transition-colors
              flex items-center justify-center gap-1
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${lang === l
              ? 'bg-brand-500/15 dark:bg-brand-600/20 text-brand-600 dark:text-brand-300'
              : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'}`}
          >
            {l}
            {/* L3: in-flight spinner until the lazy dictionary lands. */}
            {pendingLang === l && (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </>
  );
};
