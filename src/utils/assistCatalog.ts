/**
 * AS-1: the layer "vocabulary" the AI housing assistant is allowed to map wishes onto.
 *
 * Built from the single source of truth (LAYERS) plus the current-language i18n
 * labels, so the model reasons in the user's language and can only ever pick a
 * real, shipped layer. Sent to the backend with each query; the backend and this
 * module both re-validate, so a stale or malicious response can never apply a
 * bogus filter.
 */
import { LAYERS, LAYER_MAP, type LayerId } from './colorScales';
import { t } from './i18n';
import type { AssistCatalogEntry, AssistCriterion } from './api';
import type { FilterCriterion } from './filterUtils';

/**
 * Layers deliberately hidden from the assistant. Two reasons:
 *  - Not a "where do I want to live" preference: political party votes, turnout,
 *    and change/projection/trend layers describe a direction of travel, not a state.
 *  - Sensitive to steer on: foreign-language share and gender ratio are demographic
 *    attributes we do not want an assistant filtering neighborhoods by.
 * Sub-crime layers are dropped as duplicative of the crime_rate total.
 */
const EXCLUDED: ReadonlySet<LayerId> = new Set<LayerId>([
  'political_lean', 'party_kok', 'party_sdp', 'party_ps', 'party_kesk',
  'party_vihr', 'party_vas', 'party_rkp', 'party_diversity', 'voter_turnout',
  'income_change', 'population_change', 'population_projection',
  'unemployment_change', 'crime_index_change', 'property_price_change',
  'violent_crime', 'property_crime',
  'foreign_lang', 'foreign_lang_municipal', 'gender_ratio',
]);

/**
 * Build the catalog to send with a query. Uses `t()` so labels are in the active
 * language. `higherIsBetter` defaults to true (matching LayerConfig's own default)
 * and tells the model which raw direction is "good", so it can invert the user's
 * intent correctly (e.g. "safe" -> a LOW crime range).
 */
export function buildAssistCatalog(): AssistCatalogEntry[] {
  const out: AssistCatalogEntry[] = [];
  for (const layer of LAYERS) {
    if (EXCLUDED.has(layer.id)) continue;
    out.push({
      id: layer.id,
      label: t(layer.labelKey),
      higherIsBetter: layer.higherIsBetter !== false,
    });
  }
  return out;
}

/**
 * Convert the assistant's proposed criteria into FilterCriterion[] the app can apply.
 * Re-validates every layer id against LAYERS and clamps ranks to [0,100] — defence in
 * depth on top of the backend's own sanitisation.
 */
export function assistCriteriaToFilters(criteria: AssistCriterion[]): FilterCriterion[] {
  const out: FilterCriterion[] = [];
  for (const c of criteria) {
    if (!c || typeof c.layerId !== 'string') continue;
    if (!LAYER_MAP.has(c.layerId as LayerId)) continue;
    if (EXCLUDED.has(c.layerId as LayerId)) continue;
    let min = Number(c.min);
    let max = Number(c.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    min = Math.max(0, Math.min(100, min));
    max = Math.max(0, Math.min(100, max));
    if (min > max) [min, max] = [max, min];
    out.push({ layerId: c.layerId as LayerId, min, max, mode: 'percentile' });
  }
  return out;
}
