export function formatNumber(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('fi-FI');
}

export function formatEuro(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toLocaleString('fi-FI')} €`;
}

export function formatPct(v: number | null | undefined, decimals = 1): string {
  if (v == null) return '—';
  return `${v.toFixed(decimals)} %`;
}

export function formatDiff(value: number | null, avg: number | null): string {
  if (value == null || avg == null) return '';
  const diff = value - avg;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}`;
}

export function diffColor(value: number | null, avg: number | null, higherIsBetter = true): string {
  if (value == null || avg == null) return 'text-surface-400';
  const diff = value - avg;
  const positive = higherIsBetter ? diff >= 0 : diff <= 0;
  return positive ? 'text-emerald-400' : 'text-rose-400';
}
