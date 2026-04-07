import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { loadNeighborhoodData } from '../utils/dataLoader';
import { parseSlug, toSlug } from '../utils/slug';
import type { NeighborhoodProperties } from '../utils/metrics';
import { t, getLang, setLang, type Lang } from '../utils/i18n';
import { formatNumber, formatEuro, formatPct, formatDiff } from '../utils/formatting';
import { getQualityCategory, QUALITY_CATEGORIES } from '../utils/qualityIndex';
import { findSimilarNeighborhoods } from '../utils/similarity';
import { getFeatureCenter } from '../utils/geometryFilter';
import { StatCard } from '../components/profile/StatCard';
import { JsonLd } from '../components/profile/JsonLd';

const MiniMap = lazy(() => import('../components/profile/MiniMap').then(m => ({ default: m.MiniMap })));

interface LoadedState {
  feature: Feature;
  allFeatures: Feature[];
  metroAverages: Record<string, number>;
}

export const NeighborhoodProfilePage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const [state, setState] = useState<LoadedState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detect language from URL path: /en/area/… → English, /alue/… → Finnish
  const pathLang: Lang = location.pathname.startsWith('/en/') ? 'en' : 'fi';
  useEffect(() => {
    if (getLang() !== pathLang) setLang(pathLang);
  }, [pathLang]);

  const [lang, setLangState] = useState<Lang>(pathLang);
  // Sync local lang state when the URL language changes (e.g., navigating from /alue/ to /en/area/)
  useEffect(() => {
    setLangState(pathLang);
  }, [pathLang]);

  const pno = slug ? parseSlug(slug) : null;

  useEffect(() => {
    if (!pno) {
      setError('Invalid neighborhood URL');
      setLoading(false);
      setState(null);
      return;
    }

    // Reset state when pno changes so stale data/errors from the previous
    // neighborhood don't remain visible while the new data loads.
    setLoading(true);
    setError(null);

    let cancelled = false;
    loadNeighborhoodData()
      .then(({ data, metroAverages }) => {
        if (cancelled) return;
        const feat = data.features.find(f => f.properties?.pno === pno);
        if (!feat) {
          setError('Neighborhood not found');
        } else {
          setState({ feature: feat, allFeatures: data.features, metroAverages });
        }
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [pno]);

  // Update document title + hreflang + meta description.
  // Reuse existing elements from index.html where possible to avoid duplicates.
  useEffect(() => {
    if (state?.feature.properties) {
      const d = state.feature.properties as NeighborhoodProperties;
      const slug = toSlug(d.pno, d.nimi);
      document.title = `${d.nimi} (${d.pno}) – naapurustot.fi`;

      // Meta description — update existing or create
      const existingMeta = document.querySelector('meta[name="description"]');
      const descContent = d.quality_index != null
        ? `${d.nimi} (${d.pno}) – ${t('panel.quality_index')}: ${Math.round(d.quality_index)}/100`
        : `${d.nimi} (${d.pno})`;
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
      const canonicalHref = `https://naapurustot.fi/alue/${slug}`;
      if (existingCanonical) {
        prevCanonicalHref = existingCanonical.getAttribute('href');
        existingCanonical.setAttribute('href', canonicalHref);
      } else {
        createdCanonical = document.createElement('link');
        createdCanonical.rel = 'canonical';
        createdCanonical.href = canonicalHref;
        document.head.appendChild(createdCanonical);
      }

      // Hreflang — always created (not in index.html)
      const hrefFi = document.createElement('link');
      hrefFi.rel = 'alternate';
      hrefFi.hreflang = 'fi';
      hrefFi.href = `https://naapurustot.fi/alue/${slug}`;
      document.head.appendChild(hrefFi);

      const hrefEn = document.createElement('link');
      hrefEn.rel = 'alternate';
      hrefEn.hreflang = 'en';
      hrefEn.href = `https://naapurustot.fi/en/area/${slug}`;
      document.head.appendChild(hrefEn);

      return () => {
        document.title = 'naapurustot.fi';
        // Restore previous values for existing elements, remove created ones
        if (existingMeta && prevMetaContent != null) {
          existingMeta.setAttribute('content', prevMetaContent);
        }
        createdMeta?.remove();
        if (existingCanonical && prevCanonicalHref != null) {
          existingCanonical.setAttribute('href', prevCanonicalHref);
        }
        createdCanonical?.remove();
        hrefFi.remove();
        hrefEn.remove();
      };
    }
    return () => { document.title = 'naapurustot.fi'; };
  // lang is included so meta description updates when the user toggles language
  // (t() reads the current global language, which changes when lang state changes)
  }, [state, lang]);

  const toggleLang = () => {
    const next = lang === 'fi' ? 'en' : 'fi';
    setLang(next);
    setLangState(next);
  };

  const similar = useMemo(() => {
    if (!state) return [];
    return findSimilarNeighborhoods(
      state.feature.properties as NeighborhoodProperties,
      state.allFeatures,
      5,
    );
  }, [state]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-surface-950">
        <div className="animate-pulse text-surface-500">{t('loading')}</div>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-surface-950 text-surface-900 dark:text-white px-4">
        <h1 className="text-2xl font-bold mb-4">{error ?? 'Error'}</h1>
        <Link to="/" className="text-brand-500 hover:underline">{t('notfound.back_to_map')}</Link>
      </div>
    );
  }

  const d = state.feature.properties as NeighborhoodProperties;
  const avg = state.metroAverages;
  const center = getFeatureCenter(state.feature);
  const qi = d.quality_index != null ? Math.round(d.quality_index) : null;
  const qiCat = getQualityCategory(qi);

  const cityName = d.city ? t(`city.${d.city}`) : '';

  const canonicalUrl = `https://naapurustot.fi/alue/${toSlug(d.pno, d.nimi)}`;

  /** Format a comparison string: "avg: X" with color. */
  const avgStr = (val: number | null, key: string, formatter: (v: number | null) => string) => {
    const a = avg[key];
    if (val == null || a == null) return '';
    const diff = formatDiff(val, a);
    return `${t('profile.avg')}: ${formatter(a)} (${diff})`;
  };

  return (
    <div className="min-h-screen bg-white dark:bg-surface-950 text-surface-900 dark:text-white">
      <JsonLd properties={d} center={center} url={canonicalUrl} />

      {/* Header */}
      <header className="border-b border-surface-200 dark:border-surface-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-lg font-bold text-brand-500 hover:text-brand-600 transition-colors">
            naapurustot.fi
          </Link>
          <div className="flex items-center gap-4">
            <button
              onClick={toggleLang}
              className="text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
            >
              {lang === 'fi' ? 'EN' : 'FI'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <nav className="text-sm text-surface-500 dark:text-surface-400 mb-6">
          <Link to="/" className="hover:text-brand-500">{t('app.title')}</Link>
          <span className="mx-2">/</span>
          <Link to={`/?city=${d.city ?? 'helsinki_metro'}`} className="hover:text-brand-500">{cityName}</Link>
          <span className="mx-2">/</span>
          <span className="text-surface-900 dark:text-white">{d.nimi}</span>
        </nav>

        {/* Title + Mini Map */}
        <div className="mb-8 md:flex md:gap-8 md:items-start">
          <div className="md:flex-1">
            <h1 className="text-3xl font-bold mb-2">{d.nimi}</h1>
            <p className="text-surface-500 dark:text-surface-400 mb-4 md:mb-0">
              {d.namn && d.namn !== d.nimi ? `${d.namn} · ` : ''}{t('profile.postal_code')} {d.pno} · {cityName}
            </p>
          </div>
          <div className="md:w-80 md:flex-shrink-0">
            <Suspense fallback={<div className="w-full h-64 md:h-80 rounded-xl bg-surface-100 dark:bg-surface-900/60 animate-pulse" />}>
              <MiniMap
                feature={state.feature as Feature<Polygon | MultiPolygon>}
                allFeatures={state.allFeatures}
              />
            </Suspense>
          </div>
        </div>

        {/* Quality Index Banner */}
        {qi != null && qiCat && (
          <div className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-6 mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-4">
              {t('panel.quality_index')}
            </h2>
            <div className="flex items-center gap-4 mb-4">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-xl"
                style={{ backgroundColor: qiCat.color }}
              >
                {qi}
              </div>
              <div>
                <span className="text-xl font-semibold">{qiCat.label[lang]}</span>
                <span className="text-surface-500 dark:text-surface-400 text-sm ml-2">
                  ({qiCat.min}–{qiCat.max})
                </span>
              </div>
            </div>
            <div className="flex gap-0.5">
              {QUALITY_CATEGORIES.map((c) => (
                <div key={c.min} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full h-2 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="text-[9px] text-surface-500 dark:text-surface-400">{c.label[lang]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
            value={d.property_price_sqm != null ? `${formatNumber(d.property_price_sqm)} €/m²` : '—'}
            rawValue={d.property_price_sqm}
            average={avg.property_price_sqm}
            avgLabel={avgStr(d.property_price_sqm, 'property_price_sqm', v => `${formatNumber(v)} €/m²`)}
            propertyKey="property_price_sqm"
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
            {d.rental_price_sqm != null && (
              <StatItem label={t('layer.rental_price')} value={`${formatNumber(d.rental_price_sqm)} €/m²`} />
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
                  to={`${lang === 'en' ? '/en/area' : '/alue'}/${toSlug(s.properties.pno, s.properties.nimi)}`}
                  className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-4 hover:bg-surface-200 dark:hover:bg-surface-800 transition-colors"
                >
                  <div className="font-medium text-sm mb-1">{s.properties.nimi}</div>
                  <div className="text-xs text-surface-500 dark:text-surface-400">{s.properties.pno}</div>
                  {s.properties.quality_index != null && (
                    <div className="text-xs mt-2">
                      <span className="font-semibold">{Math.round(s.properties.quality_index)}</span>
                      <span className="text-surface-400 dark:text-surface-500 ml-1">{t('profile.quality_short')}</span>
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
            className="inline-flex items-center gap-2 px-6 py-3 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors font-medium"
          >
            {t('profile.explore_on_map')}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-200 dark:border-surface-800 py-6">
        <div className="max-w-5xl mx-auto px-4 text-center text-xs text-surface-400 dark:text-surface-500">
          <p>{t('profile.data_sources')}: Tilastokeskus (Paavo), HSL, OpenStreetMap, HSY</p>
          <p className="mt-1">
            <Link to="/" className="hover:text-brand-500">naapurustot.fi</Link>
          </p>
        </div>
      </footer>
    </div>
  );
};

/** Simple stat display for section grids. */
const StatItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-xs text-surface-500 dark:text-surface-400 mb-1">{label}</div>
    <div className="text-lg font-semibold">{value}</div>
  </div>
);

/** Collapsible section wrapper. */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <section className="mb-8">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-lg font-semibold mb-4 w-full text-left"
      >
        <svg
          className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {title}
      </button>
      {open && children}
    </section>
  );
};
