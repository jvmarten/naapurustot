import type { NeighborhoodProperties } from './metrics';
import { formatEuro, formatPct, formatEuroSqm, formatDiff, escapeHtml } from './formatting';
import { t } from './i18n';
import { getQualityCategory } from './qualityIndex';
import { getLayerById, getInterpolatedColor, readableTextColor } from './colorScales';
import { buildFullViewUrl } from './embed';

// T3: inline CSS for a quality-index badge whose color is sampled from the same
// quality_index map ramp the app uses (matches the panel/profile/map), with a
// contrast-safe foreground (white text fails on the light gold/lime ramp values).
function qiBadgeStyle(qi: number): string {
  const bg = getInterpolatedColor(getLayerById('quality_index'), qi);
  return `background:${bg};color:${readableTextColor(bg)};`;
}

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
  // PO-1: price has no objective "better" direction — neutral, no green/red delta
  // (a pricier area must not render as if it "won" on the shared score card).
  { key: 'property_price_sqm', label: 'panel.property_price', format: formatEuroSqm, higherIsBetter: null },
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
  const qi = data.quality_display ?? data.quality_index;
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
        <div style="width: 48px; height: 48px; border-radius: 12px; ${qiBadgeStyle(qi)}
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: 18px;">${qi}</div>
        <div style="font-size: 13px; color: #64748b;">${escapeHtml(t('panel.quality_index'))}</div>
      </div>` : ''}
    </div>
    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${METRICS.map(({ key, label, format, higherIsBetter }) => {
        const val = data[key] as number | null;
        const avg = metroAverages[key];
        const diff = val != null && avg != null ? val - avg : null;
        // PO-2: locale-correct signed diff (was period-decimal toFixed) + i18n "vs metro".
        const diffStr = formatDiff(val, avg);
        // PO-1: higherIsBetter === null → neutral (no objective better direction).
        const isGood = diff != null && higherIsBetter !== null ? (higherIsBetter ? diff > 0 : diff < 0) : false;
        const diffColor = diff != null && higherIsBetter !== null ? (diff === 0 ? '#64748b' : isGood ? '#059669' : '#dc2626') : '#64748b';
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9;">
            <span style="font-size: 13px; color: #64748b;">${escapeHtml(t(label))}</span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(format(val))}</span>
              ${diffStr ? `<span style="font-size: 11px; color: ${diffColor};">${escapeHtml(diffStr)} ${escapeHtml(t('panel.vs_metro'))}</span>` : ''}
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
    // PO-2: route through the shared Web-Share/download path with a deep link, so a
    // shared area card carries traceable inbound traffic like the other cards.
    const filename = `${(data.nimi || data.pno).replace(/[/\\:*?"<>|]/g, '_')}-${data.pno}-naapurustot.png`;
    await shareOrDownload(dataUrl, filename, buildFullViewUrl({ pno: data.pno, layer: null, city: null }), data.nimi);
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
          ? `<span style="display:inline-block;min-width:34px;padding:3px 6px;border-radius:8px;${qiBadgeStyle(qi)}font-weight:700;">${qi}</span>`
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

/**
 * CF-11: render a branded shortlist summary card — one row per shortlisted area
 * with its name, quality badge and 2-3 key metrics — as a PNG with the scoped
 * shortlist deep link (`sl`+`city` only) baked in, then share/download it. Reuses
 * the same lazy html-to-image + shareOrDownload path as the comparison card, so it
 * adds no new bundle weight. The `deepLink` is built by the caller via
 * buildShortlistShareUrl so this helper stays decoupled from the URL codec.
 */
export async function generateShortlistCard(areas: NeighborhoodProperties[], deepLink: string): Promise<void> {
  if (areas.length === 0) return;
  // Show the three most universally-populated metrics to keep rows compact.
  const cardMetrics = METRICS.slice(0, 3);

  const container = document.createElement('div');
  container.style.cssText = `
    width: 600px; padding: 32px; background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border-radius: 16px; box-sizing: border-box;
  `;

  const rows = areas
    .map((a) => {
      const qi = a.quality_index;
      const cat = qi != null ? getQualityCategory(qi) : null;
      const badge = qi != null && cat
        ? `<div style="flex-shrink:0;width:42px;height:42px;border-radius:10px;${qiBadgeStyle(qi)}display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;">${qi}</div>`
        : `<div style="flex-shrink:0;width:42px;height:42px;border-radius:10px;background:#e2e8f0;"></div>`;
      const metrics = cardMetrics
        .map(({ key, label, format }) =>
          `<span style="font-size:12px;color:#475569;"><span style="color:#94a3b8;">${escapeHtml(t(label))}:</span> ${escapeHtml(format(a[key] as number | null))}</span>`,
        )
        .join('<span style="color:#cbd5e1;">·</span>');
      return `
        <div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #f1f5f9;">
          ${badge}
          <div style="flex:1;min-width:0;">
            <div style="font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(a.nimi || a.pno)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">${metrics}</div>
          </div>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div style="font-size:13px;color:#64748b;margin-bottom:6px;font-weight:600;">naapurustot.fi · ${escapeHtml(t('shortlist.title'))}</div>
    <div style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:14px;">${areas.length} ${escapeHtml(t('shortlist.areas'))}</div>
    <div>${rows}</div>
    <div style="margin-top:20px;text-align:center;font-size:11px;color:#94a3b8;word-break:break-all;">${escapeHtml(deepLink)}</div>
  `;

  document.body.appendChild(container);
  try {
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(container, { quality: 0.95, pixelRatio: 2 });
    await shareOrDownload(dataUrl, 'naapurustot-vertailulista.png', deepLink, t('shortlist.title'));
  } finally {
    document.body.removeChild(container);
  }
}

/** Pre-computed inputs for generateCorrelationCard — the caller supplies the stats
 *  (Pearson r, optional OLS fit) and the axis/population domain, so the card renders
 *  without stats deps. Each point's `pop` scales its dot radius against `domain.popMax`. */
export interface CorrelationCardInput {
  points: { x: number; y: number; pop: number; color: string }[];
  r: number | null;
  fit: { slope: number; intercept: number } | null;
  domain: { xMin: number; xMax: number; yMin: number; yMax: number; popMax: number };
  labelX: string;
  labelY: string;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
}

/**
 * CF-10b: render the correlation scatter as a branded PNG card — the scatter plot
 * (region-coloured dots, best-fit line), the two metric labels, the Pearson r, a
 * naapurustot.fi watermark, and a deep link — then share/download it. Reuses the
 * comparison card's lazy html-to-image + shareOrDownload path, so no new bundle cost.
 */
export async function generateCorrelationCard(input: CorrelationCardInput): Promise<void> {
  const { points, r, fit, domain, labelX, labelY, formatX, formatY } = input;
  if (points.length === 0) return;

  const VB_W = 640, VB_H = 380;
  const PAD = { left: 64, right: 24, top: 16, bottom: 44 };
  const plotW = VB_W - PAD.left - PAD.right;
  const plotH = VB_H - PAD.top - PAD.bottom;
  const sx = (x: number) => PAD.left + ((x - domain.xMin) / (domain.xMax - domain.xMin || 1)) * plotW;
  const sy = (y: number) => PAD.top + plotH - ((y - domain.yMin) / (domain.yMax - domain.yMin || 1)) * plotH;
  const radius = (pop: number) => 2 + 10 * Math.sqrt(pop / (domain.popMax || 1));

  const fitLine = fit && r != null && Math.abs(r) > 0.1
    ? `<line x1="${sx(domain.xMin).toFixed(1)}" y1="${sy(fit.slope * domain.xMin + fit.intercept).toFixed(1)}" x2="${sx(domain.xMax).toFixed(1)}" y2="${sy(fit.slope * domain.xMax + fit.intercept).toFixed(1)}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="5 4" />`
    : '';
  const circles = points
    .map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${radius(p.pop).toFixed(1)}" fill="${p.color}" fill-opacity="0.7" />`)
    .join('');

  const svg = `<svg viewBox="0 0 ${VB_W} ${VB_H}" width="${VB_W}" height="${VB_H}" xmlns="http://www.w3.org/2000/svg">`
    + `<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" stroke="#cbd5e1" stroke-width="1" />`
    + `<line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}" stroke="#cbd5e1" stroke-width="1" />`
    + `<text x="${PAD.left}" y="${VB_H - 12}" fill="#64748b" font-size="11">${escapeHtml(formatX(domain.xMin))}</text>`
    + `<text x="${PAD.left + plotW}" y="${VB_H - 12}" text-anchor="end" fill="#64748b" font-size="11">${escapeHtml(formatX(domain.xMax))}</text>`
    + `<text x="${PAD.left - 8}" y="${PAD.top + plotH}" text-anchor="end" fill="#64748b" font-size="11">${escapeHtml(formatY(domain.yMin))}</text>`
    + `<text x="${PAD.left - 8}" y="${PAD.top + 10}" text-anchor="end" fill="#64748b" font-size="11">${escapeHtml(formatY(domain.yMax))}</text>`
    + fitLine + circles + `</svg>`;

  const container = document.createElement('div');
  container.style.cssText = `width:${VB_W + 64}px;padding:32px;background:#ffffff;`
    + `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;border-radius:16px;box-sizing:border-box;`;
  const rText = r == null ? '—' : r.toFixed(2);
  const deepLink = 'https://naapurustot.fi';
  container.innerHTML = `
    <div style="font-size:13px;color:#64748b;margin-bottom:6px;font-weight:600;">naapurustot.fi · ${escapeHtml(t('correlation.title'))}</div>
    <div style="font-size:18px;color:#0f172a;font-weight:700;margin-bottom:2px;">${escapeHtml(labelX)} <span style="color:#94a3b8;font-weight:400;">/</span> ${escapeHtml(labelY)}</div>
    <div style="font-size:13px;color:#334155;margin-bottom:12px;">${escapeHtml(t('correlation.pearson_r'))} = <strong>${rText}</strong></div>
    ${svg}
    <div style="margin-top:14px;text-align:center;font-size:11px;color:#94a3b8;">${escapeHtml(deepLink)}</div>
  `;

  document.body.appendChild(container);
  try {
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(container, { quality: 0.95, pixelRatio: 2 });
    await shareOrDownload(dataUrl, 'naapurustot-korrelaatio.png', deepLink, t('correlation.title'));
  } finally {
    document.body.removeChild(container);
  }
}
