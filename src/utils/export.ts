import type { NeighborhoodProperties } from './metrics';
import { formatNumber, formatEuro, formatPct, escapeHtml } from './formatting';
import { t, getLang } from './i18n';
import { getQualityCategory } from './qualityIndex';

interface StatEntry {
  label: string;
  value: string;
}

let _exportFmtLocale = '';
let _exportFmt: Intl.NumberFormat | null = null;
function exportNumFmt(): Intl.NumberFormat {
  const loc = getLang() === 'en' ? 'en-US' : 'fi-FI';
  if (_exportFmt && _exportFmtLocale === loc) return _exportFmt;
  _exportFmtLocale = loc;
  _exportFmt = new Intl.NumberFormat(loc);
  return _exportFmt;
}

function collectStats(d: NeighborhoodProperties): StatEntry[] {
  const fmt = exportNumFmt();
  const fmtDensity = (v: number | null | undefined) => (v == null ? '—' : `${fmt.format(v)} /km²`);
  const fmtSqm = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} m²`);
  const fmtEuroSqm = (v: number | null | undefined) => (v == null ? '—' : `${fmt.format(v)} €/m²`);
  const fmtStopDensity = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} /km²`);

  const rows: StatEntry[] = [
    { label: t('panel.quality_index'), value: d.quality_index != null ? String(d.quality_index) : '—' },
    { label: t('panel.population'), value: formatNumber(d.he_vakiy) },
    { label: t('panel.median_income'), value: formatEuro(d.hr_mtu) },
    { label: t('panel.avg_income'), value: formatEuro(d.hr_ktu) },
    { label: t('panel.unemployment'), value: formatPct(d.unemployment_rate) },
    { label: t('panel.foreign_lang'), value: formatPct(d.foreign_language_pct) },
    // Housing
    { label: t('panel.ownership_rate'), value: formatPct(d.ownership_rate) },
    { label: t('panel.rental_rate'), value: formatPct(d.rental_rate) },
    { label: t('panel.avg_apt_size'), value: fmtSqm(d.ra_as_kpa) },
    { label: t('panel.detached_houses'), value: formatPct(d.detached_house_share) },
    { label: t('panel.dwellings'), value: formatNumber(d.ra_asunn) },
    { label: t('panel.households'), value: formatNumber(d.te_taly) },
    // Demographics
    { label: t('panel.population_density'), value: fmtDensity(d.population_density) },
    { label: t('panel.child_ratio'), value: formatPct(d.child_ratio) },
    { label: t('panel.student_share'), value: formatPct(d.student_share) },
    // Quality of life
    { label: t('panel.property_price'), value: fmtEuroSqm(d.property_price_sqm) },
    { label: t('panel.transit_access'), value: fmtStopDensity(d.transit_stop_density) },
    { label: t('panel.air_quality'), value: d.air_quality_index != null ? d.air_quality_index.toFixed(1) : '—' },
    // Activity
    { label: t('panel.employed'), value: formatNumber(d.pt_tyoll) },
    { label: t('panel.unemployed'), value: formatNumber(d.pt_tyott) },
    { label: t('panel.students'), value: formatNumber(d.pt_opisk) },
    { label: t('panel.pensioners'), value: formatNumber(d.pt_elakel) },
  ];

  return rows;
}

