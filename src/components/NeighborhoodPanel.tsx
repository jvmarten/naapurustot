import React from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';
import { t } from '../utils/i18n';

interface PanelProps {
  data: NeighborhoodProperties;
  metroAverages: Record<string, number>;
  onClose: () => void;
}

const StatRow: React.FC<{
  label: string;
  value: string;
  diff?: string;
  diffClass?: string;
}> = ({ label, value, diff, diffClass }) => (
  <div className="flex items-center justify-between py-2">
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

export const NeighborhoodPanel: React.FC<PanelProps> = ({ data: d, metroAverages: avg, onClose }) => {
  const eduTotal = [d.ko_yl_kork, d.ko_al_kork, d.ko_ammat, d.ko_perus]
    .filter((v) => v != null && v > 0)
    .reduce((a, b) => a! + b!, 0) || 1;

  return (
    <div className="absolute top-0 left-0 z-20 h-full w-[380px] max-w-[90vw] overflow-y-auto
                    bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl border-r border-surface-200 dark:border-surface-800/50 shadow-2xl">
      {/* Header */}
      <div className="sticky top-0 bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl border-b border-surface-200 dark:border-surface-800/50 px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-display font-bold text-surface-900 dark:text-white">{d.nimi}</h2>
            <p className="text-surface-500 dark:text-surface-400 text-sm mt-0.5">{d.pno}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-900 dark:hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-6 py-4 space-y-6">
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
          <StatRow label={t('panel.dwellings')} value={formatNumber(d.ra_asunn)} />
          <StatRow label={t('panel.households')} value={formatNumber(d.te_takk)} />
        </div>
      </div>
    </div>
  );
};
