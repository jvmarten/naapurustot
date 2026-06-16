import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import { t, useI18nVersion, type Lang } from '../utils/i18n';
import type { RecentEntry } from '../hooks/useRecentNeighborhoods';
import { geocodeAddressDetailed, GEOCODING_ENABLED, type GeocodeResult } from '../utils/geocode';
import { getFeatureCenter } from '../utils/geometryFilter';
import { trackEvent } from '../utils/analytics';

interface SearchBarProps {
  /** Region-scoped data with geometry — used to resolve geocoded addresses to a containing neighborhood. */
  data: FeatureCollection | null;
  /**
   * Global all-areas index (properties only) for the name/postal-code dropdown.
   * Lets any area in Finland be found regardless of the observed subregion.
   * Falls back to `data` until the index has loaded.
   */
  searchData?: FeatureCollection | null;
  onSelect: (pno: string, center: [number, number]) => void;
  recent?: RecentEntry[];
  /** Pass current language to trigger re-render on language change */
  lang?: Lang;
  /** QW-2: the postal code currently anchored as the user's home/reference baseline. */
  homePno?: string | null;
  /** QW-2: display name of the home neighborhood (for the "My home: {area}" chip). */
  homeName?: string | null;
  /** QW-2: set (or clear, with null) the home/reference baseline. */
  onSetHome?: (pno: string | null) => void;
  /** T7: clear the entire "recently viewed" list. */
  onClearRecent?: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = React.memo(({ data, searchData, onSelect, recent = [], lang, homePno, homeName, onSetHome, onClearRecent }) => {
  useI18nVersion();
  const displayName = (p: GeoJSON.GeoJsonProperties): string => {
    if (!p) return '';
    if (lang === 'sv') return (p.namn as string) || (p.nimi as string) || (p.pno as string);
    return (p.nimi as string) || (p.namn as string) || (p.pno as string);
  };
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
  // L4: true while an address geocode is debounced/in-flight, so the dropdown can
  // show a "searching addresses…" hint instead of looking empty. Also gates the
  // C1 no-results branch so the two never both show.
  const [isGeocoding, setIsGeocoding] = useState(false);
  // ER-1: set when the geocoder failed (network/HTTP/parse) rather than simply
  // returning no matches, so we can show a retryable notice instead of "no results".
  const [addressError, setAddressError] = useState(false);
  // ER-1: bumped by the "retry" affordance to re-run the geocode for the same query.
  const [geocodeRetry, setGeocodeRetry] = useState(0);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const geocodeAbortRef = useRef<AbortController | null>(null);

  // QW-2: the neighborhood a just-picked address resolved into, surfaced as a
  // transient "set this as my home" prompt below the input. Cleared once the user
  // acts on it or starts a new search.
  const [homePrompt, setHomePrompt] = useState<{ pno: string; name: string } | null>(null);

  // Debounce the query used for the feature scan. Short delay (80ms) keeps
  // results feeling responsive while collapsing rapid keystrokes into a single scan.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), 80);
    return () => clearTimeout(handle);
  }, [query]);

  // Text search runs against the global index when available (so areas in any
  // subregion are found), falling back to the region-scoped data until it loads.
  const searchSource = searchData ?? data;

  const { results, totalCount } = useMemo(() => {
    if (!searchSource || debouncedQuery.length < 2) return { results: [], totalCount: 0 };
    const q = debouncedQuery.toLowerCase();
    // Score matches so exact/prefix hits rank above arbitrary substring matches,
    // then keep the top 8. Previously the first 8 in dataset order won, so an exact
    // name match could be pushed out of view by earlier incidental substring matches.
    const scored: { f: GeoJSON.Feature; score: number; idx: number }[] = [];
    let idx = 0;
    for (const f of searchSource.features) {
      const p = f.properties;
      if (!p) { idx++; continue; }
      const nimi = (p.nimi as string | undefined)?.toLowerCase();
      const namn = (p.namn as string | undefined)?.toLowerCase();
      const pno = p.pno as string | undefined;
      const nimiHit = nimi?.includes(q) ?? false;
      const namnHit = namn?.includes(q) ?? false;
      const pnoHit = pno?.startsWith(q) ?? false;
      if (nimiHit || namnHit || pnoHit) {
        // lower score = more relevant (same match predicate as before, so totalCount is unchanged)
        let score = 4; // namn substring fallback
        if (nimi === q || namn === q) score = 0;                       // exact name
        else if (nimi?.startsWith(q) || namn?.startsWith(q)) score = 1; // name prefix
        else if (pno === q) score = 2;                                 // exact pno
        else if (pnoHit) score = 3;                                    // pno prefix
        else if (nimiHit) score = 3.5;                                 // nimi substring
        scored.push({ f, score, idx });
      }
      idx++;
    }
    // Stable tie-break on dataset index keeps ordering deterministic.
    scored.sort((a, b) => a.score - b.score || a.idx - b.idx);
    return { results: scored.slice(0, 8).map((s) => s.f), totalCount: scored.length };
  }, [searchSource, debouncedQuery]);

