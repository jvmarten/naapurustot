import { toPng } from 'html-to-image';
import type { NeighborhoodProperties } from './metrics';
import { formatEuro, formatPct } from './formatting';
import { t } from './i18n';
import { getQualityCategory } from './qualityIndex';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const METRICS = [
  { key: 'hr_mtu', label: 'panel.median_income', format: formatEuro },
  { key: 'unemployment_rate', label: 'panel.unemployment', format: (v: number | null) => formatPct(v) },
  { key: 'property_price_sqm', label: 'panel.property_price', format: (v: number | null) => v != null ? `${v.toLocaleString('fi-FI')} €/m²` : '—' },
  { key: 'walkability_index', label: 'panel.walkability', format: (v: number | null) => v != null ? `${v.toFixed(0)}/100` : '—' },
  { key: 'transit_stop_density', label: 'panel.transit_access', format: (v: number | null) => v != null ? `${v.toFixed(1)} /km²` : '—' },
] as const;

export async function generateScoreCard(
  data: NeighborhoodProperties,
  metroAverages: Record<string, number>,
): Promise<void> {
  const qi = data.quality_index;
  const cat = qi != null ? getQualityCategory(qi) : null;

  // Build the card HTML
  const container = document.createElement('div');
  container.style.cssText = `
    width: 600px; padding: 32px; background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border-radius: 16px; box-sizing: border-box;
  `;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <div style="font-size: 24px; font-weight: 700; color: #0f172a;">${escapeHtml(data.nimi)}</div>
        <div style="font-size: 14px; color: #64748b; margin-top: 4px;">${escapeHtml(data.pno)}</div>
      </div>
      ${qi != null && cat ? `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 48px; height: 48px; border-radius: 12px; background: ${cat.color};
                    display: flex; align-items: center; justify-content: center;
                    color: white; font-weight: 700; font-size: 18px;">${qi}</div>
        <div style="font-size: 13px; color: #64748b;">${t('panel.quality_index')}</div>
      </div>` : ''}
    </div>
    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${METRICS.map(({ key, label, format }) => {
        const val = data[key] as number | null;
        const avg = metroAverages[key];
        const diff = val != null && avg != null ? val - avg : null;
        const diffStr = diff != null ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}` : '';
        const diffColor = diff != null ? (diff > 0 ? '#059669' : diff < 0 ? '#dc2626' : '#64748b') : '#64748b';
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9;">
            <span style="font-size: 13px; color: #64748b;">${t(label)}</span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 14px; font-weight: 600; color: #0f172a;">${format(val)}</span>
              ${diffStr ? `<span style="font-size: 11px; color: ${diffColor};">${diffStr} vs. metro</span>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>
    <div style="margin-top: 24px; text-align: center; font-size: 12px; color: #94a3b8;">
      naapurustot.fi
    </div>
  `;

  document.body.appendChild(container);

  try {
    const dataUrl = await toPng(container, { quality: 0.95, pixelRatio: 2 });
    const link = document.createElement('a');
    link.download = `${data.nimi}-${data.pno}-naapurustot.png`;
    link.href = dataUrl;
    link.click();
  } finally {
    document.body.removeChild(container);
  }
}
