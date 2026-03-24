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
  { id: 'tampere', labelKey: 'city.tampere' },
];

export const CitySelector: React.FC<CitySelectorProps> = ({ value, onChange }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value as CityFilter)}
    className="text-sm bg-brand-500/90 hover:bg-brand-600/90 text-white font-medium rounded-lg px-3 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400 pr-7 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22white%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem] bg-[position:right_0.25rem_center] bg-no-repeat"
    aria-label={t('city.select')}
  >
    {CITY_OPTIONS.map((opt) => (
      <option key={opt.id} value={opt.id}>
        {t(opt.labelKey)}
      </option>
    ))}
  </select>
);
