import React, { useEffect, useMemo, useState } from 'react';
import type { FeatureCollection, Feature } from 'geojson';
import { LAYERS, getLayerById, type LayerId } from '../utils/colorScales';
import { getFeatureCenter } from '../utils/geometryFilter';
import { pearson, bestFit, type XYPoint } from '../utils/correlation';
import { t, useI18nVersion } from '../utils/i18n';
import { trackEvent } from '../utils/analytics';
import { generateCorrelationCard } from '../utils/scoreCard';

interface Props {
  data: FeatureCollection | null;
  onSelect: (pno: string, center: [number, number]) => void;
  onClose: () => void;
}

// Distinct, color-blind-friendly palette cycled across the regions present.
const REGION_PALETTE = [
  '#6366f1', '#ef4444', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899',
  '#84cc16', '#a855f7', '#0ea5e9', '#f97316', '#14b8a6', '#e11d48',
];

const VB_W = 640, VB_H = 400;
const PAD = { left: 58, right: 16, top: 16, bottom: 40 };

interface Pt extends XYPoint { pno: string; name: string; pop: number; region: string; feature: Feature; }

export const CorrelationExplorer: React.FC<Props> = ({ data, onSelect, onClose }) => {
  useI18nVersion();
  const [metricX, setMetricX] = useState<LayerId>('median_income');
  const [metricY, setMetricY] = useState<LayerId>('unemployment');
  const [showFit, setShowFit] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);

  // Close on Escape (this panel sits above App's panel cascade).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const layerX = getLayerById(metricX);
  const layerY = getLayerById(metricY);

  const { points, regionColors, dropped } = useMemo(() => {
    const pts: Pt[] = [];
    const colors = new Map<string, string>();
    let dropped = 0;
    let total = 0;
    for (const f of data?.features ?? []) {
      const p = f.properties;
      if (!p?.pno) continue;
      total++;
      const x = p[layerX.property];
      const y = p[layerY.property];
      if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) { dropped++; continue; }
      const region = (p.city as string) ?? 'other';
      if (!colors.has(region)) colors.set(region, REGION_PALETTE[colors.size % REGION_PALETTE.length]);
      pts.push({
        x, y, pno: p.pno as string,
        name: (p.nimi as string) || (p.namn as string) || (p.pno as string),
        pop: typeof p.he_vakiy === 'number' && p.he_vakiy > 0 ? p.he_vakiy : 1,
        region, feature: f,
      });
    }
    return { points: pts, regionColors: colors, dropped, total };
  }, [data, layerX.property, layerY.property]);

  const r = useMemo(() => pearson(points), [points]);
  const fit = useMemo(() => (showFit ? bestFit(points) : null), [points, showFit]);

  // Axis domains with a little padding.
  const domain = useMemo(() => {
    if (points.length === 0) return null;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, popMax = 0;
    for (const p of points) {
      if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
      if (p.pop > popMax) popMax = p.pop;
    }
    const padX = (xMax - xMin) * 0.05 || 1;
    const padY = (yMax - yMin) * 0.05 || 1;
    return { xMin: xMin - padX, xMax: xMax + padX, yMin: yMin - padY, yMax: yMax + padY, popMax };
  }, [points]);

  const plotW = VB_W - PAD.left - PAD.right;
  const plotH = VB_H - PAD.top - PAD.bottom;
  const sx = (x: number) => domain ? PAD.left + ((x - domain.xMin) / (domain.xMax - domain.xMin || 1)) * plotW : 0;
  const sy = (y: number) => domain ? PAD.top + plotH - ((y - domain.yMin) / (domain.yMax - domain.yMin || 1)) * plotH : 0;
  const radius = (pop: number) => domain ? 2 + 10 * Math.sqrt(pop / (domain.popMax || 1)) : 3;

  const rText = r == null ? '—' : r.toFixed(2);
  const ariaLabel = `${t('correlation.title')}: ${t(layerX.labelKey)} / ${t(layerY.labelKey)}. ${t('correlation.pearson_r')} = ${rText}. ${points.length} ${t('correlation.point_count')}.`;

  const hoveredPt = hovered ? points.find((p) => p.pno === hovered) : null;

  const content = (
    <div className="bg-white dark:bg-surface-900 w-full md:max-w-3xl md:rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700/40 overflow-hidden max-h-[90vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-200 dark:border-surface-700/50">
        <h2 className="text-sm font-bold text-surface-900 dark:text-white">{t('correlation.title')}</h2>
        <button
          onClick={onClose}
          aria-label={t('aria.close')}
          title={t('aria.close')}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Controls */}
      <div className="px-5 py-3 flex flex-wrap items-end gap-3 border-b border-surface-100 dark:border-surface-800/60">
        <label className="flex flex-col gap-1 text-xs text-surface-500 dark:text-surface-400">
          <span>{t('correlation.x_axis')}</span>
          <select
            value={metricX}
            onChange={(e) => setMetricX(e.target.value as LayerId)}
            className="text-sm text-surface-800 dark:text-surface-100 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700/40 rounded-lg px-2 py-1.5 dark:[color-scheme:dark]"
          >
            {LAYERS.map((l) => <option key={l.id} value={l.id}>{t(l.labelKey)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-surface-500 dark:text-surface-400">
          <span>{t('correlation.y_axis')}</span>
          <select
            value={metricY}
            onChange={(e) => setMetricY(e.target.value as LayerId)}
            className="text-sm text-surface-800 dark:text-surface-100 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700/40 rounded-lg px-2 py-1.5 dark:[color-scheme:dark]"
          >
            {LAYERS.map((l) => <option key={l.id} value={l.id}>{t(l.labelKey)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-surface-600 dark:text-surface-300 pb-1.5 cursor-pointer">
          <input type="checkbox" checked={showFit} onChange={(e) => setShowFit(e.target.checked)} className="accent-brand-500" />
          {t('correlation.show_best_fit')}
        </label>
        <div className="ml-auto text-right pb-0.5">
          <div className="text-[10px] uppercase tracking-wider text-surface-400 dark:text-surface-500">{t('correlation.pearson_r')}</div>
          <div className="text-lg font-bold tabular-nums text-surface-900 dark:text-white">{rText}</div>
        </div>
      </div>

      {/* Scatter */}
      <div className="p-4 overflow-auto">
        {domain && points.length > 0 ? (
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto" role="img" aria-label={ariaLabel}>
            {/* Axes */}
            <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH} className="stroke-surface-300 dark:stroke-surface-700" strokeWidth={1} />
            <line x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH} className="stroke-surface-300 dark:stroke-surface-700" strokeWidth={1} />
            {/* Axis tick labels (min/max) */}
            <text x={PAD.left} y={VB_H - 8} className="fill-surface-500 text-[11px]">{layerX.format(domain.xMin)}</text>
            <text x={PAD.left + plotW} y={VB_H - 8} textAnchor="end" className="fill-surface-500 text-[11px]">{layerX.format(domain.xMax)}</text>
            <text x={PAD.left - 6} y={PAD.top + plotH} textAnchor="end" className="fill-surface-500 text-[11px]">{layerY.format(domain.yMin)}</text>
            <text x={PAD.left - 6} y={PAD.top + 8} textAnchor="end" className="fill-surface-500 text-[11px]">{layerY.format(domain.yMax)}</text>
            {/* Best-fit line */}
            {fit && r != null && Math.abs(r) > 0.1 && (
              <line
                x1={sx(domain.xMin)} y1={sy(fit.slope * domain.xMin + fit.intercept)}
                x2={sx(domain.xMax)} y2={sy(fit.slope * domain.xMax + fit.intercept)}
                className="stroke-surface-500 dark:stroke-surface-400" strokeWidth={1.5} strokeDasharray="5 4"
              />
            )}
            {/* Points */}
            {points.map((p) => (
              <circle
                key={p.pno}
                cx={sx(p.x)} cy={sy(p.y)} r={hovered === p.pno ? radius(p.pop) + 2 : radius(p.pop)}
                fill={regionColors.get(p.region)}
                fillOpacity={hovered && hovered !== p.pno ? 0.25 : 0.7}
                stroke={hovered === p.pno ? '#111827' : 'none'} strokeWidth={hovered === p.pno ? 1.5 : 0}
                className="cursor-pointer transition-[r,fill-opacity]"
                onMouseEnter={() => setHovered(p.pno)}
                onMouseLeave={() => setHovered((h) => (h === p.pno ? null : h))}
                onClick={() => { trackEvent('correlation-select', { pno: p.pno }); onSelect(p.pno, getFeatureCenter(p.feature)); }}
              >
                <title>{`${p.name} (${p.pno})`}</title>
              </circle>
            ))}
          </svg>
        ) : (
          <p className="text-sm text-surface-500 dark:text-surface-400 py-8 text-center">{t('correlation.no_data_warning')}</p>
        )}
      </div>

      {/* Footer / hover detail */}
      <div className="px-5 py-2.5 border-t border-surface-100 dark:border-surface-800/60 flex items-center justify-between gap-3 text-[11px] text-surface-500 dark:text-surface-400">
        <span className="min-w-0 truncate">{t('correlation.point_size_hint')} · {points.length} {t('correlation.point_count')}{dropped > 0 ? ` (+${dropped} ${t('correlation.no_data_short')})` : ''}</span>
        <div className="flex items-center gap-3 shrink-0">
          {hoveredPt && (
            <span className="font-medium text-surface-700 dark:text-surface-200 truncate max-w-[40vw] md:max-w-[220px]">
              {hoveredPt.name}: {layerX.format(hoveredPt.x)} / {layerY.format(hoveredPt.y)}
            </span>
          )}
          {/* CF-10b: share the scatter as a branded PNG card */}
          {domain && points.length > 0 && (
            <button
              onClick={() => {
                if (!domain) return;
                trackEvent('correlation-snapshot-share');
                generateCorrelationCard({
                  points: points.map((p) => ({ x: p.x, y: p.y, pop: p.pop, color: regionColors.get(p.region) ?? '#0074c5' })),
                  r,
                  fit,
                  domain,
                  labelX: t(layerX.labelKey),
                  labelY: t(layerY.labelKey),
                  formatX: layerX.format,
                  formatY: layerY.format,
                }).catch(() => { /* html-to-image load failed */ });
              }}
              className="inline-flex items-center gap-1 shrink-0 px-2 py-1 rounded-lg font-medium text-brand-600 dark:text-brand-300 hover:bg-brand-500/10 dark:hover:bg-brand-600/15 transition-colors"
              title={t('share.image')}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {t('share.image')}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center md:p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full md:w-auto" onClick={(e) => e.stopPropagation()}>{content}</div>
    </div>
  );
};
