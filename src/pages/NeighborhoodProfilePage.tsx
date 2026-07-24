import React, { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { loadNeighborhoodData, loadRegionData } from '../utils/dataLoader';
import { parseSlug, toSlug } from '../utils/slug';
import type { NeighborhoodProperties } from '../utils/metrics';
import { computeMetroAverages, getMetricSource } from '../utils/metrics';
import type { NeighbourhoodPercentiles } from '../utils/percentileRanks';
import type { RegionId } from '../utils/regions';
import { t, getLang, setLang, useI18nVersion, type Lang } from '../utils/i18n';
import { formatNumber, formatEuro, formatPct, formatDiff } from '../utils/formatting';
import { getQualityCategory, QUALITY_CATEGORIES, QUALITY_DIMENSIONS } from '../utils/qualityIndex';
import { getLayerById, getInterpolatedColor, readableTextColor } from '../utils/colorScales';
import { findSimilarNeighborhoods } from '../utils/similarity';
import { getFeatureCenter } from '../utils/geometryFilter';
import { ContactMenu } from '../components/ContactMenu';
import { LanguagePicker } from '../components/LanguagePicker';
import { StatCard } from '../components/profile/StatCard';
import { JsonLd } from '../components/profile/JsonLd';
import { FitForYouBadge } from '../components/FitForYouBadge';
import { readStoredWizardProfile } from '../hooks/useWizardProfile';
import { useFavorites } from '../hooks/useFavorites';

const MiniMap = lazy(() => import('../components/profile/MiniMap').then(m => ({ default: m.MiniMap })));

/** Render-ready payload embedded in prerendered profile pages (see prerender.mjs). */
interface EmbeddedProfile {
  /** This neighbourhood's fully processed properties (quality_index included). */
  p: NeighborhoodProperties;
  /** Dataset-wide averages, keyed by property name. */
  avg: Record<string, number>;
  /**
   * Precomputed national+regional percentile bundle (prerender.mjs). Lets the profile
   * keep its FAQPage / percentile structured data without fetching the ~2 MB national
   * dataset. Optional so pre-existing pages (older payloads) still parse.
   */
  pct?: NeighbourhoodPercentiles;
  /**
   * CF-1: reverse-nav links into the ranking / compare / municipality / planning hub mesh for
   * this area (from the build-time manifest). Present only on prerendered / hard-loaded pages,
   * so a rendering crawler follows them into the otherwise-orphaned mesh. Optional/nullable.
   */
  nav?: {
    muni?: { href: string; label: string };
    rankings?: { href: string; label: string }[];
    compares?: { href: string; label: string }[];
    planning?: { href: string; label: string };
  } | null;
}

/** CF-1: the directory ("all areas") hub, per language — always linked from a profile. */
const DIRECTORY_URL: Record<Lang, string> = {
  fi: '/kaupungit/',
  en: '/en/cities/',
  sv: '/sv/stader/',
};

/**
 * Read the data payload embedded by the prerenderer. Returns null when the page
 * was not prerendered or — crucially — on client-side navigation, where the
 * embedded payload still describes the originally loaded neighbourhood. The
 * `pno` check guards that case so we fall back to fetching instead.
 */
function readEmbeddedProfile(pno: string): EmbeddedProfile | null {
  const el = document.getElementById('__naapurustot_profile__');
  if (!el?.textContent) return null;
  try {
    const data = JSON.parse(el.textContent) as EmbeddedProfile;
    if (data?.p?.pno === pno) return data;
  } catch {
    // Malformed payload — fall back to fetching the dataset.
  }
  return null;
}

interface LoadedState {
  // `feature` holds national-dataset properties: the quality index is
  // dataset-relative, so every displayed stat must come from the national set.
  // `geoFeature` is the same neighborhood from its region's TopoJSON, loaded
  // only for the MiniMap's geometry — null when the region file fails to load.
  feature: Feature;
  geoFeature: Feature<Polygon | MultiPolygon> | null;
  regionFeatures: Feature[];
  allFeatures: Feature[];
  metroAverages: Record<string, number>;
  // Precomputed percentile bundle from the prerendered payload (fast path). Null on the
  // client-side-navigation / non-prerendered path, where <JsonLd /> derives percentiles
  // from the national cohort (`allFeatures`) that path loads anyway.
  percentiles: NeighbourhoodPercentiles | null;
}

/**
 * LP-2: build a render-ready LoadedState synchronously from a prerendered page's
 * embedded payload, so a hard load of a profile page paints content on the FIRST
 * frame instead of flashing the bare "Ladataan…" loading view (the page does not
 * hydrate — main.tsx renders fresh — so without this the static HTML is replaced
 * by a spinner → loading text → content). Returns null when there is no embedded
 * payload (the genuine in-app fetch path), leaving the loading frame intact there.
 */
function initialStateFromEmbedded(slug: string | undefined): LoadedState | null {
  const pno = slug ? parseSlug(slug) : null;
  if (!pno) return null;
  const embedded = readEmbeddedProfile(pno);
  if (!embedded) return null;
  const feat = { type: 'Feature', properties: embedded.p, geometry: null } as unknown as Feature;
  return { feature: feat, geoFeature: null, regionFeatures: [], allFeatures: [], metroAverages: embedded.avg, percentiles: embedded.pct ?? null };
}

export const NeighborhoodProfilePage: React.FC = () => {
  useI18nVersion();
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  // LP-2: seed synchronously from the prerendered payload so prerendered pages skip
  // the loading frame entirely (the post-paint effect below re-confirms it).
  const [state, setState] = useState<LoadedState | null>(() => initialStateFromEmbedded(slug));
  const [loading, setLoading] = useState(() => initialStateFromEmbedded(slug) == null);
  // Hold an error *code*, not a pre-translated string, so the message re-localizes
  // on language toggle and never leaks a raw English exception to the user.
  const [error, setError] = useState<'invalid_url' | 'not_found' | 'load_failed' | null>(null);
  // True once the region geometry load has settled (loaded or failed). Until
  // then the MiniMap slot shows a placeholder so its arrival doesn't shift layout.
  const [mapResolved, setMapResolved] = useState(false);
  // Bumped by the Retry button on a `load_failed` error; included in the load
  // effect's deps so incrementing it cleanly re-runs the fetch.
  const [retryCount, setRetryCount] = useState(0);
  // "Fit for you": the visitor's saved priority profile, read once from localStorage
  // (client-only; defaults when none saved → the badge shows a CTA instead).
  const [wizardProfile] = useState(() => readStoredWizardProfile());
  // #2: one-tap Save on the profile page (the highest-traffic, indexed surface),
  // no account required. Pure-local (no userId) — the value persists to localStorage
  // and is merged up to the user's cloud favorites the next time they sign in inside
  // the app, so the profile→app return loop closes without pulling auth onto this page.
  // Declared above the early returns so the hook order stays stable.
  const { isFavorite, toggleFavorite } = useFavorites();

  // Detect language from URL path:
  //   /sv/omrade/… → Swedish
  //   /en/area/…   → English
  //   /alue/…      → Finnish (default)
  const pathLang: Lang = location.pathname.startsWith('/sv/')
    ? 'sv'
    : location.pathname.startsWith('/en/')
      ? 'en'
      : 'fi';
  useEffect(() => {
    if (getLang() !== pathLang) void setLang(pathLang);
  }, [pathLang]);

  // Path prefix per language for building neighborhood links from this page.
  const langPathPrefix: Record<Lang, string> = {
    fi: '/alue',
    en: '/en/area',
    sv: '/sv/omrade',
  };
  // QW-5: language-aware regional-hub path. The hubs are standalone prerendered
  // HTML outside the SPA router, so the breadcrumb links to them with a plain
  // <a> (a Link would 404 against react-router). Mirrors scripts/prerender-hubs.mjs.
  const cityHubPrefix: Record<Lang, string> = {
    fi: '/kaupunki',
    en: '/en/city',
    sv: '/sv/stad',
  };

  const [lang, setLangState] = useState<Lang>(pathLang);
  // Sync local lang state when the URL language changes (e.g., navigating from /alue/ to /en/area/)
  useEffect(() => {
    setLangState(pathLang);
  }, [pathLang]);

  const pno = slug ? parseSlug(slug) : null;

  // LP-1: mirror of `state` for the load effect, so a client-side profile→profile
  // navigation can resolve the target from the PREVIOUS page's already-loaded
  // region features instead of pulling the multi-MB national dataset for one area.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // #1: captured once at mount — the pno + language the page was prerendered for (null pno
  // when the page was not prerendered). The head effect uses these to leave the richer
  // prerendered <title>/description/OG/hreflang untouched on the initial prerendered view,
  // and only take over on client-side navigation to another profile or a language toggle.
  const [prerenderedPno] = useState<string | null>(() => (pno && readEmbeddedProfile(pno) ? pno : null));
  // CF-1: reverse-nav links embedded on prerendered pages (mount-stable; null on SPA nav).
  const [prerenderedNav] = useState(() => (pno ? readEmbeddedProfile(pno)?.nav ?? null : null));
  const [prerenderedLang] = useState<Lang>(() => pathLang);
  // Flips true the first time we take over the <head>; from then on we always manage it,
  // so navigating back to the originally prerendered area doesn't re-skip onto a now-stale
  // head that an intervening navigation/toggle left behind.
  const headMutatedRef = useRef(false);

  useEffect(() => {
    if (!pno) {
      setError('invalid_url');
      setLoading(false);
      setState(null);
      return;
    }

    // Reset state when pno changes so stale data/errors from the previous
    // neighborhood don't remain visible while the new data loads.
    setLoading(true);
    setError(null);
    setMapResolved(false);

    let cancelled = false;

    // Load the neighbourhood's region TopoJSON for the MiniMap geometry and
    // surrounding polygons, then merge it into state. Runs in the background
    // so it never blocks first paint; the profile renders fine without a map.
    const loadGeometry = async (regionId: RegionId | null | undefined) => {
      if (!regionId) {
        if (!cancelled) setMapResolved(true);
        return;
      }
      try {
        const region = await loadRegionData(regionId);
        if (cancelled) return;
        const geoFeat = region.data.features.find(
          f => f.properties?.pno === pno && f.geometry != null,
        ) as Feature<Polygon | MultiPolygon> | undefined;
        setState(prev => prev
          ? { ...prev, geoFeature: geoFeat ?? null, regionFeatures: region.data.features }
          : prev);
      } catch {
        // Region geometry unavailable — render the profile without the map.
      } finally {
        if (!cancelled) setMapResolved(true);
      }
    };

    // Fast path: prerendered pages embed a render-ready payload (props + averages +
    // precomputed percentiles). Paint the profile from it immediately, then hydrate ONLY
    // the region geometry in the background (for the MiniMap and the region-scoped
    // "similar neighbourhoods" grid). Crucially we no longer fetch the ~2 MB national
    // dataset here: the percentile structured data comes from the baked `pct`, and the
    // similar grid is sourced from the region's features — so the highest-traffic surface
    // (SEO landings) drops a 2 MB fetch + 12 MB JSON.parse long-task off the main thread.
    // The national set is pulled only on genuine in-app profile→profile navigation (the
    // fallback path below), which needs it to resolve the target feature.
    const embedded = readEmbeddedProfile(pno);
    if (embedded) {
      const feat = { type: 'Feature', properties: embedded.p, geometry: null } as unknown as Feature;
      setState({
        feature: feat,
        geoFeature: null,
        regionFeatures: [],
        allFeatures: [],
        metroAverages: embedded.avg,
        percentiles: embedded.pct ?? null,
      });
      setLoading(false);

      void loadGeometry(embedded.p.city);

      return () => { cancelled = true; };
    }

    // LP-1: client-side profile→profile navigation (e.g. a tap on the
    // "Similar neighbourhoods" grid — region-scoped by construction). The target
    // usually sits in the previous page's already-loaded region features, geometry
    // included — resolve it from there instead of downloading + parsing the
    // multi-MB national dataset to look up one area on a low-powered device.
    const prev = stateRef.current;
    const regionFeat = prev?.regionFeatures.find(f => f.properties?.pno === pno);
    if (regionFeat?.properties) {
      setState({
        feature: regionFeat,
        geoFeature: regionFeat.geometry != null ? (regionFeat as Feature<Polygon | MultiPolygon>) : null,
        regionFeatures: prev!.regionFeatures,
        // Carry the national cohort forward if a previous fallback load fetched it;
        // otherwise JsonLd simply derives what it can from the region features.
        allFeatures: prev!.allFeatures,
        metroAverages: prev!.metroAverages,
        percentiles: null,
      });
      setLoading(false);
      setMapResolved(true);
      return () => { cancelled = true; };
    }

    // Fallback: no usable embedded payload (client-side navigation, or a page
    // that was not prerendered). Load the national dataset, then render — on
    // client-side navigation this resolves instantly from the in-memory cache.
    void (async () => {
      try {
        const { data, metroAverages } = await loadNeighborhoodData();
        if (cancelled) return;
        const feat = data.features.find(f => f.properties?.pno === pno);
        if (!feat) {
          setError('not_found');
          setLoading(false);
          return;
        }
        setState({
          feature: feat,
          geoFeature: null,
          regionFeatures: [],
          allFeatures: data.features,
          metroAverages,
          // No baked bundle on this path — <JsonLd /> derives percentiles from the
          // national cohort (`allFeatures`) we just loaded.
          percentiles: null,
        });
        setLoading(false);
        void loadGeometry(feat.properties?.city as RegionId | undefined);
      } catch {
        // Don't surface the raw exception text (English, unlocalized) to the user.
        if (cancelled) return;
        setError('load_failed');
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pno, retryCount]);

  // Update document title + hreflang + meta description.
  // Reuse existing elements from index.html where possible to avoid duplicates.
  useEffect(() => {
    if (state?.feature.properties) {
      const d = state.feature.properties as NeighborhoodProperties;
      // #1: on the initial prerendered view, the static <head> the prerenderer baked is
      // already correct AND richer (keyword-front-loaded title + percentile-led meta
      // description) than anything we can rebuild here — especially now the fast path no
      // longer loads the national dataset the rich description is derived from. Leave it
      // untouched; only take over on client-side navigation to a different profile or a
      // language toggle. Once we DO take over, keep managing it (headMutatedRef) so a
      // later return to this area/lang doesn't re-skip onto a stale head.
      if (!headMutatedRef.current && d.pno === prerenderedPno && lang === prerenderedLang) {
        return undefined;
      }
      headMutatedRef.current = true;
      const slug = toSlug(d.pno, d.nimi);
      // Use Swedish name in title when viewing on the Swedish route (falls back to nimi).
      const titleName = lang === 'sv' && d.namn ? d.namn : d.nimi;
      // Save the previous title so unmount restores the user's actual context
      // (e.g. the App's main title) instead of clobbering it with a hardcoded value.
      const prevTitle = document.title;
      const docTitle = `${titleName} (${d.pno}) – naapurustot.fi`;
      document.title = docTitle;

      // Meta description — update existing or create
      const existingMeta = document.querySelector('meta[name="description"]');
      const descContent = d.quality_index != null
        ? `${titleName} (${d.pno}) – ${t('panel.quality_index')}: ${Math.round(d.quality_index)}/100`
        : `${titleName} (${d.pno})`;
      let prevMetaContent: string | null = null;
      let createdMeta: HTMLMetaElement | null = null;
      if (existingMeta) {
        prevMetaContent = existingMeta.getAttribute('content');
        existingMeta.setAttribute('content', descContent);
      } else {
        createdMeta = document.createElement('meta');
        createdMeta.name = 'description';
        createdMeta.content = descContent;
        document.head.appendChild(createdMeta);
      }

      // Canonical — update existing or create
      const existingCanonical = document.querySelector('link[rel="canonical"]');
      let prevCanonicalHref: string | null = null;
      let createdCanonical: HTMLLinkElement | null = null;
      const canonicalByLang: Record<Lang, string> = {
        fi: `https://naapurustot.fi/alue/${slug}/`,
        en: `https://naapurustot.fi/en/area/${slug}/`,
        sv: `https://naapurustot.fi/sv/omrade/${slug}/`,
      };
      const canonicalHref = canonicalByLang[lang];
      if (existingCanonical) {
        prevCanonicalHref = existingCanonical.getAttribute('href');
        existingCanonical.setAttribute('href', canonicalHref);
      } else {
        createdCanonical = document.createElement('link');
        createdCanonical.rel = 'canonical';
        createdCanonical.href = canonicalHref;
        document.head.appendChild(createdCanonical);
      }

      // Hreflang — index.html and the prerenderer already ship fi/en/sv alternates, so
      // UPDATE the existing links rather than always appending (which previously left a
      // duplicate set on the client-navigation/toggle path). Create only if truly absent.
      const hreflangCleanup: Array<() => void> = [];
      for (const hl of ['fi', 'en', 'sv'] as const) {
        const href = canonicalByLang[hl];
        const existing = document.querySelector(`link[rel="alternate"][hreflang="${hl}"]`);
        if (existing) {
          const prev = existing.getAttribute('href');
          existing.setAttribute('href', href);
          hreflangCleanup.push(() => { if (prev != null) existing.setAttribute('href', prev); });
        } else {
          const link = document.createElement('link');
          link.rel = 'alternate';
          link.hreflang = hl;
          link.href = href;
          document.head.appendChild(link);
          hreflangCleanup.push(() => link.remove());
        }
      }

      // OG/Twitter tags: the prerenderer rewrites these per page, but client-side
      // navigation between profiles (e.g. via "similar neighborhoods") must keep
      // them in sync too — some social unfurlers/crawlers read the live DOM. Update
      // existing tags only (never create them), then restore on cleanup. Mirror the
      // prerender values: titles → docTitle, descriptions → descContent, og:url →
      // canonicalHref.
      const metaUpdates: { el: Element; prev: string | null }[] = [];
      const setMeta = (selector: string, value: string) => {
        const el = document.querySelector(selector);
        if (!el) return;
        metaUpdates.push({ el, prev: el.getAttribute('content') });
        el.setAttribute('content', value);
      };
      setMeta('meta[property="og:title"]', docTitle);
      setMeta('meta[property="og:description"]', descContent);
      setMeta('meta[property="og:url"]', canonicalHref);
      setMeta('meta[name="twitter:title"]', docTitle);
      setMeta('meta[name="twitter:description"]', descContent);

      return () => {
        document.title = prevTitle;
        for (const { el, prev } of metaUpdates) {
          if (prev != null) el.setAttribute('content', prev);
        }
        // Restore previous values for existing elements, remove created ones
        if (existingMeta && prevMetaContent != null) {
          existingMeta.setAttribute('content', prevMetaContent);
        }
        createdMeta?.remove();
        if (existingCanonical && prevCanonicalHref != null) {
          existingCanonical.setAttribute('href', prevCanonicalHref);
        }
        createdCanonical?.remove();
        for (const undo of hreflangCleanup) undo();
      };
    }
    // No state yet → no head mutations happened, so no cleanup needed.
    return undefined;
  // lang is included so meta description updates when the user toggles language
  // (t() reads the current global language, which changes when lang state changes).
  // prerenderedPno/prerenderedLang are mount-stable (never change after first render),
  // so listing them satisfies exhaustive-deps without adding any re-runs.
  }, [state, lang, prerenderedPno, prerenderedLang]);

  const changeLang = (next: Lang) => {
    if (next === lang) return;
    void setLang(next);
    setLangState(next);
    if (slug) navigate(`${langPathPrefix[next]}/${slug}`, { replace: true });
  };

  // "Similar neighbourhoods" grid — sourced from the region's own features (loaded for
  // the MiniMap), NOT the national set, so the prerendered fast path no longer needs to
  // fetch the ~2 MB national dataset just to fill a below-the-fold grid. On the
  // client-side-navigation path the region features load the same way. Appears once the
  // region geometry has loaded; the cross-region SEO link mesh lives in the prerendered
  // <noscript> and is unaffected.
  const similar = useMemo(() => {
    if (!state) return [];
    return findSimilarNeighborhoods(
      state.feature.properties as NeighborhoodProperties,
      state.regionFeatures,
      5,
    );
  }, [state]);

  // T1: seutukunta (sub-region) price averages, used as a display-only fallback when
  // this area lacks its own housing/rent price. Computed from the region's features
  // (loaded async for the MiniMap), so the estimate appears after that load — the
  // static/prerendered HTML and JSON-LD keep showing only real per-area data. Declared
  // before the early returns so the hook order is stable.
  const regionPriceAvg = useMemo(
    () => (state?.regionFeatures && state.regionFeatures.length > 0 ? computeMetroAverages(state.regionFeatures) : null),
    [state?.regionFeatures],
  );

  // LP-1: full-page spinner only when there is nothing to show yet (hard load of a
  // non-prerendered page). During client-side navigation the previous profile stays
  // visible under a light overlay (below) instead of blanking the whole page.
  if (loading && !state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-surface-950">
        <div className="animate-pulse text-surface-600">{t('loading')}</div>
      </div>
    );
  }

  if (error || !state) {
    // Translate at render time so the heading follows the active language and
    // re-localizes on toggle (useI18nVersion above forces the re-render).
    const heading = error ? t(`error.${error}`) : t('error.generic');
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-surface-950 text-surface-900 dark:text-white px-4">
        <h1 className="text-2xl font-bold mb-4">{heading}</h1>
        {error === 'load_failed' && (
          <button
            onClick={() => setRetryCount(c => c + 1)}
            className="inline-flex items-center px-6 py-3 mb-4 bg-brand-700 text-white rounded-lg hover:bg-brand-800 transition-colors font-medium"
          >
            {t('error.retry')}
          </button>
        )}
        <Link to="/" className="text-brand-600 hover:underline">{t('notfound.back_to_map')}</Link>
      </div>
    );
  }

  const d = state.feature.properties as NeighborhoodProperties;
  const saved = isFavorite(d.pno);
  const avg = state.metroAverages;
  const center = getFeatureCenter(state.geoFeature ?? state.feature);
  const qi = d.quality_index != null ? Math.round(d.quality_index) : null;
  const qiCat = getQualityCategory(qi);
  // T3: match the on-map quality_index fill color (continuous ramp, colorblind-aware).
  const qiLayer = getLayerById('quality_index');
  const qiColor = qi != null ? getInterpolatedColor(qiLayer, qi) : '#6b7280';

  // Fall back to the same city the breadcrumb href defaults to, so a record
  // missing `city` still renders visible, consistent link text (rather than '').
  const cityName = t(`city.${d.city ?? 'helsinki_metro'}`);

  // T1: resolve the two price fallbacks from the seutukunta averages computed above.
  const regionPrice = (key: string): number | null => {
    const v = regionPriceAvg?.[key];
    return typeof v === 'number' && isFinite(v) ? v : null;
  };
  const propertyPriceFallback = d.property_price_sqm == null ? regionPrice('property_price_sqm') : null;
  const rentalPriceFallback = d.rental_price_sqm == null ? regionPrice('rental_price_sqm') : null;

  // SearchBar/NeighborhoodProfilePage display Swedish name when on the Swedish route.
  const displayName = lang === 'sv' && d.namn ? d.namn : d.nimi;
  const altName = lang === 'sv'
    ? (d.nimi && d.nimi !== displayName ? d.nimi : '')
    : (d.namn && d.namn !== displayName ? d.namn : '');

  const profileSlug = toSlug(d.pno, d.nimi);
  const canonicalUrl = `https://naapurustot.fi${langPathPrefix[lang]}/${profileSlug}/`;

  // #1 trust: language-aware full-sources page + the distinct publishers behind the
  // headline stats, surfaced as a compact provenance line under the Quality Index so a
  // cold Google visitor sees "these numbers come from official sources" above the fold,
  // not only via a small footer link. Publisher names are proper nouns (Tilastokeskus,
  // Poliisi, HSY, …), so listing them needs no new translatable strings.
  const sourcesPath = lang === 'en' ? '/en/data-sources' : lang === 'sv' ? '/sv/datakallor' : '/tietolahteet';
  const provenancePublishers = Array.from(
    new Set(
      ['crime_index', 'hr_mtu', 'unemployment_rate', 'air_quality_index', 'transit_stop_density', 'property_price_sqm']
        .map((k) => getMetricSource(k)?.publisherName)
        .filter((n): n is string => !!n),
    ),
  );

  /** Format a comparison string: "avg: X" with color. */
  const avgStr = (val: number | null, key: string, formatter: (v: number | null) => string) => {
    const a = avg[key];
    if (val == null || a == null) return '';
    const diff = formatDiff(val, a);
    return `${t('profile.avg')}: ${formatter(a)} (${diff})`;
  };

  return (
    <div className="min-h-screen bg-white dark:bg-surface-950 text-surface-900 dark:text-white" aria-busy={loading}>
      {/* LP-1: lightweight loading veil over the still-visible previous profile
          during client-side navigation — replaces the jarring full-page blank. */}
      {loading && (
        <div className="fixed inset-0 z-40 bg-white/60 dark:bg-surface-950/60 flex items-center justify-center" role="status">
          <div className="animate-pulse text-surface-600 dark:text-surface-300">{t('loading')}</div>
        </div>
      )}
      <JsonLd properties={d} center={center} url={canonicalUrl} lang={lang} percentiles={state.percentiles} nationalFeatures={state.allFeatures} regionFeatures={state.regionFeatures} />

      {/* Header */}
      <header className="border-b border-surface-200 dark:border-surface-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-start justify-between gap-3">
          <div>
            <Link to="/" className="text-lg font-bold text-brand-600 hover:text-brand-600 transition-colors">
              naapurustot.fi
            </Link>
            {/* #2: orient the cold organic-search visitor. The ~9,000 prerendered profile
                pages are the app's dominant first impression, yet nothing here framed what
                the site IS or its breadth — the value prop lived only in the home onboarding
                modal a profile visitor never sees. */}
            <p className="text-[11px] sm:text-xs text-surface-600 dark:text-surface-400 mt-0.5 max-w-md leading-snug">
              {t('profile.site_tagline')}
            </p>
          </div>
          {/* DX-1: the shared three-option picker instead of an ambiguous single
              cycle-button showing only the NEXT language's code — a cold visitor
              couldn't tell current from target, and reaching SV from FI took two
              undiscoverable taps on the app's highest-traffic surface. */}
          <div className="shrink-0 w-36">
            <LanguagePicker lang={lang} onLangChange={changeLang} showLabel={false} />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8 focus:outline-none">
        {/* Breadcrumb */}
        <nav className="text-sm text-surface-600 dark:text-surface-400 mb-6">
          <Link to="/" className="hover:text-brand-600">{t('app.title')}</Link>
          <span className="mx-2">/</span>
          <a href={`${cityHubPrefix[lang]}/${d.city ?? 'helsinki_metro'}/`} className="hover:text-brand-600">{cityName}</a>
          {prerenderedNav?.muni && (
            <>
              <span className="mx-2">/</span>
              <a href={prerenderedNav.muni.href} className="hover:text-brand-600">{prerenderedNav.muni.label}</a>
            </>
          )}
          <span className="mx-2">/</span>
          <span className="text-surface-900 dark:text-white">{displayName}</span>
        </nav>

        {/* CF-1: reverse-nav into the ranking / compare / municipality / planning hub mesh.
            The directory link always shows; the rest render from the prerendered manifest so a
            crawler (and a returning user) can reach the otherwise-orphaned SEO pages. A <div>,
            not a second <nav> landmark — the breadcrumb above is the page's only nav landmark
            (two unlabelled navigation landmarks fail axe's landmark-unique / Lighthouse a11y). */}
        <div className="text-xs text-surface-600 dark:text-surface-400 mb-6 flex flex-wrap gap-x-4 gap-y-1.5">
          <a href={DIRECTORY_URL[lang]} className="hover:text-brand-600">{t('profile.nav_all_areas')}</a>
          {prerenderedNav?.rankings && prerenderedNav.rankings.length > 0 && (
            <span>{t('profile.nav_rankings')}:{' '}
              {prerenderedNav.rankings.slice(0, 6).map((r, i) => (
                <span key={r.href}>{i > 0 && ' · '}<a href={r.href} className="hover:text-brand-600">{r.label}</a></span>
              ))}
            </span>
          )}
          {prerenderedNav?.compares && prerenderedNav.compares.length > 0 && (
            <span>{t('profile.nav_compare')}:{' '}
              {prerenderedNav.compares.slice(0, 4).map((c, i) => (
                <span key={c.href}>{i > 0 && ' · '}<a href={c.href} className="hover:text-brand-600">{c.label}</a></span>
              ))}
            </span>
          )}
          {prerenderedNav?.planning && (
            <a href={prerenderedNav.planning.href} className="hover:text-brand-600">{t('profile.nav_planning')}</a>
          )}
        </div>

        {/* Title + Mini Map */}
        <div className="mb-8 md:flex md:gap-8 md:items-start">
          <div className="md:flex-1">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-3xl font-bold mb-2">{displayName}</h1>
              {/* #2: one-tap Save (favorite) — closes the profile→app return loop. */}
              <button
                onClick={() => toggleFavorite(d.pno)}
                aria-pressed={saved}
                aria-label={saved ? t('favorites.remove') : t('favorites.add')}
                title={saved ? t('favorites.remove') : t('favorites.add')}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  saved
                    ? 'bg-amber-400/15 text-amber-700 dark:text-amber-400 border-amber-400/40 hover:bg-amber-400/25'
                    : 'border-surface-300 dark:border-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
                }`}
              >
                <svg className="w-4 h-4" fill={saved ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
                <span className="hidden sm:inline">{saved ? t('favorites.remove') : t('favorites.add')}</span>
              </button>
            </div>
            <p className="text-surface-600 dark:text-surface-400 mb-4 md:mb-0">
              {altName ? `${altName} · ` : ''}{t('profile.postal_code')} {d.pno} · {cityName}
            </p>
            {/* #1 conversion: primary app entry points, above the fold on DESKTOP — the
                mobile sticky bar (bottom of the tree) already covers small screens, but
                desktop's only CTA was the very last element in <main>. Main CTA opens the
                live map for THIS area (/?pno=); secondary opens the "Fit for you" finder. */}
            <div className="hidden md:flex mt-4 gap-2">
              <Link
                to={`/?pno=${d.pno}`}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-700 text-white rounded-lg hover:bg-brand-800 transition-colors font-medium"
              >
                {t('profile.explore_on_map')}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <Link
                to="/?finder=1"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-surface-300 dark:border-surface-700 text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors font-medium"
              >
                {t('fit.cta')}
              </Link>
            </div>
          </div>
          {state.geoFeature ? (
            <div className="md:w-80 md:flex-shrink-0">
              {/* #1 conversion: the mini-map LOOKS interactive but MiniMap is
                  interactive:false — wrap it in a Link so the natural "click the map to
                  explore" gesture actually opens the live map for this area, with a hover
                  affordance so the interaction is discoverable on desktop. */}
              <Link
                to={`/?pno=${d.pno}`}
                aria-label={t('profile.explore_on_map')}
                className="group relative block rounded-xl overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Suspense fallback={<div className="w-full h-64 md:h-80 rounded-xl bg-surface-100 dark:bg-surface-900/60 animate-pulse" />}>
                  <MiniMap
                    feature={state.geoFeature}
                    allFeatures={state.regionFeatures}
                  />
                </Suspense>
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 py-2
                                 bg-gradient-to-t from-black/55 to-transparent text-white text-xs font-medium
                                 opacity-0 group-hover:opacity-100 transition-opacity">
                  {t('profile.explore_on_map')}
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </Link>
            </div>
          ) : (!mapResolved && d.city != null) ? (
            // Reserve the map slot while its geometry loads in the background
            // so the MiniMap's arrival doesn't push page content down (CLS).
            <div className="md:w-80 md:flex-shrink-0">
              <div className="w-full h-64 md:h-80 rounded-xl bg-surface-100 dark:bg-surface-900/60 animate-pulse" />
            </div>
          ) : null}
        </div>

        {/* Quality Index Banner */}
        {qi != null && qiCat && (
          <div className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-6 mb-8">
            {/* #1 trust: the headline number now carries the same "How is this
                calculated?" explainer the in-app panel has, so a cold visitor can see
                what the score means and how it is weighted — not an unexplained figure. */}
            <div className="flex items-center gap-1 mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400">
                {t('panel.quality_index')}
              </h2>
              <QualityExplainer lang={lang} />
            </div>
            <div className="flex items-center gap-4 mb-4">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center font-bold text-xl"
                style={{ backgroundColor: qiColor, color: readableTextColor(qiColor) }}
              >
                {qi}
              </div>
              <div>
                <span className="text-xl font-semibold">{qiCat.label[lang]}</span>
                <span className="text-surface-600 dark:text-surface-400 text-sm ml-2">
                  ({qiCat.min}–{qiCat.max})
                </span>
              </div>
            </div>
            <div className="flex gap-0.5">
              {QUALITY_CATEGORIES.map((c) => (
                <div key={c.min} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full h-2 rounded-full" style={{ backgroundColor: getInterpolatedColor(qiLayer, (c.min + c.max) / 2) }} />
                  <span className="text-[9px] text-surface-600 dark:text-surface-400">{c.label[lang]}</span>
                </div>
              ))}
            </div>
            {/* #1 trust: compact provenance for the score — real, official publishers
                behind the data + a link to the full per-source page, right under the
                headline instead of only in the footer. */}
            <div className="mt-4 pt-3 border-t border-surface-200/70 dark:border-surface-700/40 text-[11px] leading-snug text-surface-600 dark:text-surface-400">
              <Link to={sourcesPath} className="hover:text-brand-600 underline decoration-dotted underline-offset-2">
                {t('profile.data_sources')}
              </Link>
              {provenancePublishers.length > 0 && (
                <span className="text-surface-600 dark:text-surface-400"> · {provenancePublishers.join(' · ')}</span>
              )}
            </div>
          </div>
        )}

        {/* Fit for you — match score against the visitor's saved priority profile, or a
            CTA to set priorities. Opens the Neighborhood Finder on the home page. */}
        <div className="mb-8">
          <FitForYouBadge data={d} profile={wizardProfile} variant="banner" />
        </div>

        {/* Key Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          <StatCard
            label={t('layer.median_income')}
            value={formatEuro(d.hr_mtu)}
            rawValue={d.hr_mtu}
            average={avg.hr_mtu}
            avgLabel={avgStr(d.hr_mtu, 'hr_mtu', formatEuro)}
            propertyKey="hr_mtu"
          />
          <StatCard
            label={t('layer.unemployment')}
            value={formatPct(d.unemployment_rate)}
            rawValue={d.unemployment_rate}
            average={avg.unemployment_rate}
            avgLabel={avgStr(d.unemployment_rate, 'unemployment_rate', v => formatPct(v))}
            propertyKey="unemployment_rate"
            higherIsBetter={false}
          />
          <StatCard
            label={t('layer.property_price')}
            value={d.property_price_sqm != null
              ? `${formatNumber(d.property_price_sqm)} €/m²`
              : (propertyPriceFallback != null ? `${formatNumber(propertyPriceFallback)} €/m²` : '—')}
            rawValue={d.property_price_sqm}
            average={avg.property_price_sqm}
            avgLabel={avgStr(d.property_price_sqm, 'property_price_sqm', v => `${formatNumber(v)} €/m²`)}
            propertyKey="property_price_sqm"
            subregionEstimate={d.property_price_sqm == null && propertyPriceFallback != null}
            subregionBadge={t('data.subregion_estimate')}
            subregionNote={t('data.subregion_estimate_desc').replace('{region}', cityName)}
          />
          <StatCard
            label={t('layer.population_density')}
            value={d.population_density != null ? `${formatNumber(Math.round(d.population_density))}` : '—'}
            rawValue={d.population_density}
            average={avg.population_density}
            avgLabel={avgStr(d.population_density, 'population_density', v => formatNumber(Math.round(v!)))}
            propertyKey="population_density"
          />
          <StatCard
            label={t('layer.education')}
            value={formatPct(d.higher_education_rate)}
            rawValue={d.higher_education_rate}
            average={avg.higher_education_rate}
            avgLabel={avgStr(d.higher_education_rate, 'higher_education_rate', v => formatPct(v))}
            propertyKey="higher_education_rate"
          />
          <StatCard
            label={t('layer.transit_access')}
            value={d.transit_stop_density != null ? formatNumber(Math.round(d.transit_stop_density)) : '—'}
            rawValue={d.transit_stop_density}
            average={avg.transit_stop_density}
            avgLabel={avgStr(d.transit_stop_density, 'transit_stop_density', v => formatNumber(Math.round(v!)))}
            propertyKey="transit_stop_density"
          />
        </div>

        {/* Demographics Section */}
        <Section title={t('profile.demographics')}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatItem label={t('profile.population')} value={formatNumber(d.he_vakiy)} />
            <StatItem label={t('layer.avg_age')} value={d.he_kika != null ? d.he_kika.toFixed(1) : '—'} />
            <StatItem label={t('layer.child_ratio')} value={formatPct(d.child_ratio)} />
            <StatItem label={t('layer.foreign_lang')} value={formatPct(d.foreign_language_pct)} />
            <StatItem label={t('layer.pensioners')} value={formatPct(d.pensioner_share)} />
            <StatItem label={t('layer.student_share')} value={formatPct(d.student_share)} />
          </div>
        </Section>

        {/* Housing Section */}
        <Section title={t('profile.housing')}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatItem label={t('layer.ownership')} value={formatPct(d.ownership_rate)} />
            <StatItem label={t('layer.rental')} value={formatPct(d.rental_rate)} />
            <StatItem label={t('layer.apt_size')} value={d.ra_as_kpa != null ? `${d.ra_as_kpa.toFixed(1)} m²` : '—'} />
            <StatItem label={t('layer.detached_houses')} value={formatPct(d.detached_house_share)} />
            {(d.rental_price_sqm != null || rentalPriceFallback != null) && (
              <StatItem
                label={t('layer.rental_price')}
                value={d.rental_price_sqm != null
                  ? `${d.rental_price_sqm.toFixed(2)} €/m²/kk`
                  : `${rentalPriceFallback!.toFixed(2)} €/m²/kk`}
                estimate={d.rental_price_sqm == null}
                estimateBadge={t('data.subregion_estimate')}
                estimateNote={t('data.subregion_estimate_desc').replace('{region}', cityName)}
              />
            )}
            {d.avg_construction_year != null && (
              <StatItem label={t('layer.building_age')} value={String(Math.round(d.avg_construction_year))} />
            )}
          </div>
        </Section>

        {/* Services Section */}
        <Section title={t('profile.services')}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {d.grocery_density != null && <StatItem label={t('layer.grocery_access')} value={formatNumber(Math.round(d.grocery_density))} />}
            {d.restaurant_density != null && <StatItem label={t('layer.restaurant_density')} value={formatNumber(Math.round(d.restaurant_density))} />}
            {d.school_density != null && <StatItem label={t('layer.school_density')} value={formatNumber(Math.round(d.school_density))} />}
            {d.daycare_density != null && <StatItem label={t('layer.daycare_density')} value={formatNumber(Math.round(d.daycare_density))} />}
            {d.healthcare_density != null && <StatItem label={t('layer.healthcare_access')} value={formatNumber(Math.round(d.healthcare_density))} />}
            {d.sports_facility_density != null && <StatItem label={t('layer.sports_facilities')} value={formatNumber(Math.round(d.sports_facility_density))} />}
          </div>
        </Section>

        {/* Environment Section */}
        <Section title={t('profile.environment')}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {d.air_quality_index != null && <StatItem label={t('layer.air_quality')} value={d.air_quality_index.toFixed(1)} />}
            {d.tree_canopy_pct != null && <StatItem label={t('layer.tree_canopy')} value={formatPct(d.tree_canopy_pct)} />}
            {d.water_proximity_m != null && <StatItem label={t('layer.water_proximity')} value={`${formatNumber(Math.round(d.water_proximity_m))} m`} />}
            {d.noise_pollution != null && <StatItem label={t('layer.noise_pollution')} value={`${d.noise_pollution.toFixed(1)} dB`} />}
            {d.walkability_index != null && <StatItem label={t('layer.walkability')} value={d.walkability_index.toFixed(1)} />}
          </div>
        </Section>

        {/* Similar Neighborhoods */}
        {similar.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-4">{t('profile.similar')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {similar.map(s => (
                <Link
                  key={s.properties.pno}
                  to={`${langPathPrefix[lang]}/${toSlug(s.properties.pno, s.properties.nimi)}`}
                  className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-4 hover:bg-surface-200 dark:hover:bg-surface-800 transition-colors"
                >
                  <div className="font-medium text-sm mb-1">{lang === 'sv' && s.properties.namn ? s.properties.namn : s.properties.nimi}</div>
                  <div className="text-xs text-surface-600 dark:text-surface-400">{s.properties.pno}</div>
                  {s.properties.quality_index != null && (
                    <div className="text-xs mt-2">
                      <span className="font-semibold">{Math.round(s.properties.quality_index)}</span>
                      <span className="text-surface-600 dark:text-surface-400 ml-1">{t('profile.quality_short')}</span>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* CTA: Explore on map */}
        <div className="text-center py-8 border-t border-surface-200 dark:border-surface-800">
          <Link
            to={`/?pno=${d.pno}`}
            className="inline-flex items-center gap-2 px-6 py-3 bg-brand-700 text-white rounded-lg hover:bg-brand-800 transition-colors font-medium"
          >
            {t('profile.explore_on_map')}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </main>

      {/* Footer — extra bottom padding on mobile so its content clears the sticky CTA bar. */}
      <footer className="border-t border-surface-200 dark:border-surface-800 pt-6 pb-24 md:pb-6">
        <div className="max-w-5xl mx-auto px-4 text-center text-xs text-surface-600 dark:text-surface-400">
          {/* QW-5: link to the full, per-language sources page instead of a stale
              hardcoded four-source list (the app now ships ~59 layers from many sources). */}
          <p>
            <Link
              to={lang === 'en' ? '/en/data-sources' : lang === 'sv' ? '/sv/datakallor' : '/tietolahteet'}
              className="hover:text-brand-600"
            >
              {t('profile.data_sources')}
            </Link>
          </p>
          <p className="mt-1">
            <Link to="/" className="hover:text-brand-600">naapurustot.fi</Link>
            {' · '}
            <ContactMenu className="hover:text-brand-600" />
          </p>
        </div>
      </footer>

      {/* #2: mobile sticky CTA bar — hoists the two app entry points above the fold on
          the highest-traffic, indexed surface. Rendered by React only (NOT baked into the
          prerendered <noscript> HTML), so crawlers and SEO are unaffected. Primary routes
          to the live map for this area (/?pno=), secondary opens the "Fit for you" finder. */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 flex gap-2 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]
                      bg-white/95 dark:bg-surface-950/95 backdrop-blur-md border-t border-surface-200 dark:border-surface-800">
        <Link
          to={`/?pno=${d.pno}`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-brand-700 text-white font-medium text-sm hover:bg-brand-800 transition-colors"
        >
          {t('profile.explore_on_map')}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
        <Link
          to="/?finder=1"
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-surface-300 dark:border-surface-700 text-surface-700 dark:text-surface-200 font-medium text-sm hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
        >
          {t('fit.cta')}
        </Link>
      </div>
    </div>
  );
};

/**
 * #1 trust: "How is this calculated?" popover for the Quality Index, mirroring the
 * in-app NeighborhoodPanel's explainer (reuses the shared quality.* strings and the
 * QUALITY_DIMENSIONS weights) so the flagship number is auditable on the prerendered
 * profile page too. Self-contained popover state + outside-click/Escape dismissal.
 */
const QualityExplainer: React.FC<{ lang: Lang }> = ({ lang }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!popRef.current?.contains(n) && !btnRef.current?.contains(n)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  const evaluativeDims = QUALITY_DIMENSIONS.filter((d) => d.defaultWeight > 0);
  return (
    <div className="relative inline-flex normal-case tracking-normal">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('quality.how_calculated')}
        aria-expanded={open}
        className="w-4 h-4 flex items-center justify-center rounded-full text-surface-400 hover:text-brand-600 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {open && (
        <div
          ref={popRef}
          role="tooltip"
          className="absolute left-0 top-6 z-30 w-72 rounded-xl bg-white dark:bg-surface-800
                     border border-surface-200 dark:border-surface-700/50 shadow-2xl p-3 text-left"
        >
          <p className="text-[11px] font-normal text-surface-600 dark:text-surface-300 mb-2">
            {t('quality.explainer')}
          </p>
          <ul className="space-y-0.5">
            {evaluativeDims.map((dm) => (
              <li key={dm.id} className="flex items-center justify-between text-[11px] font-normal text-surface-700 dark:text-surface-200">
                <span>{dm.label[lang]}</span>
                <span className="tabular-nums text-surface-600 dark:text-surface-400">{dm.defaultWeight}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] font-normal text-surface-600 dark:text-surface-400">
            {t('quality.methodology_note')}
          </p>
        </div>
      )}
    </div>
  );
};

/** Simple stat display for section grids. */
const StatItem: React.FC<{ label: string; value: string; estimate?: boolean; estimateBadge?: string; estimateNote?: string }> = ({ label, value, estimate, estimateBadge, estimateNote }) => (
  <div>
    <div className="text-xs text-surface-600 dark:text-surface-400 mb-1">{label}</div>
    <div className="text-lg font-semibold flex items-center gap-2 flex-wrap">
      {value}
      {estimate && estimateBadge && (
        <span className="inline-flex items-center rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide
                         bg-amber-400/15 text-amber-700 dark:text-amber-400 border border-amber-400/30"
              title={estimateNote}>
          {estimateBadge}
        </span>
      )}
    </div>
  </div>
);

/** Collapsible section wrapper. AY-3: the toggle lives INSIDE a real <h2> (ARIA
 *  disclosure pattern) with aria-expanded — as a bare <button> these four stat
 *  sections were invisible to screen-reader heading navigation (the sibling
 *  Quality Index / Similar blocks already use <h2>s) and never announced state. */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-4">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-2 w-full text-left"
        >
          <svg
            className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {title}
        </button>
      </h2>
      {open && children}
    </section>
  );
};
