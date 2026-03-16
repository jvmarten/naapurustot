import React from 'react';
import { t } from '../utils/i18n';

interface ErrorBannerProps {
  message: string;
  onRetry: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onRetry }) => (
  <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 max-w-md w-full px-4">
    <div className="flex items-center gap-3 rounded-xl bg-rose-50/95 dark:bg-rose-950/90 backdrop-blur-md border border-rose-200 dark:border-rose-800/60 px-4 py-3 shadow-lg">
      <svg
        className="w-5 h-5 shrink-0 text-rose-500 dark:text-rose-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-rose-800 dark:text-rose-200">{t('error.load_failed')}</p>
        <p className="text-xs text-rose-600 dark:text-rose-400 truncate">{message}</p>
      </div>
      <button
        onClick={onRetry}
        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors"
      >
        {t('error.retry')}
      </button>
    </div>
  </div>
);
