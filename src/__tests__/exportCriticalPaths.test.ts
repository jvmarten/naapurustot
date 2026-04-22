import { describe, it, expect, beforeEach, vi } from 'vitest';
import { escapeHtml } from '../utils/formatting';

describe('escapeHtml', () => {
  it('escapes all HTML special characters', () => {
    expect(escapeHtml('<script>alert("XSS")</script>')).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('handles string with no special characters', () => {
    expect(escapeHtml('Helsinki')).toBe('Helsinki');
  });

  it('handles multiple consecutive special characters', () => {
    expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
  });

  it('handles mixed content with text and entities', () => {
    expect(escapeHtml('Hello <b>World</b> & "friends"')).toBe(
      'Hello &lt;b&gt;World&lt;/b&gt; &amp; &quot;friends&quot;'
    );
  });
});

describe('CSV injection protection', () => {
  it('formula-triggering characters are detected', () => {
    const dangerous = ['=cmd|', '+cmd|', '-cmd|', '@cmd|', '\tcmd', '\rcmd'];
    for (const s of dangerous) {
      expect(/^[=+\-@\t\r]/.test(s)).toBe(true);
    }
  });

  it('normal text is not flagged as injection', () => {
    const safe = ['hello', 'Helsinki', '00100', '30 000 €'];
    for (const s of safe) {
      expect(/^[=+\-@\t\r]/.test(s)).toBe(false);
    }
  });
});

describe('exportCsv', () => {
  it('creates a download link and triggers click', async () => {
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        vi.spyOn(el, 'click').mockImplementation(clickSpy);
      }
      return el;
    });
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');

    const { exportCsv } = await import('../utils/export');
    exportCsv({
      pno: '00100', nimi: 'Helsinki', namn: 'Helsingfors',
      kunta: '091', city: 'helsinki_metro', he_vakiy: 1000,
      quality_index: 75, hr_mtu: 30000, hr_ktu: 35000,
      unemployment_rate: 5, higher_education_rate: 45,
      foreign_language_pct: 10,
    } as any, {});

    expect(clickSpy).toHaveBeenCalled();
    expect(createUrlSpy).toHaveBeenCalled();
    const blob = createUrlSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toContain('text/csv');

    vi.restoreAllMocks();
  });

  it('sanitizes filename with special characters', async () => {
    let downloadName = '';
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        vi.spyOn(el, 'click').mockImplementation(() => {});
        Object.defineProperty(el, 'download', {
          get: () => downloadName,
          set: (v: string) => { downloadName = v; },
        });
      }
      return el;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');

    const { exportCsv } = await import('../utils/export');
    exportCsv({
      pno: '00100', nimi: 'Test/Area:Special', namn: 'Test',
      kunta: '091', city: 'helsinki_metro', he_vakiy: 1000,
    } as any, {});

    expect(downloadName).not.toContain('/');
    expect(downloadName).not.toContain(':');
    expect(downloadName).toContain('00100');

    vi.restoreAllMocks();
  });
});
