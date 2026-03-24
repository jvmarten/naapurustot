import React, { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Map } from './components/Map';
import { DEFAULT_CENTER, getInitialZoom, CITY_VIEWPORTS } from './utils/mapConstants';
import { LayerSelector } from './components/LayerSelector';
import { SearchBar } from './components/SearchBar';
import { CitySelector, type CityFilter } from './components/CitySelector';
import { Tooltip } from './components/Tooltip';
import { Legend } from './components/Legend';
import { SettingsDropdown } from './components/SettingsDropdown';
import { ToolsDropdown } from './components/ToolsDropdown';
import { ErrorBanner } from './components/ErrorBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { computeMatchingPnos, type FilterCriterion } from './utils/filterUtils';
import { useFilterPresets } from './hooks/useFilterPresets';
import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';
import { booleanIntersects } from '@turf/boolean-intersects';

// IN-6: Lazy load heavy conditionally-rendered components
const NeighborhoodPanel = lazy(() => import('./components/NeighborhoodPanel').then(m => ({ default: m.NeighborhoodPanel })));
const ComparisonPanel = lazy(() => import('./components/ComparisonPanel').then(m => ({ default: m.ComparisonPanel })));
const RankingTable = lazy(() => import('./components/RankingTable').then(m => ({ default: m.RankingTable })));
const FilterPanel = lazy(() => import('./components/FilterPanel').then(m => ({ default: m.FilterPanel })));
const CustomQualityPanel = lazy(() => import('./components/CustomQualityPanel').then(m => ({ default: m.CustomQualityPanel })));
const NeighborhoodWizard = lazy(() => import('./components/NeighborhoodWizard').then(m => ({ default: m.NeighborhoodWizard })));
const SplitMapView = lazy(() => import('./components/SplitMapView').then(m => ({ default: m.SplitMapView })));
const AreaSummaryPanel = lazy(() => import('./components/AreaSummaryPanel').then(m => ({ default: m.AreaSummaryPanel })));
import { bbox } from '@turf/bbox';
import { useMapData } from './hooks/useMapData';
import { useGridData } from './hooks/useGridData';
import { useFavorites } from './hooks/useFavorites';
import { useNotes } from './hooks/useNotes';
import { useRecentNeighborhoods } from './hooks/useRecentNeighborhoods';
import { useSelectedNeighborhood } from './hooks/useSelectedNeighborhood';
import { type LayerId, type ColorblindType, getLayerById, getColorblindMode, setColorblindMode } from './utils/colorScales';
import { readInitialUrlState, useSyncUrlState } from './hooks/useUrlState';
import type { NeighborhoodProperties } from './utils/metrics';
import { computeMetroAverages } from './utils/metrics';
import { t, getLang, setLang, type Lang } from './utils/i18n';
import { computeQualityIndices, getDefaultWeights, isCustomWeights, type QualityWeights } from './utils/qualityIndex';

const initialUrl = readInitialUrlState();

