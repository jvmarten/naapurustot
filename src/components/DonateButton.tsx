import React, { useState, useRef, useEffect } from 'react';
import { t } from '../utils/i18n';

// Replace with your Lightning Address (e.g., yourname@getalby.com)
const LIGHTNING_ADDRESS = 'naapurustot@getalby.com';

export const DonateButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(LIGHTNING_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = LIGHTNING_ADDRESS;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative" ref={popupRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-2 md:py-1.5 rounded-lg bg-white/90 dark:bg-surface-900/90 backdrop-blur-md
                   border border-surface-200 dark:border-surface-700/40 text-surface-600 dark:text-surface-300
                   hover:text-amber-500 dark:hover:text-amber-400 hover:bg-white dark:hover:bg-surface-800/80
                   transition-all shadow-lg min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                   flex items-center justify-center"
        aria-label={t('donate.button')}
        title={t('donate.button')}
      >
        {/* Lightning bolt icon */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl bg-white dark:bg-surface-900
                        border border-surface-200 dark:border-surface-700/40 shadow-2xl backdrop-blur-md
                        p-4 z-50">
          <h3 className="text-sm font-semibold text-surface-800 dark:text-white mb-1">
            {t('donate.title')}
          </h3>
          <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
            {t('donate.description')}
          </p>

          {/* Lightning Address */}
          <div className="flex items-center gap-2 bg-surface-50 dark:bg-surface-800 rounded-lg p-2.5 mb-2">
            <svg className="w-4 h-4 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-xs font-mono text-surface-700 dark:text-surface-300 truncate flex-1">
              {LIGHTNING_ADDRESS}
            </span>
            <button
              onClick={handleCopy}
              className="shrink-0 text-xs font-medium text-brand-500 hover:text-brand-600
                         dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
            >
              {copied ? t('donate.copied') : t('donate.copy')}
            </button>
          </div>

          <p className="text-[10px] text-surface-400 dark:text-surface-500">
            {t('donate.hint')}
          </p>
        </div>
      )}
    </div>
  );
};
