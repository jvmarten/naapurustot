import React from 'react';
import { Link } from 'react-router-dom';
import { t } from '../utils/i18n';

export const NotFoundPage: React.FC = () => {
  return (
    <div
      id="main"
      tabIndex={-1}
      className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-surface-950 text-surface-900 dark:text-white px-4 focus:outline-none"
    >
      <h1 className="text-6xl font-bold text-brand-700 dark:text-brand-400 mb-4">404</h1>
      <p className="text-xl mb-8">{t('notfound.message')}</p>
      <Link
        to="/"
        className="px-6 py-3 bg-brand-700 text-white rounded-lg hover:bg-brand-800 transition-colors font-medium"
      >
        {t('notfound.back_to_map')}
      </Link>
    </div>
  );
};
