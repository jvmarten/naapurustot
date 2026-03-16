import type { NeighborhoodProperties } from './metrics';
import { formatNumber, formatEuro, formatPct } from './formatting';
import { t, getLang } from './i18n';
import { getQualityCategory } from './qualityIndex';

interface StatEntry {
  label: string;
  value: string;
}

function collectStats(d: NeighborhoodProperties, avg: Record<string, number>): StatEntry[] {
  const fmtDensity = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('fi-FI')} /km²`);
  const fmtSqm = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} m²`);
  const fmtEuroSqm = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('fi-FI')} €/m²`);
  const fmtStopDensity = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} /km²`);

  const rows: StatEntry[] = [
    { label: t('panel.quality_index'), value: d.quality_index != null ? String(d.quality_index) : '—' },
    { label: t('panel.population'), value: formatNumber(d.he_vakiy) },
    { label: t('panel.median_income'), value: formatEuro(d.hr_mtu) },
    { label: t('panel.taxable_income'), value: formatEuro(d.avg_taxable_income) },
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
    { label: t('panel.rental_price'), value: d.rental_price_sqm != null ? `${d.rental_price_sqm.toFixed(2)} €/m²/kk` : '—' },
    { label: t('panel.kela_benefits'), value: formatPct(d.kela_benefit_pct) },
    // Quality of life
    { label: t('panel.walkability'), value: d.walkability_index != null ? `${d.walkability_index.toFixed(0)}/100` : '—' },
    { label: t('panel.property_price'), value: fmtEuroSqm(d.property_price_sqm) },
    { label: t('panel.transit_access'), value: fmtStopDensity(d.transit_stop_density) },
    { label: t('panel.air_quality'), value: d.air_quality_index != null ? d.air_quality_index.toFixed(1) : '—' },
    // Activity
    { label: t('panel.employed'), value: formatNumber(d.pt_tyoll) },
    { label: t('panel.unemployed'), value: formatNumber(d.pt_tyott) },
    { label: t('panel.students'), value: formatNumber(d.pt_opisk) },
    { label: t('panel.pensioners'), value: formatNumber(d.pt_elak) },
  ];

  // Add metro comparison column
  const metroMap: Record<string, number | undefined> = {
    [t('panel.median_income')]: avg.hr_mtu,
    [t('panel.unemployment')]: avg.unemployment_rate,
    [t('panel.ownership_rate')]: avg.ownership_rate,
    [t('panel.avg_apt_size')]: avg.ra_as_kpa,
    [t('panel.population_density')]: avg.population_density,
    [t('panel.child_ratio')]: avg.child_ratio,
    [t('panel.student_share')]: avg.student_share,
    [t('panel.property_price')]: avg.property_price_sqm,
    [t('panel.transit_access')]: avg.transit_stop_density,
    [t('panel.air_quality')]: avg.air_quality_index,
  };

  return rows.map((r) => {
    const metroVal = metroMap[r.label];
    return metroVal != null ? { ...r, label: r.label } : r;
  });
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function exportCsv(d: NeighborhoodProperties, avg: Record<string, number>): void {
  const stats = collectStats(d, avg);
  const header = `${escapeCsvField(t('export.field'))},${escapeCsvField(t('export.value'))}`;
  const rows = stats.map((s) => `${escapeCsvField(s.label)},${escapeCsvField(s.value)}`);
  const csv = [header, ...rows].join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${d.nimi}_${d.pno}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportPdf(d: NeighborhoodProperties, avg: Record<string, number>): void {
  const stats = collectStats(d, avg);
  const lang = getLang();
  const qi = d.quality_index;
  const cat = qi != null ? getQualityCategory(qi) : null;
  const catLabel = cat?.label[lang] ?? '—';

  const tableRows = stats
    .map(
      (s) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#374151">${s.label}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:500">${s.value}</td></tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${d.nimi} – ${d.pno}</title>
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
    <h1>${d.nimi}</h1>
    <p>${d.pno}${d.namn && d.namn !== d.nimi ? ` · ${d.namn}` : ''}</p>
    ${qi != null ? `<div class="qi"><span class="qi-score">${qi}</span><span>${catLabel}</span></div>` : ''}
  </div>
  <table>
    ${tableRows}
  </table>
  <div class="footer">${t('footer.attribution')}</div>
</div>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.addEventListener('afterprint', () => w.close());
  w.print();
}
