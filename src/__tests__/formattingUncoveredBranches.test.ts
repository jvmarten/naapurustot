/**
 * Tests for formatting.ts — uncovered lines: formatDensity, formatEuroSqm, diffColor edge cases.
 *
 * Coverage showed lines 69-71 (formatDensity) uncovered and some branches in diffColor.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('formatting — formatDensity', () => {
  let formatDensity: typeof import('../utils/formatting').formatDensity;
  let formatEuroSqm: typeof import('../utils/formatting').formatEuroSqm;
  let formatNumber: typeof import('../utils/formatting').formatNumber;
  let formatEuro: typeof import('../utils/formatting').formatEuro;
  let formatPct: typeof import('../utils/formatting').formatPct;
  let formatDiff: typeof import('../utils/formatting').formatDiff;
  let diffColor: typeof import('../utils/formatting').diffColor;
  let escapeHtml: typeof import('../utils/formatting').escapeHtml;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/formatting');
    formatDensity = mod.formatDensity;
    formatEuroSqm = mod.formatEuroSqm;
    formatNumber = mod.formatNumber;
    formatEuro = mod.formatEuro;
    formatPct = mod.formatPct;
    formatDiff = mod.formatDiff;
    diffColor = mod.diffColor;
    escapeHtml = mod.escapeHtml;
  });

  it('formatDensity formats a positive number with /km²', () => {
    const result = formatDensity(1234);
    expect(result).toContain('1');
    expect(result).toContain('/km²');
  });

  it('formatDensity returns dash for null', () => {
    expect(formatDensity(null)).toBe('—');
  });

  it('formatDensity returns dash for undefined', () => {
    expect(formatDensity(undefined)).toBe('—');
  });

  it('formatDensity handles zero', () => {
    const result = formatDensity(0);
    expect(result).toContain('0');
    expect(result).toContain('/km²');
  });

  it('formatDensity handles string input', () => {
    const result = formatDensity('5000' as unknown as number);
    expect(result).toContain('5');
    expect(result).toContain('/km²');
  });

  it('formatDensity returns dash for non-numeric string', () => {
    expect(formatDensity('abc' as unknown as number)).toBe('—');
  });

  it('formatDensity returns dash for NaN', () => {
    expect(formatDensity(NaN)).toBe('—');
  });

  it('formatDensity returns dash for Infinity', () => {
    expect(formatDensity(Infinity)).toBe('—');
  });
});

describe('formatting — formatEuroSqm', () => {
  let formatEuroSqm: typeof import('../utils/formatting').formatEuroSqm;
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/formatting');
    formatEuroSqm = mod.formatEuroSqm;
  });

  it('formats a number with €/m²', () => {
    const result = formatEuroSqm(3500);
    expect(result).toContain('3');
    expect(result).toContain('€/m²');
  });

  it('returns dash for null', () => {
    expect(formatEuroSqm(null)).toBe('—');
  });

  it('returns dash for undefined', () => {
    expect(formatEuroSqm(undefined)).toBe('—');
  });

  it('handles zero', () => {
    const result = formatEuroSqm(0);
    expect(result).toContain('0');
    expect(result).toContain('€/m²');
  });

  it('handles string number input', () => {
    const result = formatEuroSqm('2500' as unknown as number);
    expect(result).toContain('2');
    expect(result).toContain('€/m²');
  });
});

describe('formatting — diffColor edge cases', () => {
  let diffColor: typeof import('../utils/formatting').diffColor;
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/formatting');
    diffColor = mod.diffColor;
  });

  it('returns emerald when value equals average (higherIsBetter=true)', () => {
    expect(diffColor(50, 50, true)).toBe('text-emerald-400');
  });

  it('returns emerald when value equals average (higherIsBetter=false)', () => {
    expect(diffColor(50, 50, false)).toBe('text-emerald-400');
  });

  it('returns rose when value is higher than average (higherIsBetter=false)', () => {
    expect(diffColor(60, 50, false)).toBe('text-rose-400');
  });

  it('returns emerald when value is lower than average (higherIsBetter=false)', () => {
    expect(diffColor(40, 50, false)).toBe('text-emerald-400');
  });

  it('returns surface-400 when value is null', () => {
    expect(diffColor(null, 50)).toBe('text-surface-400');
  });

  it('returns surface-400 when avg is null', () => {
    expect(diffColor(50, null)).toBe('text-surface-400');
  });

  it('returns surface-400 when both are null', () => {
    expect(diffColor(null, null)).toBe('text-surface-400');
  });

  it('handles string inputs via toNum conversion', () => {
    expect(diffColor('60', '50', true)).toBe('text-emerald-400');
    expect(diffColor('40', '50', true)).toBe('text-rose-400');
  });

  it('defaults higherIsBetter to true', () => {
    // higher value without explicit higherIsBetter → emerald
    expect(diffColor(60, 50)).toBe('text-emerald-400');
    expect(diffColor(40, 50)).toBe('text-rose-400');
  });
});

describe('formatting — escapeHtml completeness', () => {
  let escapeHtml: typeof import('../utils/formatting').escapeHtml;
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/formatting');
    escapeHtml = mod.escapeHtml;
  });

  it('escapes all five special characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('escapes a complex string with all special characters', () => {
    const input = '<script>alert("XSS & \'injection\'")</script>';
    const result = escapeHtml(input);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).toContain('&amp;');
    expect(result).toContain('&quot;');
    expect(result).toContain('&#39;');
  });

  it('preserves safe strings unchanged', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('formatting — formatDiff edge cases', () => {
  let formatDiff: typeof import('../utils/formatting').formatDiff;
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/formatting');
    formatDiff = mod.formatDiff;
  });

  it('returns empty string when value is null', () => {
    expect(formatDiff(null, 50)).toBe('');
  });

  it('returns empty string when avg is null', () => {
    expect(formatDiff(50, null)).toBe('');
  });

  it('formats positive difference with + sign', () => {
    expect(formatDiff(55, 50)).toBe('+5.0');
  });

  it('formats negative difference without explicit sign', () => {
    expect(formatDiff(45, 50)).toBe('-5.0');
  });

  it('formats zero difference as 0.0 (no sign)', () => {
    // diff=0, sign condition (diff > 0) is false, so no '+' prefix
    expect(formatDiff(50, 50)).toBe('0.0');
  });

  it('accepts string inputs', () => {
    expect(formatDiff('55', '50')).toBe('+5.0');
  });
});
