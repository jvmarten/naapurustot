import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';
import { t, getLang } from '../utils/i18n';
import { getQualityCategory, QUALITY_CATEGORIES } from '../utils/qualityIndex';
import { exportCsv, exportPdf } from '../utils/export';

interface PanelProps {
  data: NeighborhoodProperties;
  metroAverages: Record<string, number>;
  onClose: () => void;
  onPin?: (props: NeighborhoodProperties) => void;
  onUnpin?: (pno: string) => void;
  isPinned?: boolean;
  pinCount?: number;
}

const StatRow: React.FC<{
  label: string;
  value: string;
  diff?: string;
  diffClass?: string;
}> = ({ label, value, diff, diffClass }) => (
  <div className="flex items-center justify-between py-2.5 md:py-2">
    <span className="text-surface-500 dark:text-surface-400 text-sm">{label}</span>
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

const formatDensity = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return `${v.toLocaleString('fi-FI')} /km²`;
};

const formatSqm = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return `${v.toFixed(1)} m²`;
};

const formatEuroSqm = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return `${v.toLocaleString('fi-FI')} €/m²`;
};

const formatStopDensity = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return `${v.toFixed(1)} /km²`;
};

const formatMinutes = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return `${v.toFixed(0)} min`;
};

const formatGini = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return v.toFixed(2);
};

const formatCarsHh = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return v.toFixed(2);
};

const formatYear = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return v.toFixed(0);
};

const formatDb = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return `${v.toFixed(0)} dB`;
};

type SheetSnap = 'peek' | 'half' | 'full';

const PEEK_HEIGHT = 140;
const HALF_RATIO = 0.5;
const FULL_RATIO = 0.92;

