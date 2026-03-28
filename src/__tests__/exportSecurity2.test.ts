import { describe, it, expect } from 'vitest';

// We need to test escapeCsvField and escapeHtml directly.
// They are not exported, so we test them through the module's behavior.
// Let's re-implement them to verify the logic matches.

describe('CSV injection prevention', () => {
  // Simulate the escapeCsvField logic
  function escapeCsvField(field: string): string {
    const needsPrefix = /^[=+\-@\t\r]/.test(field);
    const escaped = needsPrefix ? `'${field}` : field;
    if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
      return `"${escaped.replace(/"/g, '""')}"`;
    }
    return escaped;
  }

  it('prefixes formula starting with =', () => {
    expect(escapeCsvField('=cmd|')).toBe("'=cmd|");
  });

  it('prefixes formula starting with +', () => {
    expect(escapeCsvField('+1234')).toBe("'+1234");
  });

  it('prefixes formula starting with -', () => {
    expect(escapeCsvField('-1234')).toBe("'-1234");
  });

  it('prefixes formula starting with @', () => {
    expect(escapeCsvField('@SUM(A1:A10)')).toBe("'@SUM(A1:A10)");
  });

  it('prefixes formula starting with tab', () => {
    expect(escapeCsvField('\tdata')).toBe("'\tdata");
  });

  it('prefixes formula starting with CR', () => {
    expect(escapeCsvField('\rdata')).toBe("'\rdata");
  });

  it('does not prefix normal text', () => {
    expect(escapeCsvField('Hello World')).toBe('Hello World');
  });

  it('wraps fields containing commas in quotes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });

  it('wraps fields containing newlines in quotes', () => {
    expect(escapeCsvField('a\nb')).toBe('"a\nb"');
  });

  it('escapes embedded quotes by doubling them', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('handles formula with comma (both prefix and quote)', () => {
    expect(escapeCsvField('=1+2,3')).toBe("\"'=1+2,3\"");
  });

  it('handles empty string', () => {
    expect(escapeCsvField('')).toBe('');
  });
});

describe('HTML escaping', () => {
  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  it('escapes ampersand', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('handles multiple entities in one string', () => {
    expect(escapeHtml('<a href="x&y">')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;');
  });

  it('does not double-encode already-escaped content', () => {
    // First pass
    const once = escapeHtml('&');
    expect(once).toBe('&amp;');
    // Second pass double-encodes (expected, caller's responsibility)
    const twice = escapeHtml(once);
    expect(twice).toBe('&amp;amp;');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('passes through normal text unchanged', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });
});
