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
import fiExtra from '../locales/fi-extra.json';
import en from '../locales/en.json';
import sv from '../locales/sv.json';

type Dict = Record<string, string>;
const FI = fi as Dict;
const FI_EXTRA = fiExtra as Dict;
// IN-7: fi.json was split — page-only keys live in fi-extra.json. The source of
// truth for parity is the UNION (fi ∪ fi-extra); en/sv keep the full key set.
const FI_ALL: Dict = { ...FI, ...FI_EXTRA };
const EN = en as Dict;
const SV = sv as Dict;

const fiKeys = new Set(Object.keys(FI_ALL));

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
      const fiPh = placeholders(FI_ALL[key]);
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
  ['fi-extra.json', FI_EXTRA],
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

describe('fi.json / fi-extra.json split (IN-7)', () => {
  it('has no key present in both fi.json and fi-extra.json', () => {
    const both = Object.keys(FI).filter((k) => k in FI_EXTRA);
    expect(both, `keys duplicated across fi.json and fi-extra.json: ${both.join(', ')}`).toHaveLength(0);
  });
});
