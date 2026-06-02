import type { NeighborhoodProperties } from './metrics';
import { formatEuro, formatPct, formatEuroSqm, escapeHtml } from './formatting';
import { t } from './i18n';
import { getQualityCategory } from './qualityIndex';
import { buildFullViewUrl } from './embed';

/**
 * CF-10: share a generated PNG via the Web Share API (with the deep link) when the
 * browser supports sharing files, otherwise fall back to a plain download. Reused by
 * the comparison card so a shared image always carries traceable inbound traffic.
 */
async function shareOrDownload(dataUrl: string, filename: string, url: string, title: string): Promise<void> {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share && nav.canShare) {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], filename, { type: 'image/png' });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title, url });
        return;
      }
    }
  } catch {
    // user cancelled or share unsupported — fall through to download
  }
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

const METRICS = [
  { key: 'hr_mtu', label: 'panel.median_income', format: formatEuro, higherIsBetter: true },
  { key: 'unemployment_rate', label: 'panel.unemployment', format: (v: number | null) => formatPct(v), higherIsBetter: false },
  { key: 'property_price_sqm', label: 'panel.property_price', format: formatEuroSqm, higherIsBetter: true },
  { key: 'transit_stop_density', label: 'panel.transit_access', format: (v: number | null) => v != null ? `${v.toFixed(1)} /km²` : '—', higherIsBetter: true },
] as const;

/**
 * Render a neighborhood score card as an off-screen HTML element, convert to PNG, and trigger download.
 *
 * Lazy-loads html-to-image (~30KB) only when invoked, keeping it out of the initial bundle.
 * The card shows the neighborhood name, quality index badge, and key metrics compared
 * against metro averages with color-coded +/- indicators.
 */
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
        <div style="font-size: 13px; color: #64748b;">${escapeHtml(t('panel.quality_index'))}</div>
      </div>` : ''}
    </div>
    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${METRICS.map(({ key, label, format, higherIsBetter }) => {
        const val = data[key] as number | null;
        const avg = metroAverages[key];
        const diff = val != null && avg != null ? val - avg : null;
        const diffStr = diff != null ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}` : '';
        const isGood = diff != null ? (higherIsBetter ? diff > 0 : diff < 0) : false;
        const diffColor = diff != null ? (diff === 0 ? '#64748b' : isGood ? '#059669' : '#dc2626') : '#64748b';
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9;">
            <span style="font-size: 13px; color: #64748b;">${escapeHtml(t(label))}</span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(format(val))}</span>
              ${diffStr ? `<span style="font-size: 11px; color: ${diffColor};">${escapeHtml(diffStr)} vs. metro</span>` : ''}
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
    // Lazy-load html-to-image (~30KB) only when user actually clicks "Share as image".
    // This keeps it out of the initial bundle and the NeighborhoodPanel chunk.
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(container, { quality: 0.95, pixelRatio: 2 });
    const link = document.createElement('a');
    link.download = `${(data.nimi || data.pno).replace(/[/\\:*?"<>|]/g, '_')}-${data.pno}-naapurustot.png`;
    link.href = dataUrl;
    link.click();
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * CF-10: render a side-by-side comparison of the pinned neighbourhoods (quality
 * badges + key metrics) as a branded PNG with the deep link baked in, then share
 * it via the Web Share API (or download). Reuses the lazy html-to-image path.
 */
export async function generateComparisonCard(pinned: NeighborhoodProperties[]): Promise<void> {
  if (pinned.length === 0) return;

  const container = document.createElement('div');
  const width = Math.min(760, 260 + pinned.length * 200);
  container.style.cssText = `
    width: ${width}px; padding: 32px; background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border-radius: 16px; box-sizing: border-box;
  `;

  const deepLink = buildFullViewUrl(
    {
      pno: pinned[0].pno,
      layer: 'quality_index',
      city: (pinned[0].city as string | null) ?? null,
      compare: pinned.slice(1).map((p) => p.pno),
    },
    'https://naapurustot.fi',
  );

  const th = 'padding:8px 6px;font-size:13px;font-weight:700;color:#0f172a;text-align:center;border-bottom:2px solid #e2e8f0;';
  const td = 'padding:8px 6px;font-size:13px;color:#334155;text-align:center;border-bottom:1px solid #f1f5f9;';
  const rl = 'padding:8px 6px;font-size:12px;color:#64748b;text-align:left;border-bottom:1px solid #f1f5f9;';

  const qiRow = `<tr><td style="${rl}">${escapeHtml(t('panel.quality_index'))}</td>${pinned
    .map((p) => {
      const qi = p.quality_index;
      const cat = qi != null ? getQualityCategory(qi) : null;
      return `<td style="${td}">${
        qi != null && cat
          ? `<span style="display:inline-block;min-width:34px;padding:3px 6px;border-radius:8px;background:${cat.color};color:#fff;font-weight:700;">${qi}</span>`
          : '—'
      }</td>`;
    })
    .join('')}</tr>`;

  const metricRows = METRICS.map(
    ({ key, label, format }) =>
      `<tr><td style="${rl}">${escapeHtml(t(label))}</td>${pinned
        .map((p) => `<td style="${td}">${escapeHtml(format(p[key] as number | null))}</td>`)
        .join('')}</tr>`,
  ).join('');

  container.innerHTML = `
    <div style="font-size:13px;color:#64748b;margin-bottom:14px;font-weight:600;">naapurustot.fi · ${escapeHtml(t('compare.title'))}</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr><th style="${th};text-align:left;"></th>${pinned
        .map(
          (p) =>
            `<th style="${th}">${escapeHtml(p.nimi)}<br><span style="font-size:11px;font-weight:400;color:#94a3b8;">${escapeHtml(p.pno)}</span></th>`,
        )
        .join('')}</tr></thead>
      <tbody>${qiRow}${metricRows}</tbody>
    </table>
    <div style="margin-top:20px;text-align:center;font-size:11px;color:#94a3b8;">${escapeHtml(deepLink)}</div>
  `;

  document.body.appendChild(container);
  try {
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(container, { quality: 0.95, pixelRatio: 2 });
    await shareOrDownload(dataUrl, 'naapurustot-vertailu.png', deepLink, t('compare.title'));
  } finally {
    document.body.removeChild(container);
  }
}
