import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import { t, type Lang } from '../utils/i18n';
import type { RecentEntry } from '../hooks/useRecentNeighborhoods';
import { geocodeAddress, type GeocodeResult } from '../utils/geocode';
import { getFeatureCenter } from '../utils/geometryFilter';
import { trackEvent } from '../utils/analytics';

interface SearchBarProps {
  data: FeatureCollection | null;
  onSelect: (pno: string, center: [number, number]) => void;
  recent?: RecentEntry[];
  /** Pass current language to trigger re-render on language change */
  lang?: Lang;
}

export const SearchBar: React.FC<SearchBarProps> = React.memo(({ data, onSelect, recent = [], lang: _lang }) => {
  const [query, setQuery] = useState('');
  // Debounced copy of `query` used for the dataset scan. The input field still
  // updates synchronously (via `query`) so typing feels instant, but the O(n)
  // linear scan over ~1000 features (combined "all" view) only runs after the
  // user pauses for 80ms. Avoids scanning on every keystroke during fast typing.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Read breakpoint once at mount instead of calling window.innerWidth on every render
  // (which can trigger layout reflow in some browsers).
  const isMobileRef = useRef(typeof window !== 'undefined' && window.innerWidth < 768);

  // CF-1: Address geocoding state
  const [addressResults, setAddressResults] = useState<GeocodeResult[]>([]);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const geocodeAbortRef = useRef<AbortController | null>(null);

  // Debounce the query used for the feature scan. Short delay (80ms) keeps
  // results feeling responsive while collapsing rapid keystrokes into a single scan.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), 80);
    return () => clearTimeout(handle);
  }, [query]);

  const { results, totalCount } = useMemo(() => {
    if (!data || debouncedQuery.length < 2) return { results: [], totalCount: 0 };
    const q = debouncedQuery.toLowerCase();
    const top: GeoJSON.Feature[] = [];
    let count = 0;
    for (const f of data.features) {
      const p = f.properties;
      if (!p) continue;
      if (p.nimi?.toLowerCase().includes(q) || p.namn?.toLowerCase().includes(q) || p.pno?.startsWith(q)) {
        count++;
        if (top.length < 8) top.push(f);
      }
    }
    return { results: top, totalCount: count };
  }, [data, debouncedQuery]);

  // CF-1: Debounced address geocoding — always search for streets/addresses alongside neighborhoods.
  // Uses AbortController to cancel in-flight HTTP requests when the query changes,
  // preventing wasted bandwidth and stale responses from slower earlier requests.
  useEffect(() => {
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    if (geocodeAbortRef.current) geocodeAbortRef.current.abort();
    if (query.length < 3 || /^\d{5}$/.test(query.trim())) {
      setAddressResults([]);
      return;
    }
    const abortController = new AbortController();
    geocodeAbortRef.current = abortController;
    geocodeTimerRef.current = setTimeout(async () => {
      const res = await geocodeAddress(query, abortController.signal);
      if (!abortController.signal.aborted) setAddressResults(res);
    }, 300);
    return () => {
      if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
      abortController.abort();
    };
  }, [query]);

  // CF-1: Find which neighborhood contains a geocoded point.
  // Uses lazy-loaded turf modules — cached after first import.
  // Filters candidates by bbox first to avoid running the expensive
  // booleanPointInPolygon on all ~200-1000 features.
  const turfRef = useRef<{ booleanPointInPolygon: typeof import('@turf/boolean-point-in-polygon').booleanPointInPolygon; point: typeof import('@turf/helpers').point } | null>(null);
  async function findNeighborhoodForPoint(coords: [number, number]): Promise<GeoJSON.Feature | null> {
    if (!data) return null;
    if (!turfRef.current) {
      const [pipMod, helpersMod] = await Promise.all([
        import('@turf/boolean-point-in-polygon'),
        import('@turf/helpers'),
      ]);
      turfRef.current = { booleanPointInPolygon: pipMod.booleanPointInPolygon, point: helpersMod.point };
    }
    const { booleanPointInPolygon, point } = turfRef.current;
    const pt = point(coords);
    const [lng, lat] = coords;
    for (const feature of data.features) {
      if (!feature.geometry) continue;
      // Quick bbox rejection: skip features whose bounding box doesn't contain the point.
      // This avoids the expensive polygon test for ~95% of features.
      const bbox = feature.bbox;
      if (bbox) {
        if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
      }
      try {
        if (booleanPointInPolygon(pt, feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)) {
          return feature;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

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
    trackEvent('search-neighborhood');
    onSelect(feature.properties!.pno, getFeatureCenter(feature));
    setQuery(feature.properties!.nimi || feature.properties!.pno);
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  async function selectAddressResult(addr: GeocodeResult) {
    trackEvent('search-address');
    try {
      const neighborhood = await findNeighborhoodForPoint(addr.coordinates);
      if (neighborhood?.properties) {
        onSelect(neighborhood.properties.pno, addr.coordinates);
        setQuery(neighborhood.properties.nimi || addr.label);
      } else {
        onSelect('', addr.coordinates);
        setQuery(addr.label);
      }
    } catch {
      // Fallback: fly to the address coordinates even if point-in-polygon lookup fails
      onSelect('', addr.coordinates);
      setQuery(addr.label);
    }
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const totalItems = results.length + addressResults.length;
    if (!isOpen || totalItems === 0) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsOpen(false);
        inputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < results.length) {
          selectResult(results[highlightedIndex]);
        } else if (highlightedIndex >= results.length && highlightedIndex < totalItems) {
          selectAddressResult(addressResults[highlightedIndex - results.length]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  }

  return (
    <div ref={containerRef} className="w-full">
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
          aria-expanded={isOpen && (results.length > 0 || addressResults.length > 0)}
          aria-activedescendant={highlightedIndex >= 0 ? `search-result-${highlightedIndex}` : undefined}
          aria-controls="search-results-list"
          aria-autocomplete="list"
          aria-label={t('search.placeholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={isMobileRef.current ? t('search.placeholder_short') : t('search.placeholder')}
          className="w-full rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40
                     pl-10 pr-8 py-1.5 md:py-2.5 text-sm md:text-sm text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500
                     focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30
                     shadow-2xl transition-all"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setIsOpen(false); setAddressResults([]); inputRef.current?.focus(); }}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
            aria-label={t('search.clear')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* PO-5: Recent neighborhoods when input is empty/focused */}
      {isOpen && results.length === 0 && query.length < 2 && recent.length > 0 && (
        <div className="mt-1.5 rounded-xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
          <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
            {t('recent.title')}
          </div>
          {recent.slice(0, 5).map((entry) => (
            <button
              key={entry.pno}
              className="w-full text-left px-4 py-2.5 md:py-2 text-sm transition-colors min-h-[44px] md:min-h-0
                         border-b border-surface-100 dark:border-surface-800/40 last:border-0
                         hover:bg-surface-100 dark:hover:bg-surface-800/60"
              onClick={() => {
                onSelect(entry.pno, entry.center);
                setQuery(entry.name);
                setIsOpen(false);
              }}
            >
              <span className="text-surface-900 dark:text-white font-medium">{entry.name}</span>
              <span className="text-surface-500 dark:text-surface-400 ml-2">{entry.pno}</span>
            </button>
          ))}
        </div>
      )}

      {isOpen && (results.length > 0 || addressResults.length > 0) && (
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
          {/* CF-1: Address results */}
          {addressResults.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 border-t border-surface-100 dark:border-surface-800/40">
                {t('search.address_results')}
              </div>
              {addressResults.map((addr, i) => {
                const globalIndex = results.length + i;
                return (
                  <button
                    key={`${addr.coordinates[0]},${addr.coordinates[1]}`}
                    id={`search-result-${globalIndex}`}
                    role="option"
                    aria-selected={globalIndex === highlightedIndex}
                    className={`w-full text-left px-4 py-2.5 md:py-2 text-sm transition-colors min-h-[44px] md:min-h-0
                               border-b border-surface-100 dark:border-surface-800/40 last:border-0
                               ${globalIndex === highlightedIndex
                                 ? 'bg-brand-50 dark:bg-brand-900/30'
                                 : 'hover:bg-surface-100 dark:hover:bg-surface-800/60'}`}
                    onMouseEnter={() => setHighlightedIndex(globalIndex)}
                    onClick={() => selectAddressResult(addr)}
                  >
                    <span className="text-surface-700 dark:text-surface-200 text-xs">{addr.label}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
});

SearchBar.displayName = 'SearchBar';