export const NeighborhoodPanel: React.FC<PanelProps> = ({ data: d, metroAverages: avg, onClose, onPin, onUnpin, isPinned, pinCount = 0 }) => {
  const eduTotal = [d.ko_yl_kork, d.ko_al_kork, d.ko_ammat, d.ko_perus]
    .filter((v) => v != null && v > 0)
    .reduce((a, b) => a! + b!, 0) || 1;

  // Bottom sheet state (mobile only)
  const [snap, setSnap] = useState<SheetSnap>('half');
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragStartHeight = useRef<number>(0);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const getSnapHeight = useCallback((s: SheetSnap) => {
    const vh = window.innerHeight;
    switch (s) {
      case 'peek': return PEEK_HEIGHT;
      case 'half': return vh * HALF_RATIO;
      case 'full': return vh * FULL_RATIO;
    }
  }, []);

  // Set initial height
  useEffect(() => {
    setSheetHeight(getSnapHeight('half'));
  }, [getSnapHeight]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    dragStartHeight.current = sheetHeight ?? getSnapHeight(snap);
    setIsDragging(true);
  }, [sheetHeight, snap, getSnapHeight]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current == null) return;
    const deltaY = dragStartY.current - e.touches[0].clientY;
    const newHeight = Math.max(PEEK_HEIGHT, Math.min(window.innerHeight * FULL_RATIO, dragStartHeight.current + deltaY));
    setSheetHeight(newHeight);
  }, []);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    if (dragStartY.current == null || sheetHeight == null) return;
    dragStartY.current = null;

    const vh = window.innerHeight;
    const ratio = sheetHeight / vh;

    // Snap to nearest
    if (ratio < 0.25) {
      setSnap('peek');
      setSheetHeight(getSnapHeight('peek'));
    } else if (ratio < 0.7) {
      setSnap('half');
      setSheetHeight(getSnapHeight('half'));
    } else {
      setSnap('full');
      setSheetHeight(getSnapHeight('full'));
    }
  }, [sheetHeight, getSnapHeight]);

  // Close on swipe down past peek
  useEffect(() => {
    if (sheetHeight != null && sheetHeight < PEEK_HEIGHT * 0.5 && !isDragging) {
      onClose();
    }
  }, [sheetHeight, isDragging, onClose]);

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
    </div>
  );

  const panelContent = (
    <div className="px-6 py-4 space-y-6">
      {/* Quality Index */}
      {d.quality_index != null && (() => {
        const qi = d.quality_index!;
        const cat = getQualityCategory(qi);
        const lang = getLang();
        return (
          <div className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-3">
              {t('panel.quality_index')}
            </h3>
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
          <StatRow label={t('panel.population')} value={formatNumber(d.he_vakiy)} />
          <StatRow
            label={t('panel.median_income')}
            value={formatEuro(d.hr_mtu)}
            diff={formatDiff(d.hr_mtu, avg.hr_mtu)}
            diffClass={diffColor(d.hr_mtu, avg.hr_mtu)}
          />
          <StatRow
            label={t('panel.unemployment')}
            value={formatPct(d.unemployment_rate)}
            diff={formatDiff(d.unemployment_rate, avg.unemployment_rate)}
            diffClass={diffColor(d.unemployment_rate, avg.unemployment_rate, false)}
          />
          <StatRow
            label={t('panel.foreign_lang')}
            value={formatPct(d.foreign_language_pct)}
          />
        </div>
      </div>

      {/* Housing section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('panel.housing')}
        </h3>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.ownership_rate')}
            value={formatPct(d.ownership_rate)}
            diff={formatDiff(d.ownership_rate, avg.ownership_rate)}
            diffClass={diffColor(d.ownership_rate, avg.ownership_rate)}
          />
          <StatRow
            label={t('panel.rental_rate')}
            value={formatPct(d.rental_rate)}
          />
          <StatRow
            label={t('panel.avg_apt_size')}
            value={formatSqm(d.ra_as_kpa)}
            diff={formatDiff(d.ra_as_kpa, avg.ra_as_kpa)}
            diffClass={diffColor(d.ra_as_kpa, avg.ra_as_kpa)}
          />
          <StatRow
            label={t('panel.detached_houses')}
            value={formatPct(d.detached_house_share)}
          />
          <StatRow label={t('panel.dwellings')} value={formatNumber(d.ra_asunn)} />
          <StatRow label={t('panel.households')} value={formatNumber(d.te_taly)} />
        </div>
      </div>

      {/* Demographics section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('panel.demographics')}
        </h3>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.population_density')}
            value={formatDensity(d.population_density)}
            diff={formatDiff(d.population_density, avg.population_density)}
            diffClass={diffColor(d.population_density, avg.population_density)}
          />
          <StatRow
            label={t('panel.child_ratio')}
            value={formatPct(d.child_ratio)}
            diff={formatDiff(d.child_ratio, avg.child_ratio)}
            diffClass={diffColor(d.child_ratio, avg.child_ratio)}
          />
          <StatRow
            label={t('panel.student_share')}
            value={formatPct(d.student_share)}
            diff={formatDiff(d.student_share, avg.student_share)}
            diffClass={diffColor(d.student_share, avg.student_share)}
          />
        </div>
      </div>

      {/* Quality of Life section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('panel.quality_of_life')}
        </h3>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.property_price')}
            value={formatEuroSqm(d.property_price_sqm)}
            diff={formatDiff(d.property_price_sqm, avg.property_price_sqm)}
            diffClass={diffColor(d.property_price_sqm, avg.property_price_sqm)}
          />
          <StatRow
            label={t('panel.transit_access')}
            value={formatStopDensity(d.transit_stop_density)}
            diff={formatDiff(d.transit_stop_density, avg.transit_stop_density)}
            diffClass={diffColor(d.transit_stop_density, avg.transit_stop_density)}
          />
          <StatRow
            label={t('panel.air_quality')}
            value={d.air_quality_index != null ? d.air_quality_index.toFixed(1) : '—'}
            diff={formatDiff(d.air_quality_index, avg.air_quality_index)}
            diffClass={diffColor(d.air_quality_index, avg.air_quality_index, false)}
          />
          <StatRow
            label={t('panel.crime_rate')}
            value={d.crime_index != null ? `${d.crime_index.toFixed(1)} /1000` : '—'}
            diff={formatDiff(d.crime_index, avg.crime_index)}
            diffClass={diffColor(d.crime_index, avg.crime_index, false)}
          />
        </div>
      </div>

      {/* Services section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('layers.services')}
        </h3>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.restaurant_density')}
            value={formatStopDensity(d.restaurant_density)}
            diff={formatDiff(d.restaurant_density, avg.restaurant_density)}
            diffClass={diffColor(d.restaurant_density, avg.restaurant_density)}
          />
          <StatRow
            label={t('panel.grocery_access')}
            value={formatStopDensity(d.grocery_density)}
            diff={formatDiff(d.grocery_density, avg.grocery_density)}
            diffClass={diffColor(d.grocery_density, avg.grocery_density)}
          />
          <StatRow
            label={t('panel.daycare_density')}
            value={formatStopDensity(d.daycare_density)}
            diff={formatDiff(d.daycare_density, avg.daycare_density)}
            diffClass={diffColor(d.daycare_density, avg.daycare_density)}
          />
          <StatRow
            label={t('panel.school_density')}
            value={formatStopDensity(d.school_density)}
            diff={formatDiff(d.school_density, avg.school_density)}
            diffClass={diffColor(d.school_density, avg.school_density)}
          />
          <StatRow
            label={t('panel.healthcare_access')}
            value={formatStopDensity(d.healthcare_density)}
            diff={formatDiff(d.healthcare_density, avg.healthcare_density)}
            diffClass={diffColor(d.healthcare_density, avg.healthcare_density)}
          />
          <StatRow
            label={t('panel.green_space')}
            value={formatStopDensity(d.green_space_pct)}
            diff={formatDiff(d.green_space_pct, avg.green_space_pct)}
            diffClass={diffColor(d.green_space_pct, avg.green_space_pct)}
          />
        </div>
      </div>

      {/* Environment section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('layers.environment')}
        </h3>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.noise_level')}
            value={formatDb(d.noise_level)}
            diff={formatDiff(d.noise_level, avg.noise_level)}
            diffClass={diffColor(d.noise_level, avg.noise_level, false)}
          />
          <StatRow
            label={t('panel.building_age')}
            value={formatYear(d.avg_building_year)}
          />
          <StatRow
            label={t('panel.energy_class')}
            value={d.energy_efficiency != null ? d.energy_efficiency.toFixed(1) : '—'}
          />
        </div>
      </div>

      {/* Mobility section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('layers.mobility')}
        </h3>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.commute_time')}
            value={formatMinutes(d.avg_commute_min)}
            diff={formatDiff(d.avg_commute_min, avg.avg_commute_min)}
            diffClass={diffColor(d.avg_commute_min, avg.avg_commute_min, false)}
          />
          <StatRow
            label={t('panel.car_ownership')}
            value={formatCarsHh(d.cars_per_household)}
            diff={formatDiff(d.cars_per_household, avg.cars_per_household)}
            diffClass={diffColor(d.cars_per_household, avg.cars_per_household)}
          />
          <StatRow
            label={t('panel.cycling_infra')}
            value={formatStopDensity(d.cycling_density)}
            diff={formatDiff(d.cycling_density, avg.cycling_density)}
            diffClass={diffColor(d.cycling_density, avg.cycling_density)}
          />
        </div>
      </div>

      {/* Additional demographics */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('layers.demographics')} +
        </h3>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.population_growth')}
            value={formatPct(d.population_growth_pct)}
          />
          <StatRow
            label={t('panel.income_inequality')}
            value={formatGini(d.gini_coefficient)}
          />
          <StatRow
            label={t('panel.single_person_hh')}
            value={formatPct(d.single_person_hh_pct)}
          />
          <StatRow
            label={t('panel.seniors_alone')}
            value={formatPct(d.seniors_alone_pct)}
          />
        </div>
      </div>

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
            { label: t('panel.pensioners'), value: d.pt_elak, color: 'bg-blue-500' },
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
        <StatRow label={t('panel.avg_income')} value={formatEuro(d.hr_ktu)} />
      </div>
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
              <h2 className="text-xl font-display font-bold text-surface-900 dark:text-white">{d.nimi}</h2>
              <p className="text-surface-500 dark:text-surface-400 text-sm mt-0.5">{d.pno}</p>
            </div>
            <div className="flex items-center gap-1">
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
          height: sheetHeight ?? getSnapHeight('half'),
          transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
        }}
      >
        {/* Drag handle */}
        <div
          className="flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1.5 rounded-full bg-surface-300 dark:bg-surface-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 border-b border-surface-200 dark:border-surface-800/50">
          <div className="min-w-0">
            <h2 className="text-lg font-display font-bold text-surface-900 dark:text-white truncate">{d.nimi}</h2>
            <p className="text-surface-500 dark:text-surface-400 text-xs">{d.pno}</p>
          </div>
          <div className="flex items-center gap-1">
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
