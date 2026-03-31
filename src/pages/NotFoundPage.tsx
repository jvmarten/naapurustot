import React from 'react';
import { Link } from 'react-router-dom';
import { t } from '../utils/i18n';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-surface-950 text-surface-900 dark:text-white px-4">
      <h1 className="text-6xl font-bold text-brand-500 mb-4">404</h1>
      <p className="text-xl mb-8">{t('notfound.message')}</p>
      <Link
        to="/"
        className="px-6 py-3 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors font-medium"
      >
        {t('notfound.back_to_map')}
      </Link>
    </div>
  );
};
