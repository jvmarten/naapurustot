import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LAYERS } from '../utils/colorScales';
import { getMetricSource, getCoveragePct, formatCoveragePct, isLowCoverage, vintageFreshness, DATA_SOURCE_PUBLISHERS } from '../utils/metrics';
import { t, getLang, setLang, useI18nVersion, type Lang } from '../utils/i18n';

/**
 * CF-9: Public Data Sources & Methodology page (FI/EN/SV, prerendered).
 *
 * Built entirely from the single source-of-truth registry (src/data/data_sources.json
 * via metrics.ts) so it can never drift from what the map actually shows. Lists every
 * layer with its source (clickable), license, vintage, resolution, and a measured-vs-
 * estimate badge, plus a Quality Index methodology summary. The prerendered <noscript>
 * (scripts/prerender.mjs) mirrors the substance for SEO / answer engines.
 */

const GRAN_KEY: Record<string, string> = {
  postal: 'sources.gran_postal',
  '250m grid': 'sources.gran_grid',
  derived: 'sources.gran_derived',
};

export const DataSourcesPage: React.FC<{ lang: Lang }> = ({ lang }) => {
  useEffect(() => {
    if (getLang() !== lang) void setLang(lang);
  }, [lang]);
  useI18nVersion();

  useEffect(() => {
    document.title = `${t('sources.title')} | naapurustot.fi`;
    document.documentElement.lang = lang;
  }, [lang]);

  // Distinct publishers actually referenced by the shown layers.
  const usedPublishers = Array.from(
    new Set(LAYERS.map((l) => getMetricSource(l.property)?.publisher).filter(Boolean) as string[]),
  ).map((id) => ({ id, ...DATA_SOURCE_PUBLISHERS[id] }));

  // PO-3: optional recency sort. null keeps the original LAYERS order; 'newest'/'oldest'
  // orders by the freshest year in each layer's vintage (yearless rows sort last).
  const [sort, setSort] = useState<null | 'newest' | 'oldest'>(null);
  const rows = useMemo(() => {
    const base = LAYERS.map((layer) => {
      const s = getMetricSource(layer.property);
      return s ? { layer, s, fresh: vintageFreshness(s.year) } : null;
    }).filter((r): r is NonNullable<typeof r> => r != null);
    if (!sort) return base;
    const dir = sort === 'newest' ? -1 : 1;
    return [...base].sort((a, b) => {
      const ya = a.fresh?.latest;
      const yb = b.fresh?.latest;
      if (ya == null && yb == null) return 0;
      if (ya == null) return 1; // yearless rows always last
      if (yb == null) return -1;
      return (ya - yb) * dir;
    });
  }, [sort]);
  const toggleSort = () => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'));

  return (
    <main className="min-h-screen bg-surface-50 dark:bg-surface-950 text-surface-800 dark:text-surface-200">
      <div className="mx-auto max-w-4xl px-5 py-10">
        <Link
          to="/"
          className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t('sources.back_to_map')}
        </Link>

        <h1 className="mt-4 text-3xl font-bold text-surface-900 dark:text-white">
          {t('sources.title')}
        </h1>
        <p className="mt-3 max-w-2xl text-surface-600 dark:text-surface-400 leading-relaxed">
          {t('sources.subtitle')}
        </p>

        <h2 className="mt-10 mb-3 text-lg font-semibold text-surface-900 dark:text-white">
          {t('sources.layers_heading')}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-surface-200 dark:border-surface-800">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface-100 dark:bg-surface-900 text-left text-xs uppercase tracking-wider text-surface-500 dark:text-surface-400">
                <th className="px-3 py-2 font-semibold">{t('sources.col_layer')}</th>
                <th className="px-3 py-2 font-semibold">{t('sources.col_source')}</th>
                <th className="px-3 py-2 font-semibold">{t('sources.col_license')}</th>
                <th className="px-3 py-2 font-semibold">
                  <button
                    type="button"
                    onClick={toggleSort}
                    aria-label={t('sources.sort_by_year')}
                    className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
                  >
                    {t('sources.col_year')}
                    <span aria-hidden="true" className="text-[9px] leading-none">
                      {sort === 'newest' ? '▼' : sort === 'oldest' ? '▲' : '↕'}
                    </span>
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold">{t('sources.col_granularity')}</th>
                <th className="px-3 py-2 font-semibold">{t('sources.col_coverage')}</th>
                <th className="px-3 py-2 font-semibold">{t('sources.col_type')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ layer, s, fresh }) => {
                // PO-2: real per-postal-code coverage from build_metadata.json. Absent
                // for client-derived metrics (e.g. quality_index) — render "—" then.
                const cov = getCoveragePct(layer.property);
                const lowCov = isLowCoverage(layer.property);
                return (
                  <tr
                    key={layer.id}
                    className="border-t border-surface-100 dark:border-surface-800/70 align-top"
                  >
                    <td className="px-3 py-2 text-surface-800 dark:text-surface-200">{t(layer.labelKey)}</td>
                    <td className="px-3 py-2">
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-600 dark:text-brand-400 hover:underline"
                        >
                          {s.source}
                        </a>
                      ) : (
                        s.source
                      )}
                      {/* PO-4: registry caveat note (i18n key) for proxy/derived/partial metrics */}
                      {s.note && (
                        <span className="mt-0.5 block text-[11px] leading-snug text-surface-500 dark:text-surface-400">
                          {t(s.note)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-surface-600 dark:text-surface-400 whitespace-nowrap">{s.license}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="text-surface-600 dark:text-surface-400">{s.year}</span>
                      {fresh?.isStale && (
                        <span
                          className="ml-1.5 inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold
                                     bg-amber-400/15 text-amber-600 dark:text-amber-400 border border-amber-400/30"
                          title={t('sources.updated_year').replace('{year}', String(fresh.latest))}
                        >
                          {t('sources.years_ago').replace('{n}', String(fresh.yearsAgo))}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-surface-600 dark:text-surface-400">
                      {t(GRAN_KEY[s.granularity] ?? 'sources.gran_postal')}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {cov != null ? (
                        <span className={lowCov ? 'text-amber-600 dark:text-amber-400' : 'text-surface-600 dark:text-surface-400'}>
                          {t('sources.coverage_value').replace('{pct}', formatCoveragePct(cov))}
                        </span>
                      ) : (
                        <span className="text-surface-400 dark:text-surface-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {s.isProxy ? (
                        <span className="inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide
                                         bg-amber-400/15 text-amber-600 dark:text-amber-400 border border-amber-400/30">
                          {t('data.estimate')}
                        </span>
                      ) : (
                        <span className="text-surface-500 dark:text-surface-500">{t('sources.type_measured')}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2 className="mt-10 mb-3 text-lg font-semibold text-surface-900 dark:text-white">
          {t('sources.publishers_heading')}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {usedPublishers.map((p) => (
            <li key={p.id}>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-800
                           px-2.5 py-1 text-xs text-surface-700 dark:text-surface-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400"
              >
                {p.name} <span className="text-surface-400">· {p.license}</span>
              </a>
            </li>
          ))}
        </ul>

        <h2 className="mt-10 mb-3 text-lg font-semibold text-surface-900 dark:text-white">
          {t('sources.methodology_heading')}
        </h2>
        <p className="max-w-2xl text-surface-600 dark:text-surface-400 leading-relaxed">
          {t('sources.methodology_body')}
        </p>
        <p className="mt-3 max-w-2xl text-surface-600 dark:text-surface-400 leading-relaxed">
          {t('sources.quality_note')}
        </p>
      </div>
    </main>
  );
};

export default DataSourcesPage;
