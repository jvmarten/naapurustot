import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useTheme } from '../hooks/useTheme';
import { t, useI18nVersion, type Lang } from '../utils/i18n';

// Lazy-load DonateButton to keep qrcode.react (~12KB) out of the initial bundle.
// It only renders when the settings dropdown is open.
const DonateButton = lazy(() => import('./DonateButton').then(m => ({ default: m.DonateButton })));
import type { ColorblindType } from '../utils/colorScales';
import { LanguagePicker } from './LanguagePicker';

/** Format the build timestamp as a localized month + year (e.g. "May 2026"). */
function formatBuildDate(iso: string | undefined, lang: Lang): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const locale = lang === 'fi' ? 'fi-FI' : lang === 'sv' ? 'sv-SE' : 'en-GB';
  try {
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
  } catch {
    return iso.slice(0, 7);
  }
}

interface SettingsDropdownProps {
  colorblind: ColorblindType;
  onColorblindChange: (mode: ColorblindType) => void;
  lang: Lang;
  /** L3: returns a promise that settles when the lazy dictionary finishes loading,
   *  so this control can show an in-flight spinner on the clicked language. */
  onLangChange: (lang: Lang) => void | Promise<void>;
  fillOpacity: number;
  onFillOpacityChange: (value: number) => void;
  /** QW-1: Re-launches the onboarding tour. */
  onShowTour?: () => void;
  /** QW-2: Opens the keyboard shortcuts overlay. */
  onShowShortcuts?: () => void;
  /** QW-7: Copy an iframe embed snippet for the current map state to the clipboard. */
  onCopyEmbed?: () => Promise<boolean>;
  /** CF-1b: Copy a shareable link to the current configured view (incl. filters). */
  onCopyShareLink?: () => Promise<boolean>;
  /** X1: read the share URL for the manual-copy fallback when clipboard write fails. */
  getShareUrl?: () => string;
  /** X1: read the embed snippet for the manual-copy fallback when clipboard write fails. */
  getEmbedSnippet?: () => string;
}

const CB_OPTIONS: { value: ColorblindType; labelKey: string }[] = [
  { value: 'off', labelKey: 'settings.cb_off' },
  { value: 'protanopia', labelKey: 'settings.cb_protanopia' },
  { value: 'deuteranopia', labelKey: 'settings.cb_deuteranopia' },
  { value: 'tritanopia', labelKey: 'settings.cb_tritanopia' },
];

/** Opacity slider — local state for smooth drag, debounced parent callback to avoid
 *  App re-renders + localStorage writes on every tick (30–60/s during a drag). */
const OpacitySlider: React.FC<{ fillOpacity: number; onFillOpacityChange: (v: number) => void }> = ({
  fillOpacity,
  onFillOpacityChange,
}) => {
  const [local, setLocal] = useState(() => Math.round(fillOpacity * 100));
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setLocal(Math.round(fillOpacity * 100)); }, [fillOpacity]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setLocal(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onFillOpacityChange(v / 100), 100);
  }, [onFillOpacityChange]);

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3 mb-2">
        <svg className="w-4 h-4 text-surface-500 dark:text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
        <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{t('settings.opacity')}</span>
        <span className="ml-auto text-xs tabular-nums text-surface-400 dark:text-surface-500">
          {local}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={local}
        onChange={handleChange}
        className="w-full h-1 accent-brand-500 cursor-pointer
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
      />
    </div>
  );
};

