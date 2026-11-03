/**
 * fi-detail.json: the map's note.* and metric_explanation.* prose is fetched at startup
 * rather than bundled. Before it lands, t() must answer '' for those keys — never the
 * raw key — and every other key must be unaffected.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fiDetail from '../locales/fi-detail.json';
import { t, setLang, isDetailKey, __testInjectFiDetail, __testResetFiDetail } from '../utils/i18n';

const DETAIL = fiDetail as Record<string, string>;
const aNote = Object.keys(DETAIL).find((k) => k.startsWith('note.'))!;
const anExplanation = Object.keys(DETAIL).find((k) => k.startsWith('metric_explanation.'))!;

afterEach(async () => {
  __testInjectFiDetail(DETAIL);
  await setLang('fi');
});

describe('fi-detail.json', () => {
  it('classifies keys by prefix, not by lookalikes', () => {
    expect(isDetailKey('note.walkability')).toBe(true);
    expect(isDetailKey('metric_explanation.median_income')).toBe(true);
    expect(isDetailKey('notes.title')).toBe(false);
    expect(isDetailKey('supporter.lightning.note')).toBe(false);
  });

  it('answers empty, not the raw key, for detail keys before it arrives', () => {
    __testResetFiDetail();
    // (Finnish still falls back to a loaded English dictionary, as for any key, so a
    // probe found in no dictionary is what shows the pre-arrival answer.)
    expect(t('note.__probe_absent')).toBe('');
    expect(t('metric_explanation.__probe_absent')).toBe('');
    expect(t(aNote)).not.toBe(aNote);
    // Bundled keys and genuinely unknown keys behave as before.
    expect(t('notes.title')).not.toBe('');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('serves the Finnish text once it has arrived', () => {
    __testResetFiDetail();
    __testInjectFiDetail(DETAIL);
    expect(t(aNote)).toBe(DETAIL[aNote]);
    // Once it has arrived, a missing detail key is reported as itself again.
    expect(t('note.__probe_absent')).toBe('note.__probe_absent');
  });

  it('lets English and Swedish answer from their own dictionaries regardless', async () => {
    __testResetFiDetail();
    await setLang('en');
    expect(t(aNote)).not.toBe('');
    expect(t(aNote)).not.toBe(aNote);
    await setLang('sv');
    expect(t(anExplanation)).not.toBe('');
  });
});
