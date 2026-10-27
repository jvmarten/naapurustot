import React, { useState, useRef, useEffect } from 'react';
import { REGION_IDS, type RegionId } from '../utils/regions';
import type { CountryId } from '../utils/areaId';
import { t, useI18nVersion, type Lang } from '../utils/i18n';
import { fold } from '../utils/slug';
import coverageManifest from '../data/region_coverage.json';

export type CityFilter = RegionId | 'all';
/** The list's top level: the national view of both countries ('all'), or one country framed. */
export type ScopeId = 'all' | CountryId;

interface CitySelectorProps {
  value: CityFilter;
  onChange: (city: CityFilter) => void;
  /** Pass current language to trigger re-render on language change */
  lang?: Lang;
  /** Regions on the map (primary first) — all are marked current in the mobile list. */
  displayed?: readonly string[];
  /** Region view: a per-row "+" in the mobile list shows that region alongside. */
  onAdd?: (city: RegionId) => void;
  /** Render only an "add to map" button whose list adds on pick (the desktop add path,
   *  next to the layers panel) — no select, no switching. */
  addOnly?: boolean;
  /** Pick of a top-level row (World / Finland / Sweden). Without it, World falls back
   *  to onChange('all') and the country rows are not offered. */
  onScope?: (scope: ScopeId) => void;
  /** The country the national view is narrowed to (value 'all'), or null for both. */
  country?: CountryId | null;
}

/**
 * The top level of the list: World (the national view of both countries) and one row
 * per country. With 140 regions across two countries the region rows are reached by
 * searching — the popover lists them only once something is typed (plus the regions
 * already on the map, so the current view is always visible). Computed once at module level.
 */
const SCOPES: { id: ScopeId; labelKey: string }[] = [
  { id: 'all', labelKey: 'city.all' },
  { id: 'fi', labelKey: 'city.scope.fi' },
  { id: 'se', labelKey: 'city.scope.se' },
];
const REGION_OPTIONS: { id: RegionId; labelKey: string }[] =
  REGION_IDS.map((id) => ({ id, labelKey: `city.${id}` }));
/** Desktop select value for a country row — never a valid region id. */
const SCOPE_VALUE_PREFIX = 'scope:';

// CF-5 Phase C/D: coverage-aware labeling. A region with no ingested data gets
// a "(no data)" badge; a region with partial data gets "(X%)" or "(low data)".
// Full-coverage regions (and the "all" option) get no badge so the chrome
// stays quiet on the happy path.
type CoverageInfo = { present: number; total: number };
const COVERAGE: Record<string, CoverageInfo> = coverageManifest as Record<string, CoverageInfo>;
const FULL_COVERAGE_THRESHOLD = 0.95;
const LOW_COVERAGE_THRESHOLD = 0.5;

function getCoverageBadge(regionId: CityFilter): string {
  if (regionId === 'all') return '';
  const c = COVERAGE[regionId];
  // No coverage entry at all → the region has no ingested data.
  if (!c || c.total === 0) return ` (${t('city.coverage.none')})`;
  const ratio = c.present / c.total;
  if (ratio >= FULL_COVERAGE_THRESHOLD) return '';
  const pct = Math.round(ratio * 100);
  if (ratio < LOW_COVERAGE_THRESHOLD) return ` (${t('city.coverage.low')})`;
  return ` (${t('city.coverage.partial').replace('{pct}', String(pct))})`;
}

