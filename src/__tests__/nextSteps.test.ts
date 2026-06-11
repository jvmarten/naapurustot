import { describe, it, expect } from 'vitest';
import { buildNextSteps, citySlug } from '../utils/nextSteps';

describe('citySlug', () => {
  it('lowercases and transliterates Finnish letters', () => {
    expect(citySlug('Helsinki')).toBe('helsinki');
    expect(citySlug('Jyväskylä')).toBe('jyvaskyla');
    expect(citySlug('Mäntsälä')).toBe('mantsala');
    expect(citySlug('Ähtäri')).toBe('ahtari');
  });
  it('collapses non-alphanumerics to single hyphens', () => {
    expect(citySlug('Hämeenlinna  ')).toBe('hameenlinna');
    expect(citySlug('Pedersören kunta')).toBe('pedersoren-kunta');
  });
});

describe('buildNextSteps', () => {
  it('builds sale + rent links from the municipality', () => {
    const steps = buildNextSteps({ municipality: 'Helsinki', nimi: 'Kallio' });
    const sale = steps.find((s) => s.kind === 'sale');
    const rent = steps.find((s) => s.kind === 'rent');
    expect(sale?.href).toBe('https://asunnot.oikotie.fi/myytavat-asunnot/helsinki');
    expect(rent?.href).toContain('vuokraovi.com/vuokra-asunnot/Helsinki');
  });

  it('builds a journey-planner link from the centroid', () => {
    const steps = buildNextSteps({ municipality: 'Tampere', lat: 61.498, lon: 23.76, nimi: 'Keskusta' });
    const visit = steps.find((s) => s.kind === 'visit');
    expect(visit?.href).toContain('opas.matka.fi');
    expect(visit?.href).toContain('61.498,23.76');
  });

  it('omits housing links without a municipality and visit without coords', () => {
    expect(buildNextSteps({})).toEqual([]);
    expect(buildNextSteps({ lat: 60, lon: 24 }).map((s) => s.kind)).toEqual(['visit']);
    expect(buildNextSteps({ municipality: 'Oulu' }).map((s) => s.kind)).toEqual(['sale', 'rent']);
  });
});