  // SN-3/AY-4: the recents list participates in the combobox keyboard model when the
  // query is empty, so Arrow/Enter and aria-activedescendant traverse it like results.
  const recentItems = useMemo(() => recent.slice(0, 5), [recent]);
  const recentsActive = isOpen && results.length === 0 && query.length < 2 && recentItems.length > 0;

  // LP-4: on the default all-Finland view `data` is null and the global search index
  // is fetched async; until it lands `searchSource` is null and the name scan returns []
  // for any query. Treat that window as "loading" so the no-results branch can't flash.
  const indexLoading = !searchSource;

  // CF-1: Debounced address geocoding — always search for streets/addresses alongside neighborhoods.
  // Uses AbortController to cancel in-flight HTTP requests when the query changes,
  // preventing wasted bandwidth and stale responses from slower earlier requests.
  useEffect(() => {
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    if (geocodeAbortRef.current) geocodeAbortRef.current.abort();
    // SN-4: in a keyless build address search is unavailable — never flip the
    // "searching addresses…" flag (it would flash a header that resolves to nothing)
    // and never surface an address error.
    if (!GEOCODING_ENABLED || query.length < 3 || /^\d{5}$/.test(query.trim())) {
      setAddressResults([]);
      setIsGeocoding(false);
      setAddressError(false);
      return;
    }
    setIsGeocoding(true);
    setAddressError(false);
    const abortController = new AbortController();
    geocodeAbortRef.current = abortController;
    geocodeTimerRef.current = setTimeout(async () => {
      const outcome = await geocodeAddressDetailed(query, abortController.signal);
      if (!abortController.signal.aborted) {
        setAddressResults(outcome.results);
        setAddressError(outcome.status === 'error'); // ER-1: failure ≠ no matches
        setIsGeocoding(false);
      }
    }, 300);
    return () => {
      if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
      abortController.abort();
    };
  }, [query, geocodeRetry]);

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