export const SettingsDropdown: React.FC<SettingsDropdownProps> = React.memo(({
  colorblind,
  onColorblindChange,
  lang,
  onLangChange,
  fillOpacity,
  onFillOpacityChange,
  onShowTour,
  onShowShortcuts,
  onCopyEmbed,
  onCopyShareLink,
  getShareUrl,
  getEmbedSnippet,
}) => {
  useI18nVersion();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { mode, setMode } = useTheme();
  // X1: when a clipboard write fails, reveal the value for a manual select-all copy.
  // `null` = no fallback shown; otherwise the readOnly textarea displays the value.
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const fallbackTextareaRef = useRef<HTMLTextAreaElement>(null);
  // X1: manual copy from the revealed textarea (mirrors DonateButton's execCommand path).
  const handleManualCopy = useCallback(() => {
    const ta = fallbackTextareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch { /* manual select-all still available */ }
  }, []);

  // QW-7: Brief "Copied!" confirmation after clicking the embed-code button
  const [embedCopied, setEmbedCopied] = useState(false);
  const embedCopyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(embedCopyTimerRef.current), []);
  const handleEmbedClick = useCallback(async () => {
    if (!onCopyEmbed) return;
    const ok = await onCopyEmbed();
    if (ok) {
      setCopyFallback(null);
      setEmbedCopied(true);
      clearTimeout(embedCopyTimerRef.current);
      embedCopyTimerRef.current = setTimeout(() => setEmbedCopied(false), 2000);
    } else if (getEmbedSnippet) {
      // X1: clipboard blocked — reveal the snippet for a manual copy.
      setCopyFallback(getEmbedSnippet());
    }
  }, [onCopyEmbed, getEmbedSnippet]);

  // CF-1b: "Copy share link" — copies the current URL (incl. active filters).
  const [linkCopied, setLinkCopied] = useState(false);
  const linkCopyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(linkCopyTimerRef.current), []);
  const handleShareLinkClick = useCallback(async () => {
    if (!onCopyShareLink) return;
    const ok = await onCopyShareLink();
    if (ok) {
      setCopyFallback(null);
      setLinkCopied(true);
      clearTimeout(linkCopyTimerRef.current);
      linkCopyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
    } else if (getShareUrl) {
      // X1: clipboard blocked — reveal the URL for a manual copy.
      setCopyFallback(getShareUrl());
    }
  }, [onCopyShareLink, getShareUrl]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex px-2.5 py-2 rounded-lg text-xs font-semibold transition-all items-center justify-center
                   min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60
                   ${open
                     ? 'bg-brand-500/20 text-brand-600 dark:text-brand-300 border border-brand-500/30'
                     : 'text-surface-600 dark:text-white/70 hover:text-surface-900 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-white/10 border border-transparent'
                   }`}
        aria-label={t('settings.title')}
        title={t('settings.title')}
      >
        {/* Gear icon */}
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('settings.title')}
          className="absolute left-0 top-full mt-2 w-56 rounded-xl bg-white dark:bg-surface-900
                       border border-surface-200 dark:border-surface-700/40 shadow-2xl backdrop-blur-md
                       py-1 z-50 max-h-[calc(100vh-80px)] overflow-y-auto"
        >
          {/* Theme selector */}
          <div className="px-4 py-2.5">
            <div className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">{t('settings.theme')}</div>
            <div className="flex rounded-lg border border-surface-200 dark:border-surface-700/40 overflow-hidden">
              {(['system', 'light', 'dark'] as const).map((m) => (
                <button
                  key={m}
                  role="menuitem"
                  onClick={() => setMode(m)}
                  title={t(`settings.theme_${m}`)}
                  aria-label={t(`settings.theme_${m}`)}
                  className={`flex-1 flex items-center justify-center py-2 transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60
                    ${mode === m
                      ? 'bg-brand-500/15 dark:bg-brand-600/20 text-brand-600 dark:text-brand-300'
                      : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'
                    }`}
                >
                  {m === 'system' ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  ) : m === 'light' ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Language picker (FI / EN / SV) — shared LanguagePicker (also used by the
              onboarding tour). role="menuitem" so this menu's arrow-key nav includes it. */}
          <div className="px-4 py-2.5">
            <LanguagePicker lang={lang} onLangChange={onLangChange} itemRole="menuitem" />
          </div>

          {/* Colorblind mode */}
          <div className="px-4 py-2.5">
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-4 h-4 text-surface-500 dark:text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{t('settings.colorblind')}</span>
            </div>
            <select
              value={colorblind}
              onChange={(e) => onColorblindChange(e.target.value as ColorblindType)}
              className="w-full text-sm text-surface-700 dark:text-surface-200
                         bg-white dark:bg-surface-800
                         border border-surface-200 dark:border-surface-700/40 rounded-lg px-2.5 py-1.5
                         cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-500/50
                         dark:[color-scheme:dark]"
            >
              {CB_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
              ))}
            </select>
          </div>

          {/* Layer opacity — debounced to avoid Map paint updates + localStorage writes on every drag tick */}
          <OpacitySlider fillOpacity={fillOpacity} onFillOpacityChange={onFillOpacityChange} />

          {/* Divider */}
          <div className="border-t border-surface-100 dark:border-surface-700/40 my-1" />

          {/* Donate */}
          <Suspense fallback={null}>
            <DonateButton variant="menu-item" />
          </Suspense>

          {/* QW-1: Re-launch the onboarding tour */}
          {onShowTour && (
            <>
              <div className="border-t border-surface-100 dark:border-surface-700/40 my-1" />
              <button
                role="menuitem"
                onClick={() => { onShowTour(); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                           hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span>{t('settings.show_tour')}</span>
              </button>
            </>
          )}

          {/* QW-2: Keyboard shortcuts overlay */}
          {onShowShortcuts && (
            <button
              role="menuitem"
              onClick={() => { onShowShortcuts(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                         hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m-6 4h6m-9 8h12a2 2 0 002-2V5a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>{t('shortcuts.title')}</span>
            </button>
          )}

          {/* CF-1b: Copy a shareable link to the current configured view */}
          {onCopyShareLink && (
            <button
              role="menuitem"
              onClick={handleShareLinkClick}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                         hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
              title={t('share.link_hint')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m6.328-1.828a4 4 0 00-5.656 0m5.656 0l-1.5 1.5m1.5-1.5l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
              </svg>
              <span>{linkCopied ? t('share.link_copied') : t('share.link')}</span>
            </button>
          )}

          {/* QW-7: Copy iframe embed snippet for the current map state */}
          {onCopyEmbed && (
            <button
              role="menuitem"
              onClick={handleEmbedClick}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                         hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
              title={t('embed.copy_hint')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <span>{embedCopied ? t('embed.copied') : t('embed.copy_code')}</span>
            </button>
          )}

          {/* X1: clipboard write failed — reveal the value for a manual select-all copy */}
          {copyFallback !== null && (
            <div className="px-4 py-2.5">
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-2">{t('share.copy_failed')}</p>
              <textarea
                ref={fallbackTextareaRef}
                readOnly
                value={copyFallback}
                onFocus={(e) => e.currentTarget.select()}
                rows={3}
                className="w-full text-[11px] font-mono text-surface-700 dark:text-surface-200
                           bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700/40
                           rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500/50"
              />
              <button
                onClick={handleManualCopy}
                className="mt-2 w-full px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-brand-500/15 dark:bg-brand-600/20
                           text-brand-600 dark:text-brand-300 hover:bg-brand-500/25 transition-colors
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
              >
                {t('share.button')}
              </button>
            </div>
          )}

          {/* PO-14: privacy & data-handling notice (lang-aware prerendered page) */}
          <div className="border-t border-surface-100 dark:border-surface-700/40 my-1" />
          <a
            role="menuitem"
            href={lang === 'en' ? '/en/privacy' : lang === 'sv' ? '/sv/integritet' : '/tietosuoja'}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                       hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
            <span>{t('privacy.link')}</span>
          </a>

          {/* X1: Data Sources & Methodology — the desktop-only footer link is
              unreachable on mobile, so surface it here in the gear menu too. */}
          <a
            role="menuitem"
            href={lang === 'en' ? '/en/data-sources' : lang === 'sv' ? '/sv/datakallor' : '/tietolahteet'}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                       hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
            </svg>
            <span>{t('footer.sources')}</span>
          </a>

          {/* PO-6 / QW-1: Data freshness indicator — build-derived (inlined via the
              __BUILD_DATE__ define so the full build_metadata.json stays out of the bundle). */}
          {formatBuildDate(__BUILD_DATE__, lang) && (
            <>
              <div className="border-t border-surface-100 dark:border-surface-700/40 my-1" />
              <div className="px-4 py-2 text-[10px] text-surface-400 dark:text-surface-500">
                {t('data.last_updated')}: {formatBuildDate(__BUILD_DATE__, lang)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});
