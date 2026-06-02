/**
 * PO-7: Locale key-parity gate.
 *
 * Finnish (fi.json) is the source of truth. English and Swedish must have exactly
 * the same set of keys, with no empty values and consistent {placeholder} tokens.
 * This fails CI the moment a new fi key lands without translations, so Swedish —
 * a co-official Finnish language — can never again silently fall back to Finnish
 * for part of the UI.
 */
import { describe, it, expect } from 'vitest';
import fi from '../locales/fi.json';
import en from '../locales/en.json';
import sv from '../locales/sv.json';

type Dict = Record<string, string>;
const FI = fi as Dict;
const EN = en as Dict;
const SV = sv as Dict;

const fiKeys = new Set(Object.keys(FI));

function placeholders(value: string): Set<string> {
  return new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

describe.each([
  ['en.json', EN],
  ['sv.json', SV],
])('%s key parity with fi.json', (name, dict) => {
  const keys = new Set(Object.keys(dict));

  it(`has every fi.json key`, () => {
    const missing = [...fiKeys].filter((k) => !keys.has(k));
    expect(missing, `${name} missing keys: ${missing.join(', ')}`).toHaveLength(0);
  });

  it(`has no keys absent from fi.json`, () => {
    const extra = [...keys].filter((k) => !fiKeys.has(k));
    expect(extra, `${name} has orphan keys not in fi.json: ${extra.join(', ')}`).toHaveLength(0);
  });

  it(`has the same {placeholder} tokens as fi.json for every key`, () => {
    const mismatches: string[] = [];
    for (const key of fiKeys) {
      if (!(key in dict)) continue;
      const fiPh = placeholders(FI[key]);
      const otherPh = placeholders(dict[key]);
      const same =
        fiPh.size === otherPh.size && [...fiPh].every((p) => otherPh.has(p));
      if (!same) mismatches.push(`${key} (fi: {${[...fiPh].join(',')}} vs ${[...otherPh].join(',')})`);
    }
    expect(mismatches, `${name} placeholder mismatches: ${mismatches.join('; ')}`).toHaveLength(0);
  });
});

describe.each([
  ['fi.json', FI],
  ['en.json', EN],
  ['sv.json', SV],
])('%s value integrity', (name, dict) => {
  it('has no empty or whitespace-only values', () => {
    const empty = Object.entries(dict)
      .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
      .map(([k]) => k);
    expect(empty, `${name} empty values: ${empty.join(', ')}`).toHaveLength(0);
  });
});
