import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock i18n before importing modules that use it
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

// We need to test the internal CSV escaping and HTML escaping logic.
// Since exportCsv triggers DOM operations, we test the behavior end-to-end
// with mocked DOM APIs.

describe('exportCsv edge cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates CSV with BOM and correct content', async () => {
    // Dynamic import after mock is set up
    const { exportCsv } = await import('../utils/export');

    let blobContent = '';

    // Mock Blob to capture content
    const originalBlob = globalThis.Blob;
    vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts?: BlobPart[]) {
      blobContent = parts ? String(parts[0]) : '';
      return new originalBlob(parts);
    } as unknown as typeof Blob);

    // Mock URL.createObjectURL / revokeObjectURL
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Mock document.createElement to capture download filename
    const mockLink = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(mockLink as unknown as HTMLElement);

    const props = {
      pno: '00100',
      nimi: 'Kruununhaka',
      namn: 'Kronohagen',
      he_vakiy: 5000,
      hr_mtu: 35000,
      hr_ktu: 28000,
      unemployment_rate: 8.5,
      quality_index: 72,
    } as any;

    exportCsv(props, {});

    // Check BOM is present
    expect(blobContent.startsWith('\uFEFF')).toBe(true);

    // Check CSV structure (header + data rows)
    const lines = blobContent.replace('\uFEFF', '').split('\n');
    expect(lines.length).toBeGreaterThan(1);
    // Header should have two columns
    expect(lines[0]).toContain(',');

    // Download filename should include neighborhood name and PNO
    expect(mockLink.download).toBe('Kruununhaka_00100.csv');
    expect(mockLink.click).toHaveBeenCalled();
  });

  it('handles null values in properties gracefully', async () => {
    const { exportCsv } = await import('../utils/export');

    const originalBlob = globalThis.Blob;
    let blobContent = '';
    vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts?: BlobPart[]) {
      blobContent = parts ? String(parts[0]) : '';
      return new originalBlob(parts);
    } as unknown as typeof Blob);

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLElement);

    const props = {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      he_vakiy: null,
      hr_mtu: null,
      unemployment_rate: null,
      quality_index: null,
    } as any;

    // Should not throw
    expect(() => exportCsv(props, {})).not.toThrow();
    // Null values should appear as '—'
    expect(blobContent).toContain('—');
  });
});

describe('exportPdf', () => {
  it('opens a new window with HTML content', async () => {
    const { exportPdf } = await import('../utils/export');

    const listeners: Record<string, Function> = {};
    const mockWindow = {
      document: {
        write: vi.fn(),
        close: vi.fn(),
      },
      addEventListener: vi.fn((event: string, handler: Function) => { listeners[event] = handler; }),
      print: vi.fn(),
    };

    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    const props = {
      pno: '00100',
      nimi: 'Kruununhaka',
      namn: 'Kronohagen',
      he_vakiy: 5000,
      hr_mtu: 35000,
      quality_index: 72,
    } as any;

    exportPdf(props, {});

    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(mockWindow.document.write).toHaveBeenCalled();
    expect(mockWindow.document.close).toHaveBeenCalled();

    // Print is deferred to 'load' event for proper rendering
    listeners['load']?.();
    expect(mockWindow.print).toHaveBeenCalled();

    // Check HTML content includes neighborhood name (escaped)
    const htmlContent = mockWindow.document.write.mock.calls[0][0];
    expect(htmlContent).toContain('Kruununhaka');
    expect(htmlContent).toContain('00100');
  });

  it('handles null window.open gracefully', async () => {
    const { exportPdf } = await import('../utils/export');

    vi.spyOn(window, 'open').mockReturnValue(null);

    const props = {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      quality_index: null,
    } as any;

    // Should not throw when popup is blocked
    expect(() => exportPdf(props, {})).not.toThrow();
  });

  it('escapes HTML entities in neighborhood names', async () => {
    const { exportPdf } = await import('../utils/export');

    const mockWindow = {
      document: {
        write: vi.fn(),
        close: vi.fn(),
      },
      addEventListener: vi.fn(),
      print: vi.fn(),
    };

    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    const props = {
      pno: '00100',
      nimi: '<script>alert("xss")</script>',
      namn: 'Test & "Quotes"',
      quality_index: 50,
    } as any;

    exportPdf(props, {});

    const htmlContent = mockWindow.document.write.mock.calls[0][0] as string;
    // Should not contain raw script tags
    expect(htmlContent).not.toContain('<script>');
    expect(htmlContent).toContain('&lt;script&gt;');
  });
});
