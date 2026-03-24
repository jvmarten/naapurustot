import React, { useState, useRef, useEffect, lazy, Suspense, useCallback } from 'react';
import { useTheme } from '../hooks/useTheme';
import { t, type Lang } from '../utils/i18n';

// Lazy-load DonateButton to keep qrcode.react (~12KB) out of the initial bundle.
// It only renders when the settings dropdown is open.
const DonateButton = lazy(() => import('./DonateButton').then(m => ({ default: m.DonateButton })));
import type { ColorblindType } from '../utils/colorScales';

interface SettingsDropdownProps {
  colorblind: ColorblindType;
  onColorblindChange: (mode: ColorblindType) => void;
  lang: Lang;
  onToggleLang: () => void;
  fillOpacity: number;
  onFillOpacityChange: (value: number) => void;
}

const CB_OPTIONS: { value: ColorblindType; labelKey: string }[] = [
  { value: 'off', labelKey: 'settings.cb_off' },
  { value: 'protanopia', labelKey: 'settings.cb_protanopia' },
  { value: 'deuteranopia', labelKey: 'settings.cb_deuteranopia' },
  { value: 'tritanopia', labelKey: 'settings.cb_tritanopia' },
];

/** Opacity slider — local state for smooth drag, parent callback on every change. */
const OpacitySlider: React.FC<{ fillOpacity: number; onFillOpacityChange: (v: number) => void }> = ({
  fillOpacity,
  onFillOpacityChange,
}) => {
  const [local, setLocal] = useState(() => Math.round(fillOpacity * 100));

  useEffect(() => { setLocal(Math.round(fillOpacity * 100)); }, [fillOpacity]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setLocal(v);
    onFillOpacityChange(v / 100);
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
        className="w-full h-1 accent-brand-500 cursor-pointer"
      />
    </div>
  );
};

export const SettingsDropdown: React.FC<SettingsDropdownProps> = React.memo(({
  colorblind,
  onColorblindChange,
  lang,
  onToggleLang,
  fillOpacity,
  onFillOpacityChange,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { mode, setMode } = useTheme();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex px-2.5 py-2 rounded-lg text-xs font-semibold transition-all items-center justify-center
                   min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
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
        <div className="absolute left-0 top-full mt-2 w-56 rounded-xl bg-white dark:bg-surface-900
                       border border-surface-200 dark:border-surface-700/40 shadow-2xl backdrop-blur-md
                       py-1 z-50 max-h-[calc(100vh-80px)] overflow-y-auto">
          {/* Theme selector */}
          <div className="px-4 py-2.5">
            <div className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">{t('settings.theme')}</div>
            <div className="flex rounded-lg border border-surface-200 dark:border-surface-700/40 overflow-hidden">
              {(['system', 'light', 'dark'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  title={t(`settings.theme_${m}`)}
                  aria-label={t(`settings.theme_${m}`)}
                  className={`flex-1 flex items-center justify-center py-2 transition-colors
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

          {/* Language toggle */}
          <button
            onClick={onToggleLang}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                       hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
            <span>{lang === 'fi' ? 'English' : 'Suomi'}</span>
            <span className="ml-auto text-xs font-semibold uppercase text-surface-400 dark:text-surface-500">
              {lang === 'fi' ? 'EN' : 'FI'}
            </span>
          </button>

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

          {/* PO-6: Data freshness indicator */}
          <div className="border-t border-surface-100 dark:border-surface-700/40 my-1" />
          <div className="px-4 py-2 text-[10px] text-surface-400 dark:text-surface-500">
            {t('data.last_updated')}: 2026-03
          </div>
        </div>
      )}
    </div>
  );
});
