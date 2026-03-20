import React, { useState, useRef, useCallback, useMemo } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { parseTrendSeries, METRIC_SOURCES } from '../utils/metrics';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';
import { t, getLang } from '../utils/i18n';
import { getQualityCategory, QUALITY_CATEGORIES } from '../utils/qualityIndex';
import { exportCsv, exportPdf } from '../utils/export';
import { TrendSection } from './TrendChart';
import RadarChart from './RadarChart';
import { findSimilarNeighborhoods } from '../utils/similarity';
import { useAnimatedValue } from '../hooks/useAnimatedValue';
import { useBottomSheet } from '../hooks/useBottomSheet';
import { generateScoreCard } from '../utils/scoreCard';

interface PanelProps {
  data: NeighborhoodProperties;
  metroAverages: Record<string, number>;
  onClose: () => void;
  onPin?: (props: NeighborhoodProperties) => void;
  onUnpin?: (pno: string) => void;
  isPinned?: boolean;
  pinCount?: number;
  onCustomize?: () => void;
  isCustomWeights?: boolean;
  allFeatures?: GeoJSON.Feature[];
  onFlyTo?: (center: [number, number]) => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  note?: string;
  onNoteChange?: (text: string) => void;
}

const StatRow: React.FC<{
  label: string;
  value: string;
  diff?: string;
  diffClass?: string;
  /** GeoJSON property name — used to look up data source attribution */
  property?: string;
}> = ({ label, value, diff, diffClass, property }) => {
  const source = property ? METRIC_SOURCES[property] : undefined;
  return (
    <div className="flex items-center justify-between py-2.5 md:py-2">
      <span className="text-surface-500 dark:text-surface-400 text-sm flex items-center gap-1">
        {label}
        {source && (
          <span
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px] font-bold
                       text-surface-400 dark:text-surface-500 border border-surface-300 dark:border-surface-600
                       cursor-help flex-shrink-0"
            title={`${source.source} (${source.year})`}
          >
            i
          </span>
        )}
      </span>
      <div className="text-right">
        <span className="text-surface-900 dark:text-white font-medium">{value}</span>
        {diff && (
          <span className={`ml-2 text-xs ${diffClass}`}>
            {diff} {t('panel.vs_metro')}
          </span>
        )}
      </div>
    </div>
  );
};

const BarSegment: React.FC<{ label: string; value: number; total: number; color: string }> = ({
  label,
  value,
  total,
  color,
}) => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  if (pct < 1) return null;
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="w-24 text-xs text-surface-500 dark:text-surface-400 flex-shrink-0">{label}</div>
      <div className="flex-1 h-4 bg-surface-200 dark:bg-surface-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="w-12 text-xs text-surface-600 dark:text-surface-300 text-right">{pct.toFixed(0)}%</div>
    </div>
  );
};

const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

const formatDensity = (v: number | string | null | undefined): string => {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n.toLocaleString('fi-FI')} /km²`;
};

const formatSqm = (v: number | string | null | undefined): string => {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n.toFixed(1)} m²`;
};

const formatEuroSqm = (v: number | string | null | undefined): string => {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n.toLocaleString('fi-FI')} €/m²`;
};

const formatStopDensity = (v: number | string | null | undefined): string => {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n.toFixed(1)} /km²`;
};


