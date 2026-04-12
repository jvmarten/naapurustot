import React, { useState, useRef, useEffect } from 'react';
import { REGION_IDS_WITH_DATA, type RegionId } from '../utils/regions';
import { t, type Lang } from '../utils/i18n';

export type CityFilter = RegionId | 'all';

interface CitySelectorProps {
  value: CityFilter;
  onChange: (city: CityFilter) => void;
  /** Pass current language to trigger re-render on language change */
  lang?: Lang;
}

/** Options list: "All" first, then regions in config order. Computed once at module level. */
const OPTIONS: { id: CityFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'city.all' },
  ...REGION_IDS_WITH_DATA.map((id) => ({ id: id as CityFilter, labelKey: `city.${id}` })),
];

export const CitySelector: React.FC<CitySelectorProps> = React.memo(({ value, onChange, lang: _lang }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = OPTIONS;

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
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {t(opt.labelKey)}
          </option>
        ))}
      </select>

      {/* Mobile: icon button + scrollable dropdown */}
      <div ref={ref} className="relative md:hidden">
        <button
          onClick={() => setOpen((prev) => !prev)}
          className={`flex px-2.5 py-2 rounded-lg text-xs font-semibold transition-all items-center justify-center
                     min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 cursor-pointer
                     ${open
                       ? 'bg-brand-500/20 text-brand-600 dark:text-brand-300 border border-brand-500/30'
                       : 'text-surface-600 dark:text-white/70 hover:text-surface-900 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-white/10 border border-transparent'
                     }`}
          aria-label={t('city.select')}
          title={t('city.select')}
        >
          {/* Simple globe icon (stroke) */}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.6 9h16.8M3.6 15h16.8" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a15 15 0 014 9 15 15 0 01-4 9 15 15 0 01-4-9 15 15 0 014-9z" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-48 max-h-80 overflow-y-auto rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700/40 shadow-2xl backdrop-blur-md z-50 py-1">
            {options.map((opt) => (
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
});
CitySelector.displayName = 'CitySelector';
