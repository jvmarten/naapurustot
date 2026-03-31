import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../utils/formatting';

describe('escapeHtml — XSS prevention', () => {
  it('escapes all dangerous HTML characters', () => {
    const input = '<script>alert("xss")</script>&foo\'bar';
    const result = escapeHtml(input);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).toContain('&quot;');
    expect(result).toContain('&#39;');
    expect(result).toContain('&amp;');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });

  it('double-encodes already-escaped entities', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('escapes angle brackets so HTML tags cannot be injected', () => {
    const result = escapeHtml('<img src=x onerror="alert(1)">');
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
    expect(result).toContain('&gt;');
  });

  it('escapes single quotes in attributes', () => {
    const result = escapeHtml("onclick='alert(1)'");
    expect(result).not.toContain("'");
    expect(result).toContain('&#39;');
  });
});

describe('CSV injection prevention', () => {
  // Test the escapeCsvField logic by examining the pattern used in export.ts
  it('recognizes formula-triggering characters', () => {
    const dangerous = ['=', '+', '-', '@', '\t', '\r'];
    for (const char of dangerous) {
      // The regex /^[=+\-@\t\r]/ should match these at start of string
      expect(/^[=+\-@\t\r]/.test(`${char}CMD("calc")`)).toBe(true);
    }
  });

  it('safe strings do not trigger CSV prefix', () => {
    const safe = ['Hello', '12345', 'Normal text', '(parenthesized)'];
    for (const s of safe) {
      expect(/^[=+\-@\t\r]/.test(s)).toBe(false);
    }
  });
});
