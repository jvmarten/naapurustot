import React, { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Map } from './components/Map';
import { DEFAULT_CENTER, DEFAULT_ZOOM, CITY_VIEWPORTS } from './utils/mapConstants';
import { REGION_IDS, DEFAULT_CITY } from './utils/regions';
import { LayerSelector } from './components/LayerSelector';
import { SearchBar } from './components/SearchBar';
import { ContactMenu } from './components/ContactMenu';
import { CitySelector, type CityFilter } from './components/CitySelector';
import { ComparisonScopeToggle, type ComparisonScope } from './components/ComparisonScopeToggle';
import { TooltipOverlay } from './components/TooltipOverlay';
import { setTooltipData } from './utils/tooltipStore';
import { Legend } from './components/Legend';
import { SettingsDropdown } from './components/SettingsDropdown';
import { ToolsDropdown } from './components/ToolsDropdown';
import { ErrorBanner } from './components/ErrorBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { computeMatchingPnos, type FilterCriterion } from './utils/filterUtils';
import { useFilterPresets } from './hooks/useFilterPresets';
import { useQualityWeights } from './hooks/useQualityWeights';
import { useWizardProfile, wizardAnswersToQualityWeights, type WizardAnswers } from './hooks/useWizardProfile';
import { trackEvent } from './utils/analytics';
import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';

// IN-6: Lazy load heavy conditionally-rendered components
const NeighborhoodPanel = lazy(() => import('./components/NeighborhoodPanel').then(m => ({ default: m.NeighborhoodPanel })));
const ComparisonPanel = lazy(() => import('./components/ComparisonPanel').then(m => ({ default: m.ComparisonPanel })));
const RankingTable = lazy(() => import('./components/RankingTable').then(m => ({ default: m.RankingTable })));
const FilterPanel = lazy(() => import('./components/FilterPanel').then(m => ({ default: m.FilterPanel })));
const CustomQualityPanel = lazy(() => import('./components/CustomQualityPanel').then(m => ({ default: m.CustomQualityPanel })));
const NeighborhoodWizard = lazy(() => import('./components/NeighborhoodWizard').then(m => ({ default: m.NeighborhoodWizard })));
const SplitMapView = lazy(() => import('./components/SplitMapView').then(m => ({ default: m.SplitMapView })));
const AreaSummaryPanel = lazy(() => import('./components/AreaSummaryPanel').then(m => ({ default: m.AreaSummaryPanel })));
const CorrelationExplorer = lazy(() => import('./components/CorrelationExplorer').then(m => ({ default: m.CorrelationExplorer })));
const RegionRankingTable = lazy(() => import('./components/RegionRankingTable').then(m => ({ default: m.RegionRankingTable })));
import { useMapData } from './hooks/useMapData';
import { useSearchIndex } from './hooks/useSearchIndex';
import { useGridData, cellCentroid, clipGridToData, hasGridData } from './hooks/useGridData';
import { useFavorites } from './hooks/useFavorites';

import { useRecentNeighborhoods } from './hooks/useRecentNeighborhoods';
import { useShortlist } from './hooks/useShortlist';
import { useSelectedNeighborhood } from './hooks/useSelectedNeighborhood';
import { useAffordability } from './hooks/useAffordability';
import { useSimilarityMetrics } from './hooks/useSimilarityMetrics';
import { useAuth } from './hooks/useAuth';
const AuthModal = lazy(() => import('./components/AuthModal').then(m => ({ default: m.AuthModal })));
const OnboardingTour = lazy(() => import('./components/OnboardingTour').then(m => ({ default: m.OnboardingTour })));
const ShortcutsOverlay = lazy(() => import('./components/ShortcutsOverlay').then(m => ({ default: m.ShortcutsOverlay })));
const TimeSlider = lazy(() => import('./components/TimeSlider').then(m => ({ default: m.TimeSlider })));
import { UserMenu, type FavoriteEntry } from './components/UserMenu';
import { ShortlistTray } from './components/ShortlistTray';
import { type LayerId, type ColorblindType, getLayerById, getColorblindMode, setColorblindMode, rescaleLayerToData, clearRescaleCache, TIME_SERIES_LAYERS } from './utils/colorScales';
import { readInitialUrlState, useSyncUrlState, buildViewportShareUrl, buildShortlistShareUrl, type UrlViewport, type UrlDraw } from './hooks/useUrlState';
import type { NeighborhoodProperties } from './utils/metrics';
import { computeMetroAverages, timeSeriesYearProp, getAvailableYears } from './utils/metrics';
import { t, getLang, setLang, useI18nVersion, getLocaleLoadError, retryLocaleLoad, type Lang } from './utils/i18n';
import { computeQualityIndices, isCustomWeights, type QualityWeights } from './utils/qualityIndex';
import { getNationalRanges } from './utils/nationalRanges';
import { buildMetroAreaFeatures, clearMetroAreaCache } from './utils/metroAreas';
import { useAllCitiesUnionPreload } from './hooks/useAllCitiesUnionPreload';
import { IS_EMBED, buildEmbedSnippet, buildFullViewUrl, postEmbedHeight } from './utils/embed';
import { findNeighborhoodForPoint } from './utils/geocode';
import { loadHomeReference, saveHomeReference } from './utils/homeReference';
import { getFeatureCenter } from './utils/geometryFilter';
import { toSlug } from './utils/slug';
import { ISOCHRONE_ENABLED, fetchIsochrone, type IsochroneMode } from './utils/isochrone';

const initialUrl = readInitialUrlState();
// CF-1: restore colorblind mode + language from a shared URL before first render,
// so getColorblindMode()/getLang() below pick them up.
if (initialUrl.colorblind) setColorblindMode(initialUrl.colorblind);
if (initialUrl.lang) void setLang(initialUrl.lang);

// QW-3: resolve which region's bounding box contains a coordinate. Region
// bounds can overlap (irregular seutukunnat → rectangular bboxes), so pick the
// most specific (smallest-area) containing region. Best-effort: the precise
// neighborhood is then found via point-in-polygon once that region loads.
function findRegionForCoords(lng: number, lat: number): CityFilter | null {
  let best: CityFilter | null = null;
  let bestArea = Infinity;
  for (const id of REGION_IDS) {
    const vp = CITY_VIEWPORTS[id];
    if (!vp?.bounds) continue;
    const [minLng, minLat, maxLng, maxLat] = vp.bounds;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    const area = (maxLng - minLng) * (maxLat - minLat);
    if (area < bestArea) { bestArea = area; best = id as CityFilter; }
  }
  return best;
}

// L3: lightweight Suspense fallback for user-triggered lazy panels — a centered
// spinner (reusing the UserMenu animate-spin SVG markup) so opening a panel shows
// immediate feedback instead of nothing while its chunk downloads.
const PanelSkeleton: React.FC = () => (
  <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none" aria-hidden="true">
    <svg className="w-6 h-6 animate-spin text-surface-400 dark:text-surface-500" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  </div>
);

