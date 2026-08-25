/**
 * QW-8: drift guard for the statically-bundled Finnish locale.
 *
 * fi.json is imported into the always-loaded i18n chunk, so every dead string in
 * it costs bundle bytes forever. This test fails CI when a fi key (fi.json ∪
 * fi-extra.json) has zero references anywhere in src/ or scripts/, so orphaned
 * strings can't silently re-accumulate after a feature is removed.
 *
 * Many fi keys are composed at runtime (template-literal families), so the full
 * key never appears as a literal in source — those are exempted via
 * DYNAMIC_PREFIXES. The allowlist is kept deliberately NARROW (only genuinely
 * composed prefixes) so removed-feature residue like the old `panel.section.*`,
 * `settings.light_mode`/`dark_mode`, `filter.sort_*` and `app.subtitle` keys is
 * still caught rather than hidden behind a broad prefix.
 */
import { describe, it, expect } from 'vitest';
import fi from '../locales/fi.json';
import fiExtra from '../locales/fi-extra.json';

// Dynamic key families assembled at runtime — the full key never appears as a
// literal, so a substring scan can't find it. Each entry notes its composition
// site (verified in QW-8's investigation).
const DYNAMIC_PREFIXES = [
  'privacy.s_',          // PrivacyPage SECTION_KEYS → `${base}_h` / `${base}_b`
  'summary.sentence.',   // areaSummary.ts → `${base}` and `${base}_region`
  'metric_explanation.', // NeighborhoodPanel → `metric_explanation.${property}`
  'wizard.size_',        // NeighborhoodWizard → `wizard.size_${id}`
  'wizard.afford_mode_', // NeighborhoodWizard → `wizard.afford_mode_${mode}(_hint)`
  'wizard.pref_',        // NeighborhoodWizard → `wizard.pref_${pref}`
  'wizard.tenure_',      // NeighborhoodWizard → `wizard.tenure_${tenure}`
  'wizard.price_level_', // NeighborhoodWizard → `wizard.price_level_${level}`
  'wizard.foreigners_',  // NeighborhoodWizard → `wizard.foreigners_${pref}`
  'wizard.preset_',      // NeighborhoodWizard → `wizard.preset_${key}` (quick-start intents)
  'settings.theme_',     // SettingsDropdown → `settings.theme_${mode}`
  'settings.quality_scale_', // SettingsDropdown → `settings.quality_scale_${mode}(_help)`
  'correlation.sig_',    // CorrelationExplorer → `correlation.sig_${sig}`
  'live.air_quality.band_', // airquality.ts → `live.air_quality.band_${1..5}` (FMI index)
  'live.clouds.band_',   // clouds.ts → `live.clouds.band_${band}` (WMO okta bands)
  'live.wind.dir.',      // wind.ts → `live.wind.dir.${compass}` (8-point) + `.variable`
  'live.time_model.',    // FeedSidebar → `live.time_model.${feed.time}` (feed registry)
  'live.ship.type.',     // DetailPanel → `live.ship.type.${shipCategoryKey(...)}` (AIS class)
  'live.ship.status.',   // DetailPanel → `live.ship.status.${navStatusKey(...)}` (AIS navStat)
  'city.',               // region names → `city.${regionId}` (69 regions)
  'error.',              // NeighborhoodProfilePage → `error.${code}`
  'panel.plan_type_',    // NeighborhoodPanel → `panel.plan_type_${ptype}` (CF-3)
  'panel.plan_status_',  // NeighborhoodPanel → `panel.plan_status_${status}` (CF-3)
];

// Vite-native source scan: eagerly load every src + scripts code file as raw
// text (locale .json files are excluded by the extension globs, so keys never
// match their own definitions). data_sources.json is added separately because
// it holds `note.*` keys referenced as data rather than code literals.
const codeModules = import.meta.glob(
  ['../**/*.{ts,tsx,js,mjs,cjs}', '../../scripts/**/*.{ts,mjs,js,cjs}'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;
const dataModules = import.meta.glob('../data/data_sources.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const corpus = [...Object.values(codeModules), ...Object.values(dataModules)].join('\n');

describe('QW-8 fi locale unused-key drift guard', () => {
  const allKeys = [
    ...Object.keys(fi as Record<string, string>),
    ...Object.keys(fiExtra as Record<string, string>),
  ];

  it('has no orphan keys (every non-dynamic fi key is referenced in source)', () => {
    const orphans = allKeys.filter(
      (k) => !DYNAMIC_PREFIXES.some((p) => k.startsWith(p)) && !corpus.includes(k),
    );
    expect(
      orphans,
      `Unreferenced fi keys — delete them, or add the dynamic prefix to DYNAMIC_PREFIXES: ${orphans.join(', ')}`,
    ).toHaveLength(0);
  });

  it('keeps the dynamic-prefix allowlist tight (each prefix still matches keys)', () => {
    const unused = DYNAMIC_PREFIXES.filter((p) => !allKeys.some((k) => k.startsWith(p)));
    expect(unused, `DYNAMIC_PREFIXES no longer matching any key: ${unused.join(', ')}`).toHaveLength(0);
  });
});
