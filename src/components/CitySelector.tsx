import React from 'react';
import type { CityId } from '../utils/metrics';
import { t } from '../utils/i18n';

export type CityFilter = CityId | 'all';

interface CitySelectorProps {
  value: CityFilter;
  onChange: (city: CityFilter) => void;
}

const CITY_OPTIONS: { id: CityFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'city.all' },
  { id: 'helsinki_metro', labelKey: 'city.helsinki_metro' },
  { id: 'turku', labelKey: 'city.turku' },
];

export const CitySelector: React.FC<CitySelectorProps> = ({ value, onChange }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value as CityFilter)}
    className="text-xs bg-white/90 dark:bg-surface-800/90 border border-surface-300 dark:border-surface-600 rounded-md px-2 py-1 text-surface-700 dark:text-surface-200 shadow-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
    aria-label={t('city.select')}
  >
    {CITY_OPTIONS.map((opt) => (
      <option key={opt.id} value={opt.id}>
        {t(opt.labelKey)}
      </option>
    ))}
  </select>
);