export const CitySelector: React.FC<CitySelectorProps> = React.memo(({ value, onChange, lang: _lang, displayed, onAdd, addOnly, onScope, country }) => {
  useI18nVersion();
  const [open, setOpen] = useState(false);
  // SN-2: filter text for the mobile popover — 70 rows in a small unsearchable
  // scroll list made alphabetically-late regions a chore to reach (the desktop
  // native <select> at least supports type-to-jump). Accent-folded like SearchBar.
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const foldedFilter = fold(filter.trim());
  const isShown = (id: CityFilter) => id === value || !!displayed?.includes(id);
  const scopes = onScope ? SCOPES : SCOPES.slice(0, 1);
  const pickScope = (scope: ScopeId) => (onScope ? onScope(scope) : onChange('all'));
  // The top-level row the map is on: World, or the country it is narrowed to.
  const currentScope: ScopeId | null = value === 'all' ? (onScope && country) || 'all' : null;
  // addOnly lists every addable region (it is a short add path, not the switcher).
  // Otherwise an empty filter shows the regions on the map; typing searches all of them.
  const visibleScopes = addOnly || foldedFilter ? [] : scopes;
  const visibleRegions = addOnly
    ? REGION_OPTIONS.filter((opt) => !isShown(opt.id)
        && (!foldedFilter || fold(t(opt.labelKey)).includes(foldedFilter)))
    : foldedFilter
      ? REGION_OPTIONS.filter((opt) => fold(t(opt.labelKey)).includes(foldedFilter))
      : REGION_OPTIONS.filter((opt) => isShown(opt.id));

  useEffect(() => {
    if (!open) return;
    setFilter('');
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // AY-3: the popover was dismissable by outside-click only, so a keyboard or
    // screen-reader user who opened it had no way out. Mirrors ToolsDropdown:
    // this document listener runs before App's window-level Escape handler, and
    // stopPropagation keeps that handler from also deselecting an area on the
    // same press. Focus returns to the trigger so the tab order isn't lost.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <>
      {/* Desktop: native select, switch only. Adding lives in a separate button list
          (addOnly): a closed select fires `change` on every arrow / End / type-ahead key
          on Windows and Linux, so "add" options inside it fired on mere browsing. */}
      {!addOnly && <select
        data-tour-id="cities"
        value={currentScope && currentScope !== 'all' ? SCOPE_VALUE_PREFIX + currentScope : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith(SCOPE_VALUE_PREFIX)) pickScope(v.slice(SCOPE_VALUE_PREFIX.length) as ScopeId);
          else onChange(v as CityFilter);
        }}
        // Neutral, like the other header controls: as a solid brand-blue fill it was the
        // loudest thing on the page. Opaque backgrounds on purpose — Chrome on Windows
        // paints the native option list with the select's colours, and a translucent
        // fill there turns white option text invisible on the white popup.
        className="hidden md:block text-sm font-medium rounded-lg pl-3 pr-7 py-1.5 appearance-none cursor-pointer
                   bg-white dark:bg-surface-800 hover:bg-surface-50 dark:hover:bg-surface-700 text-surface-800 dark:text-white/90
                   border border-surface-200 dark:border-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60
                   bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%2364748b%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem] bg-[position:right_0.25rem_center] bg-no-repeat"
        aria-label={t('city.select')}
      >
        {/* A native select cannot be searched, so it keeps every region below the
            top-level rows. A country row narrows the national view to that country. */}
        {scopes.map((s) => (
          <option key={s.id} value={s.id === 'all' ? 'all' : SCOPE_VALUE_PREFIX + s.id}>
            {t(s.labelKey)}
          </option>
        ))}
        {REGION_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {t(opt.labelKey)}{getCoverageBadge(opt.id)}
          </option>
        ))}
      </select>}

      {/* Mobile: icon button + scrollable dropdown (addOnly: the desktop "add to map" list) */}
      <div data-tour-id={addOnly ? undefined : 'cities'} ref={ref} className={addOnly ? 'relative pointer-events-auto' : 'relative md:hidden'}>
        {addOnly ? (
          <button
            ref={triggerRef}
            onClick={() => setOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="px-3 py-2 rounded-xl text-xs font-semibold shadow-2xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md
                       border border-surface-200 dark:border-surface-700/40 text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800"
          >
            + {t('region_switch.add')}
          </button>
        ) : (
        <button
          ref={triggerRef}
          onClick={() => setOpen((prev) => !prev)}
          className={`flex gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all items-center justify-center
                     min-w-[44px] min-h-[44px] md:min-h-0 cursor-pointer
                     ${open
                       ? 'bg-brand-500/20 text-brand-700 dark:text-brand-300 border border-brand-500/30'
                       : 'text-surface-600 dark:text-white/70 hover:text-surface-900 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-white/10 border border-transparent'
                     }`}
          // AY-3: the label is the control's only text (the globe is icon-only), so
          // it has to carry the current region — otherwise a screen-reader user has
          // no way to know which region is active without opening the list. The
          // popup/expanded pair announces that this opens something, and its state.
          aria-label={`${t('city.select')}: ${t(currentScope && currentScope !== 'all' ? `city.scope.${currentScope}` : `city.${value}`)}`}
          title={t('city.select')}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {/* Simple globe icon (stroke) — icon only; the region name is intentionally
              omitted on mobile to keep the control a compact, unobtrusive icon. */}
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.6 9h16.8M3.6 15h16.8" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a15 15 0 014 9 15 15 0 01-4 9 15 15 0 01-4-9 15 15 0 014-9z" />
          </svg>
        </button>
        )}

        {open && (
          <div className="absolute right-0 top-full mt-2 w-48 max-h-80 flex flex-col rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700/40 shadow-2xl backdrop-blur-md z-50 py-1">
            {/* SN-2: small filter input, mirroring LayerSelector's search field */}
            <div className="px-2 pb-1 flex-shrink-0">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('city.filter_placeholder')}
                aria-label={t('city.filter_placeholder')}
                className="w-full rounded-lg bg-surface-100 dark:bg-surface-800 border border-transparent focus:border-brand-500/50
                           px-3 py-2 text-xs text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500
                           focus:outline-none"
              />
            </div>
            <div className="overflow-y-auto flex-1 min-h-0">
              {visibleScopes.map((s) => {
                const shown = s.id === currentScope;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      pickScope(s.id);
                      setOpen(false);
                    }}
                    aria-current={shown || undefined}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                      shown
                        ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300 font-medium'
                        : 'text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60'
                    }`}
                  >
                    {t(s.labelKey)}
                  </button>
                );
              })}
              {visibleRegions.map((opt) => {
                const shown = isShown(opt.id);
                return (
                  <div key={opt.id} className="flex">
                    <button
                      onClick={() => {
                        // addOnly: every row is an add. Otherwise a switch — except that
                        // re-picking the primary while other regions are shown must not
                        // collapse the view (the desktop select fires nothing for its
                        // current value either).
                        if (addOnly) onAdd?.(opt.id);
                        else if (!(opt.id === value && (displayed?.length ?? 0) > 1)) onChange(opt.id);
                        setOpen(false);
                      }}
                      aria-current={shown || undefined}
                      className={`flex-1 min-w-0 text-left px-4 py-3 text-sm transition-colors ${
                        shown
                          ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300 font-medium'
                          : 'text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60'
                      }`}
                    >
                      {t(opt.labelKey)}{getCoverageBadge(opt.id)}
                    </button>
                    {onAdd && !addOnly && !shown && (
                      <button
                        onClick={() => {
                          onAdd(opt.id);
                          setOpen(false);
                        }}
                        aria-label={`${t('region_switch.add')}: ${t(opt.labelKey)}`}
                        className="shrink-0 w-11 flex items-center justify-center text-lg font-semibold text-brand-700 dark:text-brand-300 hover:bg-surface-100 dark:hover:bg-surface-800/60"
                      >
                        +
                      </button>
                    )}
                  </div>
                );
              })}
              {foldedFilter && visibleRegions.length === 0 && (
                <div className="px-4 py-3 text-xs text-surface-500 dark:text-surface-400">{t('city.filter_no_match')}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
});
CitySelector.displayName = 'CitySelector';