function escapeCsvField(field: string): string {
  // Prevent CSV injection: prefix formula-triggering characters with a single quote
  // so Excel/LibreOffice treat the cell as text, not a formula.
  const needsPrefix = /^[=+\-@\t\r]/.test(field);
  const escaped = needsPrefix ? `'${field}` : field;
  if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') || escaped.includes('\r')) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

/**
 * Export neighborhood stats as a CSV file download.
 * Includes UTF-8 BOM for Excel compatibility and CSV injection protection
 * (formula-triggering characters are prefixed with a single quote).
 */
export function exportCsv(d: NeighborhoodProperties, _avg: Record<string, number>): void {
  const stats = collectStats(d);
  const header = `${escapeCsvField(t('export.field'))},${escapeCsvField(t('export.value'))}`;
  const rows = stats.map((s) => `${escapeCsvField(s.label)},${escapeCsvField(s.value)}`);
  const csv = [header, ...rows].join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(d.nimi || d.pno).replace(/[/\\:*?"<>|]/g, '_')}_${d.pno}.csv`;
    a.click();
  } finally {
    // Revoke after a generous delay to ensure the browser has initiated the download.
    // 1s is too short on slow devices; 60s is safe and the blob is small.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * Generate a styled HTML report in a new popup window and trigger the browser's print dialog.
 * The user can then "Save as PDF" from the browser's print dialog.
 * Handles popup blockers and defers print() until the document is fully rendered.
 */
export function exportPdf(d: NeighborhoodProperties, _avg: Record<string, number>): void {
  const stats = collectStats(d);
  const lang = getLang();
  const qi = d.quality_index;
  const cat = qi != null ? getQualityCategory(qi) : null;
  const catLabel = cat?.label[lang] ?? '—';

  const tableRows = stats
    .map(
      (s) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#374151">${escapeHtml(s.label)}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:500">${escapeHtml(s.value)}</td></tr>`,
    )
    .join('');

  const safeNimi = escapeHtml(d.nimi);
  const safePno = escapeHtml(d.pno);
  const safeNamn = escapeHtml(d.namn ?? '');

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<title>${safeNimi} – ${safePno}</title>
<style>
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 2rem auto; color: #111827; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
  .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 24px; }
  .header h1 { margin: 0 0 4px 0; font-size: 1.5rem; }
  .header p { margin: 0; opacity: 0.85; font-size: 0.9rem; }
  .qi { display: inline-flex; align-items: center; gap: 8px; margin-top: 12px; background: rgba(255,255,255,0.2); border-radius: 8px; padding: 6px 12px; }
  .qi-score { font-weight: 700; font-size: 1.2rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .section-title { padding: 12px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; background: #f9fafb; }
  .footer { padding: 12px; font-size: 0.75rem; color: #9ca3af; text-align: center; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>${safeNimi}</h1>
    <p>${safePno}${d.namn && d.namn !== d.nimi ? ` · ${safeNamn}` : ''}</p>
    ${qi != null ? `<div class="qi"><span class="qi-score">${qi}</span><span>${escapeHtml(catLabel)}</span></div>` : ''}
  </div>
  <table>
    ${tableRows}
  </table>
  <div class="footer">${escapeHtml(t('footer.attribution'))}</div>
</div>
</body>
</html>`;

  openPrintWindow(html);
}

function openPrintWindow(html: string): void {
  const w = window.open('', '_blank');
  if (!w) {
    alert(getLang() === 'fi'
      ? 'Ponnahdusikkuna estettiin. Salli ponnahdusikkunat ja yritä uudelleen.'
      : 'Popup was blocked. Please allow popups and try again.');
    return;
  }
  w.document.write(html);
  w.document.close();
  w.addEventListener('afterprint', () => w.close());
  // Defer print() until the document is fully rendered to avoid blank printouts.
  // Use a flag to avoid double-printing from both the load event and the fallback timer.
  let printed = false;
  const doPrint = () => { if (!printed) { printed = true; w.print(); } };
  w.addEventListener('load', doPrint);
  // Fallback for browsers that don't fire 'load' on document.write().
  // Use requestAnimationFrame to ensure the browser has painted before printing.
  // Guard against the window being closed before the timer fires.
  setTimeout(() => { if (!w.closed) w.requestAnimationFrame(() => doPrint()); }, 500);
}

// ── CF-8: Multi-neighborhood comparison export ──

const COMPARE_COLORS = ['#6366f1', '#10b981', '#f59e0b'];

/** Export a multi-neighborhood comparison as a styled HTML report and trigger print. */
export function exportComparisonPdf(pinned: NeighborhoodProperties[]): void {
  if (pinned.length < 2) return;

  const lang = getLang();
  const safeNames = pinned.map((p) => escapeHtml(p.nimi ?? p.pno));
  const safePnos = pinned.map((p) => escapeHtml(p.pno));

  // Build summary table — one row per metric, columns per neighborhood with best highlighted.
  const summaryStats = collectStats(pinned[0]);
  const statKeys = summaryStats.map((s) => s.label);

  const allStats = pinned.map((p) => collectStats(p));
  // Find best per row (rough heuristic: higher value wins for most stats — kept simple here)
  const summaryRows = statKeys
    .map((label, i) => {
      const cells = allStats.map((stats) => stats[i]?.value ?? '—');
      const tds = cells
        .map(
          (v) =>
            `<td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:500">${escapeHtml(v)}</td>`,
        )
        .join('');
      return `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#374151">${escapeHtml(label)}</td>${tds}</tr>`;
    })
    .join('');

  const headerCells = safeNames
    .map((n, i) => {
      const color = COMPARE_COLORS[i] ?? '#6b7280';
      return `<th style="padding:8px 12px;border-bottom:2px solid #e5e7eb;text-align:right;color:${color}">${n}<br><span style="font-weight:400;font-size:0.75rem;color:#9ca3af">${safePnos[i]}</span></th>`;
    })
    .join('');

  // Per-neighborhood detail pages
  const detailPages = pinned
    .map((p, i) => {
      const stats = allStats[i];
      const qi = p.quality_index;
      const cat = qi != null ? getQualityCategory(qi) : null;
      const catLabel = cat?.label[lang] ?? '—';
      const color = COMPARE_COLORS[i] ?? '#6366f1';
      const rows = stats
        .map(
          (s) =>
            `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#374151">${escapeHtml(s.label)}</td>` +
            `<td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:500">${escapeHtml(s.value)}</td></tr>`,
        )
        .join('');
      return `<section class="page" style="page-break-before:always">
        <div class="card">
          <div class="header" style="background:linear-gradient(135deg,${color},#8b5cf6)">
            <h1>${safeNames[i]}</h1>
            <p>${safePnos[i]}${p.namn && p.namn !== p.nimi ? ` · ${escapeHtml(p.namn)}` : ''}</p>
            ${qi != null ? `<div class="qi"><span class="qi-score">${qi}</span><span>${escapeHtml(catLabel)}</span></div>` : ''}
          </div>
          <table>${rows}</table>
        </div>
      </section>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(t('compare.title'))} – ${safeNames.join(' · ')}</title>
<style>
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 2rem auto; color: #111827; padding: 0 1rem; }
  h1 { margin: 0 0 4px 0; font-size: 1.5rem; }
  h2 { font-size: 1.15rem; margin: 0 0 12px 0; color: #1f2937; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
  .header { color: white; padding: 24px; }
  .header p { margin: 0; opacity: 0.85; font-size: 0.9rem; }
  .qi { display: inline-flex; align-items: center; gap: 8px; margin-top: 12px; background: rgba(255,255,255,0.2); border-radius: 8px; padding: 6px 12px; }
  .qi-score { font-weight: 700; font-size: 1.2rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .footer { padding: 12px; font-size: 0.75rem; color: #9ca3af; text-align: center; }
  .summary-header { padding: 8px 12px; color: white; background: linear-gradient(135deg,#6366f1,#8b5cf6); }
  .summary-header h1 { margin: 0; }
  .summary-header p { margin: 4px 0 0 0; font-size: 0.85rem; opacity: 0.9; }
</style>
</head>
<body>
<section class="page">
  <div class="card">
    <div class="summary-header">
      <h1>${escapeHtml(t('compare.title'))}</h1>
      <p>${safeNames.join(' · ')}</p>
    </div>
    <table>
      <thead>
        <tr>
          <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb;text-align:left;color:#6b7280">${escapeHtml(t('export.field'))}</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        ${summaryRows}
      </tbody>
    </table>
    <div class="footer">${escapeHtml(t('footer.attribution'))}</div>
  </div>
</section>
${detailPages}
</body>
</html>`;

  openPrintWindow(html);
}

/** Export a multi-neighborhood comparison as a single CSV file. */
export function exportComparisonCsv(pinned: NeighborhoodProperties[]): void {
  if (pinned.length === 0) return;

  // Row 0: header with neighborhood names; Row 1+: one row per metric across all neighborhoods.
  const allStats = pinned.map((p) => collectStats(p));
  const labels = allStats[0].map((s) => s.label);
  const headerRow = [t('export.field'), ...pinned.map((p) => `${p.nimi ?? p.pno} (${p.pno})`)]
    .map(escapeCsvField)
    .join(',');
  const rows = labels.map((label, i) => {
    const cells = allStats.map((stats) => stats[i]?.value ?? '');
    return [label, ...cells].map(escapeCsvField).join(',');
  });
  const csv = [headerRow, ...rows].join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    const slug = pinned
      .map((p) => (p.nimi || p.pno).replace(/[/\\:*?"<>|]/g, '_'))
      .join('_vs_');
    a.download = `comparison_${slug}.csv`;
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
