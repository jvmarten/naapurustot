import React, { useState, useRef, useEffect } from 'react';
import type { CityId } from '../utils/metrics';
import { t, type Lang } from '../utils/i18n';

export type CityFilter = CityId | 'all';

interface CitySelectorProps {
  value: CityFilter;
  onChange: (city: CityFilter) => void;
  /** Pass current language to trigger re-render on language change */
  lang?: Lang;
}

const CITY_OPTIONS: { id: CityFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'city.all' },
  { id: 'helsinki_metro', labelKey: 'city.helsinki_metro' },
  { id: 'turku', labelKey: 'city.turku' },
  { id: 'tampere', labelKey: 'city.tampere' },
];

export const CitySelector: React.FC<CitySelectorProps> = ({ value, onChange, lang: _lang }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <>
      {/* Desktop: native select, unchanged */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as CityFilter)}
        className="hidden md:block text-sm bg-brand-500/90 hover:bg-brand-600/90 text-white font-medium rounded-lg px-3 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400 pr-7 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22white%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem] bg-[position:right_0.25rem_center] bg-no-repeat"
        aria-label={t('city.select')}
      >
        {CITY_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {t(opt.labelKey)}
          </option>
        ))}
      </select>

      {/* Mobile: icon button + dropdown */}
      <div ref={ref} className="relative md:hidden">
        <button
          onClick={() => setOpen((prev) => !prev)}
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400 ${
            open
              ? 'bg-brand-500/20 border border-brand-500/30 text-brand-600 dark:text-brand-400'
              : 'bg-brand-500/90 hover:bg-brand-600/90 text-white'
          }`}
          aria-label={t('city.select')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-1.5 0a6.5 6.5 0 11-11-4.58v.09c0 .72.37 1.39.97 1.76l.32.2a1.25 1.25 0 01.57 1.05v.27c0 .69.56 1.25 1.25 1.25h.09c.32 0 .62.13.84.36l.18.18c.21.21.5.34.8.34h.28a.6.6 0 00.6-.6v-.14a1.4 1.4 0 01.98-1.33l.06-.02a1.25 1.25 0 00.86-1.19V7.28c0-.42-.21-.8-.56-1.03l-.52-.35a1.25 1.25 0 00-1.08-.13l-.2.07a1.25 1.25 0 01-1.37-.38l-.08-.1A1.25 1.25 0 008.37 5h-.12a1.25 1.25 0 00-.98.48l-.01.01A6.48 6.48 0 0116.5 10z" clipRule="evenodd" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700/40 shadow-2xl backdrop-blur-md z-50 py-1">
            {CITY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                  opt.id === value
                    ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300 font-medium'
                    : 'text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
