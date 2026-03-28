import { describe, it, expect, beforeEach } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';
import { setLang } from '../utils/i18n';

describe('formatting — language-specific behavior', () => {
  beforeEach(() => {
    setLang('fi');
  });

  it('formatNumber handles negative values', () => {
    const result = formatNumber(-1234);
    expect(typeof result).toBe('string');
    expect(result).not.toBe('—');
  });

  it('formatNumber handles very large values', () => {
    const result = formatNumber(1_000_000_000);
    expect(typeof result).toBe('string');
    expect(result).not.toBe('—');
  });

  it('formatEuro handles negative values', () => {
    const result = formatEuro(-500);
    expect(typeof result).toBe('string');
    expect(result).toContain('€');
  });

  it('formatPct handles values > 100', () => {
    const result = formatPct(150.5);
    expect(result).toContain('150');
    expect(result).toContain('%');
  });

  it('formatPct handles negative values', () => {
    const result = formatPct(-5.3);
    expect(result).toContain('-5');
    expect(result).toContain('%');
  });

  it('formatDiff shows sign for small differences', () => {
    const result = formatDiff(10.1, 10.0);
    expect(result).toContain('+');
  });

  it('formatDiff handles equal values', () => {
    const result = formatDiff(10, 10);
    expect(result).toBe('0.0');
  });

  it('formatDiff handles large negative difference', () => {
    const result = formatDiff(5, 100);
    expect(result).toContain('-');
  });

  it('diffColor returns correct color for equal values', () => {
    expect(diffColor(50, 50, true)).toContain('emerald');
    expect(diffColor(50, 50, false)).toContain('emerald');
  });
});

describe('formatting — English locale', () => {
  beforeEach(() => {
    setLang('en');
  });

  it('formatEuro in English locale still includes €', () => {
    const result = formatEuro(1000);
    expect(result).toContain('€');
  });

  it('formatPct with 0 decimals', () => {
    const result = formatPct(75.678, 0);
    expect(result).toContain('76');
    expect(result).toContain('%');
  });
});
