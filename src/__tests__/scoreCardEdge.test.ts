import { describe, it, expect } from 'vitest';
import { getQualityCategory, QUALITY_CATEGORIES } from '../utils/qualityIndex';
import { escapeHtml } from '../utils/formatting';

describe('scoreCard — metric diff logic', () => {
  function computeDiff(val: number | null, avg: number | null, higherIsBetter: boolean) {
    const diff = val != null && avg != null ? val - avg : null;
    const diffStr = diff != null ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}` : '';
    const isGood = diff != null ? (higherIsBetter ? diff > 0 : diff < 0) : false;
    const diffColor = diff != null ? (diff === 0 ? '#64748b' : isGood ? '#059669' : '#dc2626') : '#64748b';
    return { diff, diffStr, diffColor };
  }

  it('positive diff for higherIsBetter=true metric → green', () => {
    const { diffColor, diffStr } = computeDiff(35000, 32000, true);
    expect(diffColor).toBe('#059669');
    expect(diffStr).toBe('+3000.0');
  });

  it('negative diff for higherIsBetter=true metric → red', () => {
    const { diffColor, diffStr } = computeDiff(28000, 32000, true);
    expect(diffColor).toBe('#dc2626');
    expect(diffStr).toBe('-4000.0');
  });

  it('zero diff → gray', () => {
    const { diffColor, diffStr } = computeDiff(32000, 32000, true);
    expect(diffColor).toBe('#64748b');
    expect(diffStr).toBe('0.0');
  });

  it('positive diff for higherIsBetter=false metric (unemployment) → red', () => {
    const { diffColor } = computeDiff(12, 9, false);
    expect(diffColor).toBe('#dc2626');
  });

  it('negative diff for higherIsBetter=false metric (unemployment) → green', () => {
    const { diffColor } = computeDiff(7.5, 9.0, false);
    expect(diffColor).toBe('#059669');
  });

  it('null value → gray with no diff string', () => {
    const { diffColor, diffStr } = computeDiff(null, 32000, true);
    expect(diffColor).toBe('#64748b');
    expect(diffStr).toBe('');
  });

  it('null avg → gray with no diff string', () => {
    const { diffColor, diffStr } = computeDiff(35000, null, true);
    expect(diffColor).toBe('#64748b');
    expect(diffStr).toBe('');
  });
});

describe('scoreCard — filename sanitization', () => {
  it('replaces dangerous characters', () => {
    const nimi = 'Test/Path:Name*"<>|';
    const sanitized = nimi.replace(/[/\\:*?"<>|]/g, '_');
    expect(sanitized).not.toContain('/');
    expect(sanitized).not.toContain(':');
    expect(sanitized).not.toContain('*');
    expect(sanitized).not.toContain('"');
    expect(sanitized).not.toContain('<');
    expect(sanitized).not.toContain('>');
    expect(sanitized).not.toContain('|');
    // 'Test/Path:Name*"<>|' has 5 special chars: / : * " < > |  → plus backslash in regex class
    expect(sanitized).toBe('Test_Path_Name_____');
  });

  it('uses pno as fallback when nimi is falsy', () => {
    const nimi = '';
    const pno = '00100';
    const name = nimi || pno;
    expect(name).toBe('00100');
  });
});

describe('scoreCard — quality category badge', () => {
  it('returns correct category for quality index 72', () => {
    const cat = getQualityCategory(72);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Good');
  });

  it('returns null for null quality index', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('category has a valid color', () => {
    for (const cat of QUALITY_CATEGORIES) {
      expect(cat.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('scoreCard — escapeHtml in card', () => {
  it('escapes HTML in neighborhood name', () => {
    const dangerous = '<script>alert("xss")</script>';
    const escaped = escapeHtml(dangerous);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });
});
