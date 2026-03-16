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
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  function getCenter(feature: GeoJSON.Feature): [number, number] {
    const geom = feature.geometry;
    if (geom.type === 'Point') return geom.coordinates as [number, number];
    const coords: number[][] = [];
    function extract(c: any) {
      if (typeof c[0] === 'number') coords.push(c);
      else c.forEach(extract);
    }
    extract((geom as any).coordinates);
    const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    return [lng, lat];
  }

  return (
    <div ref={containerRef} className="absolute top-4 left-4 z-10 w-72">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={t('search.placeholder')}
          className="w-full rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40
                     pl-10 pr-4 py-2.5 text-sm text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500
                     focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30
                     shadow-2xl transition-all"
        />
      </div>

      {isOpen && results.length > 0 && (
        <div className="mt-1.5 rounded-xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
          {results.map((f) => (
            <button
              key={f.properties!.pno}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors
                         border-b border-surface-100 dark:border-surface-800/40 last:border-0"
              onClick={() => {
                onSelect(f.properties!.pno, getCenter(f));
                setQuery(f.properties!.nimi || f.properties!.pno);
                setIsOpen(false);
              }}
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
