import { describe, it, expect } from 'vitest';
import { buildEmbedSnippet, buildFullViewUrl } from '../utils/embed';

describe('embed (QW-3)', () => {
  const state = {
    pno: '00100',
    layer: 'median_income',
    city: 'turku',
    compare: ['00200', '00300'],
    scope: 'region',
    year: 2022,
    colorblind: 'protanopia',
    lang: 'en',
  };

  it('buildFullViewUrl carries the full configured state', () => {
    const url = decodeURIComponent(buildFullViewUrl(state, 'https://naapurustot.fi'));
    expect(url).toContain('pno=00100');
    expect(url).toContain('layer=median_income');
    expect(url).toContain('city=turku');
    expect(url).toContain('compare=00200,00300');
    expect(url).toContain('scope=region');
    expect(url).toContain('year=2022');
    expect(url).toContain('cb=protanopia');
    expect(url).toContain('lang=en');
    expect(url).not.toContain('embed=1');
  });

  it('omits default values to keep the link short', () => {
    const url = buildFullViewUrl(
      { pno: null, layer: 'quality_index', city: 'all', scope: 'all', colorblind: 'off', lang: 'fi' },
      'https://naapurustot.fi',
    );
    expect(url).toBe('https://naapurustot.fi/');
  });

  it('buildEmbedSnippet sets embed=1, carries state, and includes the resize handshake', () => {
    const snippet = buildEmbedSnippet({ ...state, origin: 'https://naapurustot.fi' });
    expect(snippet).toContain('embed=1');
    expect(snippet).toContain('scope=region');
    expect(snippet).toContain('<iframe');
    expect(snippet).toContain('naapurustot:height');
  });
});