const App: React.FC = () => {
  // City filter — declared before useMapData so the hook can load the right region
  const [cityFilter, setCityFilter] = useState<CityFilter>((initialUrl.city as CityFilter) ?? DEFAULT_CITY);

  // Load only the selected region's data (or combined data for "all" view)
  const { data, loading, error, metroAverages, retry } = useMapData(cityFilter);

  // Global all-areas index (properties only) so search finds any area in
  // Finland regardless of the observed subregion. Shares loadAllData's cache.
  const searchIndex = useSearchIndex();

  // Auth
  const { user, loading: authLoading, login, signup, logout, exportData, deleteAccount } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  // QW-1: Onboarding tour
  const [showTour, setShowTour] = useState(false);
  // E9: dismissible locale-load-error notice (non-blocking).
  const [localeErrorDismissed, setLocaleErrorDismissed] = useState(false);
  // QW-3: "Show my area" geolocation status (transient toast).
  const [geoStatus, setGeoStatus] = useState<null | 'loading' | 'denied' | 'outside' | 'unavailable'>(null);
  const pendingGeoRef = useRef<[number, number] | null>(null);
  // C4/C7/C8: one shared transient toast (mirrors the geoStatus role="status"
  // toast + its auto-dismiss timer) for scope-rescale, city-switch and
  // address-only notices. A bumped key restarts the auto-dismiss on repeats.
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const showToast = useCallback((text: string) => setToast({ text, key: Date.now() }), []);
  // QW-2: keyboard shortcuts help overlay.
  const [showShortcuts, setShowShortcuts] = useState(false);
  // PO-2: time slider / historical playback.
  const [timeYear, setTimeYear] = useState<number | null>(initialUrl.year);
  const [timePlaying, setTimePlaying] = useState(false);
  // CF-3: correlation / scatter explorer.
  const [showScatter, setShowScatter] = useState(false);
  const handleToggleScatter = useCallback(() => { setShowScatter((v) => { if (!v) trackEvent('open-scatter'); return !v; }); }, []);
  // CF-4: region comparison & ranking.
  const [showRegionRanking, setShowRegionRanking] = useState(false);
  const handleToggleRegionRanking = useCallback(() => { setShowRegionRanking((v) => { if (!v) trackEvent('open-region-ranking'); return !v; }); }, []);
  // CF-5: travel-time isochrone overlay.
  const [isochronePolygon, setIsochronePolygon] = useState<Feature<Polygon | MultiPolygon> | null>(null);
  const [isochroneMode, setIsochroneMode] = useState<IsochroneMode>('walk');
  const [isochroneBudget, setIsochroneBudget] = useState(20);
  const [isochroneLoading, setIsochroneLoading] = useState(false);
  // E1: distinguishes a genuine fetch failure (network/HTTP) from an empty area,
  // so the panel can surface an error + retry rather than silently showing nothing.
  const [isochroneError, setIsochroneError] = useState(false);

  // Build a PNO→Feature lookup Map for O(1) feature access.
  // Replaces multiple O(n) .find() scans after quality index recomputation
  // and URL restoration (~200 features × 4+ lookups = ~800 iterations saved).
  const pnoFeatureMap = useMemo(() => {
    if (!data) return new globalThis.Map<string, GeoJSON.Feature>();
    const m = new globalThis.Map<string, GeoJSON.Feature>();
    for (const f of data.features) {
      const pno = f.properties?.pno;
      if (pno) m.set(pno as string, f);
    }
    return m;
  }, [data]);

  // Map every postal code to the region (`city`) that owns it, from the global
  // search index. Lets a cross-subregion search resolve which region to switch
  // to so the area's geometry can load.
  const pnoRegionMap = useMemo(() => {
    const m = new globalThis.Map<string, CityFilter>();
    if (!searchIndex) return m;
    for (const f of searchIndex.features) {
      const pno = f.properties?.pno;
      const city = f.properties?.city;
      if (pno && city) m.set(pno as string, city as CityFilter);
    }
    return m;
  }, [searchIndex]);

  const { selected, select, deselect, pinned, pin, unpin, clearPinned, refreshPinned } = useSelectedNeighborhood();
  const [activeLayer, setActiveLayerRaw] = useState<LayerId>(initialUrl.layer ?? 'quality_index');
  const setActiveLayer = useCallback((layer: LayerId) => { trackEvent('change-layer', { layer }); setActiveLayerRaw(layer); }, []);
  const { gridData: rawGridData, loading: gridLoading } = useGridData(activeLayer);
  // Clip grid cells to the loaded region so a region-scoped view (e.g. Helsinki
  // Metro) doesn't leak grid cells from other regions (e.g. Turku, Tampere).
  // For the all-cities view this is effectively a no-op (the region covers all
  // of Finland). IN-2: the test is on each cell's CENTROID, not an arbitrary
  // first ring vertex, so boundary cells no longer leak or clip incorrectly on
  // the ~50k-cell grids.
  //
  // Two-stage clip:
  //  1. `gridClipGeometry` (sync): the region bbox + each region polygon's ring
  //     coordinates and bbox, computed once per loaded dataset.
  //  2. bbox fast-path (sync) → exact point-in-polygon refine (async): a cheap
  //     bbox prefilter keeps us off an O(cells × polygons) PIP sweep, then
  //     @turf/boolean-point-in-polygon (lazy-loaded) refines the survivors
  //     against the actual region outline.
  const gridClipGeometry = useMemo(() => {
    if (!data) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Per-polygon outer/holes rings + bbox, for the point-in-polygon refine step.
    const polygons: { rings: Position[][]; bbox: [number, number, number, number] }[] = [];
    for (const feat of data.features) {
      const g = feat.geometry;
      if (!g) continue;
      const multi = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : null;
      if (!multi) continue;
      for (const poly of multi) {
        let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
        for (const ring of poly) {
          for (const [x, y] of ring) {
            if (x < pMinX) pMinX = x;
            if (y < pMinY) pMinY = y;
            if (x > pMaxX) pMaxX = x;
            if (y > pMaxY) pMaxY = y;
          }
        }
        if (!isFinite(pMinX)) continue;
        polygons.push({ rings: poly as Position[][], bbox: [pMinX, pMinY, pMaxX, pMaxY] });
        if (pMinX < minX) minX = pMinX;
        if (pMinY < minY) minY = pMinY;
        if (pMaxX > maxX) maxX = pMaxX;
        if (pMaxY > maxY) maxY = pMaxY;
      }
    }
    if (!isFinite(minX)) return null;
    return { bbox: [minX, minY, maxX, maxY] as [number, number, number, number], polygons };
  }, [data]);

  // Stage 1: synchronous bbox-of-centroid clip. Serves as the immediate render
  // value (no flash of out-of-region cells) and as the candidate set the async
  // point-in-polygon pass refines. `null` cells fall through to the raw grid.
  const gridDataBboxClipped = useMemo(() => {
    if (!rawGridData) return rawGridData;
    if (!gridClipGeometry) return rawGridData;
    const [minX, minY, maxX, maxY] = gridClipGeometry.bbox;
    const features = rawGridData.features.filter((f) => {
      const c = cellCentroid(f);
      if (!c) return false;
      return c[0] >= minX && c[0] <= maxX && c[1] >= minY && c[1] <= maxY;
    });
    return { ...rawGridData, features };
  }, [rawGridData, gridClipGeometry]);

  // Stage 2: refine the bbox-clipped candidates against the actual region
  // polygon(s). Lazy-loads @turf/boolean-point-in-polygon to keep it out of the
  // main bundle. Until it resolves (and on failure) we render the bbox-clipped
  // set, which is already centroid-correct at the bbox level.
  const [gridData, setGridData] = useState<typeof rawGridData>(gridDataBboxClipped);
  useEffect(() => {
    // Nothing to refine: no grid, or no region geometry → use bbox-clipped value as-is.
    if (!gridDataBboxClipped || !gridClipGeometry || gridClipGeometry.polygons.length === 0) {
      setGridData(gridDataBboxClipped);
      return;
    }
    // Show the bbox-clipped set immediately while the precise pass loads.
    setGridData(gridDataBboxClipped);
    let cancelled = false;
    import('@turf/boolean-point-in-polygon')
      .then(({ booleanPointInPolygon }) => {
        if (cancelled) return;
        const { polygons } = gridClipGeometry;
        const features = gridDataBboxClipped.features.filter((f) => {
          const c = cellCentroid(f);
          if (!c) return false;
          const [cx, cy] = c;
          for (const { rings, bbox } of polygons) {
            // Per-polygon bbox reject keeps PIP off polygons that can't contain the cell.
            if (cx < bbox[0] || cx > bbox[2] || cy < bbox[1] || cy > bbox[3]) continue;
            try {
              if (booleanPointInPolygon(c, { type: 'Polygon', coordinates: rings })) return true;
            } catch { /* skip invalid ring */ }
          }
          return false;
        });
        setGridData({ ...gridDataBboxClipped, features });
      })
      .catch(() => {
        // Lazy import failed — keep the bbox-clipped fallback already set.
      });
    return () => { cancelled = true; };
  }, [gridDataBboxClipped, gridClipGeometry]);
  const [wizardResultPnos, setWizardResultPnos] = useState<string[]>([]);
  const [flyTarget, setFlyTarget] = useState<{ center: [number, number]; zoom?: number; bounds?: [number, number, number, number] } | null>(() => {
    // CF-1: an explicit shared viewport takes precedence over the city preset.
    if (initialUrl.viewport) {
      return { center: initialUrl.viewport.center, zoom: initialUrl.viewport.zoom };
    }
    const city = (initialUrl.city as CityFilter) ?? DEFAULT_CITY;
    const vp = CITY_VIEWPORTS[city];
    if (vp?.bounds) {
      return { center: vp.center, zoom: vp.zoom, bounds: vp.bounds };
    }
    return null;
  });
  // CF-1: latest map camera, captured on moveend (no re-render, no URL churn) so the
  // "copy link to this view" affordance can embed the exact viewport on demand.
  const cameraRef = useRef<UrlViewport | null>(initialUrl.viewport);
  const handleMapMoveEnd = useCallback((cam: UrlViewport) => { cameraRef.current = cam; }, []);
  // Subscribe to i18n changes (language switch + lazy-loaded dictionary arrivals)
  // so App and its non-memoized children re-render whenever translations may
  // have changed. Memoized children call useI18nVersion themselves.
  const i18nVersion = useI18nVersion();
  const lang = getLang();
  const [showRanking, setShowRanking] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showCustomQuality, setShowCustomQuality] = useState(false);
  const [filters, setFilters] = useState<FilterCriterion[]>(initialUrl.filters);
  // CF-2: Quality weights persist to localStorage and (when logged in) sync to the backend.
  const { weights: qualityWeights, setWeights: setQualityWeights } = useQualityWeights(user?.id ?? null);
  // Memoize isCustomWeights to avoid iterating all QUALITY_FACTORS on every App render
  // (called twice in JSX: LayerSelector + NeighborhoodPanel).
  const customWeights = useMemo(() => isCustomWeights(qualityWeights), [qualityWeights]);
  const [colorblind, setColorblind] = useState(getColorblindMode);
  const [showWizard, setShowWizard] = useState(false);
  // CF-4: persistent, shareable wizard priority profile (localStorage + cloud sync).
  const { profile: wizardProfile, setProfile: setWizardProfile } = useWizardProfile(user?.id ?? null);
  const { presets: savedPresets, addPreset: saveFilterPreset, removePreset: removeFilterPreset } = useFilterPresets(user?.id ?? null);
  const [fillOpacity, setFillOpacity] = useState(() => {
    try {
      const saved = localStorage.getItem('naapurustot-fill-opacity');
      if (saved !== null) {
        const n = Number(saved);
        if (isFinite(n) && n >= 0 && n <= 1) return n;
      }
    } catch { /* localStorage unavailable */ }
    return 1;
  });
  // QW-4: Split map view state
  const [splitMode, setSplitMode] = useState(false);
  const [secondaryLayer, setSecondaryLayer] = useState<LayerId>('median_income');
  // IN-1: second grid fetch for the split view's right pane. The hook is lazy —
  // it only fetches when `secondaryLayer` actually has a grid dataset (most don't),
  // so this is free for the common case. Clipped to the loaded region's bbox so a
  // region view doesn't leak national grid cells (cheaper sync clip than the main
  // pane's async point-in-polygon refine, which is overkill for a comparison pane).
  const { gridData: rawSecondaryGrid } = useGridData(secondaryLayer);
  const secondaryGridData = useMemo(
    () => clipGridToData(rawSecondaryGrid, data),
    [rawSecondaryGrid, data],
  );
  const { favorites, isFavorite, toggleFavorite } = useFavorites(user?.id);
  const { recent, addRecent } = useRecentNeighborhoods();
  // QW-2: durable shortlist (distinct from one-tap favorites). QW-2b: cloud-syncs when signed in.
  const { shortlist, isInShortlist, toggleShortlist, removeFromShortlist, clearShortlist, mergeIntoShortlist } = useShortlist(user?.id);
  // CF-14: affordability inputs (localStorage + URL-shared). Hydrates from a shared link;
  // consumed read-only by the wizard's budget fold since the panel calculator was removed.
  const { state: affordabilityState, urlValue: affordabilityUrl } = useAffordability(initialUrl.affordability);
  // CF-5: per-metric similarity weights (localStorage + URL-shared). Lifted here so the
  // URL writer can carry them; the panel drives the controls via the passed props.
  const {
    weights: similarityWeights,
    setWeight: setSimilarityWeight,
    toggle: toggleSimilarityMetric,
    urlWeights: similarityUrlWeights,
  } = useSimilarityMetrics(initialUrl.simWeights);
  const restoredPno = useRef(false);
  // Monotonic version counter to force re-renders when quality indices change
  const [qualityVersion, setQualityVersion] = useState(0);
  // Version counter that bumps once the pre-baked seutukunta outlines fetch
  // resolves, triggering a re-run of buildMetroAreaFeatures with full region boundaries.
  const unionReady = useAllCitiesUnionPreload(cityFilter);
  const [ariaAnnouncement, setAriaAnnouncement] = useState('');
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  const [comparisonScope, setComparisonScope] = useState<ComparisonScope>(initialUrl.scope ?? 'all');

  // C4: explain the region-scoping rescale the FIRST time the user switches to
  // 'region' (persisted flag mirrors the fill-opacity localStorage try/catch).
  // Wrap setComparisonScope so both ComparisonScopeToggle instances trigger it.
  const handleScopeChange = useCallback((next: ComparisonScope) => {
    if (next === 'region') {
      try {
        if (!localStorage.getItem('naapurustot-scope-hint-seen')) {
          localStorage.setItem('naapurustot-scope-hint-seen', '1');
          showToast(t('scope.rescale_note'));
        }
      } catch { /* localStorage unavailable */ }
    }
    setComparisonScope(next);
  }, [showToast]);

  // With per-region loading, single-region data is already scoped — no client-side filter needed.
  // Only the "all" view needs metro area aggregation.
  const singleCityData = useMemo(() => {
    if (!data || cityFilter === 'all') return null;
    return data;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- qualityVersion signals in-place data mutation
  }, [data, cityFilter, qualityVersion]);

  const allCitiesData = useMemo(() => {
    if (!data || cityFilter !== 'all') return null;
    return buildMetroAreaFeatures(data.features) as typeof data;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lang triggers rebuild so metro area names respect language; unionReady signals the pre-baked region outlines fetch resolved; qualityVersion signals in-place data mutation
  }, [data, cityFilter, lang, unionReady, qualityVersion]);

  const filteredData = cityFilter === 'all' ? allCitiesData : singleCityData;

  // Recompute metro averages for the selected city.
  // qualityVersion is included so that averages are recalculated after custom quality weight changes
  // (computeQualityIndices mutates features in-place, so we need this signal to trigger recomputation).
  // For single-city views with no in-place mutations yet (qualityVersion === 0),
  // reuse the pre-computed averages from useMapData — saves iterating ~200 features × ~30 metrics.
  const cityAverages = useMemo(() => {
    if (!filteredData) return metroAverages;
    if (cityFilter !== 'all' && qualityVersion === 0) return metroAverages;
    return computeMetroAverages(filteredData.features);
  }, [filteredData, qualityVersion, cityFilter, metroAverages]);

  // CF-5: custom reference baseline — compare the panel's diffs + radar overlay
  // against a user-pinned neighbourhood instead of the region average. Falls back to
  // the average when no reference is set or when viewing the reference area itself.
  // QW-2: a shared `ref` link wins; otherwise restore the user's persisted "my home".
  const [referencePno, setReferencePno] = useState<string | null>(() => initialUrl.ref ?? loadHomeReference());
  const referenceProps = useMemo(
    () => (referencePno ? (pnoFeatureMap.get(referencePno)?.properties as NeighborhoodProperties | undefined) : undefined),
    [referencePno, pnoFeatureMap],
  );
  const referenceName = referenceProps?.nimi ?? null;
  const effectiveBaseline = useMemo(
    () =>
      referenceProps && referencePno !== selected?.pno
        ? (referenceProps as unknown as Record<string, number>)
        : cityAverages,
    [referenceProps, referencePno, selected?.pno, cityAverages],
  );
  const handleSetReference = useCallback((pno: string | null) => {
    setReferencePno(pno);
    // QW-2: mirror to localStorage so "my home" survives reloads (URL `ref` still
    // carries it for sharing; this restores it when no link is present).
    saveHomeReference(pno);
    trackEvent(pno ? 'set-reference' : 'clear-reference');
  }, []);

  // Rescale layer stops when comparison scope is 'region' and a specific city is selected.
  // Uses a ref to return the same object identity when stops haven't changed,
  // avoiding unnecessary Map layer color transition effects.
  // PO-2: years available for the active time-series metric (single-region only).
  const timeHistoryProp = TIME_SERIES_LAYERS[activeLayer];
  const availableYears = useMemo(() => {
    if (!timeHistoryProp || cityFilter === 'all' || !filteredData) return [];
    return getAvailableYears(filteredData.features, timeHistoryProp);
  }, [timeHistoryProp, cityFilter, filteredData]);

  const prevEffectiveLayerRef = useRef<ReturnType<typeof getLayerById> | null>(null);
  const effectiveLayer = useMemo(() => {
    const base = getLayerById(activeLayer);
    // PO-2: scrub the choropleth to a single year's value while keeping the
    // metric's fixed color scale (so the animation shows change, not a rescale).
    if (timeYear != null && timeHistoryProp) {
      return { ...base, property: timeSeriesYearProp(timeHistoryProp, timeYear) };
    }
    if (comparisonScope !== 'region' || cityFilter === 'all' || !filteredData) {
      prevEffectiveLayerRef.current = base;
      return base;
    }
    const rescaled = rescaleLayerToData(base, filteredData.features);
    const prev = prevEffectiveLayerRef.current;
    // Return previous object if stops are identical to preserve referential equality
    if (prev && prev.id === rescaled.id && prev.stops.length === rescaled.stops.length &&
        prev.stops.every((s, i) => s === rescaled.stops[i])) {
      return prev;
    }
    prevEffectiveLayerRef.current = rescaled;
    return rescaled;
  // colorblind: getLayerById() applies the colorblind palette substitution, so the
  // effective layer must recompute when the mode changes — otherwise the choropleth
  // keeps the old palette until a reload (the cache is cleared in setColorblindMode).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- qualityVersion signals in-place data mutation for quality_index layer
  }, [activeLayer, comparisonScope, cityFilter, filteredData, qualityVersion, timeYear, timeHistoryProp, colorblind]);

  const handleCityChange = useCallback((city: CityFilter) => {
    trackEvent('switch-city', { city });
    setCityFilter(city);
    if (city === 'all') setComparisonScope('all');
    deselect();
    const vp = CITY_VIEWPORTS[city];
    if (vp) {
      setFlyTarget({ center: vp.center, zoom: vp.zoom, bounds: vp.bounds });
    } else {
      setFlyTarget({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    }
  }, [deselect]);

  // CF-6: Draw polygon state
  const [drawMode, setDrawMode] = useState(false);
  const [drawVertices, setDrawVertices] = useState<Position[]>([]);
  const drawVerticesRef = useRef<Position[]>([]);
  const [drawnPolygon, setDrawnPolygon] = useState<Feature<Polygon> | null>(null);

  // Select-areas mode: tap neighborhoods to multi-select them
  const [selectMode, setSelectMode] = useState(false);
  const [selectedAreaPnos, setSelectedAreaPnos] = useState<string[]>([]);

  const handleToggleDraw = useCallback(() => {
    // Exit select mode if entering draw mode
    setSelectMode(false);
    setSelectedAreaPnos([]);
    setDrawMode((v) => {
      if (v) {
        // Exiting draw mode — clear in-progress vertices
        setDrawVertices([]);
        drawVerticesRef.current = [];
      }
      return !v;
    });
  }, []);

  const handleToggleSelectMode = useCallback(() => {
    // Exit draw mode if entering select mode
    setDrawMode(false);
    setDrawVertices([]);
    drawVerticesRef.current = [];
    setSelectMode((v) => {
      if (v) {
        setSelectedAreaPnos([]);
      }
      return !v;
    });
  }, []);

  const handleDrawClick = useCallback((lngLat: [number, number]) => {
    setDrawVertices((prev) => {
      const next = [...prev, lngLat];
      drawVerticesRef.current = next;
      return next;
    });
  }, []);

  const handleDrawDoubleClick = useCallback(() => {
    // Read current vertices from the ref (avoids impure side-effects inside
    // a state updater, which violates React's contract and can break under
    // concurrent rendering).
    const vertices = drawVerticesRef.current;
    setDrawVertices([]);
    drawVerticesRef.current = [];
    if (vertices.length >= 3) {
      const closed = [...vertices, vertices[0]];
      setDrawnPolygon({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [closed],
        },
      });
      setDrawMode(false);
    }
  }, []);

  // Finish draw with explicit button (mobile-friendly alternative to double-click)
  const handleFinishDraw = useCallback(() => {
    handleDrawDoubleClick();
  }, [handleDrawDoubleClick]);

  const selectedAreaPnoSet = useMemo(() => new Set(selectedAreaPnos), [selectedAreaPnos]);

  // Build union polygon from selected neighborhoods for AreaSummaryPanel.
  // Depends on `data` (not `filteredData`) because geometry doesn't change on
  // quality weight adjustments — avoids re-running the Graham scan convex hull
  // on every quality slider tick.
  const selectedAreasPolygon = useMemo<Feature<Polygon> | null>(() => {
    if (selectedAreaPnos.length === 0 || !data) return null;
    const selectedFeatures = data.features.filter(
      (f) => f.properties?.pno && selectedAreaPnoSet.has(f.properties.pno as string)
    );
    if (selectedFeatures.length === 0) return null;

    // Collect all exterior ring coordinates from selected features. Append
    // vertices with a loop, not `push(...ring)` — a postal code's exterior
    // ring can hold ~11k vertices, and spreading that many call arguments
    // overflows the stack on iOS WebKit.
    const allCoords: Position[] = [];
    for (const f of selectedFeatures) {
      const geom = f.geometry;
      if (!geom) continue;
      if (geom.type === 'Polygon') {
        for (const c of geom.coordinates[0]) allCoords.push(c);
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          for (const c of poly[0]) allCoords.push(c);
        }
      }
    }
    if (allCoords.length < 3) return null;

    // Simple Graham scan for convex hull
    const points = allCoords.map(([x, y]) => [x, y] as [number, number]);
    let pivot = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i][1] < points[pivot][1] || (points[i][1] === points[pivot][1] && points[i][0] < points[pivot][0])) {
        pivot = i;
      }
    }
    [points[0], points[pivot]] = [points[pivot], points[0]];
    const p0 = points[0];
    const rest = points.slice(1).sort((a, b) => {
      const cross = (a[0] - p0[0]) * (b[1] - p0[1]) - (b[0] - p0[0]) * (a[1] - p0[1]);
      if (Math.abs(cross) < 1e-10) {
        const da = (a[0] - p0[0]) ** 2 + (a[1] - p0[1]) ** 2;
        const db = (b[0] - p0[0]) ** 2 + (b[1] - p0[1]) ** 2;
        return da - db;
      }
      return -cross;
    });
    const hull: [number, number][] = [p0];
    for (const pt of rest) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2];
        const b = hull[hull.length - 1];
        const cross = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
        // Use strict < 0 (not <= 0) to keep collinear points on the hull.
        if (cross < 0) hull.pop();
        else break;
      }
      hull.push(pt);
    }
    if (hull.length < 3) return null;
    hull.push(hull[0]);

    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [hull] },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- uses data (geometry only) instead of filteredData to avoid recomputing hull on quality weight changes
  }, [selectedAreaPnoSet, data]);

  // Compute PNOs of neighborhoods intersecting with drawn polygon (for boundary snapping).
  // booleanIntersects is lazily imported to keep @turf/boolean-intersects out of the main bundle.
  const [drawnAreaPnos, setDrawnAreaPnos] = useState<string[]>([]);
  useEffect(() => {
    if (!drawnPolygon || !data) { setDrawnAreaPnos([]); return; }
    if (selectedAreaPnos.length > 0) { setDrawnAreaPnos(selectedAreaPnos); return; }
    let cancelled = false;
    import('@turf/boolean-intersects').then(({ booleanIntersects }) => {
      if (cancelled) return;
      const pnos: string[] = [];
      for (const feature of data.features) {
        if (!feature.geometry || !feature.properties?.pno) continue;
        const geom = feature.geometry as Polygon | MultiPolygon;
        if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;
        try {
          if (booleanIntersects(drawnPolygon, feature as Feature<Polygon | MultiPolygon>)) {
            pnos.push(feature.properties.pno as string);
          }
        } catch { /* Skip features with invalid geometry */ }
      }
      setDrawnAreaPnos(pnos);
    }).catch(() => {
      if (!cancelled) setDrawnAreaPnos([]);
    });
    return () => { cancelled = true; };
  }, [drawnPolygon, data, selectedAreaPnos]);

  // CF-9: encode the active analysis area for the share URL. A select-areas
  // selection (pnos present) serializes as a pno list; a free-hand drawn polygon
  // serializes as its ring vertices. Null when no area is active. Tracked via its
  // own key in useSyncUrlState, so this only drives the URL — never a render loop.
  const drawUrlValue = useMemo<UrlDraw | null>(() => {
    if (!drawnPolygon) return null;
    if (selectedAreaPnos.length > 0) return { mode: 'select', pnos: selectedAreaPnos };
    const ring = drawnPolygon.geometry.coordinates[0];
    if (!ring || ring.length < 4) return null; // closed ring needs >=4 points (3 distinct + close)
    // Drop the duplicated closing vertex; deserializeDraw re-closes the ring.
    const vertices = ring.slice(0, -1).map(([lng, lat]) => [lng, lat] as [number, number]);
    return vertices.length >= 3 ? { mode: 'polygon', vertices } : null;
  }, [drawnPolygon, selectedAreaPnos]);

  const handleSelectAreaClick = useCallback((props: NeighborhoodProperties) => {
    const pno = props.pno;
    setSelectedAreaPnos((prev) => {
      const idx = prev.indexOf(pno);
      if (idx >= 0) {
        const next = prev.slice();
        next.splice(idx, 1);
        return next;
      }
      return [...prev, pno];
    });
  }, []);

  const handleFinishSelect = useCallback(() => {
    if (selectedAreasPolygon) {
      setDrawnPolygon(selectedAreasPolygon);
      setSelectMode(false);
    }
  }, [selectedAreasPolygon]);

  const handleClearDraw = useCallback(() => {
    setDrawnPolygon(null);
    setDrawVertices([]);
    drawVerticesRef.current = [];
    setDrawMode(false);
    setSelectMode(false);
    setSelectedAreaPnos([]);
  }, []);

  // Recompute quality indices when comparison scope changes or new data loads.
  // Without `data` in the dependency array, switching regions would use quality indices
  // computed with default weights in processTopology, ignoring custom user weights.
  const prevScopeRef = useRef(comparisonScope);
  const prevCityFilterRef = useRef(cityFilter);
  useEffect(() => {
    if (!data) return;
    // Skip the expensive recomputation on initial data load when scope is 'all'
    // and weights are default — processTopology already computed identical indices.
    // Only recompute when scope/city actually changed, or when custom weights are active.
    const scopeChanged = prevScopeRef.current !== comparisonScope;
    const cityChanged = prevCityFilterRef.current !== cityFilter;
    prevScopeRef.current = comparisonScope;
    prevCityFilterRef.current = cityFilter;
    const needsRecompute = scopeChanged || cityChanged || customWeights;

    if (needsRecompute) {
      // Default ("all") normalizes against national ranges so scores are
      // comparable across regions; "region" scope re-normalizes within the
      // loaded region only.
      const regionScoped = comparisonScope === 'region' && cityFilter !== 'all' && !!filteredData;
      const features = regionScoped ? filteredData!.features : data.features;
      computeQualityIndices(features, qualityWeights, regionScoped ? null : getNationalRanges());
    }
    // Only quality_index changed (computeQualityIndices mutates nothing else),
    // so recompute just the metro-area quality_index averages, not all ~46.
    clearMetroAreaCache({ qualityIndexOnly: true });
    clearRescaleCache();
    setQualityVersion((v) => v + 1);
    // Refresh selected/pinned with updated quality index values (O(1) Map lookups)
    if (selected) {
      const feature = pnoFeatureMap.get(selected.pno);
      if (feature?.properties) select(feature.properties as NeighborhoodProperties);
    }
    if (pinned.length > 0) {
      const updated = pinned
        .map((p) => pnoFeatureMap.get(p.pno)?.properties as NeighborhoodProperties | undefined)
        .filter((p): p is NeighborhoodProperties => p != null);
      refreshPinned(updated);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- qualityWeights changes are handled by the debounced handleQualityWeightsChange; selected/pinned/pnoFeatureMap are read from current render values
  }, [comparisonScope, cityFilter, data]);

  // Restore neighborhood selection and pinned comparisons from URL once data is loaded
  useEffect(() => {
    if (!data || restoredPno.current) return;
    // Only latch the "restored" flag once the requested pno/compare pins actually
    // resolve (or there was nothing to restore). A deep link can target a region
    // other than the initially-loaded one — e.g. ?pno=20100 (Turku) under the
    // default helsinki_metro view — in which case the lookup misses. Latching
    // unconditionally would permanently skip the restore; leaving the flag unset
    // lets this effect retry when the matching region's data later arrives.
    let restoredSomething = !initialUrl.pno && (!initialUrl.compare || initialUrl.compare.length === 0);
    if (initialUrl.pno) {
      const feature = pnoFeatureMap.get(initialUrl.pno);
      if (feature?.properties) {
        select(feature.properties as NeighborhoodProperties);
        restoredSomething = true;
      }
    }
    // QW-3: Restore pinned comparisons from URL
    if (initialUrl.compare && initialUrl.compare.length > 0) {
      for (const pno of initialUrl.compare) {
        const feature = pnoFeatureMap.get(pno);
        if (feature?.properties) {
          pin(feature.properties as NeighborhoodProperties);
          restoredSomething = true;
        }
      }
    }
    if (restoredSomething) restoredPno.current = true;
  }, [data, select, pin, pnoFeatureMap]);

  // CF-1 / QW-2: apply shared analytical state from the URL once on mount. Custom
  // weights override the locally-stored set (so a shared link reproduces the
  // author's index); the shortlist is merged so the recipient keeps their own.
  useEffect(() => {
    if (initialUrl.weights) setQualityWeights(initialUrl.weights);
    if (initialUrl.shortlist.length > 0) mergeIntoShortlist(initialUrl.shortlist);
    // CF-4: restore a shared wizard priority profile so the finder reopens pre-filled.
    if (initialUrl.wizardProfile) setWizardProfile(initialUrl.wizardProfile);
    // CF-9: restore a shared drawn/selected analysis area so AreaSummaryPanel reopens.
    // Free-hand polygons reconstruct immediately (no data needed); select-areas
    // selections only set the pnos here — the latched effect below promotes them
    // to a hull polygon once the region's geometry has loaded.
    const draw = initialUrl.draw;
    if (draw) {
      if (draw.mode === 'polygon') {
        const closed = [...draw.vertices, draw.vertices[0]];
        setDrawnPolygon({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closed] } });
      } else {
        setSelectedAreaPnos(draw.pnos);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // CF-9: promote a restored select-areas selection to a drawn polygon once the
  // selected-areas hull can be computed (needs the region geometry to be loaded).
  // Latches after the first promotion so later selection edits aren't overridden.
  const drawRestoredRef = useRef(initialUrl.draw?.mode !== 'select');
  useEffect(() => {
    if (drawRestoredRef.current) return;
    if (selectedAreasPolygon) {
      drawRestoredRef.current = true;
      setDrawnPolygon(selectedAreasPolygon);
    }
  }, [selectedAreasPolygon]);

  // Memoize pinned PNO array to avoid new references on every render.
  // Without this, Map's pinnedPnos useEffect fires on every App re-render,
  // recreating the pinned highlight layer unnecessarily.
  const pinnedPnos = useMemo(() => pinned.map((p) => p.pno), [pinned]);

  // Memoize isPinned to avoid creating a new boolean on every render,
  // which would defeat React.memo on NeighborhoodPanel.
  const isPinned = useMemo(() => pinned.some((p) => p.pno === selected?.pno), [pinned, selected?.pno]);

  // Stable features array for similarity computation in NeighborhoodPanel.
  // filteredData?.features changes reference on every qualityVersion/lang bump,
  // but similarity only depends on structural metrics (income, unemployment, etc.)
  // that don't change. Without this, findSimilarNeighborhoods (O(n×m)) re-runs
  // on every quality weight adjustment.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on data/cityFilter, not filteredData, to avoid re-running similarity on qualityVersion bumps
  const allFeatures = useMemo(() => filteredData?.features ?? undefined, [data, cityFilter]);

  // Keep URL in sync with current state (including pinned comparisons)
  // Suppress URL writes until data is loaded and initial URL state (pno, compare) has been consumed
  // by the restoration effect. Without this, the debounced write fires with empty values during
  // loading and clears the initial URL params before they can be restored.
  useSyncUrlState(selected?.pno ?? null, activeLayer, pinnedPnos, cityFilter, !!data, {
    scope: comparisonScope,
    year: timeYear,
    colorblind,
    lang,
    ref: referencePno,
    filters,
    // CF-1: carry custom quality weights and an active isochrone, plus the QW-2 shortlist.
    weights: qualityWeights,
    isochrone: isochronePolygon ? { mode: isochroneMode, budget: isochroneBudget } : null,
    shortlist,
    affordability: affordabilityUrl,
    simWeights: similarityUrlWeights,
    // CF-9: shared drawn/selected analysis area.
    draw: drawUrlValue,
    // CF-4: shared wizard priority profile (only emitted when non-default).
    wizardProfile,
  });

  // Recompute quality indices when custom weights change.
  // The slider state updates immediately for responsiveness, but the expensive
  // recomputation (iterates all features) is debounced to avoid jank during drags.
  const qualityDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Use refs for values read inside the debounced timeout to avoid stale closures.
  // Without this, selecting a new neighborhood during the 150ms debounce window
  // would cause the timeout to overwrite the new selection with the old one.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const comparisonScopeRef = useRef(comparisonScope);
  comparisonScopeRef.current = comparisonScope;
  const cityFilterRef = useRef(cityFilter);
  cityFilterRef.current = cityFilter;
  const filteredDataRef = useRef(filteredData);
  filteredDataRef.current = filteredData;
  const pnoFeatureMapRef = useRef(pnoFeatureMap);
  pnoFeatureMapRef.current = pnoFeatureMap;
  const pnoRegionMapRef = useRef(pnoRegionMap);
  pnoRegionMapRef.current = pnoRegionMap;
  // Postal code awaiting selection after a cross-subregion search switches
  // regions — resolved once the target region's geometry finishes loading.
  const pendingSearchRef = useRef<string | null>(null);
  // CF-2: track the latest weights set via slider edits so a server-sync update
  // from useQualityWeights can be detected and routed through the same recompute path.
  const lastInteractiveWeightsRef = useRef(qualityWeights);
  const handleQualityWeightsChange = useCallback(
    (newWeights: QualityWeights) => {
      lastInteractiveWeightsRef.current = newWeights;
      setQualityWeights(newWeights);
      if (qualityDebounceRef.current) clearTimeout(qualityDebounceRef.current);
      qualityDebounceRef.current = setTimeout(() => {
        if (data) {
          const regionScoped = comparisonScopeRef.current === 'region' && cityFilterRef.current !== 'all' && !!filteredDataRef.current;
          const features = regionScoped ? filteredDataRef.current!.features : data.features;
          computeQualityIndices(features, newWeights, regionScoped ? null : getNationalRanges());
          clearMetroAreaCache({ qualityIndexOnly: true });
          clearRescaleCache();
          setQualityVersion((v) => v + 1);
          // Update selected neighborhood if it exists (O(1) Map lookup)
          const sel = selectedRef.current;
          const lookup = pnoFeatureMapRef.current;
          if (sel) {
            const feature = lookup.get(sel.pno);
            if (feature?.properties) {
              select(feature.properties as NeighborhoodProperties);
            }
          }
          // Update pinned neighborhoods so comparison panel reflects new quality indices
          const pins = pinnedRef.current;
          if (pins.length > 0) {
            const updated = pins
              .map((p) => lookup.get(p.pno)?.properties as NeighborhoodProperties | undefined)
              .filter((p): p is NeighborhoodProperties => p != null);
            refreshPinned(updated);
          }
        }
      }, 150);
    },
    [data, select, refreshPinned, setQualityWeights],
  );
  // Clean up debounce timer on unmount
  useEffect(() => () => { if (qualityDebounceRef.current) clearTimeout(qualityDebounceRef.current); }, []);

  // CF-2: when qualityWeights changes from outside the slider handler
  // (e.g., adopted from server on login), recompute quality indices.
  useEffect(() => {
    if (lastInteractiveWeightsRef.current === qualityWeights) return;
    lastInteractiveWeightsRef.current = qualityWeights;
    if (!data) return;
    const regionScoped = comparisonScopeRef.current === 'region' && cityFilterRef.current !== 'all' && !!filteredDataRef.current;
    const features = regionScoped ? filteredDataRef.current!.features : data.features;
    computeQualityIndices(features, qualityWeights, regionScoped ? null : getNationalRanges());
    clearMetroAreaCache({ qualityIndexOnly: true });
    clearRescaleCache();
    setQualityVersion((v) => v + 1);
    const sel = selectedRef.current;
    const lookup = pnoFeatureMapRef.current;
    if (sel) {
      const feature = lookup.get(sel.pno);
      if (feature?.properties) select(feature.properties as NeighborhoodProperties);
    }
    const pins = pinnedRef.current;
    if (pins.length > 0) {
      const updated = pins
        .map((p) => lookup.get(p.pno)?.properties as NeighborhoodProperties | undefined)
        .filter((p): p is NeighborhoodProperties => p != null);
      refreshPinned(updated);
    }
  }, [qualityWeights, data, select, refreshPinned]);

  const handleHover = useCallback(
    (props: NeighborhoodProperties | null, x: number, y: number) => {
      if (selectedRef.current) return;
      setTooltipData(props ? { props, x, y } : null);
    },
    [],
  );

  const handleClick = useCallback(
    (props: NeighborhoodProperties) => {
      select(props);
      setTooltipData(null);
      setAriaAnnouncement(`${t('aria.neighborhood_selected')}: ${props.nimi}`);
    },
    [select],
  );

  // Refs for values read inside handleSearch — avoids recreating the callback
  // when filteredData/cityFilter change (which would defeat React.memo on SearchBar).
  const dataRef = useRef(data);
  dataRef.current = data;
  // Select a neighborhood feature (with geometry) and fly the map to its extent.
  const selectAndFly = useCallback(
    (feature: GeoJSON.Feature) => {
      const props = feature.properties as NeighborhoodProperties;
      select(props);
      trackEvent('view-neighborhood', { pno: props.pno, name: props.nimi || props.pno });
      const center = getFeatureCenter(feature);
      addRecent({ pno: props.pno, name: props.nimi || props.pno, center });
      // Use feature bounding box for a better zoom fit (lazy-load @turf/bbox).
      import('@turf/bbox').then(({ bbox }) => {
        const [minLng, minLat, maxLng, maxLat] = bbox(feature);
        setFlyTarget({ center, bounds: [minLng, minLat, maxLng, maxLat] });
      }).catch(() => {
        setFlyTarget({ center });
      });
    },
    [select, addRecent],
  );

  const handleSearch = useCallback(
    (pno: string, center: [number, number]) => {
      // Address-only result (no postal code) — fly straight to the geocoded point.
      if (!pno) {
        setFlyTarget({ center });
        // C8: tell the user we have no neighborhood data for this address.
        showToast(t('address.no_neighborhood'));
        return;
      }

      const currentCity = cityFilterRef.current;
      const currentFiltered = filteredDataRef.current;
      const lookup = pnoFeatureMapRef.current;
      // Feature with geometry from the currently loaded region, if present.
      const localFeature = lookup.get(pno)
        ?? currentFiltered?.features.find((f) => f.properties?.pno === pno);

      if (localFeature?.properties && localFeature.geometry) {
        // Geometry is already loaded — select and fly immediately.
        selectAndFly(localFeature);
        return;
      }

      // No geometry loaded for this area: it lives in a different subregion, or
      // we're in the all-cities view (which holds properties only). Resolve its
      // owning region, switch to it, and defer selection until geometry loads.
      // This both enables cross-subregion search and avoids flying to [0,0],
      // which getFeatureCenter returns for the index's null-geometry features.
      const targetRegion = pnoRegionMapRef.current.get(pno)
        ?? (localFeature?.properties?.city as CityFilter | undefined);
      if (targetRegion && targetRegion !== currentCity) {
        pendingSearchRef.current = pno;
        setCityFilter(targetRegion);
        deselect();
        // C7: surface the forced region switch so the map jump isn't a surprise.
        showToast(t('city.switched_to').replace('{city}', t('city.' + targetRegion)));
        return;
      }

      // Same region but geometry isn't available yet (or region unknown) —
      // best-effort fly to the provided center, but never to the [0,0] sentinel.
      if (center[0] !== 0 || center[1] !== 0) {
        setFlyTarget({ center });
      }
    },
    [selectAndFly, deselect, showToast],
  );

  // Resolve a pending cross-subregion search once the target region's geometry
  // has loaded (analogous to the geolocation resolver). pendingSearchRef is
  // cleared on first resolution so later data changes re-run this as a no-op.
  useEffect(() => {
    const pno = pendingSearchRef.current;
    if (!pno || !filteredData) return;
    const feature = pnoFeatureMap.get(pno);
    if (!feature?.properties || !feature.geometry) return; // region still loading
    pendingSearchRef.current = null;
    selectAndFly(feature);
  }, [filteredData, pnoFeatureMap, selectAndFly]);

  // QW-3: "Show my area" — geolocate the visitor, switch to their region if
  // needed, and select the containing neighborhood. Graceful fallbacks for
  // denied permission, missing geolocation, and points outside coverage.
  const handleUseLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('unavailable');
      return;
    }
    trackEvent('use-location');
    setGeoStatus('loading');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        const target = findRegionForCoords(coords[0], coords[1]);
        if (!target) { setGeoStatus('outside'); return; }
        // Already viewing the right region with geometry loaded → resolve now.
        const current = dataRef.current;
        if (cityFilterRef.current === target && current) {
          const f = await findNeighborhoodForPoint(coords, current.features);
          if (f?.properties) {
            const props = f.properties as NeighborhoodProperties;
            select(props);
            addRecent({ pno: props.pno, name: props.nimi || props.pno, center: getFeatureCenter(f) });
            setFlyTarget({ center: getFeatureCenter(f) });
            setGeoStatus(null);
            return;
          }
        }
        // Otherwise switch to the user's region; the deferred resolver below
        // selects the neighborhood once that region's data finishes loading.
        pendingGeoRef.current = coords;
        setFlyTarget({ center: coords, zoom: 12 });
        if (cityFilterRef.current !== target) {
          setCityFilter(target);
          deselect();
        }
        setGeoStatus(null);
      },
      (err) => {
        // E2: TIMEOUT / POSITION_UNAVAILABLE are device/permission failures, not
        // out-of-coverage coordinates — only genuinely off-map coords say 'outside'.
        setGeoStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }, [select, addRecent, deselect]);

  // QW-3: resolve a pending geolocation once the target region's data loads.
  // pendingGeoRef is cleared after the first resolution, so later filteredData
  // changes (quality recompute, language) re-run this as a no-op.
  useEffect(() => {
    if (!pendingGeoRef.current || !filteredData) return;
    const coords = pendingGeoRef.current;
    let cancelled = false;
    findNeighborhoodForPoint(coords, filteredData.features).then((f) => {
      if (cancelled) return;
      pendingGeoRef.current = null;
      if (f?.properties) {
        const props = f.properties as NeighborhoodProperties;
        select(props);
        addRecent({ pno: props.pno, name: props.nimi || props.pno, center: getFeatureCenter(f) });
        setFlyTarget({ center: getFeatureCenter(f) });
      } else {
        setGeoStatus('outside');
      }
    }).catch(() => { if (!cancelled) { pendingGeoRef.current = null; } });
    return () => { cancelled = true; };
  }, [filteredData, select, addRecent]);

  // QW-3: auto-dismiss transient geolocation status toasts (errors only).
  useEffect(() => {
    if (!geoStatus || geoStatus === 'loading') return;
    const id = setTimeout(() => setGeoStatus(null), 4000);
    return () => clearTimeout(id);
  }, [geoStatus]);

  // C4/C7/C8: auto-dismiss the shared transient toast (re-armed on each new key).
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  // PO-2: when the active time-series metric (or its years) changes, snap the
  // slider to the most recent year; deactivate (and stop playback) otherwise.
  useEffect(() => {
    if (timeHistoryProp && cityFilter !== 'all' && availableYears.length > 1) {
      setTimeYear(availableYears[availableYears.length - 1]);
    } else {
      setTimeYear(null);
      setTimePlaying(false);
    }
  }, [timeHistoryProp, cityFilter, availableYears]);

  // PO-2: playback loop — advance through years while playing.
  useEffect(() => {
    if (!timePlaying || availableYears.length < 2) return;
    const id = setInterval(() => {
      setTimeYear((y) => {
        const i = y == null ? -1 : availableYears.indexOf(y);
        return availableYears[(i + 1) % availableYears.length];
      });
    }, 900);
    return () => clearInterval(id);
  }, [timePlaying, availableYears]);

  // PO-2: manual scrub pauses playback.
  const handleScrubYear = useCallback((year: number) => {
    setTimePlaying(false);
    setTimeYear(year);
  }, []);
  const handleToggleTimePlay = useCallback(() => setTimePlaying((p) => !p), []);

  // CF-5: fetch and show a travel-time isochrone for the selected neighborhood.
  const handleIsochroneChange = useCallback(async (mode: IsochroneMode, budget: number) => {
    const sel = selectedRef.current;
    if (!sel) return;
    const feature = pnoFeatureMapRef.current.get(sel.pno);
    if (!feature?.geometry) return;
    const [lng, lat] = getFeatureCenter(feature);
    setIsochroneMode(mode);
    setIsochroneBudget(budget);
    setIsochroneLoading(true);
    setIsochroneError(false);
    const result = await fetchIsochrone(sel.pno, lng, lat, mode, budget);
    // Ignore a stale response if the selection changed mid-request.
    if (selectedRef.current?.pno !== sel.pno) { setIsochroneLoading(false); return; }
    if (result.ok) {
      setIsochronePolygon(result.feature);
      setIsochroneError(false);
    } else {
      // E1: genuine fetch failure — keep any prior overlay cleared and flag the error.
      setIsochronePolygon(null);
      setIsochroneError(true);
    }
    setIsochroneLoading(false);
  }, []);
  const handleIsochroneClear = useCallback(() => { setIsochronePolygon(null); setIsochroneError(false); }, []);

  // CF-5: clear the isochrone overlay whenever the selected neighborhood changes
  // (or is deselected) so a stale reachable-area doesn't linger on a new area.
  useEffect(() => { setIsochronePolygon(null); setIsochroneError(false); }, [selected?.pno]);

  // CF-1: re-fetch a shared isochrone once its neighbourhood has been restored. Runs
  // once; the clear-on-selection effect above fires first for this same pno change.
  const isoRestoredRef = useRef(false);
  useEffect(() => {
    if (isoRestoredRef.current) return;
    if (!initialUrl.isochrone || !initialUrl.pno || !ISOCHRONE_ENABLED) { isoRestoredRef.current = true; return; }
    if (selected?.pno === initialUrl.pno) {
      isoRestoredRef.current = true;
      void handleIsochroneChange(initialUrl.isochrone.mode, initialUrl.isochrone.budget);
    }
  }, [selected?.pno, handleIsochroneChange]);

  // C6: full reset — return to the default region AND clear all transient state
  // (selection, pins, drawn/selected area, filters, panels, wizard highlight, scope).
  const handleResetView = useCallback(() => {
    handleCityChange(DEFAULT_CITY);
    deselect();
    clearPinned();
    handleClearDraw();
    setFilters([]);
    setShowFilter(false);
    setShowRanking(false);
    setWizardResultPnos([]);
    setComparisonScope('all');
  }, [handleCityChange, deselect, clearPinned, handleClearDraw]);

  const handleLangChange = useCallback((next: Lang) => {
    if (next === lang) return;
    trackEvent('switch-language', { lang: next });
    // setLang notifies useI18nVersion subscribers synchronously (so the active
    // button highlight updates immediately) and again when the lazy-loaded
    // dictionary arrives (so memoized children re-render with real translations
    // instead of staying on the Finnish fallback).
    void setLang(next);
  }, [lang]);

  const handleColorblindChange = useCallback((mode: ColorblindType) => {
    setColorblindMode(mode);
    setColorblind(mode);
  }, []);

  const opacityPersistRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleFillOpacityChange = useCallback((v: number) => {
    setFillOpacity(v);
    if (opacityPersistRef.current) clearTimeout(opacityPersistRef.current);
    opacityPersistRef.current = setTimeout(() => {
      try { localStorage.setItem('naapurustot-fill-opacity', String(v)); } catch { /* unavailable */ }
    }, 300);
  }, []);

  // Compute matching neighborhood PNOs for filter-aware map rendering.
  // computeMatchingPnos returns a stable empty Set when filters are empty,
  // so Map's filter effect won't re-run unnecessarily.
  const filterMatchPnos = useMemo(
    () => computeMatchingPnos(showFilter ? filteredData : null, filters),
    [filteredData, filters, showFilter],
  );

  // Close ranking when opening filter and vice versa
  const toggleFilter = useCallback(() => {
    setShowFilter((v) => {
      if (!v) { setShowRanking(false); trackEvent('open-filter'); }
      return !v;
    });
  }, []);

  const toggleRanking = useCallback(() => {
    setShowRanking((v) => {
      if (!v) { setShowFilter(false); trackEvent('open-ranking'); }
      return !v;
    });
  }, []);

  // Stable callbacks for memoized children (avoids new refs on every App re-render)
  const handleOpenWizard = useCallback(() => { trackEvent('open-wizard'); setShowWizard(true); }, []);
  const handleClearWizardHighlight = useCallback(() => setWizardResultPnos([]), []);
  const handleToggleSplitMode = useCallback(() => { trackEvent('toggle-split-view'); setSplitMode((v) => !v); }, []);
  const handleToggleCustomQuality = useCallback(() => setShowCustomQuality((v) => !v), []);
  const handleCloseRanking = useCallback(() => setShowRanking(false), []);
  const handleCloseFilter = useCallback(() => setShowFilter(false), []);
  const handleCloseCustomQuality = useCallback(() => setShowCustomQuality(false), []);
  const handleCloseWizard = useCallback(() => setShowWizard(false), []);
  const handleWizardShowOnMap = useCallback((pnos: string[]) => {
    setWizardResultPnos(pnos);
    setShowWizard(false);
  }, []);
  // CF-4: persist the wizard's priority profile (localStorage + cloud + share URL).
  const handleSaveWizardProfile = useCallback((answers: WizardAnswers) => {
    setWizardProfile(answers);
  }, [setWizardProfile]);
  // CF-4: map the wizard's stated priorities onto the live Quality Index weights, so
  // the headline map score reflects them continuously. Persists the profile too.
  const handleApplyWizardToMap = useCallback((answers: WizardAnswers) => {
    setWizardProfile(answers);
    handleQualityWeightsChange(wizardAnswersToQualityWeights(answers));
  }, [setWizardProfile, handleQualityWeightsChange]);
  const handleFlyTo = useCallback((center: [number, number]) => setFlyTarget({ center }), []);

  // Memoize the headerSlot to avoid creating new React elements on every App render.
  // Without this, LayerSelector (React.memo) re-renders on every unrelated state change.
  const layerSelectorHeaderSlot = useMemo(() => (
    <div className="rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
      <ComparisonScopeToggle
        scope={comparisonScope}
        onChange={handleScopeChange}
        disabled={cityFilter === 'all'}
      />
    </div>
  ), [comparisonScope, cityFilter, handleScopeChange]);
  // Stable callbacks for NeighborhoodPanel props — prevents new closures on every render
  // which would defeat React.memo on the panel.
  const handleToggleFavorite = useCallback(() => {
    if (selected) toggleFavorite(selected.pno);
  }, [selected, toggleFavorite]);
  // Stable shortlist toggle — an inline arrow here would be a fresh prop every App
  // render, defeating NeighborhoodPanel's React.memo (and re-rendering the largest
  // mounted subtree on every unrelated state change, e.g. time-slider playback).
  const handleToggleShortlist = useCallback(() => {
    if (selected) toggleShortlist(selected.pno);
  }, [selected, toggleShortlist]);
  const handleExploreCity = useCallback((cityId: string) => {
    handleCityChange(cityId as CityFilter);
  }, [handleCityChange]);

  // Build favorite entries with names for UserMenu.
  // Uses pnoFeatureMap for real neighborhoods and i18n for metro area region IDs.
  // Does NOT depend on filteredData/qualityVersion since favorites only need names.
  const regionIdSet = useMemo(() => new Set<string>(REGION_IDS), []);
  const favoriteEntries: FavoriteEntry[] = useMemo(() => {
    return favorites
      .map(pno => {
        const feature = pnoFeatureMap.get(pno);
        if (feature) {
          const name = (feature.properties?.nimi as string) ?? pno;
          return { pno, name };
        }
        // Metro area or region ID — resolve name from i18n
        if (regionIdSet.has(pno)) {
          return { pno, name: t(`city.${pno}`) };
        }
        return null;
      })
      .filter((e): e is FavoriteEntry => e !== null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lang triggers name refresh; pnoFeatureMap covers real neighborhoods
  }, [favorites, pnoFeatureMap, regionIdSet, lang]);

  const pendingFavoritePno = useRef<string | null>(null);
  const handleSelectFavorite = useCallback((pno: string) => {
    // Neighborhood lookup — use pnoFeatureMap for real neighborhoods,
    // then fall back to filteredData (via ref) for synthetic metro area features
    const feature = pnoFeatureMapRef.current.get(pno)
      ?? filteredDataRef.current?.features.find(f => f.properties?.pno === pno);
    if (feature?.properties) {
      const city = feature.properties.city as string | undefined;
      if (city && feature.properties._isMetroArea) {
        setCityFilter('all');
      } else if (city && cityFilterRef.current !== 'all' && city !== cityFilterRef.current) {
        setCityFilter(city as CityFilter);
        // C7: surface the forced region switch (mirrors handleSearch).
        showToast(t('city.switched_to').replace('{city}', t('city.' + city)));
      }
      select(feature.properties as NeighborhoodProperties);
      return;
    }
    // Metro area favorite when not currently in "all" view — switch and defer selection
    if (regionIdSet.has(pno)) {
      pendingFavoritePno.current = pno;
      setCityFilter('all');
    }
  }, [select, setCityFilter, regionIdSet, showToast]);

  // QW-2: shortlist tray entries (pno → name) and the "compare" action, which pins
  // the shortlist up to the comparison max (pin() dedupes + caps internally).
  const shortlistEntries = useMemo(
    () => shortlist.map((pno) => ({ pno, name: (pnoFeatureMap.get(pno)?.properties?.nimi as string | undefined) ?? pno })),
    [shortlist, pnoFeatureMap],
  );
  // CF-10: resolve a pno's map feature/geometry for the GeoJSON data exports
  // (shortlist tray + comparison set). Geometry lives only in pnoFeatureMap.
  const featureFor = useCallback(
    (pno: string): GeoJSON.Feature | null => pnoFeatureMap.get(pno) ?? null,
    [pnoFeatureMap],
  );
  const geometryFor = useCallback(
    (pno: string): GeoJSON.Geometry | null => pnoFeatureMap.get(pno)?.geometry ?? null,
    [pnoFeatureMap],
  );
  const handleCompareShortlist = useCallback(() => {
    trackEvent('shortlist-compare');
    for (const pno of shortlist) {
      const f = pnoFeatureMapRef.current.get(pno);
      if (f?.properties) pin(f.properties as NeighborhoodProperties);
    }
  }, [shortlist, pin]);
  // CF-11: a MINIMAL share link carrying ONLY the shortlist + city, so a recipient
  // gets the candidate set on a clean view (none of the author's layer/filter/weight state).
  const shortlistShareUrl = useMemo(
    () => buildShortlistShareUrl(shortlist, cityFilter),
    [shortlist, cityFilter],
  );

  // Resolve pending metro area favorite after allCitiesData becomes available
  useEffect(() => {
    if (!pendingFavoritePno.current || !filteredData) return;
    const pno = pendingFavoritePno.current;
    const feature = filteredData.features.find(f => f.properties?.pno === pno);
    if (feature?.properties) {
      pendingFavoritePno.current = null;
      select(feature.properties as NeighborhoodProperties);
    }
  }, [filteredData, select]);

  // IN-5: Dynamic SEO — update document title, meta, and canonical when neighborhood selected.
  // Cache meta element refs once to avoid 5 × document.querySelector on every selection change.
  const seoRefs = useRef<{ canonical: Element | null; ogUrl: Element | null; desc: Element | null; ogTitle: Element | null; ogDesc: Element | null } | null>(null);
  useEffect(() => {
    if (!seoRefs.current) {
      seoRefs.current = {
        canonical: document.querySelector('link[rel="canonical"]'),
        ogUrl: document.querySelector('meta[property="og:url"]'),
        desc: document.querySelector('meta[name="description"]'),
        ogTitle: document.querySelector('meta[property="og:title"]'),
        ogDesc: document.querySelector('meta[property="og:description"]'),
      };
    }
    const { canonical, ogUrl, desc, ogTitle, ogDesc } = seoRefs.current;
    if (selected) {
      const qi = selected.quality_index != null ? ` — ${t('panel.quality_index')}: ${selected.quality_index}` : '';
      document.title = `${selected.nimi} (${selected.pno})${qi} | naapurustot.fi`;
      if (desc) {
        const name = lang === 'sv' ? (selected.namn ?? selected.nimi) : selected.nimi;
        desc.setAttribute('content', `${name} (${selected.pno}): ${t('meta.area_description_tail')}`);
      }
      if (ogTitle) ogTitle.setAttribute('content', `${selected.nimi} — naapurustot.fi`);
      if (ogDesc) ogDesc.setAttribute('content', `${selected.nimi} (${selected.pno}) — ${t('panel.quality_index')}: ${selected.quality_index ?? '—'}`);
      const pnoUrl = `https://naapurustot.fi/?pno=${selected.pno}`;
      if (canonical) canonical.setAttribute('href', pnoUrl);
      if (ogUrl) ogUrl.setAttribute('content', pnoUrl);
    } else {
      document.title = 'naapurustot — naapurustot kartalla | naapurustot.fi';
      if (desc) desc.setAttribute('content', t('meta.site_description'));
      if (canonical) canonical.setAttribute('href', 'https://naapurustot.fi/');
      if (ogUrl) ogUrl.setAttribute('content', 'https://naapurustot.fi/');
    }
    // i18nVersion in deps so the description re-renders when the lazy en/sv
    // dictionary arrives — otherwise non-FI first paint keeps the FI fallback.
  }, [selected, lang, i18nVersion]);

  // Dynamic HTML lang attribute for SEO
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // ARIA: announce layer changes (skip initial mount to avoid spurious announcement)
  const layerMountedRef = useRef(false);
  useEffect(() => {
    if (!layerMountedRef.current) {
      layerMountedRef.current = true;
      return;
    }
    const layer = getLayerById(activeLayer);
    setAriaAnnouncement(`${t('aria.layer_changed')} ${t(layer.labelKey)}`);
  }, [activeLayer]);

  // QW-1: Show onboarding tour on first visit, after data has loaded.
  // Skip when the user deep-linked to a specific neighborhood — they're here
  // for that area, not for a chrome walkthrough. Also skip under browser
  // automation (Playwright/WebDriver) so e2e tests aren't blocked by the
  // tour's click-capturing overlay. Manual launch via Settings still works.
  // QW-7: Also skip in embed mode — the chrome the tour points at isn't visible.
  useEffect(() => {
    if (IS_EMBED) return;
    if (loading || !data) return;
    if (initialUrl.pno) return;
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    try {
      if (localStorage.getItem('naapurustot-onboarding-seen')) return;
    } catch { /* localStorage unavailable */ }
    setShowTour(true);
  }, [loading, data]);

  const handleCloseTour = useCallback(() => {
    try { localStorage.setItem('naapurustot-onboarding-seen', '1'); } catch { /* unavailable */ }
    setShowTour(false);
  }, []);

  const handleShowTour = useCallback(() => {
    setShowTour(true);
  }, []);

  // QW-2: open the keyboard shortcuts overlay from Settings.
  const handleShowShortcuts = useCallback(() => {
    setShowShortcuts(true);
  }, []);

  // QW-7: build the iframe embed snippet for the current map state. X1: exposed as
  // a getter so SettingsDropdown can reveal it for a manual select-all copy fallback.
  const getEmbedSnippet = useCallback((): string => buildEmbedSnippet({
    pno: selected?.pno ?? null,
    layer: activeLayer,
    city: cityFilter,
    compare: pinnedPnos,
    scope: comparisonScope,
    year: timeYear,
    colorblind,
    lang,
  }), [selected?.pno, activeLayer, cityFilter, pinnedPnos, comparisonScope, timeYear, colorblind, lang]);

  // CF-1: build a shareable link to the exact configured view — selection, layer,
  // comparison, scope, year, filters, custom weights, isochrone and shortlist are
  // already kept in window.location by useSyncUrlState; here we additionally bake in
  // the current map camera (viewport) so the link reproduces the pan/zoom.
  // X1/X3: exposed as a getter so both the header Share control and SettingsDropdown's
  // manual-copy fallback can read the exact same URL.
  // X4: when an area is selected, share its localized profile URL instead — that
  // route already has correct, prerendered, per-area OG/Twitter cards (generated by
  // scripts/prerender.mjs), so deep links unfurl as the right area/metric/language
  // card. The path shape mirrors NeighborhoodProfilePage's canonicalByLang map
  // (src/pages/NeighborhoodProfilePage.tsx:238-242). With nothing selected we keep
  // the existing root viewport-share URL (which still serves generic root OG).
  const getShareUrl = useCallback((): string => {
    if (selected) {
      const slug = toSlug(selected.pno, selected.nimi);
      const profilePathByLang: Record<Lang, string> = {
        fi: `/alue/${slug}/`,
        en: `/en/area/${slug}/`,
        sv: `/sv/omrade/${slug}/`,
      };
      return `${window.location.origin}${profilePathByLang[lang]}`;
    }
    return buildViewportShareUrl(cameraRef.current);
  }, [selected, lang]);

  // QW-7: Copy an iframe embed snippet for the current map state.
  const handleCopyEmbed = useCallback(async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(getEmbedSnippet());
      trackEvent('copy-embed', { layer: activeLayer });
      return true;
    } catch {
      return false;
    }
  }, [getEmbedSnippet, activeLayer]);

  const handleCopyShareLink = useCallback(async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(getShareUrl());
      trackEvent('copy-share-link', { layer: activeLayer });
      return true;
    } catch {
      return false;
    }
  }, [getShareUrl, activeLayer]);

  // QW-3: from inside an embedded iframe, post the content height so a host page
  // can auto-size the iframe (no-op outside an iframe).
  useEffect(() => {
    if (!IS_EMBED) return;
    postEmbedHeight();
    window.addEventListener('resize', postEmbedHeight);
    return () => window.removeEventListener('resize', postEmbedHeight);
  }, []);

  // IN-6: Reactive offline detection
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // QW-4 / QW-2: global keydown — Escape cascade + power-user shortcuts.
  // Uses refs to avoid re-subscribing the listener on every state change
  // (the previous version had a 10-item dependency array that churned constantly).
  const escapeStateRef = useRef({ selectMode, drawMode, drawnPolygon, showWizard, showCustomQuality, selected, showFilter, showRanking });
  escapeStateRef.current = { selectMode, drawMode, drawnPolygon, showWizard, showCustomQuality, selected, showFilter, showRanking };
  const escapeActionsRef = useRef({ deselect, handleClearDraw });
  escapeActionsRef.current = { deselect, handleClearDraw };
  // QW-2: shortcut state + actions, read at keypress time to keep the listener stable.
  const shortcutsRef = useRef({ showShortcuts, showAuth, toggleFilter, toggleRanking, handleOpenWizard, handleToggleCustomQuality, handleToggleSplitMode, handleUseLocation, select });
  shortcutsRef.current = { showShortcuts, showAuth, toggleFilter, toggleRanking, handleOpenWizard, handleToggleCustomQuality, handleToggleSplitMode, handleUseLocation, select };
  const filterMatchPnosRef = useRef(filterMatchPnos);
  filterMatchPnosRef.current = filterMatchPnos;
  useEffect(() => {
    // [ / ] step through the current filter-match results (no-op when filter inactive).
    const stepResults = (dir: number) => {
      const matches = [...filterMatchPnosRef.current];
      if (matches.length === 0) return;
      const cur = selectedRef.current ? matches.indexOf(selectedRef.current.pno) : -1;
      let next = cur + dir;
      if (next < 0) next = matches.length - 1;
      if (next >= matches.length) next = 0;
      const feat = pnoFeatureMapRef.current.get(matches[next]);
      if (feat?.properties) {
        shortcutsRef.current.select(feat.properties as NeighborhoodProperties);
        setFlyTarget({ center: getFeatureCenter(feat) });
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      const sc = shortcutsRef.current;
      if (e.key === 'Escape') {
        const s = escapeStateRef.current;
        const a = escapeActionsRef.current;
        if (sc.showShortcuts) { setShowShortcuts(false); return; }
        if (s.selectMode) { setSelectMode(false); setSelectedAreaPnos([]); return; }
        if (s.drawMode) { setDrawMode(false); setDrawVertices([]); drawVerticesRef.current = []; return; }
        if (s.drawnPolygon) { a.handleClearDraw(); return; }
        if (s.showWizard) { setShowWizard(false); return; }
        if (s.showCustomQuality) { setShowCustomQuality(false); return; }
        if (s.selected) { a.deselect(); return; }
        if (s.showFilter) { setShowFilter(false); return; }
        if (s.showRanking) { setShowRanking(false); return; }
        return;
      }

      // Power-user shortcuts: ignore while typing in a field or holding a chord modifier.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === '?') { e.preventDefault(); setShowShortcuts((v) => !v); return; }
      // Remaining shortcuts shouldn't fire behind the auth modal.
      if (sc.showAuth) return;

      switch (e.key) {
        case '/':
          e.preventDefault();
          (document.querySelector('input[role="combobox"]') as HTMLInputElement | null)?.focus();
          break;
        case '[': stepResults(-1); break;
        case ']': stepResults(1); break;
        default:
          switch (e.key.toLowerCase()) {
            case 'f': sc.toggleFilter(); break;
            case 'r': sc.toggleRanking(); break;
            case 'w': sc.handleOpenWizard(); break;
            case 'c': sc.handleToggleCustomQuality(); break;
            case 's': sc.handleToggleSplitMode(); break;
            case 'g': sc.handleUseLocation(); break;
            case 'l': setShowAuth(true); break;
            default: return;
          }
      }
      // A handled shortcut dismisses the help overlay so it feels responsive.
      setShowShortcuts(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // C6: any transient state worth a one-tap reset. Drives the "Clear all" chip.
  const isDirty =
    !!selected ||
    pinned.length > 0 ||
    !!drawnPolygon ||
    filters.length > 0 ||
    wizardResultPnos.length > 0 ||
    comparisonScope !== 'all';

  // E9: surface a failed locale dictionary fetch (re-render via useI18nVersion above).
  const localeLoadError = getLocaleLoadError();

  return (
    <div id="main" tabIndex={-1} className="h-dvh w-screen overflow-hidden relative focus:outline-none" data-testid="app-root" data-loaded={!loading}>
      {/* A1: screen-reader entry point — names the map and points to the keyboard-accessible selection paths (search combobox + ranking table). */}
      <p className="sr-only">{t('aria.map_instructions')}</p>
      {/* Map — QW-4: Conditional split view */}
      <ErrorBoundary>
        {splitMode ? (
          <Suspense fallback={null}>
            <SplitMapView
              data={filteredData}
              leftLayer={activeLayer}
              rightLayer={secondaryLayer}
              onLeftLayerChange={setActiveLayer}
              onRightLayerChange={setSecondaryLayer}
              colorblind={colorblind}
              leftGridData={gridData}
              rightGridData={secondaryGridData}
              metroAverages={cityAverages}
              onSelectNeighborhood={handleClick}
            />
          </Suspense>
        ) : (
          <Map
            data={filteredData}
            activeLayer={activeLayer}
            onHover={handleHover}
            onClick={handleClick}
            flyTo={flyTarget}
            selectedPno={selected?.pno ?? null}
            pinnedPnos={pinnedPnos}
            filterActive={showFilter && filters.length > 0}
            filterMatchPnos={filterMatchPnos}
            qualityVersion={qualityVersion}
            colorblind={colorblind}
            wizardHighlightPnos={wizardResultPnos}
            fillOpacity={fillOpacity}
            gridData={gridData}
            drawMode={drawMode}
            onDrawClick={handleDrawClick}
            onDrawDoubleClick={handleDrawDoubleClick}
            drawVertices={drawVertices}
            drawnPolygon={drawnPolygon}
            drawnAreaPnos={drawnAreaPnos}
            selectMode={selectMode}
            selectedAreaPnos={selectedAreaPnos}
            onSelectAreaClick={handleSelectAreaClick}
            layerConfig={effectiveLayer}
            isochrone={isochronePolygon}
            onMoveEnd={handleMapMoveEnd}
          />
        )}
      </ErrorBoundary>

      {/* Skeleton / shimmer loading overlay */}
      {loading && (
        <div data-testid="loading-overlay" className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-surface-950/80 backdrop-blur-sm">
          <div className="text-center space-y-4">
            {/* Shimmer placeholder blocks */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-48 h-5 rounded-md bg-surface-200 dark:bg-surface-700 animate-pulse" />
              <div className="w-32 h-3 rounded-md bg-surface-200 dark:bg-surface-700 animate-pulse" />
              <div className="w-10 h-10 rounded-full bg-surface-200 dark:bg-surface-700 animate-pulse mt-2" />
            </div>
            <h1 className="text-xl font-display font-bold text-surface-900 dark:text-white">naapurustot</h1>
            <p className="text-surface-500 dark:text-surface-400 text-sm">{t(cityFilter === 'all' ? 'loading.nationwide' : 'loading.title')}</p>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && <ErrorBanner onRetry={retry} />}

      {/* QW-7: Header is hidden in embed mode so the map renders edge-to-edge. */}
      {!IS_EMBED && (
      <header className="absolute top-0 left-0 right-0 z-20 h-12 flex items-center justify-between px-3 md:px-4 bg-white/80 dark:bg-surface-950/80 backdrop-blur-md border-b border-surface-200/50 dark:border-white/10">
        {/* Left: settings, tools & auth */}
        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          <SettingsDropdown
            colorblind={colorblind}
            onColorblindChange={handleColorblindChange}
            lang={lang}
            onLangChange={handleLangChange}
            fillOpacity={fillOpacity}
            onFillOpacityChange={handleFillOpacityChange}
            onShowTour={handleShowTour}
            onShowShortcuts={handleShowShortcuts}
            onCopyEmbed={handleCopyEmbed}
            onCopyShareLink={handleCopyShareLink}
            getShareUrl={getShareUrl}
            getEmbedSnippet={getEmbedSnippet}
          />
          <ToolsDropdown
            showFilter={showFilter}
            showRanking={showRanking}
            onToggleFilter={toggleFilter}
            onToggleRanking={toggleRanking}
            onOpenWizard={handleOpenWizard}
            wizardHighlightActive={wizardResultPnos.length > 0}
            onClearWizardHighlight={handleClearWizardHighlight}
            splitMode={splitMode}
            onToggleSplitMode={handleToggleSplitMode}
            drawMode={drawMode}
            hasPolygon={!!drawnPolygon}
            onToggleDraw={handleToggleDraw}
            onClearDraw={handleClearDraw}
            selectMode={selectMode}
            onToggleSelectMode={handleToggleSelectMode}
            onUseLocation={handleUseLocation}
            showScatter={showScatter}
            onToggleScatter={handleToggleScatter}
            showRegionRanking={showRegionRanking}
            onToggleRegionRanking={handleToggleRegionRanking}
            lang={lang}
          />
        </div>

        {/* Center: brand — absolutely positioned for true centering */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <button
            onClick={handleResetView}
            className="cursor-pointer bg-transparent border-none truncate pointer-events-auto"
            title={t('map.reset_view')}
          >
            <h1 className="text-lg font-display font-bold text-surface-900 dark:text-white/90 tracking-tight whitespace-nowrap">
              naapurustot<span className="text-brand-600 dark:text-brand-400">.fi</span>
            </h1>
          </button>
        </div>

        {/* Right: city selector & auth */}
        <div className="flex items-center gap-1.5 shrink-0">
          {user ? (
            <UserMenu user={user} onLogout={logout} favorites={favoriteEntries} onSelectFavorite={handleSelectFavorite} onToggleFavorite={toggleFavorite} onExportData={exportData} onDeleteAccount={deleteAccount} />
          ) : authLoading ? (
            // L7: while restoring a returning user's session, show a placeholder
            // instead of the Sign-in button to avoid a flash of "Sign in".
            <div
              aria-hidden="true"
              className="min-w-[44px] min-h-[44px] md:min-w-[64px] md:min-h-[36px] rounded-lg bg-surface-200 dark:bg-surface-700 animate-pulse"
            />
          ) : (
            <button
              data-tour-id="auth"
              onClick={() => setShowAuth(true)}
              className="flex px-2.5 py-2 rounded-lg text-xs font-semibold transition-all items-center justify-center
                         min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                         text-surface-600 dark:text-white/70 hover:text-surface-900 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-white/10 border border-transparent"
              aria-label={t('auth.login')}
              title={t('auth.login')}
            >
              {/* Mobile: user icon only */}
              <svg className="w-4 h-4 md:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              {/* Desktop: text only */}
              <span className="hidden md:inline">{t('auth.login')}</span>
            </button>
          )}
          <CitySelector value={cityFilter} onChange={handleCityChange} lang={lang} />
        </div>
      </header>
      )}

      {/* Search bar (hidden in embed mode) */}
      {!IS_EMBED && (
        <div data-tour-id="search" className="absolute top-[3.5rem] left-3 md:left-4 z-10 w-52 md:w-72">
          <SearchBar
            data={data}
            searchData={searchIndex}
            onSelect={handleSearch}
            recent={recent}
            lang={lang}
            homePno={referencePno}
            homeName={referenceName}
            onSetHome={handleSetReference}
          />
        </div>
      )}

      {/* Comparison scope toggle — mobile only (desktop rendered inside LayerSelector via headerSlot). Hidden in embed mode. */}
      {!IS_EMBED && (
        <div className="absolute top-[3.5rem] right-3 z-10 md:hidden flex items-center gap-1.5">
          {comparisonScope === 'region' && cityFilter !== 'all' && (
            <div className="px-2.5 py-1 rounded-lg bg-amber-500/90 text-white text-[10px] font-semibold backdrop-blur-sm">
              {t('scope.active_hint')}
            </div>
          )}
          <ComparisonScopeToggle
            scope={comparisonScope}
            onChange={handleScopeChange}
            disabled={cityFilter === 'all'}
          />
        </div>
      )}

      {/* Ranking table */}
      {showRanking && (
        <ErrorBoundary>
          <Suspense fallback={<PanelSkeleton />}>
            <RankingTable
              data={filteredData}
              activeLayer={activeLayer}
              layerConfig={effectiveLayer}
              onSelect={handleSearch}
              onClose={handleCloseRanking}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Filter panel */}
      {showFilter && (
        <ErrorBoundary>
          <Suspense fallback={<PanelSkeleton />}>
            <FilterPanel
              data={filteredData}
              filters={filters}
              matchingPnos={filterMatchPnos}
              onFiltersChange={setFilters}
              onSelect={handleSearch}
              onClose={handleCloseFilter}
              savedPresets={savedPresets}
              onSavePreset={saveFilterPreset}
              onRemovePreset={removeFilterPreset}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Layer selector — hidden in embed mode so the map is uncluttered. */}
      {!IS_EMBED && (
        <LayerSelector
          activeLayer={activeLayer}
          onLayerChange={setActiveLayer}
          onCustomizeQuality={handleToggleCustomQuality}
          isCustomWeights={customWeights}
          headerSlot={layerSelectorHeaderSlot}
          lang={lang}
          hidden={!!selected}
        />
      )}

      {/* Legend — repositioned for mobile (MO2: suppressed on mobile when an area panel covers it) */}
      <Legend layerId={activeLayer} colorblind={colorblind} layerConfig={effectiveLayer} lang={lang} gridLoading={gridLoading && hasGridData(activeLayer)} hidden={!!selected} />

      {/* PO-2: Time slider / historical playback (only when a time-series metric is active) */}
      {!IS_EMBED && timeYear != null && availableYears.length > 1 && (
        <Suspense fallback={null}>
          <TimeSlider
            years={availableYears}
            currentYear={timeYear}
            onYearChange={handleScrubYear}
            playing={timePlaying}
            onTogglePlay={handleToggleTimePlay}
          />
        </Suspense>
      )}

      {/* Tooltip — hidden on touch devices via CSS.
           Reads from external store so mouse-move doesn't re-render App. */}
      <TooltipOverlay
        hidden={!!selected}
        effectiveLayer={effectiveLayer}
        metroAverage={(comparisonScope === 'region' ? cityAverages : metroAverages)[effectiveLayer.property]}
      />

      {/* Custom quality sliders panel */}
      {showCustomQuality && (
        <ErrorBoundary>
          <Suspense fallback={<PanelSkeleton />}>
            <CustomQualityPanel
              weights={qualityWeights}
              onChange={handleQualityWeightsChange}
              onClose={handleCloseCustomQuality}
            />
          </Suspense>
        </ErrorBoundary>
      )}


      {/* Neighborhood detail panel */}
      {selected && (
        <ErrorBoundary>
          <Suspense fallback={<PanelSkeleton />}>
          <NeighborhoodPanel
            data={selected}
            metroAverages={effectiveBaseline}
            onClose={deselect}
            onPin={pin}
            onUnpin={unpin}
            isPinned={isPinned}
            pinCount={pinned.length}
            onCustomize={handleToggleCustomQuality}
            isCustomWeights={customWeights}
            allFeatures={allFeatures}
            activeLayer={activeLayer}
            onFlyTo={handleFlyTo}
            isFavorite={isFavorite(selected.pno)}
            onToggleFavorite={handleToggleFavorite}
            isInShortlist={isInShortlist(selected.pno)}
            onToggleShortlist={handleToggleShortlist}
            referencePno={referencePno}
            referenceName={referenceName}
            onSetReference={handleSetReference}
            qualityScope={comparisonScope === 'region' && cityFilter !== 'all' ? 'region' : 'national'}
            onExploreCity={handleExploreCity}
            userId={user?.id ?? null}
            isochroneEnabled={ISOCHRONE_ENABLED}
            isochroneMode={isochroneMode}
            isochroneBudget={isochroneBudget}
            isochroneLoading={isochroneLoading}
            isochroneError={isochroneError}
            isochroneActive={isochronePolygon != null}
            onIsochroneChange={handleIsochroneChange}
            onIsochroneClear={handleIsochroneClear}
            similarityWeights={similarityWeights}
            onSimilarityWeightChange={setSimilarityWeight}
            onSimilarityToggle={toggleSimilarityMetric}
          />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* CF-3: Correlation / scatter explorer */}
      {showScatter && (
        <ErrorBoundary>
          <Suspense fallback={<PanelSkeleton />}>
            <CorrelationExplorer
              data={filteredData}
              onSelect={handleSearch}
              onClose={() => setShowScatter(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* CF-4: Region comparison & ranking */}
      {showRegionRanking && (
        <ErrorBoundary>
          <Suspense fallback={<PanelSkeleton />}>
            <RegionRankingTable
              activeLayer={activeLayer}
              layerConfig={getLayerById(activeLayer)}
              onSelectRegion={handleExploreCity}
              onClose={() => setShowRegionRanking(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Neighborhood wizard */}
      {showWizard && (
        <ErrorBoundary>
          <Suspense fallback={<PanelSkeleton />}>
            <NeighborhoodWizard
              data={filteredData}
              onSelect={handleSearch}
              onClose={handleCloseWizard}
              onShowOnMap={handleWizardShowOnMap}
              initialAnswers={wizardProfile}
              onSaveProfile={handleSaveWizardProfile}
              onApplyToMap={handleApplyWizardToMap}
              affordability={affordabilityState}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* QW-2: shortlist tray — shown on the idle home view */}
      {!IS_EMBED && !selected && !showTour && pinned.length === 0 && data && shortlist.length > 0 && (
        <ShortlistTray
          entries={shortlistEntries}
          onSelect={handleSelectFavorite}
          onRemove={removeFromShortlist}
          onCompare={handleCompareShortlist}
          onClear={clearShortlist}
          featureFor={featureFor}
          shareUrl={shortlistShareUrl}
        />
      )}

      {/* Comparison panel (shows hint at 1 pinned, full panel at 2+). Hidden in embed mode. */}
      {!IS_EMBED && pinned.length >= 1 && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <ComparisonPanel pinned={pinned} onUnpin={unpin} onClear={clearPinned} reference={referenceProps ?? null} referenceName={referenceName} geometryFor={geometryFor} suppressMobile={!!selected} />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* CF-6: Area summary panel for drawn polygon */}
      {drawnPolygon && filteredData && (
        <ErrorBoundary>
          <Suspense fallback={<PanelSkeleton />}>
            <AreaSummaryPanel
              polygon={drawnPolygon}
              data={filteredData}
              metroAverages={cityAverages}
              onClose={handleClearDraw}
              selectedPnos={selectedAreaPnos.length > 0 ? selectedAreaPnos : drawnAreaPnos.length > 0 ? drawnAreaPnos : undefined}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* CF-6: Draw mode hint with Done button */}
      {drawMode && (
        <div className="absolute bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-xl
                       bg-violet-500/90 text-white text-xs font-medium backdrop-blur-sm shadow-lg">
          <span className="hidden md:inline">{t('draw.hint_desktop')}</span>
          <span className="md:hidden">{t('draw.hint')}</span>
          {drawVertices.length >= 3 && (
            <button
              onClick={handleFinishDraw}
              className="px-3 py-1 rounded-lg bg-white/25 hover:bg-white/40 transition-colors font-semibold text-xs"
            >
              {t('draw.finish')}
            </button>
          )}
        </div>
      )}

      {/* Select areas mode hint with Done button */}
      {selectMode && (
        <div className="absolute bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-xl
                       bg-violet-500/90 text-white text-xs font-medium backdrop-blur-sm shadow-lg">
          <span>{t('draw.select_hint')}</span>
          {selectedAreaPnos.length > 0 && (
            <>
              <span className="px-1.5 py-0.5 rounded-md bg-white/25 tabular-nums">{selectedAreaPnos.length}</span>
              <button
                onClick={handleFinishSelect}
                className="px-3 py-1 rounded-lg bg-white/25 hover:bg-white/40 transition-colors font-semibold text-xs"
              >
                {t('draw.finish')}
              </button>
            </>
          )}
        </div>
      )}


      {/* C6: one-tap "Clear all" reset chip — shown only when transient state is dirty.
          Suppressed while actively drawing/selecting so it doesn't stack on those hint pills. */}
      {isDirty && !drawMode && !selectMode && (
        <div className="absolute bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-8 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={handleResetView}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500/90 hover:bg-violet-500
                       text-white text-xs font-medium backdrop-blur-sm shadow-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            {t('map.clear_all')}
          </button>
        </div>
      )}

      {/* C10: persistent wizard-results chip — shows the highlighted count with a
          one-tap Clear. Offset above the "Clear all"/draw pills so it doesn't overlap. */}
      {!IS_EMBED && wizardResultPnos.length > 0 && (
        <div className="absolute bottom-[calc(8rem+env(safe-area-inset-bottom))] md:bottom-[4.5rem] left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-xl
                       bg-amber-500/90 text-white text-xs font-medium backdrop-blur-sm shadow-lg">
          <span className="whitespace-nowrap">{t('wizard.results')} · <span className="tabular-nums">{wizardResultPnos.length}</span></span>
          <button
            onClick={handleClearWizardHighlight}
            aria-label={t('wizard.clear_highlights')}
            title={t('wizard.clear_highlights')}
            className="p-1 rounded-md hover:bg-white/25 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* IN-6: Offline indicator */}
      {isOffline && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg
                       bg-amber-500/90 text-white text-xs font-medium backdrop-blur-sm">
          {t('offline.indicator')}
        </div>
      )}

      {/* QW-3: Geolocation status toast */}
      {geoStatus && (
        <div
          role="status"
          className={`absolute top-12 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg text-white text-xs font-medium backdrop-blur-sm
                     ${geoStatus === 'loading' ? 'bg-brand-700/90' : 'bg-amber-500/90'}`}
        >
          {geoStatus === 'loading'
            ? t('geolocation.using')
            : geoStatus === 'denied'
              ? t('geolocation.denied')
              : geoStatus === 'unavailable'
                ? t('geolocation.unavailable')
                : t('geolocation.outside')}
        </div>
      )}

      {/* C4/C7/C8: shared transient toast (scope rescale note, city switch, address-only) */}
      {toast && (
        <div
          role="status"
          className="absolute top-12 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] px-3 py-1.5 rounded-lg
                     bg-brand-700/90 text-white text-xs font-medium text-center backdrop-blur-sm shadow-lg"
        >
          {toast.text}
        </div>
      )}

      {/* E9: locale dictionary load failure — non-blocking notice with retry + dismiss */}
      {localeLoadError && !localeErrorDismissed && (
        <div
          role="status"
          className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-lg
                     bg-amber-500/90 text-white text-xs font-medium backdrop-blur-sm shadow-lg"
        >
          <span>{t('lang.load_failed')}</span>
          <button
            onClick={retryLocaleLoad}
            className="px-2 py-0.5 rounded-md bg-white/25 hover:bg-white/40 transition-colors font-semibold"
          >
            {t('error.retry')}
          </button>
          <button
            onClick={() => setLocaleErrorDismissed(true)}
            aria-label={t('aria.close')}
            title={t('aria.close')}
            className="p-0.5 rounded-md hover:bg-white/25 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Attribution footer (full attribution hidden in embed mode) */}
      {!IS_EMBED && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 hidden md:block">
          <p className="text-[10px] text-surface-600/70 dark:text-surface-500/70">
            {t('footer.attribution')}
            {' · '}
            <ContactMenu className="underline hover:text-brand-600 dark:hover:text-brand-300" />
            {' · '}
            {/* CF-9: link to the public data sources & methodology page (lang-aware) */}
            <a
              href={lang === 'en' ? '/en/data-sources' : lang === 'sv' ? '/sv/datakallor' : '/tietolahteet'}
              className="underline hover:text-brand-600 dark:hover:text-brand-300"
            >
              {t('footer.sources')}
            </a>
            {' · '}
            {/* PO-14: link to the public privacy & data-handling notice (lang-aware) */}
            <a
              href={lang === 'en' ? '/en/privacy' : lang === 'sv' ? '/sv/integritet' : '/tietosuoja'}
              className="underline hover:text-brand-600 dark:hover:text-brand-300"
            >
              {t('privacy.link')}
            </a>
          </p>
        </div>
      )}

      {/* QW-3: Embed watermark — "open full view" deep link carrying the full configured state */}
      {IS_EMBED && (
        <a
          href={buildFullViewUrl(
            {
              pno: selected?.pno ?? null,
              layer: activeLayer,
              city: cityFilter,
              compare: pinnedPnos,
              scope: comparisonScope,
              year: timeYear,
              colorblind,
              lang,
            },
            'https://naapurustot.fi',
          )}
          target="_top"
          rel="noopener"
          title={t('embed.open_full')}
          aria-label={t('embed.open_full')}
          className="absolute bottom-2 right-2 z-30 px-2.5 py-1 rounded-md text-[11px] font-semibold
                     bg-white/85 dark:bg-surface-900/85 backdrop-blur-sm border border-surface-200/60 dark:border-surface-700/40
                     text-surface-700 dark:text-surface-200 hover:text-brand-600 dark:hover:text-brand-300
                     shadow-md transition-colors"
        >
          naapurustot<span className="text-brand-600 dark:text-brand-400">.fi</span>
          <span className="ml-1 opacity-60" aria-hidden="true">↗</span>
        </a>
      )}

      {/* Auth modal (hidden in embed mode) */}
      {!IS_EMBED && showAuth && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <AuthModal
              onClose={() => setShowAuth(false)}
              onLogin={login}
              onSignup={signup}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* QW-1: Onboarding tour (hidden in embed mode) */}
      {!IS_EMBED && showTour && (
        <Suspense fallback={null}>
          <OnboardingTour onComplete={handleCloseTour} skipAuthStep={!!user} />
        </Suspense>
      )}

      {/* QW-2: Keyboard shortcuts overlay (hidden in embed mode) */}
      {!IS_EMBED && showShortcuts && (
        <Suspense fallback={null}>
          <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />
        </Suspense>
      )}

      {/* ARIA live region for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {ariaAnnouncement}
      </div>
    </div>
  );
};

export default App;
