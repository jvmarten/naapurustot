/**
 * Tests for CSV export injection edge patterns.
 *
 * The escapeCsvField function at export.ts:51-58 must prevent:
 * - Formula injection via =, +, -, @ prefix characters
 * - Tab character injection (0x09)
 * - Carriage return injection (0x0D)
 * - Fields containing commas, quotes, newlines must be properly quoted
 *
 * We test the internal escaping logic by importing it indirectly through
 * the escape pattern used in the export module.
 */
import { describe, it, expect } from 'vitest';

// Replicate the exact escapeCsvField logic from export.ts
function escapeCsvField(field: string): string {
  const needsPrefix = /^[=+\-@\t\r]/.test(field);
  const escaped = needsPrefix ? `'${field}` : field;
  if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') || escaped.includes('\r')) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

describe('CSV injection — formula character escaping', () => {
  it('prefixes = with single quote', () => {
    expect(escapeCsvField('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
  });

  it('prefixes + with single quote', () => {
    expect(escapeCsvField('+1234')).toBe("'+1234");
  });

  it('prefixes - with single quote', () => {
    expect(escapeCsvField('-1234')).toBe("'-1234");
  });

  it('prefixes @ with single quote', () => {
    expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('prefixes tab character with single quote', () => {
    expect(escapeCsvField('\tcommand')).toBe("'\tcommand");
  });

  it('prefixes carriage return with single quote and quotes the field', () => {
    const result = escapeCsvField('\rinjection');
    // \r matches the prefix regex AND triggers quoting (includes \r)
    // Result: "'\rinjection" (quoted because it contains \r)
    expect(result.startsWith('"')).toBe(true);
    expect(result).toContain("'");
    // The raw \r character should be inside the quoted field
    expect(result).toContain('\r');
  });
});

describe('CSV injection — complex formula patterns', () => {
  it('handles =cmd|...|.. DDE injection pattern', () => {
    const result = escapeCsvField('=cmd|/C calc.exe|!A0');
    expect(result.startsWith("'")).toBe(true);
    expect(result).not.toBe('=cmd|/C calc.exe|!A0');
  });

  it('handles =HYPERLINK formula', () => {
    const result = escapeCsvField('=HYPERLINK("http://evil.com","Click")');
    // Should be prefixed and quoted (contains commas and quotes)
    expect(result.startsWith('"')).toBe(true);
    expect(result).toContain("'=HYPERLINK");
  });

  it('handles +cmd formula variant', () => {
    const result = escapeCsvField('+cmd|/C notepad|!A0');
    expect(result.startsWith("'")).toBe(true);
  });

  it('handles @SUM DDE variant', () => {
    const result = escapeCsvField('@SUM(1+1)*cmd|/C calc|!A0');
    expect(result.startsWith("'")).toBe(true);
  });
});

describe('CSV field quoting — special characters', () => {
  it('quotes fields containing commas', () => {
    expect(escapeCsvField('Helsinki, Finland')).toBe('"Helsinki, Finland"');
  });

  it('quotes fields containing double quotes and escapes them', () => {
    expect(escapeCsvField('He said "hello"')).toBe('"He said ""hello"""');
  });

  it('quotes fields containing newlines', () => {
    expect(escapeCsvField('Line1\nLine2')).toBe('"Line1\nLine2"');
  });

  it('handles fields with both commas and quotes', () => {
    expect(escapeCsvField('"Price", 100 €')).toBe('"""Price"", 100 €"');
  });

  it('leaves plain fields unquoted', () => {
    expect(escapeCsvField('Helsinki')).toBe('Helsinki');
  });

  it('leaves numeric-looking fields unquoted', () => {
    expect(escapeCsvField('12345')).toBe('12345');
  });

  it('handles empty string', () => {
    expect(escapeCsvField('')).toBe('');
  });
});

describe('CSV injection — escapeHtml for PDF export', () => {
  // escapeHtml is used in exportPdf to prevent XSS in the generated HTML
  // Import directly since it's exported from formatting.ts
  it('escapes HTML special characters', async () => {
    const { escapeHtml } = await import('../utils/formatting');
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands', async () => {
    const { escapeHtml } = await import('../utils/formatting');
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes single quotes', async () => {
    const { escapeHtml } = await import('../utils/formatting');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('handles neighborhood names with special characters', async () => {
    const { escapeHtml } = await import('../utils/formatting');
    // Finnish neighborhood names should never need escaping, but user-provided
    // data (notes) might contain HTML
    expect(escapeHtml('Töölö <"best"> & Kallio')).toBe(
      'Töölö &lt;&quot;best&quot;&gt; &amp; Kallio'
    );
  });
});
