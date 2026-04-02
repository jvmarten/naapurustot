import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../utils/i18n';

// Lazy-load qrcode.react (~13KB gzipped) — only needed when user clicks "Show QR"
const QRCodeSVG = lazy(() => import('qrcode.react').then(m => ({ default: m.QRCodeSVG })));

const BOLT12_OFFER =
  'lno1zrxq8pjw7qjlm68mtp7e3yvxee4y5xrgjhhyf2fxhlphpckrvevh50u0qw9y07wzkqlq5yek7g53xhyrjfsqhyz7dygu0srtfagh8jyws0umjqszkt849v9ad3afkf8x6kllvg7ch9detyux8u8hg7f80wdurc8s4ycqqv622dhrd8t0xcehufgj7ckgfw80fhmlfqs8j2nvzdwf04g9x3s5syxkcfwkearq326z8xkcklcmztsyvw5sqd97wsh2sgl7vtng75japckt6dcmanjcssdp96c052j3cfxa8r68wqqs6q8rgxe6m4jgnusl2348zng7ky';

interface DonateButtonProps {
  variant?: 'button' | 'menu-item';
}

export const DonateButton: React.FC<DonateButtonProps> = ({ variant = 'button' }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setShowQr(false);
  }, [open]);

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
      await navigator.clipboard.writeText(BOLT12_OFFER);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = BOLT12_OFFER;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const menuItemContent = (
    <div className="px-4 pb-3">
      <h3 className="text-sm font-semibold text-surface-800 dark:text-white mb-1">
        {t('donate.title')}
      </h3>
      <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
        {t('donate.descriptionShort')}
      </p>

      {/* Copyable offer string */}
      <div className="flex items-center gap-2 bg-surface-50 dark:bg-surface-800 rounded-lg p-2.5 mb-2">
        <svg className="w-4 h-4 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="text-[10px] font-mono text-surface-700 dark:text-surface-300 truncate flex-1">
          {BOLT12_OFFER}
        </span>
        <button
          onClick={handleCopy}
          className="shrink-0 text-xs font-medium text-brand-500 hover:text-brand-600
                     dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
        >
          {copied ? t('donate.copied') : t('donate.copy')}
        </button>
      </div>

      {/* QR Code toggle */}
      <button
        onClick={() => setShowQr((v) => !v)}
        className="text-xs font-medium text-brand-500 hover:text-brand-600
                   dark:text-brand-400 dark:hover:text-brand-300 transition-colors mb-2"
      >
        {showQr ? t('donate.hideQr') : t('donate.showQr')}
      </button>
      {showQr && (
        <div className="flex justify-center mb-2">
          <div className="bg-white p-2 rounded-lg">
            <Suspense fallback={<div className="w-[160px] h-[160px] bg-surface-100 dark:bg-surface-800 animate-pulse rounded" />}>
              <QRCodeSVG
                value={BOLT12_OFFER}
                size={160}
                level="L"
              />
            </Suspense>
          </div>
        </div>
      )}

      <p className="text-[10px] text-surface-400 dark:text-surface-500">
        {t('donate.hint')}
      </p>
    </div>
  );

  const donateContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-white dark:bg-surface-900
                   border border-surface-200 dark:border-surface-700/40 shadow-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
          <h3 className="text-sm font-semibold text-surface-800 dark:text-white mb-1">
            {t('donate.title')}
          </h3>
          <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
            {t('donate.descriptionShort')}
          </p>

          {/* Copyable offer string */}
          <div className="flex items-center gap-2 bg-surface-50 dark:bg-surface-800 rounded-lg p-2.5 mb-2">
            <svg className="w-4 h-4 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-[10px] font-mono text-surface-700 dark:text-surface-300 truncate flex-1">
              {BOLT12_OFFER}
            </span>
            <button
              onClick={handleCopy}
              className="shrink-0 text-xs font-medium text-brand-500 hover:text-brand-600
                         dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
            >
              {copied ? t('donate.copied') : t('donate.copy')}
            </button>
          </div>

          {/* QR Code toggle */}
          <button
            onClick={() => setShowQr((v) => !v)}
            className="text-xs font-medium text-brand-500 hover:text-brand-600
                       dark:text-brand-400 dark:hover:text-brand-300 transition-colors mb-2"
          >
            {showQr ? t('donate.hideQr') : t('donate.showQr')}
          </button>
          {showQr && (
            <div className="flex justify-center mb-2">
              <div className="bg-white p-2 rounded-lg">
                <Suspense fallback={<div className="w-[180px] h-[180px] bg-surface-100 dark:bg-surface-800 animate-pulse rounded" />}>
                  <QRCodeSVG
                    value={BOLT12_OFFER}
                    size={180}
                    level="L"
                  />
                </Suspense>
              </div>
            </div>
          )}

          <p className="text-[10px] text-surface-400 dark:text-surface-500">
            {t('donate.hint')}
          </p>
      </div>
    </div>
  );

  if (variant === 'menu-item') {
    return (
      <>
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                     hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>{t('donate.button')}</span>
        </button>
        {open && createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              ref={popupRef}
              className="w-80 rounded-xl bg-white dark:bg-surface-900 border border-surface-200
                         dark:border-surface-700/40 shadow-2xl p-4"
              onClick={(e) => e.stopPropagation()}
            >
              {menuItemContent}
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  return (
    <div ref={popupRef}>
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
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </button>
      {open && createPortal(donateContent, document.body)}
    </div>
  );
};