// PO-2: Collapsible section component
const CollapsibleSection: React.FC<{
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-2 cursor-pointer group"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 group-hover:text-surface-700 dark:group-hover:text-surface-200 transition-colors">
          {title}
        </h3>
        <svg
          className={`w-3.5 h-3.5 text-surface-400 dark:text-surface-500 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && children}
    </div>
  );
};

export const NeighborhoodPanel: React.FC<PanelProps> = ({ data: d, metroAverages: avg, onClose, onPin, onUnpin, isPinned, pinCount = 0, onCustomize, isCustomWeights = false, allFeatures, onFlyTo, isFavorite = false, onToggleFavorite, note = '', onNoteChange }) => {
  const eduTotal = [d.ko_yl_kork, d.ko_al_kork, d.ko_ammat, d.ko_perus]
    .filter((v): v is number => v != null && v > 0)
    .reduce((a, b) => a + b, 0) || 1;

  // QW-2: Animated value displays
  const animatedQI = useAnimatedValue(d.quality_index);
  const animatedIncome = useAnimatedValue(d.hr_mtu);
  const animatedUnemployment = useAnimatedValue(d.unemployment_rate);
  const animatedPopulation = useAnimatedValue(d.he_vakiy);
  const animatedPropertyPrice = useAnimatedValue(d.property_price_sqm);

  // Copy link state
  const [copied, setCopied] = useState(false);
  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  // QW-3: Bottom sheet state (mobile only) — uses shared useBottomSheet hook
  const sheetRef = useRef<HTMLDivElement>(null);
  const { sheetHeight, isDragging, handlers: sheetHandlers } = useBottomSheet({
    initialSnap: 'half',
    onClose,
  });

  const favoriteButton = onToggleFavorite && (
    <button
      onClick={onToggleFavorite}
      className={`p-1.5 rounded-lg transition-colors min-h-[44px] md:min-h-0 ${
        isFavorite
          ? 'text-amber-500 hover:text-amber-600'
          : 'text-surface-400 hover:text-amber-500'
      }`}
      title={isFavorite ? t('favorites.remove') : t('favorites.add')}
    >
      <svg className="w-5 h-5" fill={isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    </button>
  );

  const pinButton = onPin && (
    <button
      onClick={() => isPinned && onUnpin ? onUnpin(d.pno) : onPin(d)}
      disabled={!isPinned && pinCount >= 3}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors min-h-[44px] md:min-h-0 ${
        isPinned
          ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-400'
          : pinCount >= 3
            ? 'bg-surface-100 dark:bg-surface-800 text-surface-400 cursor-not-allowed'
            : 'bg-brand-500 hover:bg-brand-600 text-white'
      }`}
      title={isPinned ? t('compare.pinned') : pinCount >= 3 ? t('compare.max') : t('compare.pin')}
    >
      {isPinned ? t('compare.pinned') : t('compare.pin')}
    </button>
  );

  const exportButtons = (
    <div className="flex gap-2 px-6 mt-3">
      <button
        onClick={() => exportCsv(d, avg)}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 md:py-1.5 rounded-lg text-xs font-medium min-h-[44px] md:min-h-0
                   bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300
                   hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {t('export.csv')}
      </button>
      <button
        onClick={() => exportPdf(d, avg)}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 md:py-1.5 rounded-lg text-xs font-medium min-h-[44px] md:min-h-0
                   bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300
                   hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
        </svg>
        {t('export.pdf')}
      </button>
      {/* CF-2: Share as image */}
      <button
        onClick={() => generateScoreCard(d, avg)}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 md:py-1.5 rounded-lg text-xs font-medium min-h-[44px] md:min-h-0
                   bg-brand-500/10 dark:bg-brand-600/15 text-brand-600 dark:text-brand-300
                   hover:bg-brand-500/20 dark:hover:bg-brand-600/25 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {t('share.image')}
      </button>
    </div>
  );

  const incomeHistory = useMemo(() => parseTrendSeries(d.income_history), [d.income_history]);
  const populationHistory = useMemo(() => parseTrendSeries(d.population_history), [d.population_history]);
  const unemploymentHistory = useMemo(() => parseTrendSeries(d.unemployment_history), [d.unemployment_history]);

  // CF-1: Similar neighborhoods
  const similar = useMemo(() => {
    if (!allFeatures) return [];
    return findSimilarNeighborhoods(d, allFeatures, 5);
  }, [d, allFeatures]);

  const panelContent = (
    <div className="px-6 py-4 space-y-6">
      {/* Quality Index */}
      {d.quality_index != null && (() => {
        const qi = animatedQI != null ? Math.round(animatedQI) : d.quality_index!;
        const cat = getQualityCategory(qi);
        const lang = getLang();
        return (
          <div className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                {t('panel.quality_index')}
                {isCustomWeights && (
                  <span className="ml-1.5 text-brand-500 dark:text-brand-400">
                    ({t('custom_quality.custom_label')})
                  </span>
                )}
              </h3>
              {onCustomize && (
                <button
                  onClick={onCustomize}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors
                    ${isCustomWeights
                      ? 'bg-brand-500/15 text-brand-600 dark:text-brand-400 hover:bg-brand-500/25'
                      : 'bg-surface-200/60 dark:bg-surface-800/60 text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
                    }`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  {t('custom_quality.button')}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: cat?.color ?? '#6b7280' }}
              >
                {qi}
              </div>
              <span className="text-surface-900 dark:text-white font-semibold text-lg">
                {cat?.label[lang] ?? '—'}
              </span>
              <span className="text-surface-500 dark:text-surface-400 text-sm">
                ({cat?.min}–{cat?.max})
              </span>
            </div>
            <div className="relative">
              <div className="flex gap-0.5">
                {QUALITY_CATEGORIES.map((c) => (
                  <div key={c.min} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full h-2 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="text-[9px] text-surface-500 dark:text-surface-400">{c.label[lang]}</span>
                  </div>
                ))}
              </div>
              {/* Dot indicator */}
              <div
                className="absolute top-0 w-4 h-4 -mt-1 rounded-full border-2 border-white dark:border-surface-300 shadow-md"
                style={{
                  left: `${qi}%`,
                  transform: 'translateX(-50%)',
                  backgroundColor: cat?.color ?? '#6b7280',
                }}
              />
            </div>
          </div>
        );
      })()}

      {/* Key stats */}
      <div>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow label={t('panel.population')} value={formatNumber(animatedPopulation)} property="he_vakiy" />
          <StatRow
            label={t('panel.median_income')}
            value={formatEuro(animatedIncome)}
            diff={formatDiff(d.hr_mtu, avg.hr_mtu)}
            diffClass={diffColor(d.hr_mtu, avg.hr_mtu)}
            property="hr_mtu"
          />
          <StatRow
            label={t('panel.unemployment')}
            value={formatPct(animatedUnemployment)}
            diff={formatDiff(d.unemployment_rate, avg.unemployment_rate)}
            diffClass={diffColor(d.unemployment_rate, avg.unemployment_rate, false)}
            property="unemployment_rate"
          />
          <StatRow
            label={t('panel.foreign_lang')}
            value={formatPct(d.foreign_language_pct)}
            property="foreign_language_pct"
          />
        </div>
      </div>

      {/* Historical Trends */}
      <TrendSection
        incomeData={incomeHistory}
        populationData={populationHistory}
        unemploymentData={unemploymentHistory}
      />

      {/* Housing section — PO-2: collapsible, default open */}
      <CollapsibleSection title={t('panel.housing')} defaultOpen>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.ownership_rate')}
            value={formatPct(d.ownership_rate)}
            diff={formatDiff(d.ownership_rate, avg.ownership_rate)}
            diffClass={diffColor(d.ownership_rate, avg.ownership_rate)}
            property="ownership_rate"
          />
          <StatRow
            label={t('panel.rental_rate')}
            value={formatPct(d.rental_rate)}
            property="rental_rate"
          />
          <StatRow
            label={t('panel.avg_apt_size')}
            value={formatSqm(d.ra_as_kpa)}
            diff={formatDiff(d.ra_as_kpa, avg.ra_as_kpa)}
            diffClass={diffColor(d.ra_as_kpa, avg.ra_as_kpa)}
            property="ra_as_kpa"
          />
          <StatRow
            label={t('panel.detached_houses')}
            value={formatPct(d.detached_house_share)}
            property="detached_house_share"
          />
          <StatRow
            label={t('panel.rental_price')}
            value={d.rental_price_sqm != null ? `${Number(d.rental_price_sqm).toFixed(2)} €/m²/kk` : '—'}
            diff={formatDiff(d.rental_price_sqm, avg.rental_price_sqm)}
            diffClass={diffColor(d.rental_price_sqm, avg.rental_price_sqm, false)}
            property="rental_price_sqm"
          />
          <StatRow
            label={t('panel.price_to_rent')}
            value={d.price_to_rent_ratio != null ? `${Number(d.price_to_rent_ratio).toFixed(1)} v` : '—'}
            diff={formatDiff(d.price_to_rent_ratio, avg.price_to_rent_ratio)}
            diffClass={diffColor(d.price_to_rent_ratio, avg.price_to_rent_ratio)}
            property="price_to_rent_ratio"
          />
          <StatRow label={t('panel.dwellings')} value={formatNumber(d.ra_asunn)} />
          <StatRow label={t('panel.households')} value={formatNumber(d.te_taly)} />
        </div>
      </CollapsibleSection>

      {/* Demographics section — PO-2: collapsible */}
      <CollapsibleSection title={t('panel.demographics')}>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.population_density')}
            value={formatDensity(d.population_density)}
            diff={formatDiff(d.population_density, avg.population_density)}
            diffClass={diffColor(d.population_density, avg.population_density)}
            property="population_density"
          />
          <StatRow
            label={t('panel.child_ratio')}
            value={formatPct(d.child_ratio)}
            diff={formatDiff(d.child_ratio, avg.child_ratio)}
            diffClass={diffColor(d.child_ratio, avg.child_ratio)}
            property="child_ratio"
          />
          <StatRow
            label={t('panel.student_share')}
            value={formatPct(d.student_share)}
            diff={formatDiff(d.student_share, avg.student_share)}
            diffClass={diffColor(d.student_share, avg.student_share)}
            property="student_share"
          />
          <StatRow
            label={t('panel.elderly_ratio')}
            value={formatPct(d.elderly_ratio_pct)}
            diff={formatDiff(d.elderly_ratio_pct, avg.elderly_ratio_pct)}
            diffClass={diffColor(d.elderly_ratio_pct, avg.elderly_ratio_pct)}
            property="elderly_ratio_pct"
          />
          <StatRow
            label={t('panel.employment_rate')}
            value={formatPct(d.employment_rate)}
            diff={formatDiff(d.employment_rate, avg.employment_rate)}
            diffClass={diffColor(d.employment_rate, avg.employment_rate)}
            property="employment_rate"
          />
          <StatRow
            label={t('panel.avg_household_size')}
            value={d.avg_household_size != null ? `${Number(d.avg_household_size).toFixed(2)}` : '—'}
            diff={formatDiff(d.avg_household_size, avg.avg_household_size)}
            diffClass={diffColor(d.avg_household_size, avg.avg_household_size)}
            property="avg_household_size"
          />
        </div>
      </CollapsibleSection>

      {/* Quality of Life section — PO-2: collapsible */}
      <CollapsibleSection title={t('panel.quality_of_life')}>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.property_price')}
            value={formatEuroSqm(animatedPropertyPrice)}
            diff={formatDiff(d.property_price_sqm, avg.property_price_sqm)}
            diffClass={diffColor(d.property_price_sqm, avg.property_price_sqm)}
            property="property_price_sqm"
          />
          <StatRow
            label={t('panel.property_price_change')}
            value={d.property_price_change_pct != null ? `${Number(d.property_price_change_pct) >= 0 ? '+' : ''}${Number(d.property_price_change_pct).toFixed(1)} %` : '—'}
            diff={formatDiff(d.property_price_change_pct, avg.property_price_change_pct)}
            diffClass={diffColor(d.property_price_change_pct, avg.property_price_change_pct)}
            property="property_price_change_pct"
          />
          <StatRow
            label={t('panel.transit_access')}
            value={formatStopDensity(d.transit_stop_density)}
            diff={formatDiff(d.transit_stop_density, avg.transit_stop_density)}
            diffClass={diffColor(d.transit_stop_density, avg.transit_stop_density)}
            property="transit_stop_density"
          />
          <StatRow
            label={t('panel.air_quality')}
            value={d.air_quality_index != null ? Number(d.air_quality_index).toFixed(1) : '—'}
            diff={formatDiff(d.air_quality_index, avg.air_quality_index)}
            diffClass={diffColor(d.air_quality_index, avg.air_quality_index, false)}
            property="air_quality_index"
          />
          <StatRow
            label={t('panel.crime_rate')}
            value={d.crime_index != null ? `${Number(d.crime_index).toFixed(1)} /1000` : '—'}
            diff={formatDiff(d.crime_index, avg.crime_index)}
            diffClass={diffColor(d.crime_index, avg.crime_index, false)}
            property="crime_index"
          />
          <StatRow
            label={t('panel.walkability')}
            value={d.walkability_index != null ? `${Number(d.walkability_index).toFixed(0)}/100` : '—'}
            diff={formatDiff(d.walkability_index, avg.walkability_index)}
            diffClass={diffColor(d.walkability_index, avg.walkability_index)}
            property="walkability_index"
          />
          <StatRow
            label={t('panel.traffic_accidents')}
            value={d.traffic_accident_rate != null ? `${Number(d.traffic_accident_rate).toFixed(1)} /1000` : '—'}
            diff={formatDiff(d.traffic_accident_rate, avg.traffic_accident_rate)}
            diffClass={diffColor(d.traffic_accident_rate, avg.traffic_accident_rate, false)}
            property="traffic_accident_rate"
          />
          <StatRow
            label={t('panel.light_pollution')}
            value={d.light_pollution != null ? `${Number(d.light_pollution).toFixed(1)} nW` : '—'}
            diff={formatDiff(d.light_pollution, avg.light_pollution)}
            diffClass={diffColor(d.light_pollution, avg.light_pollution, false)}
            property="light_pollution"
          />
        </div>
      </CollapsibleSection>

      {/* Services section — PO-2: collapsible */}
      <CollapsibleSection title={t('layers.services')}>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.restaurant_density')}
            value={formatStopDensity(d.restaurant_density)}
            diff={formatDiff(d.restaurant_density, avg.restaurant_density)}
            diffClass={diffColor(d.restaurant_density, avg.restaurant_density)}
            property="restaurant_density"
          />
          <StatRow
            label={t('panel.grocery_access')}
            value={formatStopDensity(d.grocery_density)}
            diff={formatDiff(d.grocery_density, avg.grocery_density)}
            diffClass={diffColor(d.grocery_density, avg.grocery_density)}
            property="grocery_density"
          />
          <StatRow
            label={t('panel.daycare_density')}
            value={formatStopDensity(d.daycare_density)}
            diff={formatDiff(d.daycare_density, avg.daycare_density)}
            diffClass={diffColor(d.daycare_density, avg.daycare_density)}
            property="daycare_density"
          />
          <StatRow
            label={t('panel.school_density')}
            value={formatStopDensity(d.school_density)}
            diff={formatDiff(d.school_density, avg.school_density)}
            diffClass={diffColor(d.school_density, avg.school_density)}
            property="school_density"
          />
          <StatRow
            label={t('panel.school_quality')}
            value={d.school_quality_score != null ? `${Number(d.school_quality_score).toFixed(0)}/100` : '—'}
            diff={formatDiff(d.school_quality_score, avg.school_quality_score)}
            diffClass={diffColor(d.school_quality_score, avg.school_quality_score)}
            property="school_quality_score"
          />
          <StatRow
            label={t('panel.healthcare_access')}
            value={formatStopDensity(d.healthcare_density)}
            diff={formatDiff(d.healthcare_density, avg.healthcare_density)}
            diffClass={diffColor(d.healthcare_density, avg.healthcare_density)}
            property="healthcare_density"
          />
          <StatRow
            label={t('panel.green_space')}
            value={formatStopDensity(d.green_space_pct)}
            diff={formatDiff(d.green_space_pct, avg.green_space_pct)}
            diffClass={diffColor(d.green_space_pct, avg.green_space_pct)}
            property="green_space_pct"
          />
        </div>
      </CollapsibleSection>

      {/* Mobility section — PO-2: collapsible */}
      <CollapsibleSection title={t('layers.mobility')}>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.cycling_infra')}
            value={formatStopDensity(d.cycling_density)}
            diff={formatDiff(d.cycling_density, avg.cycling_density)}
            diffClass={diffColor(d.cycling_density, avg.cycling_density)}
            property="cycling_density"
          />
        </div>
      </CollapsibleSection>

      {/* Additional demographics — PO-2: collapsible */}
      <CollapsibleSection title={`${t('layers.demographics')} +`}>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.single_person_hh')}
            value={formatPct(d.single_person_hh_pct)}
            property="single_person_hh_pct"
          />
          <StatRow
            label={t('panel.new_construction')}
            value={formatPct(d.new_construction_pct)}
            diff={formatDiff(d.new_construction_pct, avg.new_construction_pct)}
            diffClass={diffColor(d.new_construction_pct, avg.new_construction_pct)}
            property="new_construction_pct"
          />
          <StatRow
            label={t('panel.manufacturing_jobs')}
            value={formatPct(d.manufacturing_jobs_pct)}
            diff={formatDiff(d.manufacturing_jobs_pct, avg.manufacturing_jobs_pct)}
            diffClass={diffColor(d.manufacturing_jobs_pct, avg.manufacturing_jobs_pct)}
            property="manufacturing_jobs_pct"
          />
          <StatRow
            label={t('panel.public_sector_jobs')}
            value={formatPct(d.public_sector_jobs_pct)}
            diff={formatDiff(d.public_sector_jobs_pct, avg.public_sector_jobs_pct)}
            diffClass={diffColor(d.public_sector_jobs_pct, avg.public_sector_jobs_pct)}
            property="public_sector_jobs_pct"
          />
          <StatRow
            label={t('panel.service_sector_jobs')}
            value={formatPct(d.service_sector_jobs_pct)}
            diff={formatDiff(d.service_sector_jobs_pct, avg.service_sector_jobs_pct)}
            diffClass={diffColor(d.service_sector_jobs_pct, avg.service_sector_jobs_pct)}
            property="service_sector_jobs_pct"
          />
        </div>
      </CollapsibleSection>

      {/* Education breakdown */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('panel.education')}
        </h3>
        <BarSegment label={t('panel.higher_edu')} value={d.ko_yl_kork ?? 0} total={eduTotal} color="#a78bfa" />
        <BarSegment label={t('panel.bachelor')} value={d.ko_al_kork ?? 0} total={eduTotal} color="#818cf8" />
        <BarSegment label={t('panel.vocational')} value={d.ko_ammat ?? 0} total={eduTotal} color="#6366f1" />
        <BarSegment label={t('panel.basic')} value={d.ko_perus ?? 0} total={eduTotal} color="#4f46e5" />
      </div>

      {/* Activity status */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('panel.age_distribution')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: t('panel.employed'), value: d.pt_tyoll, color: 'bg-emerald-500' },
            { label: t('panel.unemployed'), value: d.pt_tyott, color: 'bg-rose-500' },
            { label: t('panel.students'), value: d.pt_opisk, color: 'bg-amber-500' },
            { label: t('panel.pensioners'), value: d.pt_elakel, color: 'bg-blue-500' },
          ].map((item) => (
            <div key={item.label} className="bg-surface-100 dark:bg-surface-900/60 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${item.color}`} />
                <span className="text-xs text-surface-500 dark:text-surface-400">{item.label}</span>
              </div>
              <span className="text-lg font-semibold text-surface-900 dark:text-white">{formatNumber(item.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Extra stats */}
      <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
        <StatRow label={t('panel.avg_income')} value={formatEuro(d.hr_ktu)} property="hr_ktu" />
      </div>

      {/* CF-4: Radar chart */}
      <RadarChart data={d} metroAverages={avg} />

      {/* CF-4: Neighborhood Notes */}
      {onNoteChange && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
            {t('notes.title')}
          </h3>
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={t('notes.placeholder')}
            className="w-full rounded-lg bg-surface-100 dark:bg-surface-900/60 border border-surface-200 dark:border-surface-800/50
                       p-3 text-sm text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500
                       focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30 resize-y min-h-[80px]"
          />
        </div>
      )}

      {/* CF-1: Similar neighborhoods */}
      {similar.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
            {t('panel.similar')}
          </h3>
          <div className="space-y-2">
            {similar.map((s) => (
              <button
                key={s.properties.pno}
                onClick={() => onFlyTo?.(s.center)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg
                           bg-surface-100 dark:bg-surface-900/60 hover:bg-surface-200 dark:hover:bg-surface-800
                           transition-colors text-left"
              >
                <div>
                  <span className="text-sm font-medium text-surface-900 dark:text-white">{s.properties.nimi}</span>
                  <span className="text-xs text-surface-400 ml-1.5">{s.properties.pno}</span>
                </div>
                <span className="text-xs text-surface-500">{(s.distance * 100).toFixed(0)}% {t('panel.similar').toLowerCase()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop: side panel */}
      <div className="hidden md:block absolute top-0 left-0 z-20 h-full w-[380px] max-w-[90vw] overflow-y-auto
                      bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl border-r border-surface-200 dark:border-surface-800/50 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl border-b border-surface-200 dark:border-surface-800/50 px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-display font-bold text-surface-900 dark:text-white">{d.nimi}</h2>
                <button
                  onClick={handleCopyLink}
                  className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-600 dark:hover:text-surface-200"
                  title={t('panel.copy_link')}
                >
                  {copied ? (
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  )}
                </button>
                {copied && (
                  <span className="text-xs text-emerald-500 font-medium animate-fade-in">{t('panel.copied')}</span>
                )}
              </div>
              <p className="text-surface-500 dark:text-surface-400 text-sm mt-0.5">{d.pno}</p>
            </div>
            <div className="flex items-center gap-1">
              {favoriteButton}
              {pinButton}
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-900 dark:hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          {exportButtons}
        </div>
        {panelContent}
      </div>

      {/* Mobile: bottom sheet */}
      <div
        ref={sheetRef}
        className="md:hidden fixed bottom-0 left-0 right-0 z-20
                   bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                   border-t border-surface-200 dark:border-surface-800/50
                   shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl"
        style={{
          height: sheetHeight,
          transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
        }}
      >
        {/* Drag handle */}
        <div
          className="flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={sheetHandlers.onTouchStart}
          onTouchMove={sheetHandlers.onTouchMove}
          onTouchEnd={sheetHandlers.onTouchEnd}
        >
          <div className="w-10 h-1.5 rounded-full bg-surface-300 dark:bg-surface-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 border-b border-surface-200 dark:border-surface-800/50">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-display font-bold text-surface-900 dark:text-white truncate">{d.nimi}</h2>
              <button
                onClick={handleCopyLink}
                className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 flex-shrink-0"
                title={t('panel.copy_link')}
              >
                {copied ? (
                  <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                )}
              </button>
              {copied && (
                <span className="text-xs text-emerald-500 font-medium">{t('panel.copied')}</span>
              )}
            </div>
            <p className="text-surface-500 dark:text-surface-400 text-xs">{d.pno}</p>
          </div>
          <div className="flex items-center gap-1">
            {favoriteButton}
            {pinButton}
            <button
              onClick={onClose}
              className="p-2.5 -mr-1 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-900 dark:hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {exportButtons}

        {/* Scrollable content */}
        <div className="overflow-y-auto" style={{ height: `calc(100% - 9rem)` }}>
          {panelContent}
        </div>
      </div>
    </>
  );
};