const App: React.FC = () => {
  const { data, loading, error, metroAverages, retry } = useMapData();
  const { selected, select, deselect, pinned, pin, unpin, clearPinned } = useSelectedNeighborhood();
  const [activeLayer, setActiveLayer] = useState<LayerId>(initialUrl.layer ?? 'quality_index');
  const { gridData } = useGridData(activeLayer);
  const [wizardResultPnos, setWizardResultPnos] = useState<string[]>([]);
  const [tooltip, setTooltip] = useState<{
    props: NeighborhoodProperties;
    x: number;
    y: number;
  } | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ center: [number, number]; zoom?: number; bounds?: [number, number, number, number] } | null>(null);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [showRanking, setShowRanking] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showCustomQuality, setShowCustomQuality] = useState(false);
  const [filters, setFilters] = useState<FilterCriterion[]>([]);
  const [qualityWeights, setQualityWeights] = useState<QualityWeights>(getDefaultWeights);
  const [colorblind, setColorblind] = useState(getColorblindMode);
  const [showWizard, setShowWizard] = useState(false);
  const { presets: savedPresets, addPreset: saveFilterPreset, removePreset: removeFilterPreset } = useFilterPresets();
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
  const [secondaryLayer] = useState<LayerId>('median_income');
  const { isFavorite, toggleFavorite } = useFavorites();
  const { getNote, setNote } = useNotes();
  const { recent, addRecent } = useRecentNeighborhoods();
  const restoredPno = useRef(false);
  // Monotonic version counter to force re-renders when quality indices change
  const [qualityVersion, setQualityVersion] = useState(0);
  const [ariaAnnouncement, setAriaAnnouncement] = useState('');
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  // City filter
  const [cityFilter, setCityFilter] = useState<CityFilter>((initialUrl.city as CityFilter) ?? 'all');

  // Filter data by selected city
  const filteredData = useMemo(() => {
    if (!data) return null;
    if (cityFilter === 'all') return data;
    return {
      ...data,
      features: data.features.filter(
        (f) => f.properties?.city === cityFilter,
      ),
    } as typeof data;
  }, [data, cityFilter]);

  // Recompute metro averages for the selected city
  const cityAverages = useMemo(() => {
    if (!filteredData) return metroAverages;
    if (cityFilter === 'all') return metroAverages;
    return computeMetroAverages(filteredData.features);
  }, [filteredData, cityFilter, metroAverages]);

  const handleCityChange = useCallback((city: CityFilter) => {
    setCityFilter(city);
    deselect();
    if (city !== 'all') {
      const vp = CITY_VIEWPORTS[city];
      if (vp) setFlyTarget({ center: vp.center, zoom: vp.zoom });
    } else {
      setFlyTarget({ center: DEFAULT_CENTER, zoom: getInitialZoom() });
    }
  }, [deselect]);

  // CF-6: Draw polygon state
  const [drawMode, setDrawMode] = useState(false);
  const [drawVertices, setDrawVertices] = useState<Position[]>([]);
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
      }
      return !v;
    });
  }, []);

  const handleToggleSelectMode = useCallback(() => {
    // Exit draw mode if entering select mode
    setDrawMode(false);
    setDrawVertices([]);
    setSelectMode((v) => {
      if (v) {
        setSelectedAreaPnos([]);
      }
      return !v;
    });
  }, []);

  const handleDrawClick = useCallback((lngLat: [number, number]) => {
    setDrawVertices((prev) => [...prev, lngLat]);
  }, []);

  const handleDrawDoubleClick = useCallback(() => {
    setDrawVertices((prev) => {
      if (prev.length >= 3) {
        // Close the polygon
        const closed = [...prev, prev[0]];
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
      return [];
    });
  }, []);

  // Finish draw with explicit button (mobile-friendly alternative to double-click)
  const handleFinishDraw = useCallback(() => {
    handleDrawDoubleClick();
  }, [handleDrawDoubleClick]);

  // Build union polygon from selected neighborhoods for AreaSummaryPanel
  const selectedAreasPolygon = useMemo<Feature<Polygon> | null>(() => {
    if (selectedAreaPnos.length === 0 || !filteredData) return null;
    // Collect all coordinates from selected neighborhoods and create a convex hull-like polygon
    // For the AreaSummaryPanel, we create a bounding polygon that contains all selected areas
    const selectedFeatures = filteredData.features.filter(
      (f) => f.properties?.pno && selectedAreaPnos.includes(f.properties.pno)
    );
    if (selectedFeatures.length === 0) return null;

    // Collect all exterior ring coordinates from selected features
    const allCoords: Position[] = [];
    for (const f of selectedFeatures) {
      const geom = f.geometry;
      if (geom.type === 'Polygon') {
        allCoords.push(...geom.coordinates[0]);
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          allCoords.push(...poly[0]);
        }
      }
    }
    if (allCoords.length < 3) return null;

    // Use convex hull to create a bounding polygon
    // Simple Graham scan for convex hull
    const points = allCoords.map(([x, y]) => [x, y] as [number, number]);
    // Find bottom-most point (min y, then min x)
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
        if (cross <= 0) hull.pop();
        else break;
      }
      hull.push(pt);
    }
    if (hull.length < 3) return null;
    hull.push(hull[0]); // Close the ring

    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [hull] },
    };
  }, [selectedAreaPnos, filteredData]);

  // Compute PNOs of neighborhoods intersecting with drawn polygon (for boundary snapping)
  const drawnAreaPnos = useMemo<string[]>(() => {
    if (!drawnPolygon || !filteredData) return [];
    // If we came from select mode, use the selectedAreaPnos directly
    if (selectedAreaPnos.length > 0) return selectedAreaPnos;
    const pnos: string[] = [];
    for (const feature of filteredData.features) {
      if (!feature.geometry || !feature.properties?.pno) continue;
      const geom = feature.geometry as Polygon | MultiPolygon;
      if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;
      try {
        if (booleanIntersects(drawnPolygon, feature as Feature<Polygon | MultiPolygon>)) {
          pnos.push(feature.properties.pno as string);
        }
      } catch {
        // Skip features with invalid geometry
      }
    }
    return pnos;
  }, [drawnPolygon, filteredData, selectedAreaPnos]);

  const handleSelectAreaClick = useCallback((props: NeighborhoodProperties) => {
    const pno = props.pno;
    setSelectedAreaPnos((prev) =>
      prev.includes(pno) ? prev.filter((p) => p !== pno) : [...prev, pno]
    );
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
    setDrawMode(false);
    setSelectMode(false);
    setSelectedAreaPnos([]);
  }, []);

  // Restore neighborhood selection and pinned comparisons from URL once data is loaded
  useEffect(() => {
    if (!data || restoredPno.current) return;
    restoredPno.current = true;
    if (initialUrl.pno) {
      const feature = data.features.find((f) => f.properties?.pno === initialUrl.pno);
      if (feature?.properties) {
        select(feature.properties as NeighborhoodProperties);
      }
    }
    // QW-3: Restore pinned comparisons from URL
    if (initialUrl.compare && initialUrl.compare.length > 0) {
      for (const pno of initialUrl.compare) {
        const feature = data.features.find((f) => f.properties?.pno === pno);
        if (feature?.properties) {
          pin(feature.properties as NeighborhoodProperties);
        }
      }
    }
  }, [data, select, pin]);

  // Memoize pinned PNO array to avoid new references on every render.
  // Without this, Map's pinnedPnos useEffect fires on every App re-render,
  // recreating the pinned highlight layer unnecessarily.
  const pinnedPnos = useMemo(() => pinned.map((p) => p.pno), [pinned]);

  // Keep URL in sync with current state (including pinned comparisons)
  useSyncUrlState(selected?.pno ?? null, activeLayer, pinnedPnos, cityFilter);

  // Recompute quality indices when custom weights change
  const handleQualityWeightsChange = useCallback(
    (newWeights: QualityWeights) => {
      setQualityWeights(newWeights);
      if (data) {
        computeQualityIndices(data.features, newWeights);
        setQualityVersion((v) => v + 1);
        // Update selected neighborhood if it exists
        if (selected) {
          const feature = data.features.find((f) => f.properties?.pno === selected.pno);
          if (feature?.properties) {
            select(feature.properties as NeighborhoodProperties);
          }
        }
      }
    },
    [data, selected, select],
  );

  const handleHover = useCallback(
    (props: NeighborhoodProperties | null, x: number, y: number) => {
      if (props) {
        setTooltip({ props, x, y });
      } else {
        setTooltip(null);
      }
    },
    [],
  );

  const handleClick = useCallback(
    (props: NeighborhoodProperties) => {
      select(props);
      setAriaAnnouncement(`${t('aria.neighborhood_selected')}: ${props.nimi}`);
    },
    [select],
  );

  const handleSearch = useCallback(
    (pno: string, center: [number, number]) => {
      if (data) {
        const feature = data.features.find((f) => f.properties?.pno === pno);
        if (feature?.properties) {
          const props = feature.properties as NeighborhoodProperties;
          // Auto-switch city filter if the searched neighborhood is in a different city
          if (props.city && cityFilter !== 'all' && props.city !== cityFilter) {
            setCityFilter(props.city);
          }
          select(props);
          addRecent({ pno: props.pno, name: props.nimi || props.pno, center });
          // Use feature bounding box for better zoom fit
          if (feature.geometry) {
            const [minLng, minLat, maxLng, maxLat] = bbox(feature);
            setFlyTarget({ center, bounds: [minLng, minLat, maxLng, maxLat] });
          } else {
            setFlyTarget({ center });
          }
        } else {
          setFlyTarget({ center });
        }
      } else {
        setFlyTarget({ center });
      }
    },
    [data, select, addRecent, cityFilter],
  );

  const handleResetView = useCallback(() => {
    deselect();
    setFlyTarget({ center: DEFAULT_CENTER, zoom: getInitialZoom() });
  }, [deselect]);

  const toggleLang = useCallback(() => {
    const next = lang === 'fi' ? 'en' : 'fi';
    setLang(next);
    setLangState(next);
  }, [lang]);

  const handleColorblindChange = useCallback((mode: ColorblindType) => {
    setColorblindMode(mode);
    setColorblind(mode);
  }, []);

  const handleFillOpacityChange = useCallback((v: number) => {
    try { localStorage.setItem('naapurustot-fill-opacity', String(v)); } catch { /* unavailable */ }
    setFillOpacity(v);
  }, []);

  // Compute matching neighborhood PNOs for filter-aware map rendering
  const filterMatchPnos = useMemo(
    () => (showFilter ? computeMatchingPnos(filteredData, filters) : new Set<string>()),
    [filteredData, filters, showFilter],
  );

  // Close ranking when opening filter and vice versa
  const toggleFilter = useCallback(() => {
    setShowFilter((v) => {
      if (!v) setShowRanking(false);
      return !v;
    });
  }, []);

  const toggleRanking = useCallback(() => {
    setShowRanking((v) => {
      if (!v) setShowFilter(false);
      return !v;
    });
  }, []);

  // Stable callbacks for memoized children (avoids new refs on every App re-render)
  const handleOpenWizard = useCallback(() => setShowWizard(true), []);
  const handleClearWizardHighlight = useCallback(() => setWizardResultPnos([]), []);
  const handleToggleSplitMode = useCallback(() => setSplitMode((v) => !v), []);
  const handleToggleCustomQuality = useCallback(() => setShowCustomQuality((v) => !v), []);
  const handleCloseRanking = useCallback(() => setShowRanking(false), []);
  const handleCloseFilter = useCallback(() => setShowFilter(false), []);
  const handleCloseCustomQuality = useCallback(() => setShowCustomQuality(false), []);
  const handleCloseWizard = useCallback(() => setShowWizard(false), []);
  const handleWizardShowOnMap = useCallback((pnos: string[]) => {
    setWizardResultPnos(pnos);
    setShowWizard(false);
  }, []);
  const handleFlyTo = useCallback((center: [number, number]) => setFlyTarget({ center }), []);

  // IN-5: Dynamic SEO — update document title, meta, and canonical when neighborhood selected
  useEffect(() => {
    const canonical = document.querySelector('link[rel="canonical"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (selected) {
      const qi = selected.quality_index != null ? ` — ${t('panel.quality_index')}: ${selected.quality_index}` : '';
      document.title = `${selected.nimi} (${selected.pno})${qi} | naapurustot.fi`;
      const desc = document.querySelector('meta[name="description"]');
      if (desc) {
        desc.setAttribute('content',
          lang === 'fi'
            ? `${selected.nimi} (${selected.pno}): mediaanitulo, työttömyys, asuntohinnat, palvelut ja 35+ mittaria Helsingin seudun asuinalueen vertailuun.`
            : `${selected.nimi} (${selected.pno}): median income, unemployment, property prices, services and 35+ metrics for neighborhood comparison.`
        );
      }
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.setAttribute('content', `${selected.nimi} — naapurustot.fi`);
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute('content', `${selected.nimi} (${selected.pno}) — ${t('panel.quality_index')}: ${selected.quality_index ?? '—'}`);
      const pnoUrl = `https://naapurustot.fi/?pno=${selected.pno}`;
      if (canonical) canonical.setAttribute('href', pnoUrl);
      if (ogUrl) ogUrl.setAttribute('content', pnoUrl);
    } else {
      document.title = 'naapurustot — naapurustot kartalla | naapurustot.fi';
      const desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute('content', 'naapurustot.fi — vertaile Helsingin, Espoon, Vantaan ja Turun naapurustoja ja asuinalueita 35+ mittarilla. Tulotaso, asuntohinnat, palvelut, turvallisuus, joukkoliikenne ja paljon muuta interaktiivisella kartalla.');
      if (canonical) canonical.setAttribute('href', 'https://naapurustot.fi/');
      if (ogUrl) ogUrl.setAttribute('content', 'https://naapurustot.fi/');
    }
  }, [selected, lang]);

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

  // QW-4: Escape to close topmost panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectMode) { setSelectMode(false); setSelectedAreaPnos([]); return; }
      if (drawMode) { setDrawMode(false); setDrawVertices([]); return; }
      if (drawnPolygon) { handleClearDraw(); return; }
      if (showWizard) { setShowWizard(false); return; }
      if (showCustomQuality) { setShowCustomQuality(false); return; }
      if (selected) { deselect(); return; }
      if (showFilter) { setShowFilter(false); return; }
      if (showRanking) { setShowRanking(false); return; }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, showCustomQuality, showFilter, showRanking, showWizard, deselect, drawMode, drawnPolygon, handleClearDraw, selectMode]);

  return (
    <div className="h-screen w-screen overflow-hidden relative" data-testid="app-root" data-loaded={!loading}>
      {/* Map — QW-4: Conditional split view */}
      <ErrorBoundary>
        {splitMode ? (
          <Suspense fallback={null}>
            <SplitMapView
              data={filteredData}
              leftLayer={activeLayer}
              rightLayer={secondaryLayer}
              colorblind={colorblind}
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
            <p className="text-surface-500 dark:text-surface-400 text-sm">{t('loading.title')}</p>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && <ErrorBanner message={error} onRetry={retry} />}

      {/* Brand mark + city selector — hidden on mobile to avoid overlap */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 hidden md:flex items-center gap-2">
        <button
          onClick={handleResetView}
          className="cursor-pointer bg-transparent border-none"
          title={t('map.reset_view')}
        >
          <h1 className="text-lg font-display font-bold text-surface-800/90 dark:text-white/90 tracking-tight">
            naapurustot<span className="text-brand-500 dark:text-brand-400">.fi</span>
          </h1>
        </button>
        <CitySelector value={cityFilter} onChange={handleCityChange} />
      </div>

      {/* Top-right controls — dropdown menus */}
      <div className="absolute top-3 md:top-4 right-3 md:right-[17rem] z-10 flex items-center gap-2">
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
        />
        <SettingsDropdown
          colorblind={colorblind}
          onColorblindChange={handleColorblindChange}
          lang={lang}
          onToggleLang={toggleLang}
          fillOpacity={fillOpacity}
          onFillOpacityChange={handleFillOpacityChange}
        />
        <span className="md:hidden"><CitySelector value={cityFilter} onChange={handleCityChange} /></span>
      </div>

      {/* Search */}
      <SearchBar data={data} onSelect={handleSearch} recent={recent} />

      {/* Ranking table */}
      {showRanking && (
        <Suspense fallback={null}>
          <RankingTable
            data={filteredData}
            activeLayer={activeLayer}
            onSelect={handleSearch}
            onClose={handleCloseRanking}
          />
        </Suspense>
      )}

      {/* Filter panel */}
      {showFilter && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <FilterPanel
              data={filteredData}
              filters={filters}
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

      {/* Layer selector */}
      <LayerSelector
        activeLayer={activeLayer}
        onLayerChange={setActiveLayer}
        onCustomizeQuality={handleToggleCustomQuality}
        isCustomWeights={isCustomWeights(qualityWeights)}
      />

      {/* Legend — repositioned for mobile */}
      <Legend layerId={activeLayer} colorblind={colorblind} />

      {/* Tooltip — hidden on touch devices via CSS */}
      {tooltip && !selected && (
        <Tooltip
          x={tooltip.x}
          y={tooltip.y}
          name={tooltip.props.nimi || tooltip.props.pno}
          value={tooltip.props[getLayerById(activeLayer).property] as number | null}
          layerId={activeLayer}
          metroAverage={metroAverages[getLayerById(activeLayer).property]}
        />
      )}

      {/* Custom quality sliders panel */}
      {showCustomQuality && (
        <Suspense fallback={null}>
          <CustomQualityPanel
            weights={qualityWeights}
            onChange={handleQualityWeightsChange}
            onClose={handleCloseCustomQuality}
          />
        </Suspense>
      )}


      {/* Neighborhood detail panel */}
      {selected && (
        <ErrorBoundary>
          <Suspense fallback={null}>
          <NeighborhoodPanel
            data={selected}
            metroAverages={cityAverages}
            onClose={deselect}
            onPin={pin}
            onUnpin={unpin}
            isPinned={pinned.some((p) => p.pno === selected.pno)}
            pinCount={pinned.length}
            onCustomize={handleToggleCustomQuality}
            isCustomWeights={isCustomWeights(qualityWeights)}
            allFeatures={filteredData?.features}
            onFlyTo={handleFlyTo}
            isFavorite={isFavorite(selected.pno)}
            onToggleFavorite={() => toggleFavorite(selected.pno)}
            note={getNote(selected.pno)}
            onNoteChange={(text) => setNote(selected.pno, text)}
          />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Neighborhood wizard */}
      {showWizard && (
        <Suspense fallback={null}>
        <NeighborhoodWizard
          data={filteredData}
          onSelect={handleSearch}
          onClose={handleCloseWizard}
          onShowOnMap={handleWizardShowOnMap}
        />
        </Suspense>
      )}

      {/* Comparison panel (shows hint at 1 pinned, full panel at 2+) */}
      {pinned.length >= 1 && (
        <Suspense fallback={null}>
          <ComparisonPanel pinned={pinned} onUnpin={unpin} onClear={clearPinned} />
        </Suspense>
      )}

      {/* CF-6: Area summary panel for drawn polygon */}
      {drawnPolygon && filteredData && (
        <Suspense fallback={null}>
          <AreaSummaryPanel
            polygon={drawnPolygon}
            data={filteredData}
            metroAverages={cityAverages}
            onClose={handleClearDraw}
            selectedPnos={selectedAreaPnos.length > 0 ? selectedAreaPnos : undefined}
          />
        </Suspense>
      )}

      {/* CF-6: Draw mode hint with Done button */}
      {drawMode && (
        <div className="absolute bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-xl
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
        <div className="absolute bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-xl
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

      {/* IN-6: Offline indicator */}
      {isOffline && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg
                       bg-amber-500/90 text-white text-xs font-medium backdrop-blur-sm">
          {t('offline.indicator')}
        </div>
      )}

      {/* Attribution footer */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 hidden md:block">
        <p className="text-[10px] text-surface-600/70 dark:text-surface-500/70">{t('footer.attribution')}</p>
      </div>

      {/* ARIA live region for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {ariaAnnouncement}
      </div>
    </div>
  );
};

export default App;
