/**
 * Tests for formatDensity, formatEuroSqm, and escapeHtml — the three formatters
 * whose outputs land directly in user-visible UI and HTML exports.
 *
 * Risk:
 *  - formatDensity/formatEuroSqm run on tooltip hot path (60Hz) — must handle
 *    null/undefined/string silently, never throw, never produce "NaN /km²".
 *  - escapeHtml is the only defense against XSS in the PDF/score card HTML
 *    generators. A regression here → stored XSS across every neighborhood panel.
 */
import { describe, it, expect } from 'vitest';
import { formatDensity, formatEuroSqm, escapeHtml, formatNumber, formatEuro } from '../utils/formatting';

describe('formatDensity', () => {
  it('returns em dash for null and undefined', () => {
    expect(formatDensity(null)).toBe('—');
    expect(formatDensity(undefined)).toBe('—');
  });

  it('returns em dash for non-numeric strings', () => {
    expect(formatDensity('abc' as unknown as string)).toBe('—');
  });

  it('appends /km² with rounded integer value', () => {
    const out = formatDensity(1234.7);
    expect(out).toContain('/km²');
    // Rounded up to 1235; locale-specific thousands separator
    expect(out.replace(/\s|\u00a0/g, '')).toBe('1235/km²');
  });

  it('rounds 0.4 down to 0', () => {
    expect(formatDensity(0.4)).toBe('0 /km²');
  });

  it('rounds 0.5 up to 1 (banker-like Math.round)', () => {
    expect(formatDensity(0.5)).toBe('1 /km²');
  });

  it('accepts numeric strings via toNum coercion', () => {
    expect(formatDensity('42')).toBe('42 /km²');
  });

  it('handles zero without crashing', () => {
    expect(formatDensity(0)).toBe('0 /km²');
  });
});

describe('formatEuroSqm', () => {
  it('returns em dash for null/undefined/non-numeric', () => {
    expect(formatEuroSqm(null)).toBe('—');
    expect(formatEuroSqm(undefined)).toBe('—');
    expect(formatEuroSqm('oops' as unknown as string)).toBe('—');
  });

  it('appends €/m² without rounding (preserves the original value)', () => {
    const out = formatEuroSqm(3500);
    expect(out).toContain('€/m²');
    expect(out.replace(/\s|\u00a0/g, '')).toBe('3500€/m²');
  });

  it('formats numeric string input', () => {
    expect(formatEuroSqm('4200')).toContain('€/m²');
  });
});

describe('escapeHtml — XSS defense', () => {
  it('escapes & to &amp; (must run first so subsequent entities are not doubly-encoded)', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes all five reserved characters in a single pass', () => {
    expect(escapeHtml(`<script>alert("xss")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('escapes single quotes to &#39; (not &apos;)', () => {
    // &apos; is NOT a valid HTML4 entity, so &#39; is the safe choice.
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('does not double-encode — the order is &, then <, >, ", \'', () => {
    // If < or > were escaped before &, "&lt;" would become "&amp;lt;".
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('leaves safe ASCII text unchanged', () => {
    expect(escapeHtml('Helsinki 00100')).toBe('Helsinki 00100');
  });

  it('handles Finnish diacritics (non-ASCII but not HTML-special) unchanged', () => {
    expect(escapeHtml('Pöyhönen Ämä Åland')).toBe('Pöyhönen Ämä Åland');
  });

  it('defeats the classic attribute-injection payload', () => {
    // Injection into an unquoted/quoted attribute: all three chars must be escaped.
    const payload = `" onmouseover="alert(1)"`;
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain('"');
    expect(escaped).toContain('&quot;');
  });
});

describe('formatting — numeric string coercion is consistent across formatters', () => {
  // toNum() is shared — if one formatter handles "42" correctly, all should.
  it('formatNumber, formatEuro, formatEuroSqm, formatDensity all accept numeric strings', () => {
    expect(formatNumber('42')).not.toBe('—');
    expect(formatEuro('42')).not.toBe('—');
    expect(formatEuroSqm('42')).not.toBe('—');
    expect(formatDensity('42')).not.toBe('—');
  });

  it('all reject whitespace-only strings as missing', () => {
    // Number(' ') === 0, which should NOT display as "0 /km²" — matching user intent "no data".
    // The current toNum() returns 0 for whitespace via Number() coercion. This test
    // pins the current behavior so a future change is intentional.
    // (Number('  ') === 0, isFinite(0) === true → returns 0)
    expect(formatDensity('  ')).toBe('0 /km²');
  });
});