  // Scroll the keyboard-highlighted option into view (the list can exceed its
  // scroll region with 8 neighborhoods + address results).
  useEffect(() => {
    if (highlightedIndex < 0) return;
    document.getElementById(`search-result-${highlightedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  function selectResult(feature: GeoJSON.Feature) {
    trackEvent('search-neighborhood');
    onSelect(feature.properties!.pno, getFeatureCenter(feature));
    setQuery(displayName(feature.properties) || feature.properties!.pno);
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  async function selectAddressResult(addr: GeocodeResult) {
    trackEvent('search-address');
    try {
      const neighborhood = await findNeighborhoodForPoint(addr.coordinates);
      if (neighborhood?.properties) {
        const pno = neighborhood.properties.pno as string;
        onSelect(pno, addr.coordinates);
        setQuery(displayName(neighborhood.properties) || addr.label);
        // QW-2: an address resolved to a real neighborhood → offer "set as my home".
        // Skip the prompt when it's already the home so we don't nag.
        if (onSetHome && pno !== homePno) {
          setHomePrompt({ pno, name: displayName(neighborhood.properties) || pno });
        }
      } else {
        onSelect('', addr.coordinates);
        // SN-5: on the all-Finland view `data` is null, so App resolves the area via its
        // deferred-geo path and opens the panel (which carries the home/reference toggle).
        // Showing the raw street label here would only mismatch the panel title, so clear it.
        setQuery(data ? addr.label : '');
      }
    } catch {
      // Fallback: fly to the address coordinates even if point-in-polygon lookup fails
      onSelect('', addr.coordinates);
      setQuery(data ? addr.label : '');
    }
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function selectRecent(entry: RecentEntry) {
    onSelect(entry.pno, entry.center);
    setQuery(entry.name);
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // SN-3: when the query is empty the recents list is the active popup, so the
    // combobox keyboard model traverses it; otherwise it traverses results + addresses.
    const totalItems = recentsActive ? recentItems.length : results.length + addressResults.length;
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
      case 'Enter': {
        e.preventDefault();
        if (recentsActive) {
          selectRecent(recentItems[highlightedIndex < 0 ? 0 : highlightedIndex]);
          break;
        }
        // SN-1: with nothing explicitly highlighted, Enter selects the top match
        // (the universal combobox convention) instead of doing nothing.
        const idx = highlightedIndex < 0 ? 0 : highlightedIndex;
        if (idx < results.length) {
          selectResult(results[idx]);
        } else if (idx < totalItems) {
          selectAddressResult(addressResults[idx - results.length]);
        }
        break;
      }
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
          aria-expanded={isOpen && (recentsActive || results.length > 0 || addressResults.length > 0)}
          aria-activedescendant={highlightedIndex >= 0 ? `search-result-${highlightedIndex}` : undefined}
          aria-controls="search-results-list"
          aria-autocomplete="list"
          aria-label={t(GEOCODING_ENABLED ? 'search.address_placeholder' : 'search.placeholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            // QW-2: a fresh search supersedes any pending "set as home" prompt.
            if (homePrompt) setHomePrompt(null);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={isMobileRef.current ? t('search.placeholder_short') : t(GEOCODING_ENABLED ? 'search.address_placeholder' : 'search.placeholder')}
          className="w-full rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40
                     pl-10 pr-8 py-1.5 md:py-2.5 text-sm md:text-sm text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500
                     focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30
                     shadow-2xl transition-all"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setIsOpen(false); setAddressResults([]); setIsGeocoding(false); setHomePrompt(null); inputRef.current?.focus(); }}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
            aria-label={t('search.clear')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* QW-2: "set this address's area as my home" prompt after an address resolves. */}
      {onSetHome && homePrompt && (
        <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-brand-500/10 dark:bg-brand-600/15 border border-brand-500/30 px-3 py-2 text-xs shadow-lg backdrop-blur-md">
          <svg className="w-4 h-4 shrink-0 text-brand-600 dark:text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <button
            type="button"
            onClick={() => { trackEvent('set-home-address'); onSetHome(homePrompt.pno); setHomePrompt(null); }}
            className="flex-1 text-left font-medium text-brand-700 dark:text-brand-200 hover:underline"
          >
            {t('home.set_prompt').replace('{area}', homePrompt.name)}
          </button>
          <button
            type="button"
            onClick={() => setHomePrompt(null)}
            className="shrink-0 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
            aria-label={t('home.dismiss')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* QW-2: persistent "My home: {area}" chip — the active reference baseline. */}
      {homePno && homeName && (
        <div className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-600/90 dark:bg-brand-700/90 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg backdrop-blur-md">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span className="truncate">{t('home.chip').replace('{area}', homeName)}</span>
          {onSetHome && (
            <button
              type="button"
              onClick={() => { trackEvent('clear-home'); onSetHome(null); }}
              className="shrink-0 -mr-0.5 rounded-full p-0.5 hover:bg-white/20"
              aria-label={t('home.clear')}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* PO-5: Recent neighborhoods when input is empty/focused.
          SN-3: when shown, this IS the live combobox popup (id matches aria-controls)
          and each option is keyboard-navigable via aria-activedescendant. */}
      {recentsActive && (
        <div
          id="search-results-list"
          role="listbox"
          aria-label={t('recent.title')}
          className="mt-1.5 rounded-xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
              {t('recent.title')}
            </span>
            {onClearRecent && (
              <button
                type="button"
                className="text-[11px] font-medium normal-case text-surface-500 dark:text-surface-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
                onClick={() => { onClearRecent(); trackEvent('clear-recent'); }}
              >
                {t('recent.clear')}
              </button>
            )}
          </div>
          {recentItems.map((entry, index) => (
            <button
              key={entry.pno}
              id={`search-result-${index}`}
              role="option"
              aria-selected={index === highlightedIndex}
              className={`w-full text-left px-4 py-2.5 md:py-2 text-sm transition-colors min-h-[44px] md:min-h-0
                         border-b border-surface-100 dark:border-surface-800/40 last:border-0
                         ${index === highlightedIndex
                           ? 'bg-brand-50 dark:bg-brand-900/30'
                           : 'hover:bg-surface-100 dark:hover:bg-surface-800/60'}`}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectRecent(entry)}
            >
              <span className="text-surface-900 dark:text-white font-medium">{entry.name}</span>
              <span className="text-surface-500 dark:text-surface-400 ml-2">{entry.pno}</span>
            </button>
          ))}
        </div>
      )}

      {/* EM5: first-timer hint when the input is empty/focused and there are no recents yet. */}
      {isOpen && query.length < 2 && recent.length === 0 && (
        <div className="mt-1.5 rounded-xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
          <div className="px-4 py-2.5 text-sm text-surface-500 dark:text-surface-400">
            {t('search.start_typing')}
          </div>
        </div>
      )}

      {isOpen && (results.length > 0 || addressResults.length > 0 || isGeocoding) && (
        <div
          ref={listRef}
          id="search-results-list"
          role="listbox"
          aria-label={t('search.results_label')}
          className="mt-1.5 rounded-xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl max-h-[60vh] overflow-y-auto"
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
              <span className="text-surface-900 dark:text-white font-medium">{displayName(f.properties)}</span>
              <span className="text-surface-500 dark:text-surface-400 ml-2">{f.properties!.pno}</span>
            </button>
          ))}
          {totalCount > 8 && (
            <div className="px-4 py-2 text-xs text-surface-400 dark:text-surface-500 text-center border-t border-surface-100 dark:border-surface-800/40">
              {totalCount - 8} {t('search.moreResults')}
            </div>
          )}
          {/* CF-1: Address results */}
          {(addressResults.length > 0 || isGeocoding) && (
            <>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 border-t border-surface-100 dark:border-surface-800/40">
                {t('search.address_results')}
              </div>
              {/* L4: subtle loading row while geocoding has not yet returned results. */}
              {isGeocoding && addressResults.length === 0 && (
                <div className="px-4 py-2 text-xs text-surface-400 dark:text-surface-500">
                  {t('search.address_searching')}
                </div>
              )}
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

      {/* ER-1: the geocoder failed (not merely "no matches") — offer a retry rather
          than a misleading "no results", and suppress the generic branch below. */}
      {isOpen && addressError && results.length === 0 && !isGeocoding && (
        <div className="mt-1.5 rounded-xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-surface-500 dark:text-surface-400">
            <span>{t('search.address_unavailable')}</span>
            <button
              type="button"
              className="shrink-0 font-medium text-brand-600 dark:text-brand-300 hover:underline"
              onClick={() => setGeocodeRetry((n) => n + 1)}
            >
              {t('search.address_retry')}
            </button>
          </div>
        </div>
      )}

      {/* LP-4: the global search index hasn't loaded yet (default all-Finland view) —
          show a loading row instead of a premature "no results". */}
      {isOpen && indexLoading && debouncedQuery.length >= 2 && results.length === 0 && addressResults.length === 0 && !isGeocoding && !addressError && (
        <div className="mt-1.5 rounded-xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
          <div className="px-4 py-2.5 text-sm text-surface-400 dark:text-surface-500">
            {t('loading.title')}
          </div>
        </div>
      )}

      {/* C1/ES-6: settled no-results — query long enough, the index is loaded, both
          searches returned nothing, no geocode error. Copy holds at the threshold and
          no longer advises "change city" (search is already nationwide). */}
      {isOpen && !indexLoading && !addressError && debouncedQuery.length >= 2 && results.length === 0 && addressResults.length === 0 && !isGeocoding && (
        <div className="mt-1.5 rounded-xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
          <div className="px-4 py-2.5 text-sm text-surface-500 dark:text-surface-400">
            {t('search.no_results').replace('{query}', debouncedQuery)}
          </div>
        </div>
      )}
    </div>
  );
});

SearchBar.displayName = 'SearchBar';
