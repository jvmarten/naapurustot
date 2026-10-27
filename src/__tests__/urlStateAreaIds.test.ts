import { describe, it, expect, beforeEach } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

function setSearch(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState(null, '', url.toString());
}

describe('readInitialUrlState — Swedish DeSO ids', () => {
  beforeEach(() => {
    window.location.hash = '';
    setSearch('');
  });

  it('carries DeSO codes through pno, compare, ref and sl like postal codes', () => {
    setSearch('?pno=0180C1090&compare=00100,0180C1091&ref=0180C1092&sl=00100.0180C1093.junk');
    const s = readInitialUrlState();
    expect(s.pno).toBe('0180C1090');
    expect(s.compare).toEqual(['00100', '0180C1091']);
    expect(s.ref).toBe('0180C1092');
    expect(s.shortlist).toEqual(['00100', '0180C1093']);
  });
});
