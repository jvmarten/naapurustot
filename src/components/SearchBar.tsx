import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import { t } from '../utils/i18n';

interface SearchBarProps {
  data: FeatureCollection | null;
  onSelect: (pno: string, center: [number, number]) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ data, onSelect }) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const { results, totalCount } = useMemo(() => {
    if (!data || query.length < 2) return { results: [], totalCount: 0 };
    const q = query.toLowerCase();
    const matched = data.features.filter((f) => {
      const p = f.properties!;
      return (
        p.nimi?.toLowerCase().includes(q) ||
        p.namn?.toLowerCase().includes(q) ||
        p.pno?.startsWith(q)
      );
    });
    return { results: matched.slice(0, 8), totalCount: matched.length };
  }, [data, query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reset highlight when results change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [results]);

  function selectResult(feature: GeoJSON.Feature) {
    onSelect(feature.properties!.pno, getCenter(feature));
    setQuery(feature.properties!.nimi || feature.properties!.pno);
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || results.length === 0) {
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < results.length) {
          selectResult(results[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  }

  function getCenter(feature: GeoJSON.Feature): [number, number] {
    const geom = feature.geometry;
    if (geom.type === 'Point') return geom.coordinates as [number, number];
    const coords: GeoJSON.Position[] = [];
    function extract(c: GeoJSON.Position | GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][]) {
      if (typeof c[0] === 'number') coords.push(c as GeoJSON.Position);
      else (c as GeoJSON.Position[][]).forEach(extract);
    }
    if ('coordinates' in geom) {
      extract(geom.coordinates as GeoJSON.Position[]);
    }
    const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    return [lng, lat];
  }

  return (
    <div ref={containerRef} className="absolute top-3 md:top-4 left-3 md:left-4 z-10 w-[calc(100%-13rem)] md:w-72">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen && results.length > 0}
          aria-activedescendant={highlightedIndex >= 0 ? `search-result-${highlightedIndex}` : undefined}
          aria-controls="search-results-list"
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={isMobile ? t('search.placeholder_short') : t('search.placeholder')}
          className="w-full rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40
                     pl-10 pr-4 py-3 md:py-2.5 text-base md:text-sm text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500
                     focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30
                     shadow-2xl transition-all"
        />
      </div>

      {isOpen && results.length > 0 && (
        <div
          ref={listRef}
          id="search-results-list"
          role="listbox"
          className="mt-1.5 rounded-xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden"
        >
          {results.map((f, index) => (
            <button
              key={f.properties!.pno}
              id={`search-result-${index}`}
              role="option"
              aria-selected={index === highlightedIndex}
              className={`w-full text-left px-4 py-3 md:py-2.5 text-sm transition-colors min-h-[44px] md:min-h-0
                         border-b border-surface-100 dark:border-surface-800/40 last:border-0
                         ${index === highlightedIndex
                           ? 'bg-brand-50 dark:bg-brand-900/30'
                           : 'hover:bg-surface-100 dark:hover:bg-surface-800/60'}`}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectResult(f)}
            >
              <span className="text-surface-900 dark:text-white font-medium">{f.properties!.nimi}</span>
              <span className="text-surface-500 dark:text-surface-400 ml-2">{f.properties!.pno}</span>
            </button>
          ))}
          {totalCount > 8 && (
            <div className="px-4 py-2 text-xs text-surface-400 dark:text-surface-500 text-center border-t border-surface-100 dark:border-surface-800/40">
              {totalCount - 8} {t('search.moreResults')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
